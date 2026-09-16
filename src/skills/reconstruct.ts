/**
 * `reconstructRepo` — the inverse of `extractSkill`, for one repository.
 * Pure: no fs, no network, no clock.
 *
 * `reconstruct.ts` exists to PROVE `extract.ts` correct (design decision 4),
 * not as a feature in its own right — every extraction test in this project
 * asserts round-trip byte equality against a literal, never against a
 * fixture written from the same understanding as the code. Two independent
 * transformations (grouping-and-classifying, then resolving-and-replaying)
 * composing to the identity is an assertion no fixture can agree with, which
 * is exactly why it is the load-bearing test of the whole change.
 *
 * Reconstruction walks the core's sections in order and, at each one,
 * replays every op whose `heading` matches and whose `repos` include this
 * repository. An op with `anchor: null` goes before the section's first
 * anchor line; every other op is placed by resolving its `anchor` text
 * through `resolveAnchor` — the SAME resolver `sync` would use, so an
 * anchor that has become ambiguous since extraction (a heading edited by
 * hand, say) fails LOUD here too, never silently.
 *
 * `conflicts` ops are replayed alongside `overrides` (design decision 2:
 * "reconstruction applies all three, so it reaches 42 of 42"). Distribution
 * consults only `core` + `overrides`; reconstruction — the proof that
 * nothing was lost — consults all three.
 */

import { resolveAnchor } from "./anchor.ts";
import type { ExtractedSkill, PatchOp } from "./extract.ts";

function sameHeading(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/** A stable sort key for ops that land at the SAME resolved position — this
 * is what makes task 3.2's shuffled-order guarantee more than accidental:
 * whatever order the caller's `Map`/array happens to iterate in, ops at one
 * position are always replayed in this order, never insertion order. */
function opSortKey(op: PatchOp): string {
  return JSON.stringify([op.attribution, [...op.repos].sort(), op.content]);
}

function opsForRepoAndHeading(
  extracted: ExtractedSkill,
  repo: string,
  heading: readonly string[],
): PatchOp[] {
  const candidates: PatchOp[] = [...(extracted.overrides.get(repo) ?? []), ...extracted.conflicts];
  return candidates
    .filter((op) => op.repos.includes(repo) && sameHeading(op.heading, heading))
    .sort((a, b) => opSortKey(a).localeCompare(opSortKey(b)));
}

function headingKey(heading: readonly string[]): string {
  return JSON.stringify(heading);
}

/**
 * Rebuilds `repo`'s original section-by-section body from `extracted`.
 * Sections where `repo` is listed in `absentFor` are skipped entirely —
 * that repository never had this heading, so reconstructing it would
 * invent a section it never wrote (see `extract.ts` on `body === null`).
 *
 * `extractSkill` always records a `CoreSection` for every heading it saw
 * (task 2.7), so this is the normal path. But `meetsCoreFloor` (task 4)
 * must also fail correctly for a hand-built `ExtractedSkill` that skips
 * `core` entirely and puts a whole file into one override — the "empty
 * core" trap `exploration.md` names — so any op whose heading has NO
 * matching `core` entry is still replayed, appended after the real
 * sections, in a fixed order (task 4.1: reconstruction must still SUCCEED
 * for that shape, only the floor is supposed to catch it).
 */
export function reconstructRepo(extracted: ExtractedSkill, repo: string): readonly string[] {
  const output: string[] = [];
  const knownHeadings = new Set(extracted.core.map((s) => headingKey(s.path)));

  for (const section of extracted.core) {
    if (section.absentFor.includes(repo)) continue;

    const ops = opsForRepoAndHeading(extracted, repo, section.path);

    // Ops anchored at `null` — "before the first anchor line" — including
    // the degenerate case of a section with NO anchors at all (a fully
    // divergent section: everything for this repo lives in this one op).
    for (const op of ops.filter((o) => o.anchor === null)) {
      output.push(...op.content.split("\n"));
    }

    section.lines.forEach((anchorLine, index) => {
      output.push(anchorLine);

      // Resolve every non-null anchor THROUGH resolveAnchor, scoped to this
      // section's own lines — not by comparing `op.anchor === anchorLine`
      // directly, which would silently apply an op after every occurrence
      // of a repeated anchor line instead of failing loud on the ambiguity
      // SPEC 2.1.1 calls fatal.
      for (const op of ops) {
        if (op.anchor === null) continue;
        const resolved = resolveAnchor({
          skill: extracted.skill,
          repo,
          heading: section.path,
          lines: section.lines,
          anchor: op.anchor,
        });
        if (resolved === index) output.push(...op.content.split("\n"));
      }
    });
  }

  const orphanHeadings: string[] = [];
  const seenOrphan = new Set<string>();
  for (const op of [...(extracted.overrides.get(repo) ?? []), ...extracted.conflicts]) {
    if (!op.repos.includes(repo)) continue;
    const key = headingKey(op.heading);
    if (knownHeadings.has(key) || seenOrphan.has(key)) continue;
    seenOrphan.add(key);
    orphanHeadings.push(key);
  }

  for (const key of orphanHeadings.sort()) {
    const heading = JSON.parse(key) as string[];
    const ops = opsForRepoAndHeading(extracted, repo, heading).filter((op) => op.anchor === null);
    for (const op of ops) output.push(...op.content.split("\n"));
  }

  return output;
}

export interface LossyReport {
  readonly skill: string;
  readonly repo: string;
  readonly expected: readonly string[];
  readonly actual: readonly string[];
}

export interface ReconstructionSummary {
  readonly reconstructed: number;
  readonly lossy: readonly LossyReport[];
}

function linesEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/**
 * Reconstructs every repo in `originals` and reports which matched byte for
 * byte. `reconstructed + lossy.length === originals.size` always — the loop
 * below visits every entry exactly once and puts it in exactly one bucket,
 * so this is arithmetic, not something that could drift out of sync (task
 * 3.4).
 */
export function reconstructAndVerify(
  extracted: ExtractedSkill,
  originals: ReadonlyMap<string, readonly string[]>,
): ReconstructionSummary {
  let reconstructed = 0;
  const lossy: LossyReport[] = [];

  for (const [repo, expected] of originals) {
    const actual = reconstructRepo(extracted, repo);
    if (linesEqual(actual, expected)) {
      reconstructed++;
    } else {
      lossy.push({ skill: extracted.skill, repo, expected, actual });
    }
  }

  return { reconstructed, lossy };
}

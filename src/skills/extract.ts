/**
 * `extractSkill` — `SkillDiff` -> `ExtractedSkill` (SPEC 2.1; design decision
 * 3). Pure: no fs, no network, no clock.
 *
 * Extraction is a PROJECTION of `diffSkill`'s output, not a second analysis:
 *
 *     SkillDiff  --project-->  core  +  overrides/<repo>  +  conflicts
 *
 * `diff.ts` already did the hard part — grouping section bodies, segmenting
 * divergent blocks, classifying by marker. This module only asks, for each
 * already-classified section: does it stay whole in the core, or does it
 * contribute its anchors to the core and its divergent content to ops? That
 * is why `ClassifiedSection` carries `wholeLines` and `anchors` (added for
 * this change) instead of this module recomputing `commonAcrossGroups`
 * itself — recomputing it here would be a second analysis of the same
 * corpus, and the two would drift with nobody able to see it, because each
 * would have its own tests (the same argument that keeps `covers()` a single
 * function in the crosscheck).
 *
 * A section with no divergent blocks (`blocks.length === 0`) goes to the
 * core whole. A divergent section contributes only its `anchors` — the
 * lines common to every variant — to the core, and each divergent position
 * becomes one or more patch ops, keyed by the anchor line that precedes it
 * (`null` for the position before the first anchor, i.e. the start of the
 * section).
 *
 * `override` and `sharedOverride` ops are materialised into EVERY repo in
 * their group's `overrides/<repo>` list — reconstruction is per repo, so
 * each member needs its own copy, even though a `sharedOverride` is
 * attributed to no SINGLE repo in the report (task 2.5). `conflict` ops go
 * to a separate list and are never written into any repo's overrides (task
 * 2.4) — SPEC 2.1.1 forbids resolving a conflict automatically, and putting
 * it in an override file is exactly that: it launders a divergence nobody
 * declared into a decision `sync` would then distribute as policy.
 */

import type { ClassifiedSection, DivergentBlock, SectionCategory, SkillDiff } from "./types.ts";

/**
 * One patch operation: insert `content` immediately after `anchor` within
 * `heading` (or at the very start of the section when `anchor` is `null`).
 * `repos` are every repository this op reconstructs — for a `conflict` op
 * this is still populated (reconstruction of the FULL corpus applies
 * conflicts too, design decision 2: "reconstruction applies all three"),
 * even though a conflict is never written into any `overrides/<repo>` file.
 */
export interface PatchOp {
  readonly heading: readonly string[];
  readonly anchor: string | null;
  readonly content: string;
  readonly repos: readonly string[];
  readonly attribution: SectionCategory;
}

export interface CoreSection {
  readonly path: readonly string[];
  /** The skeleton: the whole body for a fully common section, or just the
   * anchors for a divergent one. */
  readonly lines: readonly string[];
  /** Repos whose original file has no such heading at all — reconstruction
   * skips this section entirely for them (never emits the skeleton). */
  readonly absentFor: readonly string[];
}

export interface ExtractedSkill {
  readonly skill: string;
  readonly repos: readonly string[];
  readonly core: readonly CoreSection[];
  /** Every repo in `skill`'s repo list has an entry, even an empty one — a
   * repo with nothing to override is a fact, not an absence. */
  readonly overrides: ReadonlyMap<string, readonly PatchOp[]>;
  readonly conflicts: readonly PatchOp[];
  /** The core's share of total content, 0..1 (task 2.6; SPEC's ≥ 50 % floor
   * lives in `meetsCoreFloor`, not here — this module only measures). */
  readonly coreShare: number;
  /** `false` exactly when `conflicts` is non-empty (design decision 2). */
  readonly distributable: boolean;
  /** Human-readable "heading: anchor" for each blocking conflict, for a
   * report to name without re-deriving it. */
  readonly blockingConflicts: readonly string[];
}

function headingLabel(heading: readonly string[]): string {
  return heading.length === 0 ? "(preamble)" : heading.join(" > ");
}

function anchorLabel(anchor: string | null): string {
  return anchor === null ? "(start of section)" : anchor;
}

/** Repos in any group whose body is `null` — SPEC's "absent-versus-present
 * is distinct" (types.ts on `SectionGroup.body`): those repos never had
 * this heading at all, so their reconstruction must skip the whole section,
 * not just this one divergent position. */
function absentReposIn(section: ClassifiedSection): string[] {
  const absent = new Set<string>();
  for (const block of section.blocks) {
    for (const group of block.groups) {
      if (group.body === null) {
        for (const repo of group.repos) absent.add(repo);
      }
    }
  }
  return [...absent].sort((a, b) => a.localeCompare(b));
}

/** Groups blocks by the slot they occupy — `classifyPosition` can return
 * more than one block for the same slot when markers are mixed (design
 * decision 1's "split, never collapse"), and extraction must treat those as
 * one position with several ops, not several positions. */
function groupBySlot(blocks: readonly DivergentBlock[]): Map<number, DivergentBlock[]> {
  const bySlot = new Map<number, DivergentBlock[]>();
  for (const block of blocks) {
    const list = bySlot.get(block.slot);
    if (list) {
      list.push(block);
    } else {
      bySlot.set(block.slot, [block]);
    }
  }
  return bySlot;
}

export function extractSkill(diff: SkillDiff): ExtractedSkill {
  const core: CoreSection[] = [];
  const overridesByRepo = new Map<string, PatchOp[]>();
  for (const repo of diff.repos) overridesByRepo.set(repo, []);
  const conflicts: PatchOp[] = [];

  for (const section of diff.sections) {
    if (section.blocks.length === 0) {
      core.push({ path: section.path, lines: section.wholeLines ?? [], absentFor: [] });
      continue;
    }

    core.push({ path: section.path, lines: [...section.anchors], absentFor: absentReposIn(section) });

    const bySlot = groupBySlot(section.blocks);
    for (const slot of [...bySlot.keys()].sort((a, b) => a - b)) {
      const anchor = slot === 0 ? null : section.anchors[slot - 1]!;

      for (const block of bySlot.get(slot)!) {
        for (const group of block.groups) {
          // A group with nothing to insert here — e.g. the absent-body
          // group, or a repo whose content at this position is empty —
          // contributes no op. Its repos reconstruct from the skeleton
          // alone.
          if (group.diffLines.length === 0) continue;

          const op: PatchOp = {
            heading: section.path,
            anchor,
            content: group.diffLines.join("\n"),
            repos: group.repos,
            attribution: block.category,
          };

          if (block.category === "conflict") {
            conflicts.push(op);
            continue;
          }

          for (const repo of group.repos) {
            overridesByRepo.get(repo)?.push(op);
          }
        }
      }
    }
  }

  // One entry per blocking POSITION (heading + anchor), not per op — a
  // conflict at one position is typically emitted as one op per distinct
  // group (design decision 1: "no base repository", every population is its
  // own group), and a person resolving conflicts needs "these positions
  // block you," not the same position repeated once per group that
  // disagrees there.
  const blockingConflicts = [
    ...new Set(conflicts.map((op) => `${headingLabel(op.heading)}: ${anchorLabel(op.anchor)}`)),
  ];

  const withoutShare: Omit<ExtractedSkill, "coreShare"> = {
    skill: diff.skill,
    repos: diff.repos,
    core,
    overrides: overridesByRepo,
    conflicts,
    distributable: conflicts.length === 0,
    blockingConflicts,
  };

  return { ...withoutShare, coreShare: computeCoreShare(withoutShare) };
}

/**
 * Derives the core's share of total content DIRECTLY from `core`,
 * `overrides` and `conflicts` — never trusted as a field set independently
 * of them, so a hand-built `ExtractedSkill` (task 4.1: "every file whole as
 * its own override") measures the same way a real extraction does. Without
 * this, the ≥ 50 % floor (SPEC 2.4) would be checking a number that could
 * disagree with the structure it is supposed to describe.
 *
 * Divergent content is counted ONCE per distinct (heading, anchor, content,
 * attribution) — a `PatchOp` is replicated into every member repo's
 * override list (extraction above), and counting each replica would make
 * the share shrink with the number of repos sharing an override rather than
 * with how much content actually diverges.
 */
export function computeCoreShare(extracted: Pick<ExtractedSkill, "core" | "overrides" | "conflicts">): number {
  const coreLines = extracted.core.reduce((sum, s) => sum + s.lines.length, 0);

  const seen = new Set<string>();
  let divergentLines = 0;
  for (const op of [...[...extracted.overrides.values()].flat(), ...extracted.conflicts]) {
    const key = JSON.stringify([op.heading, op.anchor, op.content, op.attribution]);
    if (seen.has(key)) continue;
    seen.add(key);
    divergentLines += op.content.length === 0 ? 0 : op.content.split("\n").length;
  }

  const totalLines = coreLines + divergentLines;
  return totalLines === 0 ? 1 : coreLines / totalLines;
}

/** SPEC's ≥ 50 % floor (task 4.2) — a hard check, kept separate from
 * `extractSkill` so task 4.1's "empty core still fails" test can construct
 * an `ExtractedSkill` by hand and check the floor without re-running the
 * whole classifier. */
export function meetsCoreFloor(extracted: ExtractedSkill, floor = 0.5): boolean {
  return computeCoreShare(extracted) >= floor;
}

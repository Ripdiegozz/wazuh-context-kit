/**
 * `planSync` — `ExtractedSkill[] -> SyncPlan` for one target repository
 * (SPEC 2.3). Pure: no fs, no network, no clock.
 *
 * `sync` plans before it writes (design decision 1). This module decides
 * WHAT would be materialised and WHAT is blocked, and returns a value that
 * both the "0 of 6 distributed" report and the actual write in `apply.ts`
 * are built from — the same value driving both means the summary and the
 * disk cannot disagree, the failure this project has repeatedly built
 * guardrails against in the sibling `src/skills/` package.
 *
 * A skill blocked by its own conflicts must not block a clean one (SPEC:
 * "sync never distributes a skill carrying conflicts", "distribute skills
 * independently of one another"). `planSync` partitions every skill into
 * `distributed` and `blocked` — a FILTER, never a guard clause that stops at
 * the first blocked skill (design decision 4): with six blocked skills, all
 * six reasons are reported, not just the first.
 *
 * The materialised content is THIS REPOSITORY'S OWN reconstruction —
 * `core` + this repo's `overrides` replayed by `reconstructRepo` — not a
 * generic repo-agnostic "core only" copy. `reconstructRepo` already resolves
 * every override anchor through `resolveAnchor` (`anchor.ts`), so an anchor
 * that has become ambiguous is fatal here, at PLANNING time, before any byte
 * reaches disk (SPEC 2.1.1, and the reason `applySync` never needs its own
 * anchor-resolution logic: there is only one resolver in this project, and
 * `sync` uses the same one `reconstruct.ts` already proved correct).
 *
 * A skill the target repository has no copy of is reported as `blocked` too
 * — not silently dropped, and not "distributed" with invented content. It is
 * not a conflict, but it is still a reason nothing was written for that
 * skill, and SPEC's "0 of 6, and what blocks each" promises a reason for
 * every skill that did not ship, not only the conflict ones.
 */

import { createHash } from "node:crypto";
import { applySettings } from "../settings/apply.ts";
import type { ConflictKind, MergedSettings, SettingsConflict } from "../settings/types.ts";
import { headingLabel } from "../skills/extract.ts";
import type { ExtractedSkill } from "../skills/extract.ts";
import { reconstructRepo } from "../skills/reconstruct.ts";

/** SHA-256 of the exact bytes given, hex-encoded and prefixed the same way
 * `src/matrix/hash.ts` prefixes a payload hash — one hashing convention
 * across the project. Exact bytes, no normalisation: a trailing-newline
 * difference must change this hash, because normalising is how a real edit
 * gets hidden (design's "what could go wrong"). */
export function hashContent(content: string): string {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

export interface DistributedFile {
  readonly skill: string;
  /** Relative to `.claude/standards/` — never an absolute path, so the plan
   * stays independent of where `apply.ts` eventually roots it. */
  readonly path: string;
  readonly content: string;
  readonly hash: string;
}

/** One heading path's conflict count, for the readable summary
 * (`render.ts`). Grouping and deduplicating by heading — rather than
 * printing one line per `PatchOp` — is what turns "14 conflicts" from a wall
 * of repeated conflict bodies into something a person can act on: WHERE the
 * conflicts are, and how many sit at each position, never the disputed text
 * itself (that already lives in `conflicts/<skill>.yml`). */
export interface ConflictHeadingCount {
  readonly heading: string;
  readonly count: number;
}

export interface BlockedSkill {
  readonly skill: string;
  /** Never empty — a skill is only `blocked`, never merely absent, and
   * every entry here is something a person can act on. Machine-oriented:
   * one string per blocking position (heading + anchor), unchanged since
   * `extractSkill` computed it. `render.ts` does NOT use this field for the
   * human-facing summary — see `conflictHeadings`. */
  readonly reasons: readonly string[];
  /**
   * The SAME conflicts as `reasons`, grouped by heading path and counted —
   * built directly from `ExtractedSkill.conflicts`, never re-derived from
   * `reasons`' formatted strings (a heading can legitimately contain its own
   * colon, e.g. "Issue source: public vs internal", which makes parsing
   * `reasons` back apart ambiguous; going to the structured source avoids
   * that entirely). Empty when this skill is blocked for a reason that is
   * not a conflict (e.g. the target repository has no copy of it) — there,
   * `reasons` alone carries the explanation.
   */
  readonly conflictHeadings: readonly ConflictHeadingCount[];
}

export interface ManifestFile {
  readonly path: string;
  readonly hash: string;
}

/**
 * The contract between `sync` and `check` (design decision 2). `tool` and
 * `payloadHash` let `check` say WHICH of "edited locally" or "a different
 * version was synced" happened, instead of collapsing both into one
 * accusation.
 */
export interface SyncManifest {
  readonly tool: string;
  readonly payloadHash: string;
  readonly files: readonly ManifestFile[];
}

/** One conflict kind's count — the settings analogue of `ConflictHeadingCount`
 * (design decision 4: "the report groups by kind"). `.claude/settings.json`
 * has no marker convention, so unlike a skill's undeclared-divergence
 * conflicts, its two kinds — `removed-from-core` and `scalar-disagreement`
 * — say WHY it is a conflict, not just where. */
export interface ConflictKindCount {
  readonly kind: ConflictKind;
  readonly count: number;
}

/** The settings analogue of `BlockedSkill` — never empty, same discipline:
 * every `.claude/settings.json` conflict blocks the WHOLE file for every
 * repository, mirroring how one skill's conflicts block that skill for
 * every repository rather than only the repo that happens to appear in the
 * conflict (design.md: "one conflicts layer... the same gate blocks
 * distribution"). */
export interface BlockedSettings {
  readonly reasons: readonly string[];
  readonly conflictsByKind: readonly ConflictKindCount[];
}

export interface DistributedSettings {
  /** Relative to the target repository's root, matching the real file this
   * change ultimately materialises — `.claude/settings.json` itself, never
   * `.claude/standards/...` the way skills are (settings.json is not a
   * generated standard, it is the file Claude Code itself reads). */
  readonly path: string;
  readonly content: string;
  readonly hash: string;
}

/** `null` exactly when the caller passed no `MergedSettings` at all — a run
 * that never considered `.claude/settings.json` is a different fact from
 * one that considered it and found it clean, the same "not-applicable vs
 * verified" distinction `standards/verify.ts` makes for `check`. When
 * non-null, exactly one of `distributed`/`blocked` is set, never both and
 * never neither — mirroring `BlockedSkill`/`DistributedFile`'s own
 * partition. */
export interface SettingsPlan {
  readonly distributed: DistributedSettings | null;
  readonly blocked: BlockedSettings | null;
}

export interface SyncPlan {
  readonly repo: string;
  readonly distributed: readonly DistributedFile[];
  readonly blocked: readonly BlockedSkill[];
  readonly manifest: SyncManifest;
  /** Optional so existing hand-built `SyncPlan` fixtures (predating this
   * change) stay valid without edits — `planSync` itself always sets it,
   * to `null` when no `MergedSettings` was supplied. */
  readonly settings?: SettingsPlan | null;
}

function standardPath(skill: string): string {
  return `skills/${skill}/SKILL.md`;
}

/** `.claude/settings.json`'s own path, distinct from `standardPath` above —
 * settings is not written under `.claude/standards/`. */
const SETTINGS_PATH = ".claude/settings.json";

/** One human-readable line per conflict, naming its kind (task 3.3: "the
 * reason naming it") — never the disputed content verbatim beyond what is
 * needed to identify it, the same restraint `render.ts` uses for skill
 * conflicts (the full detail lives in the conflict object itself, not the
 * summary line). */
function describeSettingsConflict(conflict: SettingsConflict): string {
  const heading = conflict.path.join(".");
  if (conflict.kind === "removed-from-core") {
    return (
      `${heading}: '${conflict.value}' is present in every repository except '${conflict.missingFrom}' ` +
      `(removed-from-core)`
    );
  }
  const values = conflict.variants.map((v) => `${v.repo}=${JSON.stringify(v.value)}`).join(", ");
  return `${heading}: repositories disagree (scalar-disagreement) — ${values}`;
}

/** Groups `conflicts` by kind, counted and sorted by kind name — the
 * structured basis for `BlockedSettings.conflictsByKind` (task 3.2). */
function groupSettingsConflictsByKind(conflicts: readonly SettingsConflict[]): ConflictKindCount[] {
  const counts = new Map<ConflictKind, number>();
  for (const conflict of conflicts) counts.set(conflict.kind, (counts.get(conflict.kind) ?? 0) + 1);
  return [...counts.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => a.kind.localeCompare(b.kind));
}

/**
 * Plans `.claude/settings.json` for `repo` from `mergedSettings` — `null`
 * when the caller supplied none. Any conflict at all blocks the file for
 * EVERY repository (task 3.3), the same all-or-nothing gate `distributable`
 * applies to a skill: a conflict is, by construction, content nobody can
 * safely reconstruct on any one repository's behalf, so there is no partial
 * distribution to offer.
 */
function planSettings(mergedSettings: MergedSettings | undefined, repo: string): SettingsPlan | null {
  if (!mergedSettings) return null;

  if (mergedSettings.conflicts.length > 0) {
    return {
      distributed: null,
      blocked: {
        reasons: mergedSettings.conflicts.map(describeSettingsConflict),
        conflictsByKind: groupSettingsConflictsByKind(mergedSettings.conflicts),
      },
    };
  }

  const settingsTree = applySettings(mergedSettings, repo);
  const content = `${JSON.stringify(settingsTree, null, 2)}\n`;
  return { distributed: { path: SETTINGS_PATH, content, hash: hashContent(content) }, blocked: null };
}

/** Groups `conflicts` by heading path, counted, sorted by heading — the
 * structured basis for the readable summary (design: never re-derive this
 * from the pre-formatted `blockingConflicts` strings). */
function groupConflictsByHeading(conflicts: ExtractedSkill["conflicts"]): ConflictHeadingCount[] {
  const counts = new Map<string, number>();
  for (const op of conflicts) {
    const heading = headingLabel(op.heading);
    counts.set(heading, (counts.get(heading) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([heading, count]) => ({ heading, count }))
    .sort((a, b) => a.heading.localeCompare(b.heading));
}

/**
 * Builds `SyncPlan` for `repo` from `extracted` — every `ExtractedSkill` the
 * caller wants considered, typically every skill a `skills-diff --extract`
 * run produced. Deterministic ordering (skill name) so two runs over
 * identical inputs produce byte-identical manifests, matching the
 * determinism-by-construction discipline `emit.ts` established for the
 * sibling package.
 */
export function planSync(
  extracted: readonly ExtractedSkill[],
  repo: string,
  tool: string,
  mergedSettings?: MergedSettings,
): SyncPlan {
  const distributed: DistributedFile[] = [];
  const blocked: BlockedSkill[] = [];

  const sorted = [...extracted].sort((a, b) => a.skill.localeCompare(b.skill));

  for (const skill of sorted) {
    if (!skill.repos.includes(repo)) {
      blocked.push({
        skill: skill.skill,
        reasons: [`repository '${repo}' has no copy of this skill`],
        conflictHeadings: [],
      });
      continue;
    }

    if (!skill.distributable) {
      blocked.push({
        skill: skill.skill,
        reasons: skill.blockingConflicts,
        conflictHeadings: groupConflictsByHeading(skill.conflicts),
      });
      continue;
    }

    // Distributable means `skill.conflicts` is empty (extract.ts), so this
    // is exactly `core` replayed with `repo`'s own overrides applied — never
    // a conflict op, since there are none to apply.
    const lines = reconstructRepo(skill, repo);
    const content = `${lines.join("\n")}\n`;
    const path = standardPath(skill.skill);
    distributed.push({ skill: skill.skill, path, content, hash: hashContent(content) });
  }

  const settingsPlan = planSettings(mergedSettings, repo);

  // The settings file joins the SAME manifest as the skills — "sync
  // materialises them alongside the skills" (design.md) means one manifest
  // covers both, so `check` can detect drift in either without a second
  // contract to keep in sync with this one.
  const files: ManifestFile[] = [
    ...distributed.map((d) => ({ path: d.path, hash: d.hash })),
    ...(settingsPlan?.distributed ? [{ path: settingsPlan.distributed.path, hash: settingsPlan.distributed.hash }] : []),
  ].sort((a, b) => a.path.localeCompare(b.path));

  const payloadHash = hashContent(JSON.stringify(files));

  return {
    repo,
    distributed,
    blocked,
    manifest: { tool, payloadHash, files },
    settings: settingsPlan,
  };
}

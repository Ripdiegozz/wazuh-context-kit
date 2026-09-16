/**
 * Domain types for `src/skills/` — the `skills-diff` analysis (SPEC 2.1).
 *
 * This module is part of the pure core (SPEC 6.1): no fs, no network, no
 * clock. Every classification decision here is a decision about strings, so
 * every type is shaped to be constructible from a literal in a test file —
 * there is no fixture-file surface for the pure layer to disagree with.
 */

/** The two fields SPEC 2.1 cares about. `description` legitimately differs
 * per repository (design decision 3); `name` must not. */
export interface SkillFrontmatter {
  readonly name: string;
  readonly description: string;
}

/**
 * A `> **repo-specific(...):**` marker, located by its line index within the
 * section that contains it (design decision 1, point 5 — a marker only
 * explains the divergence at its OWN lines, not the whole body).
 *
 * `repo === null` is the unattributed form, `> **repo-specific:**` — SPEC's
 * "15 of 97 markers name no repository" (design decision 2). It is never
 * upgraded to a name by inference.
 */
export interface SectionMarker {
  readonly lineIndex: number;
  readonly repo: string | null;
}

/**
 * One heading-delimited unit of a `SKILL.md` (design: "the anchor is the
 * heading"). `path` is empty for the preamble — content before the first
 * heading is real and is never dropped (task 1.3).
 */
export interface ParsedSection {
  readonly path: readonly string[];
  readonly lines: readonly string[];
  readonly markers: readonly SectionMarker[];
}

export interface ParsedSkill {
  readonly frontmatter: SkillFrontmatter;
  readonly sections: readonly ParsedSection[];
}

/** One repository's copy of a skill, the unit `diffSkill` compares. */
export interface SkillVariant {
  readonly repo: string;
  readonly skill: ParsedSkill;
}

/** A divergent BLOCK's category — never `"common"`: a block only exists
 * because something diverges (SPEC 2.4, "todo bloque divergente"). A fully
 * common section has zero blocks, see `ClassifiedSection`. */
export type SectionCategory = "override" | "sharedOverride" | "conflict";

/**
 * "2 of 13 lines differ" as data (design decision 1, point 4). `total` and
 * `common` describe the ENCLOSING SECTION (context: how big is it, how much
 * of it is untouched by ANY divergence); `differing` is scoped to THIS block
 * alone, so two unrelated findings in the same 13-line section each report
 * their own (small) `differing` count against the same section-wide `total`.
 */
export interface LineMagnitude {
  readonly total: number;
  readonly common: number;
  readonly differing: number;
}

/**
 * One content population within one divergent BLOCK (design decision 1: "no
 * base repository" — every group is reported the same way, none privileged).
 *
 * `body === null` marks the group of repositories where the ENCLOSING
 * SECTION is entirely absent (task 2.8). `diffLines` is this group's content
 * for this block specifically — not its whole section body, and not even
 * every line that differs somewhere in the section, only the lines that
 * belong to THIS finding.
 */
export interface SectionGroup {
  readonly repos: readonly string[];
  readonly body: string | null;
  readonly diffLines: readonly string[];
  readonly marker: "named" | "unnamed" | "none";
}

/**
 * One independent finding within a section (SPEC 2.4's unit: "todo bloque
 * divergente cae en común / override / CONFLICTO" — the divergent BLOCK, not
 * the section). A single section can hold several: an independent oracle run
 * found a real `develop-issue` section carrying both a declared
 * `repo-specific (wazuh-dashboard)` override AND a separate, unmarked wording
 * disagreement — collapsing both into one section-wide label hid one of them
 * no matter which label won.
 */
export interface DivergentBlock {
  readonly category: SectionCategory;
  readonly groups: readonly SectionGroup[];
  readonly magnitude: LineMagnitude;
  /**
   * The 0-based gap this block occupies among the section's `anchors`
   * (`0` is "before the first anchor", `anchors.length` is "after the
   * last"). `skills-core`'s extraction (design decision 1) needs this to
   * know WHERE to anchor its patch op — two blocks can share a `slot` when
   * `classifyPosition` splits a mixed-marker position, and extraction must
   * treat them as the same location, not two.
   */
  readonly slot: number;
}

/**
 * `blocks` is empty for a fully common section — nothing diverged, so there
 * is nothing to classify (SPEC 2.4: "todo bloque divergente", not "toda
 * sección").
 *
 * `wholeLines` and `anchors` exist for `skills-core` (design: "extraction is
 * a projection of [the diff result], not a second analysis"): without them,
 * a projection would have to re-run `commonAcrossGroups` itself to recover
 * the section's shared skeleton, which is exactly the "two analyses of the
 * same corpus drift" trap this module's own docblock warns against. Exactly
 * one of the two is populated, matching `blocks`:
 *
 * - `blocks.length === 0` (fully common): `wholeLines` holds the section's
 *   one shared body; `anchors` is empty — there is nothing to anchor.
 * - `blocks.length > 0` (divergent): `anchors` holds the lines common to
 *   every distinct body, in order — the skeleton `blocks[].slot` indexes
 *   into; `wholeLines` is `null` — there is no single shared body.
 */
export interface ClassifiedSection {
  readonly path: readonly string[];
  readonly blocks: readonly DivergentBlock[];
  readonly wholeLines: readonly string[] | null;
  readonly anchors: readonly string[];
}

export interface DescriptionRow {
  readonly repo: string;
  readonly description: string;
}

export interface SkillDiffCounts {
  readonly total: number;
  readonly common: number;
  readonly override: number;
  readonly sharedOverride: number;
  readonly conflict: number;
}

export interface SkillDiff {
  readonly skill: string;
  readonly repos: readonly string[];
  readonly descriptions: readonly DescriptionRow[];
  readonly sections: readonly ClassifiedSection[];
  readonly counts: SkillDiffCounts;
}

/** A repository considered for the diff, whether or not it had the skills tree. */
export interface RepoSelection {
  readonly repo: string;
  readonly included: boolean;
  readonly reason: string;
}

/**
 * A skill found in exactly one repository — SPEC "a skill is diffed when it
 * is shared": there is nothing to diff it against, so it is reported, not
 * dropped and not folded into the cross-repo comparison. This is the
 * indexer-plugins shape measured in `exploration.md` finding 2: `docs-review`,
 * `perf-tuning` and `wcs-management` each live in exactly one repository.
 */
export interface SingleRepoSkill {
  readonly skill: string;
  readonly repo: string;
  readonly description: string;
}

export interface SkillsDiffJson {
  readonly meta: { readonly generatedAt: string; readonly tool: string };
  readonly ref: string;
  readonly repos: readonly RepoSelection[];
  readonly skills: readonly SkillDiff[];
  readonly singleRepoSkills: readonly SingleRepoSkill[];
  /** SPEC 2.1's "and that is recorded" — see design's "Decided: `.claude/settings.json` is NOT in this change". */
  readonly outOfScope: readonly { readonly path: string; readonly reason: string; readonly openCriterion: string }[];
}

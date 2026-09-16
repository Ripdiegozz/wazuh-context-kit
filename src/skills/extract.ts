/**
 * `extractSkill` — `SkillDiff` -> `ExtractedSkill` (SPEC 2.1; design decision
 * 3, REVISED). Pure: no fs, no network, no clock.
 *
 * Extraction is a PROJECTION of `diffSkill`'s output, not a second analysis:
 *
 *     SkillDiff  --project-->  core  +  overrides/<repo>  +  conflicts
 *
 * `diff.ts` already did the hard part — grouping section bodies, segmenting
 * divergent blocks, classifying by marker. This module only asks, for each
 * already-classified section: does it stay whole in the core, or does it
 * contribute its anchors PLUS a majority baseline to the core, with the
 * deviating groups carrying overrides? That is why `ClassifiedSection`
 * carries `wholeLines` and `anchors` (added for `skills-core`) instead of
 * this module recomputing `commonAcrossGroups` itself — recomputing it here
 * would be a second analysis of the same corpus, and the two would drift
 * with nobody able to see it, because each would have its own tests (the
 * same argument that keeps `covers()` a single function in the crosscheck).
 *
 * REVISED after the first real-corpus run (2026-09-16): the original rule —
 * "the core is only what literally every variant shares verbatim" — measured
 * 34 % overall against a 60 %-predicted, 50 %-floor target, and per skill it
 * gutted the core hardest exactly where seven variants exist:
 * `check-standards` measured 12 % against a 34 % prediction. The math is
 * mechanical, not a coding bug: at seven variants, almost every position has
 * SOME repo differing, so "shared by literally all seven" collapses toward
 * empty. That is precisely the failure an override system exists to avoid —
 * Kustomize bases with patches, Helm values with overlays, this project's
 * own `decisions.yml` over parsed facts all put the MAJORITY case in the
 * base and the exception in the overlay, never the reverse. A base that may
 * only hold what nobody ever overrides holds almost nothing, and every
 * consumer ends up reading the overlays anyway — the exact duplication this
 * change exists to remove, wearing a different hat.
 *
 * So: at each divergent POSITION (design's "slot"), the core carries the
 * MAJORITY group's content — the group with the most repos, not the
 * intersection of all of them — and every OTHER group becomes a patch op
 * that REPLACES the majority baseline for its own repos. When no group has
 * a strict majority (a genuine N-way tie), the choice is made
 * deterministically: the tied group whose alphabetically-first repo name
 * sorts earliest, so the pick never depends on iteration order — and the
 * position is recorded in `tiedPositions`, because "no majority existed" is
 * a fact worth a person's attention, not something to bury inside a
 * silently-arbitrary pick.
 *
 * `override` and `sharedOverride` ops are materialised into EVERY repo in
 * their group's `overrides/<repo>` list — reconstruction is per repo, so
 * each member needs its own copy, even though a `sharedOverride` is
 * attributed to no SINGLE repo in the report (task 2.5). `conflict` ops go
 * to a separate list and are never written into any repo's overrides (task
 * 2.4) — SPEC 2.1.1 forbids resolving a conflict automatically, and putting
 * it in an override file is exactly that: it launders a divergence nobody
 * declared into a decision `sync` would then distribute as policy. The
 * majority-baseline rule does not change this: a conflict position's
 * MAJORITY still lands in the core (it is, after all, what most repos
 * actually have), but every minority group there is still a conflict op,
 * never an override — "most common" is not "declared," and SPEC 2.1.1 does
 * not let volume substitute for a marker.
 */

import type { ClassifiedSection, DivergentBlock, SectionCategory, SectionGroup, SkillDiff } from "./types.ts";

/**
 * One patch operation: REPLACE the core's baseline at this position with
 * `content`, for every repo in `repos`. `content` is a LINE ARRAY, not a
 * joined string — `[]` (replace with nothing) and `[""]` (replace with one
 * blank line) are different, real facts about a repo's original file, and a
 * joined string collapses both to `""` with no way back.
 *
 * `anchor` identifies the position — preferring a NON-BLANK line: a blank
 * line occurs everywhere, so nominating one is ambiguous almost by
 * definition and unfriendly to a human reading the emitted YAML besides.
 * `anchor` is the nearest NON-BLANK line at or before this position, or
 * `null` when every line at or before it is blank (including the position
 * before the section's first anchor, or a section with no anchors at all).
 * `offset` counts how many blank anchor lines sit between that nominated
 * anchor (or the section start, when `anchor` is `null`) and this op's
 * actual target — `0` in the overwhelming common case. The blank lines
 * themselves are NEVER dropped — they still exist in `CoreSection.anchors`,
 * exactly where they were; only their eligibility to be REFERENCED changes.
 *
 * `occurrence` is design decision 1's third anchor component, 1-based:
 * "the Nth match of `anchor` within this heading." Avoiding blank lines
 * only fixes ONE line shape that repeats within a section; a code fence
 * (` ``` `), a `---` separator, a table pipe, or a bare list bullet repeats
 * just as legitimately, and the real corpus proved it on the second skill
 * extraction was run against (`check-standards`, a fence line twice in one
 * heading). `occurrence` is what makes EVERY non-blank line usable as an
 * anchor regardless of how many times it repeats — `resolveAnchor` picks
 * the specific match by ordinal instead of requiring uniqueness.
 *
 * `repos` are every repository this op reconstructs — for a `conflict` op
 * this is still populated (reconstruction of the FULL corpus applies
 * conflicts too, design decision 2: "reconstruction applies all three"),
 * even though a conflict is never written into any `overrides/<repo>` file.
 */
export interface PatchOp {
  readonly heading: readonly string[];
  readonly anchor: string | null;
  /** 1-based ordinal of `anchor` within the section's anchors, meaningless
   * (and always `0`) when `anchor` is `null`. */
  readonly occurrence: number;
  readonly offset: number;
  readonly content: readonly string[];
  readonly repos: readonly string[];
  readonly attribution: SectionCategory;
}

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

/** The 1-based ordinal of `anchors[index]` among every earlier-or-equal
 * index holding the SAME text — "this is the Nth match of this line." */
function occurrenceAt(anchors: readonly string[], index: number): number {
  let count = 0;
  for (let i = 0; i <= index; i++) {
    if (anchors[i] === anchors[index]) count++;
  }
  return count;
}

/**
 * Finds the anchor a position `slot` (before `anchors[slot]`, `0` is the
 * start of the section) should be described relative to: the nearest
 * NON-BLANK anchor at index `< slot`, walking backward past any blank ones,
 * how many blank anchors were passed (`offset`), and which occurrence of
 * that anchor TEXT it is within the section (`occurrence`) — the line may
 * repeat elsewhere in the same heading (a fence, a separator), and
 * `occurrence` is what lets `resolveAnchor` land on this exact one instead
 * of requiring the text to be unique. Returns `{ anchor: null, occurrence:
 * 0, offset: slot }` when every anchor before `slot` is blank (including
 * `slot === 0`, where `offset` is trivially `0`).
 *
 * This is the ONLY place that decides which line — and which occurrence of
 * it — an op is anchored to. `reconstruct.ts`'s `contentAt` inverts exactly
 * this arithmetic (`resolvedIndex + 1 + offset === slot`, where
 * `resolvedIndex` comes from resolving `(anchor, occurrence)`) to get back
 * to the same position.
 */
function nominateAnchor(
  anchors: readonly string[],
  slot: number,
): { anchor: string | null; occurrence: number; offset: number } {
  let index = slot - 1;
  let offset = 0;
  while (index >= 0 && isBlank(anchors[index]!)) {
    index--;
    offset++;
  }
  return index < 0
    ? { anchor: null, occurrence: 0, offset: slot }
    : { anchor: anchors[index]!, occurrence: occurrenceAt(anchors, index), offset };
}

export interface CoreSection {
  readonly path: readonly string[];
  /** The lines common to literally every variant, in order — empty for a
   * fully common section (there, the WHOLE body already qualifies and lives
   * entirely in `slots[0]`, so there is nothing left to anchor). */
  readonly anchors: readonly string[];
  /**
   * The majority baseline at each of `anchors.length + 1` gaps (`slots[0]`
   * before the first anchor, `slots[i + 1]` after `anchors[i]`). A
   * repository with no op at a given position reconstructs FROM this
   * baseline; a repository with an op there uses the op's content INSTEAD
   * of the baseline, never both — this is what makes it an override rather
   * than an insertion.
   */
  readonly slots: readonly (readonly string[])[];
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
  /** Human-readable "heading: anchor" for each position where no group held
   * a strict majority — the tie-break landed somewhere, and this is the
   * record that it WAS a tie-break, not a real majority (design decision 3,
   * revised). */
  readonly tiedPositions: readonly string[];
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
 * one position, not several. */
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

/**
 * The groups actually present at a slot, deduplicated by REFERENCE. A mixed
 * position (design decision 1's split) can list the SAME unmarked baseline
 * group object inside both its `override` and `sharedOverride` blocks —
 * deliberately, for the report, so a reader sees it under both headings.
 * Extraction must still treat it as ONE group, or it would emit the same
 * content twice (once per block) into reconstruction, silently duplicating
 * bytes on replay.
 */
function presentGroupsAtSlot(blocksAtSlot: readonly DivergentBlock[]): SectionGroup[] {
  const seen = new Set<SectionGroup>();
  const result: SectionGroup[] = [];
  for (const block of blocksAtSlot) {
    for (const group of block.groups) {
      if (group.body === null) continue; // absent — never a majority candidate, never an op
      if (seen.has(group)) continue;
      seen.add(group);
      result.push(group);
    }
  }
  return result;
}

function firstRepo(group: SectionGroup): string {
  return [...group.repos].sort((a, b) => a.localeCompare(b))[0] ?? "";
}

interface MajorityPick {
  readonly majority: SectionGroup;
  readonly tied: boolean;
}

/**
 * Picks the majority group among `groups` — the one with the most repos.
 * Ties (including the N-way-all-distinct case) are broken by the
 * alphabetically-first repo name across the tied candidates, so the choice
 * depends only on repo names, never on array order or iteration order
 * (design decision 3, revised: "pick the deterministic first group by
 * sorted repo name").
 */
function pickMajority(groups: readonly SectionGroup[]): MajorityPick {
  const maxSize = Math.max(...groups.map((g) => g.repos.length));
  const candidates = groups.filter((g) => g.repos.length === maxSize);
  const sorted = [...candidates].sort((a, b) => firstRepo(a).localeCompare(firstRepo(b)));
  return { majority: sorted[0]!, tied: candidates.length > 1 };
}

export function extractSkill(diff: SkillDiff): ExtractedSkill {
  const core: CoreSection[] = [];
  const overridesByRepo = new Map<string, PatchOp[]>();
  for (const repo of diff.repos) overridesByRepo.set(repo, []);
  const conflicts: PatchOp[] = [];
  const tiedPositions: string[] = [];

  for (const section of diff.sections) {
    if (section.blocks.length === 0) {
      // Fully common: the whole body IS the majority (everyone has it), so
      // it lives entirely in the single slot before a (nonexistent) first
      // anchor. Representing it this way — rather than as a special case —
      // means reconstruction never needs to know "common" as its own idea.
      core.push({ path: section.path, anchors: [], slots: [[...(section.wholeLines ?? [])]], absentFor: [] });
      continue;
    }

    const bySlot = groupBySlot(section.blocks);
    const slots: string[][] = [];
    const emittedGroups = new Set<SectionGroup>();

    for (let slot = 0; slot <= section.anchors.length; slot++) {
      const blocksAtSlot = bySlot.get(slot) ?? [];
      const groups = presentGroupsAtSlot(blocksAtSlot);

      if (groups.length === 0) {
        slots.push([]);
        continue;
      }

      const { majority, tied } = pickMajority(groups);
      slots.push([...majority.diffLines]);

      const { anchor: nominatedAnchor, occurrence, offset } = nominateAnchor(section.anchors, slot);

      if (tied) {
        tiedPositions.push(`${headingLabel(section.path)}: ${anchorLabel(nominatedAnchor)}`);
      }

      for (const block of blocksAtSlot) {
        for (const group of block.groups) {
          if (group === majority || group.body === null) continue;
          if (emittedGroups.has(group)) continue; // same dedup as presentGroupsAtSlot, for op emission
          emittedGroups.add(group);
          // NOT skipped when `diffLines` is empty: an empty minority group
          // is a real fact — "this repo has NOTHING here, unlike the
          // majority" — and must REPLACE the baseline with nothing, not
          // silently fall back to it (that fallback is exactly what
          // `reconstruct.ts` does for a group with no op at all).

          const op: PatchOp = {
            heading: section.path,
            anchor: nominatedAnchor,
            occurrence,
            offset,
            content: [...group.diffLines],
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

    core.push({ path: section.path, anchors: [...section.anchors], slots, absentFor: absentReposIn(section) });
  }

  // One entry per blocking POSITION (heading + anchor), not per op — a
  // conflict at one position is typically emitted as one op per distinct
  // minority group (design decision 1: "no base repository", every
  // population is its own group), and a person resolving conflicts needs
  // "these positions block you," not the same position repeated once per
  // group that disagrees there.
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
    tiedPositions: [...new Set(tiedPositions)],
  };

  return { ...withoutShare, coreShare: computeCoreShare(withoutShare) };
}

/**
 * Raw line counts behind `computeCoreShare` — exposed separately so a
 * caller aggregating several skills (the CLI's overall floor check) sums
 * COUNTS, not per-skill ratios: averaging ratios would let a tiny skill's
 * 100 % share cancel out a large skill's 10 % share, which is not what
 * "the core carries at least half the content" means at the corpus level.
 */
export function coreShareCounts(
  extracted: Pick<ExtractedSkill, "core" | "overrides" | "conflicts">,
): { readonly coreLines: number; readonly totalLines: number } {
  const coreLines = extracted.core.reduce(
    (sum, s) => sum + s.anchors.length + s.slots.reduce((slotSum, slot) => slotSum + slot.length, 0),
    0,
  );

  const seen = new Set<string>();
  let divergentLines = 0;
  for (const op of [...[...extracted.overrides.values()].flat(), ...extracted.conflicts]) {
    const key = JSON.stringify([op.heading, op.anchor, op.occurrence, op.offset, op.content, op.attribution]);
    if (seen.has(key)) continue;
    seen.add(key);
    divergentLines += op.content.length;
  }

  return { coreLines, totalLines: coreLines + divergentLines };
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
  const { coreLines, totalLines } = coreShareCounts(extracted);
  return totalLines === 0 ? 1 : coreLines / totalLines;
}

/** SPEC's ≥ 50 % floor (task 4.2) — a hard check, kept separate from
 * `extractSkill` so task 4.1's "empty core still fails" test can construct
 * an `ExtractedSkill` by hand and check the floor without re-running the
 * whole classifier. */
export function meetsCoreFloor(extracted: ExtractedSkill, floor = 0.5): boolean {
  return computeCoreShare(extracted) >= floor;
}

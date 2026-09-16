/**
 * `diffSkill` — `SkillVariant[]` -> `SkillDiff` (SPEC 2.1; design decision 1).
 *
 * Pure: no fs, no network, no clock. Classification happens in three layers:
 *
 * 1. GROUP whole section bodies by exact content, never pairwise against one
 *    chosen variant — "there is no base repository" (design decision 1). This
 *    is what makes a "3 identical, 4 different" shape read as two
 *    populations instead of six pairwise differences.
 * 2. Within a divergent section, SEGMENT it into independent divergent
 *    BLOCKS — SPEC 2.4's own unit ("todo bloque divergente cae en común /
 *    override / CONFLICTO"), not the whole section. The lines common to
 *    every variant act as anchors; the runs of lines between two anchors
 *    (or before the first / after the last) are the blocks.
 * 3. Within one block, classify by whether a `repo-specific` marker sits on
 *    THAT group's own lines for THAT block — not anywhere in the section.
 *
 * Layer 2 exists because of a defect an independent oracle run found: a real
 * `develop-issue` section carried BOTH a declared `repo-specific
 * (wazuh-dashboard)` override AND a separate, unmarked wording disagreement
 * ("area/layer" vs "plugin(s)/layer(s)") a few lines apart. Classifying the
 * whole section as one label loses information whichever way it goes:
 * calling it `override` hides the undeclared divergence under "someone
 * decided this"; calling it `conflict` buries a genuine, explicitly-declared
 * override under "nobody decided this". A person who finds a `repo-specific`
 * marker sitting right next to a reported CONFLICT reasonably concludes the
 * tool is wrong — for a project whose thesis is a verifiable, trustworthy
 * dataset, that is worse than reporting less.
 */

import type {
  DivergentBlock,
  LineMagnitude,
  ParsedSection,
  RepoSelection,
  SectionCategory,
  SectionGroup,
  SingleRepoSkill,
  SkillDiff,
  SkillsDiffJson,
  SkillVariant,
  ClassifiedSection,
  DescriptionRow,
} from "./types.ts";

const ABSENT = Symbol("absent");

/**
 * Longest common subsequence of two string arrays, reconstructed. Standard
 * DP; section bodies are short (tens of lines), so the O(n*m) table is cheap.
 */
function lcs(a: readonly string[], b: readonly string[]): string[] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }

  const result: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      result.push(a[i]!);
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      i++;
    } else {
      j++;
    }
  }
  return result;
}

/**
 * The lines common to EVERY group's body, computed as a reduction rather than
 * a comparison against one chosen group (design decision 1: "there is no base
 * repository"). LCS(LCS(a, b), c) is a subsequence of a, b AND c, so folding
 * groups in one at a time — in a fixed, sorted order for determinism — always
 * yields a sequence that is a true subsequence of every group's lines,
 * regardless of which order they were folded in. These common lines double
 * as the ANCHORS that segment a section into independent blocks (layer 2).
 */
function commonAcrossGroups(bodies: readonly (readonly string[])[]): string[] {
  if (bodies.length === 0) return [];
  let common: string[] = [...bodies[0]!];
  for (const body of bodies.slice(1)) {
    common = lcs(common, body);
  }
  return common;
}

/**
 * Splits `lines` into `anchors.length + 1` slots, using `anchors` (a valid
 * subsequence of `lines`) as separators. Slot `i` holds the lines between
 * anchor `i - 1` and anchor `i` (slot `0` is everything before the first
 * anchor, the last slot everything after the last). Returns ORIGINAL indices
 * into `lines`, not the text, so a caller can still look up markers by their
 * recorded `lineIndex`.
 */
function segmentIntoSlots(lines: readonly string[], anchors: readonly string[]): number[][] {
  const slots: number[][] = Array.from({ length: anchors.length + 1 }, () => []);
  let ai = 0;
  lines.forEach((line, index) => {
    if (ai < anchors.length && line === anchors[ai]) {
      ai++;
      return; // the anchor line itself belongs to no block — it is common
    }
    slots[ai]!.push(index);
  });
  return slots;
}

type MarkerKind = "named" | "unnamed" | "none";

/** Whether a marker sits on one of THESE specific line indices — not
 * anywhere else in the section (design decision 1, point 5). */
function markerKindOnIndices(section: ParsedSection | undefined, indices: readonly number[]): MarkerKind {
  if (section === undefined || indices.length === 0) return "none";
  const indexSet = new Set(indices);
  const relevant = section.markers.filter((m) => indexSet.has(m.lineIndex));
  if (relevant.length === 0) return "none";
  return relevant.some((m) => m.repo === null) ? "unnamed" : "named";
}

interface RepoBody {
  readonly repo: string;
  readonly body: readonly string[] | typeof ABSENT;
  readonly section: ParsedSection | undefined;
}

function entryLines(entry: RepoBody): readonly string[] {
  return entry.body === ABSENT ? [] : entry.body;
}

function bodyKey(body: readonly string[] | typeof ABSENT): string {
  return body === ABSENT ? " ABSENT " : body.join("\n");
}

function groupByExactContent<T>(entries: readonly T[], keyOf: (entry: T) => string): T[][] {
  const order: string[] = [];
  const byKey = new Map<string, T[]>();
  for (const entry of entries) {
    const key = keyOf(entry);
    const bucket = byKey.get(key);
    if (bucket) {
      bucket.push(entry);
    } else {
      byKey.set(key, [entry]);
      order.push(key);
    }
  }
  return order.map((key) => byKey.get(key)!);
}

function magnitudeFor(groups: readonly SectionGroup[], sectionTotal: number): LineMagnitude {
  const differing = Math.max(...groups.map((g) => g.diffLines.length));
  return { total: sectionTotal, common: sectionTotal - differing, differing };
}

/**
 * Classifies one already-isolated divergence — a slot's worth of lines, one
 * per repository — into one or more `DivergentBlock`s. `sectionTotal` is the
 * enclosing section's own line count, carried through so magnitude reads as
 * "N of the section's M lines", not "N of N": this block's own extent versus
 * the whole section's size (design decision 1, point 4).
 *
 * Returns MORE THAN ONE block exactly when the groups at this position
 * disagree on marker KIND (a named group and a bare/unnamed group both
 * present). Collapsing them into one label always destroys one of the two
 * truths: a real `resolve-cve` position carried a group explicitly marked
 * `> **repo-specific (wazuh-dashboard):**` next to a group carrying a bare
 * `> **repo-specific:**`, and folding both into one `sharedOverride` erased
 * the wazuh-dashboard attribution the author actually wrote down. This is the
 * same collapsing bug already fixed twice — section to block, block to
 * group — one level further down: a category must never discard an
 * attribution present in one of its own groups, so a mixed position SPLITS
 * into a named `override` (its own groups) and a separate `sharedOverride`
 * (its own groups) rather than being forced to pick one label for both.
 */
function classifyPosition(
  slotEntries: readonly { repo: string; indices: readonly number[]; text: readonly string[]; section: ParsedSection | undefined; isAbsentSection: boolean }[],
  sectionTotal: number,
): DivergentBlock[] {
  const contentGroups = groupByExactContent(slotEntries, (e) => e.text.join("\n"));

  const groups: SectionGroup[] = contentGroups.map((members) => {
    const representative = members[0]!;
    const allAbsent = members.every((m) => m.isAbsentSection);
    const marker = markerKindOnIndices(representative.section, representative.indices);
    return {
      repos: members.map((m) => m.repo).sort((a, b) => a.localeCompare(b)),
      body: allAbsent ? null : representative.text.join("\n"),
      diffLines: [...representative.text],
      marker,
    };
  });

  const unmarkedGroups = groups.filter((g) => g.marker === "none");
  const namedGroups = groups.filter((g) => g.marker === "named");
  const unnamedGroups = groups.filter((g) => g.marker === "unnamed");

  // More than one DISTINCT unmarked variant is unexplained divergence no
  // matter what else is present — the whole heuristic stays deliberately
  // dumb (design decision 2): a marker attached to a THIRD group cannot
  // explain why two unmarked groups disagree with each other.
  const hasUnexplainedPlurality = unmarkedGroups.length > 1;
  const hasNoMarker = namedGroups.length === 0 && unnamedGroups.length === 0;

  if (hasUnexplainedPlurality || hasNoMarker) {
    const category: SectionCategory = "conflict";
    return [{ category, groups, magnitude: magnitudeFor(groups, sectionTotal) }];
  }

  // Exactly one marker KIND present (plus at most one unmarked baseline):
  // the case already measured against the real seven repositories and
  // matching an independent oracle's `common`/`override` counts exactly —
  // unchanged.
  if (namedGroups.length === 0 || unnamedGroups.length === 0) {
    const category: SectionCategory = unnamedGroups.length > 0 ? "sharedOverride" : "override";
    return [{ category, groups, magnitude: magnitudeFor(groups, sectionTotal) }];
  }

  // Both kinds present: split, never collapse. Each split keeps the same
  // unmarked baseline (if any) so both retain the "vs the rest" context; if
  // there is no unmarked group at all (the real `resolve-cve` shape — every
  // group at this position IS marked, one named and one bare), each split
  // stands alone on its own marked group(s), which is still the correct,
  // fully-attributed report: nothing here is unexplained.
  const overrideGroups = [...namedGroups, ...unmarkedGroups];
  const sharedOverrideGroups = [...unnamedGroups, ...unmarkedGroups];
  return [
    { category: "override", groups: overrideGroups, magnitude: magnitudeFor(overrideGroups, sectionTotal) },
    {
      category: "sharedOverride",
      groups: sharedOverrideGroups,
      magnitude: magnitudeFor(sharedOverrideGroups, sectionTotal),
    },
  ];
}

function classifySection(path: readonly string[], entries: readonly RepoBody[]): ClassifiedSection {
  const wholeBodyGroups = groupByExactContent(entries, (e) => bodyKey(e.body));

  if (wholeBodyGroups.length === 1) {
    return { path, blocks: [] }; // fully common — nothing to classify
  }

  const distinctBodies = wholeBodyGroups.map((g) => entryLines(g[0]!));
  const anchors = commonAcrossGroups(distinctBodies);
  const sectionTotal = Math.max(...distinctBodies.map((b) => b.length));

  const slotsByRepo = new Map<string, number[][]>();
  for (const entry of entries) {
    slotsByRepo.set(entry.repo, segmentIntoSlots(entryLines(entry), anchors));
  }

  const blocks: DivergentBlock[] = [];
  const slotCount = anchors.length + 1;
  for (let slot = 0; slot < slotCount; slot++) {
    const slotEntries = entries.map((entry) => {
      const indices = slotsByRepo.get(entry.repo)![slot]!;
      const lines = entryLines(entry);
      return {
        repo: entry.repo,
        indices,
        text: indices.map((i) => lines[i]!),
        section: entry.section,
        isAbsentSection: entry.body === ABSENT,
      };
    });

    const distinctContents = new Set(slotEntries.map((e) => e.text.join("\n")));
    if (distinctContents.size <= 1) continue; // nothing diverges at this position

    blocks.push(...classifyPosition(slotEntries, sectionTotal));
  }

  return { path, blocks };
}

export function diffSkill(skillName: string, variants: readonly SkillVariant[]): SkillDiff {
  const names = new Set(variants.map((v) => v.skill.frontmatter.name));
  if (names.size > 1) {
    throw new Error(
      `diffSkill: frontmatter 'name' mismatch across variants of '${skillName}': ${[...names].join(", ")}`,
    );
  }

  const descriptions: DescriptionRow[] = variants.map((v) => ({
    repo: v.repo,
    description: v.skill.frontmatter.description,
  }));

  const allPaths: string[] = [];
  const seenPathKeys = new Set<string>();
  for (const v of variants) {
    for (const section of v.skill.sections) {
      const key = JSON.stringify(section.path);
      if (!seenPathKeys.has(key)) {
        seenPathKeys.add(key);
        allPaths.push(key);
      }
    }
  }

  const sections: ClassifiedSection[] = allPaths.map((key) => {
    const path = JSON.parse(key) as string[];
    const entries: RepoBody[] = variants.map((v) => {
      const section = v.skill.sections.find((s) => JSON.stringify(s.path) === key);
      return { repo: v.repo, body: section ? section.lines : ABSENT, section };
    });
    return classifySection(path, entries);
  });

  const allBlocks = sections.flatMap((s) => s.blocks);
  const counts = {
    total:
      sections.filter((s) => s.blocks.length === 0).length +
      allBlocks.filter((b) => b.category === "override").length +
      allBlocks.filter((b) => b.category === "sharedOverride").length +
      allBlocks.filter((b) => b.category === "conflict").length,
    common: sections.filter((s) => s.blocks.length === 0).length,
    override: allBlocks.filter((b) => b.category === "override").length,
    sharedOverride: allBlocks.filter((b) => b.category === "sharedOverride").length,
    conflict: allBlocks.filter((b) => b.category === "conflict").length,
  };

  return {
    skill: skillName,
    repos: variants.map((v) => v.repo).sort((a, b) => a.localeCompare(b)),
    descriptions,
    sections,
    counts,
  };
}

/**
 * `.claude/settings.json` is deliberately out of scope (design "Decided:
 * `.claude/settings.json` is NOT in this change"). It is JSON, not markdown
 * with a text-anchored override model, and handling it here would mean two
 * override engines under one name. Named as an artifact, not just documented
 * in prose, so a consumer of `skills-diff.json` sees the boundary too.
 */
const SETTINGS_JSON_OUT_OF_SCOPE = {
  path: ".claude/settings.json",
  reason:
    "JSON, not markdown with a text-anchored override model; the SPEC 2.1.1 " +
    "override mechanism is a positional patch anchored to a heading, which a " +
    "JSON file has no equivalent for",
  openCriterion: "SPEC 2.4 known-conflicts criterion naming settings.json",
};

/**
 * Assembles the whole-command artifact from already-loaded, already-parsed
 * data. Pure: `repos`, `variantsBySkill` and `singleRepoSkills` are
 * `loadSkills`'s OUTPUT, not something this function reads itself — the
 * fs/network boundary stays in `src/skills/load.ts` and `src/cli.ts` alone.
 *
 * The two-or-more threshold that decides `variantsBySkill` vs
 * `singleRepoSkills` is already applied by the time this function runs
 * (`loadSkills` applies it, see that module's doc) — this function only
 * renders both populations into one artifact, it does not decide membership.
 */
export function buildSkillsDiffJson(input: {
  readonly ref: string;
  readonly generatedAt: string;
  readonly tool: string;
  readonly repos: readonly RepoSelection[];
  readonly variantsBySkill: ReadonlyMap<string, readonly SkillVariant[]>;
  readonly singleRepoSkills: readonly SingleRepoSkill[];
}): SkillsDiffJson {
  const skills = [...input.variantsBySkill.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, variants]) => diffSkill(name, variants));

  return {
    meta: { generatedAt: input.generatedAt, tool: input.tool },
    ref: input.ref,
    repos: [...input.repos].sort((a, b) => a.repo.localeCompare(b.repo)),
    skills,
    singleRepoSkills: [...input.singleRepoSkills].sort(
      (a, b) => a.skill.localeCompare(b.skill) || a.repo.localeCompare(b.repo),
    ),
    outOfScope: [SETTINGS_JSON_OUT_OF_SCOPE],
  };
}

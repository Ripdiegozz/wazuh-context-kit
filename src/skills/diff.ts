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

/** Whether `candidate` appears, in order, as a subsequence of `body`. */
function isSubsequence(candidate: readonly string[], body: readonly string[]): boolean {
  let ci = 0;
  for (const line of body) {
    if (ci < candidate.length && line === candidate[ci]) ci++;
  }
  return ci === candidate.length;
}

/**
 * The lines common to EVERY group's body — the ANCHORS that segment a
 * section into independent blocks (layer 2).
 *
 * An earlier version reduced this PAIRWISE: `lcs(lcs(a, b), c)`. That is
 * unsound, not just imprecise — an independent oracle found the exact
 * counter-example: reducing `["a","b"]` against `["b","a"]` can select `"b"`
 * (a valid, but not the only, optimal 2-way LCS), and reducing THAT against
 * `["a"]` then finds no match at all, even though `"a"` is present in every
 * one of the three bodies. A dropped anchor merges positions that should be
 * separable, which silently changes block boundaries and therefore
 * classifications.
 *
 * The fix computes a genuine multi-way common subsequence in two steps:
 *
 * 1. SEED from a value-multiplicity lower bound — for each distinct line,
 *    the minimum number of times it occurs across ALL bodies at once. This
 *    is order-agnostic (a set/multiset intersection), so it cannot be fooled
 *    by which pairwise alignment a 2-way LCS happens to pick: a line present
 *    in every body always has a multiplicity of at least 1. Scanning one
 *    reference body while respecting this per-value budget yields a
 *    candidate that already contains everything that COULD be universal.
 * 2. REPAIR by validating the candidate is an actual ordered subsequence of
 *    every body, shrinking it via a real LCS only against a body where
 *    validation concretely fails (never on a guess or a tie-break). Each
 *    repair strictly shortens the candidate, so this always terminates, and
 *    the result is verified, not assumed, to be a true subsequence of every
 *    body.
 *
 * Bodies are still folded with no group privileged as "the reference" for
 * MEANING (design decision 1: "there is no base repository") — `bodies[0]`
 * is only where the scan starts; every body constrains the multiplicity
 * budget equally, and every body is validated against, including the first.
 */
function commonAcrossGroups(bodies: readonly (readonly string[])[]): string[] {
  if (bodies.length === 0) return [];
  if (bodies.length === 1) return [...bodies[0]!];

  const countsPerBody = bodies.map((body) => {
    const counts = new Map<string, number>();
    for (const line of body) counts.set(line, (counts.get(line) ?? 0) + 1);
    return counts;
  });

  const allValues = new Set<string>();
  for (const counts of countsPerBody) {
    for (const value of counts.keys()) allValues.add(value);
  }

  const minCount = new Map<string, number>();
  for (const value of allValues) {
    let min = Infinity;
    for (const counts of countsPerBody) min = Math.min(min, counts.get(value) ?? 0);
    minCount.set(value, min);
  }

  const budget = new Map(minCount);
  let candidate: string[] = [];
  for (const line of bodies[0]!) {
    const remaining = budget.get(line) ?? 0;
    if (remaining > 0) {
      candidate.push(line);
      budget.set(line, remaining - 1);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const body of bodies) {
      if (isSubsequence(candidate, body)) continue;
      candidate = lcs(candidate, body);
      changed = true;
    }
  }

  return candidate;
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

/**
 * Grouping key for one repo's content at one slot. `isAbsentSection` is part
 * of the key, not just `text`: an ABSENT section and a PRESENT section with
 * no lines at this slot both produce `text = []`, and `"".join("\n")` cannot
 * tell them apart on its own — a real section a repo does not have and a
 * real section it has with an empty body are different facts (design
 * decision 1, task 2.8), and collapsing them would invent content for the
 * absent repo or erase the presence of an intentionally empty one.
 */
function slotContentKey(e: { readonly text: readonly string[]; readonly isAbsentSection: boolean }): string {
  return `${e.isAbsentSection ? "absent" : "present"}\u0000${e.text.join("\n")}`;
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
 * present), OR when two or more distinct unmarked groups coexist with a
 * marked one. Collapsing any of these into one label always destroys some
 * of the truth at this position:
 *
 * - A real `resolve-cve` position carried a group explicitly marked
 *   `> **repo-specific (wazuh-dashboard):**` next to a group carrying a bare
 *   `> **repo-specific:**`, and folding both into one `sharedOverride` erased
 *   the wazuh-dashboard attribution the author actually wrote down.
 * - A marked group can also coexist with TWO OR MORE unmarked groups that
 *   disagree with each other. The unmarked disagreement is a genuine,
 *   unexplained conflict between those two — design decision 2's
 *   "deliberately dumb" rule, a marker on a THIRD group cannot explain why
 *   two unmarked ones disagree — but that conflict must not swallow the
 *   marked group's own, separate attribution just because they share a
 *   position. This was latent (0 violations against the real seven
 *   repositories) precisely because the real data never happened to produce
 *   three-or-more-way splits at one position; it is exactly the kind of bug
 *   that stays hidden until a literal test manufactures the shape.
 *
 * This is the same collapsing bug already fixed three times — section to
 * block, block to group, group to category — one level further down: a
 * category must never discard an attribution present in one of its own
 * groups, so a mixed or plural position SPLITS into as many blocks as it
 * needs rather than being forced under one label.
 */
function classifyPosition(
  slotEntries: readonly { repo: string; indices: readonly number[]; text: readonly string[]; section: ParsedSection | undefined; isAbsentSection: boolean }[],
  sectionTotal: number,
  slot: number,
): DivergentBlock[] {
  const contentGroups = groupByExactContent(slotEntries, slotContentKey);

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

  // No marker anywhere at this position: one plain conflict, unchanged.
  if (namedGroups.length === 0 && unnamedGroups.length === 0) {
    return [{ category: "conflict", groups, magnitude: magnitudeFor(groups, sectionTotal), slot }];
  }

  // Two or more DISTINCT unmarked variants are unexplained divergence among
  // THEMSELVES — design decision 2's "deliberately dumb" rule, a marker on a
  // THIRD group cannot explain why two unmarked groups disagree with each
  // other — but that must not swallow a marked group's own attribution. The
  // unmarked disagreement becomes its own `conflict` block; each marked kind
  // present becomes its own separate block, never folded into the conflict.
  if (unmarkedGroups.length > 1) {
    const blocks: DivergentBlock[] = [
      { category: "conflict", groups: unmarkedGroups, magnitude: magnitudeFor(unmarkedGroups, sectionTotal), slot },
    ];
    if (namedGroups.length > 0) {
      blocks.push({
        category: "override",
        groups: namedGroups,
        magnitude: magnitudeFor(namedGroups, sectionTotal),
        slot,
      });
    }
    if (unnamedGroups.length > 0) {
      blocks.push({
        category: "sharedOverride",
        groups: unnamedGroups,
        magnitude: magnitudeFor(unnamedGroups, sectionTotal),
        slot,
      });
    }
    return blocks;
  }

  // From here, at most one unmarked group. Exactly one marker KIND present
  // (plus at most that one unmarked baseline): the case already measured
  // against the real seven repositories and matching an independent
  // oracle's `common`/`override` counts exactly — unchanged.
  if (namedGroups.length === 0 || unnamedGroups.length === 0) {
    const category: SectionCategory = unnamedGroups.length > 0 ? "sharedOverride" : "override";
    return [{ category, groups, magnitude: magnitudeFor(groups, sectionTotal), slot }];
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
    { category: "override", groups: overrideGroups, magnitude: magnitudeFor(overrideGroups, sectionTotal), slot },
    {
      category: "sharedOverride",
      groups: sharedOverrideGroups,
      magnitude: magnitudeFor(sharedOverrideGroups, sectionTotal),
      slot,
    },
  ];
}

function classifySection(path: readonly string[], entries: readonly RepoBody[]): ClassifiedSection {
  const wholeBodyGroups = groupByExactContent(entries, (e) => bodyKey(e.body));

  if (wholeBodyGroups.length === 1) {
    // Fully common — nothing to classify. `entryLines` rather than raw
    // `body` because `body` may be `ABSENT`; a section present in every
    // variant (the only way to reach this branch, see the module docblock
    // on `classifySection`'s caller) never actually has an ABSENT entry, so
    // `entryLines` on any member is that one shared body.
    return { path, blocks: [], wholeLines: entryLines(entries[0]!), anchors: [] };
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

    const distinctContents = new Set(slotEntries.map(slotContentKey));
    if (distinctContents.size <= 1) continue; // nothing diverges at this position

    blocks.push(...classifyPosition(slotEntries, sectionTotal, slot));
  }

  return { path, blocks, wholeLines: null, anchors };
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

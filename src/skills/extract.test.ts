/**
 * `extractSkill` — `SkillDiff` -> `ExtractedSkill` (tasks 2.1–2.6).
 *
 * Extraction is a PROJECTION of `diffSkill`'s output, not a second analysis
 * (design: "reusing the diff rather than re-deriving it is deliberate — two
 * analyses of the same corpus drift, and the drift is invisible because each
 * has its own tests"). So every test here builds its input the same way
 * `diff.test.ts` does — literal `SkillVariant`s fed through the real
 * `diffSkill` — rather than hand-assembling a `SkillDiff` object, which
 * would let this file's understanding of the diff's shape drift from
 * `diff.ts`'s own without either suite noticing.
 *
 * Design decision 3, REVISED after the first real-corpus run: the core
 * carries the MAJORITY group at each divergent position — the group with
 * the most repos, never "only what every last variant shares verbatim" —
 * because at seven real variants that stricter rule measured 34 % overall
 * against a 60 %-predicted, 50 %-floor target. Every test below that
 * touches a divergent position therefore checks BOTH halves of the same
 * fact: the majority's content lands in `core`, and only the MINORITY
 * carries an op.
 *
 * No fixture files: every input is a literal in this file.
 */

import { describe, expect, test } from "bun:test";
import { resolveAnchor } from "./anchor.ts";
import { diffSkill } from "./diff.ts";
import { extractSkill as extractSkillUnchecked } from "./extract.ts";
import type { CoreSection, ExtractedSkill } from "./extract.ts";
import { reconstructRepo } from "./reconstruct.ts";
import type { SectionMarker, SkillVariant } from "./types.ts";

/**
 * The invariant this file exists to hold, applied to EVERY test in this
 * file, not just the one written for it — the same blanket style as
 * `diff.test.ts`'s `assertNoDiscardedAttribution`. A blank anchor is
 * ambiguous by construction (it occurs everywhere a blank line does), and
 * the first real-corpus run crashed on exactly this: `nominateAnchor`
 * walking back past blank lines is `extract.ts`'s job, and a regression
 * here would surface as a crash in `reconstruct.ts`, several calls away
 * from the actual bug — this check catches it at the source instead.
 */
function assertNoBlankAnchor(extracted: ExtractedSkill): void {
  const allOps = [...[...extracted.overrides.values()].flat(), ...extracted.conflicts];
  for (const op of allOps) {
    if (op.anchor !== null && op.anchor.trim().length === 0) {
      throw new Error(
        `assertNoBlankAnchor: skill '${extracted.skill}' has an op at heading ` +
          `${JSON.stringify(op.heading)} anchored to a blank/whitespace-only line ` +
          `(${JSON.stringify(op.anchor)}) — blank lines occur everywhere and must ` +
          "never be nominated as an anchor",
      );
    }
  }
}

/**
 * The GENERAL invariant, replacing a per-line-type blacklist: every emitted
 * op's `(heading, anchor, occurrence, offset)` MUST resolve to exactly one
 * position, in every repo the op belongs to. This is what the blank-anchor
 * guard above was really a special case of — a blank line was one line
 * shape that could be ambiguous within a heading; a code fence, a `---`
 * separator, a table pipe, or a bare list bullet are others, and the real
 * corpus surfaced a fence repeating in `check-standards` right after the
 * blank-line fix landed. Calling the SAME `resolveAnchor` reconstruction
 * itself uses means this check fails exactly when reconstruction would —
 * before a real run finds out, not after.
 */
function assertAnchorsResolve(extracted: ExtractedSkill): void {
  const coreByHeading = new Map(extracted.core.map((section) => [JSON.stringify(section.path), section]));
  const opsWithRepo: { readonly op: { heading: readonly string[]; anchor: string | null; occurrence: number }; readonly repo: string }[] = [];
  for (const [repo, ops] of extracted.overrides) for (const op of ops) opsWithRepo.push({ op, repo });
  for (const op of extracted.conflicts) for (const repo of op.repos) opsWithRepo.push({ op, repo });

  for (const { op, repo } of opsWithRepo) {
    if (op.anchor === null) continue; // nothing to resolve — the position IS the start
    const section = coreByHeading.get(JSON.stringify(op.heading));
    if (section === undefined) continue; // an orphan heading, only possible in a hand-built ExtractedSkill
    // Throws with resolveAnchor's own message on failure — a real bug here
    // should read exactly like the crash it prevents, not a generic
    // assertion failure.
    resolveAnchor({
      skill: extracted.skill,
      repo,
      heading: op.heading,
      lines: section.anchors,
      anchor: op.anchor,
      occurrence: op.occurrence,
    });
  }
}

/**
 * The blanket round-trip guard, applied to EVERY extraction this file
 * builds, not just the ones with a dedicated round-trip test. A weaker,
 * line-COUNT-only version of this lived here first and missed a real bug: a
 * section-ordering defect in `diffSkill` moved a block of lines to the
 * wrong position while leaving the total count untouched (`check-standards`,
 * `wazuh-dashboard-alerting` — 101 reconstructed lines, 101 expected, 13 of
 * them 17 lines out of place). Line count is necessary and not sufficient;
 * only full byte equality catches a REORDERING, not just a loss or a
 * duplication.
 */
function assertReconstructionMatchesOriginal(
  extracted: ExtractedSkill,
  variants: readonly { repo: string; skill: { sections: readonly { lines: readonly string[] }[] } }[],
): void {
  for (const v of variants) {
    const expected = v.skill.sections.flatMap((s) => s.lines);
    const actual = reconstructRepo(extracted, v.repo);
    const matches = actual.length === expected.length && actual.every((line, i) => line === expected[i]);
    if (!matches) {
      throw new Error(
        `assertReconstructionMatchesOriginal: skill '${extracted.skill}' repo '${v.repo}' did not ` +
          `round-trip — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      );
    }
  }
}

function extractSkill(skillName: string, variants: readonly SkillVariant[]): ExtractedSkill {
  const result = extractSkillUnchecked(diffSkill(skillName, variants));
  assertNoBlankAnchor(result);
  assertAnchorsResolve(result);
  assertReconstructionMatchesOriginal(result, variants);
  return result;
}

const REPOS = ["wazuh-dashboard", "wazuh-dashboard-plugins", "wazuh-indexer"] as const;

function variant(
  repo: string,
  sections: readonly { path: readonly string[]; lines: readonly string[]; markers?: readonly SectionMarker[] }[],
): SkillVariant {
  return {
    repo,
    skill: {
      frontmatter: { name: "a-skill", description: `${repo}'s description` },
      sections: sections.map((s) => ({ path: s.path, lines: s.lines, markers: s.markers ?? [] })),
    },
  };
}

/** Flattens a `CoreSection`'s anchors and majority-baseline slots back into
 * one line list, for assertions — the same interleaving `reconstruct.ts`
 * and `emit.ts` both replay. */
function flatten(section: CoreSection): readonly string[] {
  const out: string[] = [...section.slots[0]!];
  section.anchors.forEach((anchorLine, i) => {
    out.push(anchorLine, ...section.slots[i + 1]!);
  });
  return out;
}

function coreFor(extracted: ExtractedSkill, path: readonly string[]): CoreSection {
  return extracted.core.find((s) => s.path.join("/") === path.join("/"))!;
}

describe("a section with no divergent blocks goes to the core whole (task 2.1)", () => {
  test("its full body lands in core.sections, no override, no conflict", () => {
    const lines = ["Run the standard checks.", "Nothing repo-specific here."];
    const variants = REPOS.map((repo) => variant(repo, [{ path: ["Section"], lines }]));

    const extracted = extractSkill("a-skill", variants);

    expect(extracted.core).toHaveLength(1);
    expect(extracted.core[0]!.path).toEqual(["Section"]);
    expect(flatten(extracted.core[0]!)).toEqual(lines);
    expect(extracted.core[0]!.absentFor).toEqual([]);
    for (const repo of REPOS) {
      expect(extracted.overrides.get(repo)).toEqual([]);
    }
    expect(extracted.conflicts).toEqual([]);
  });
});

describe("a divergent position: the MAJORITY lands in core, the minority carries the op (task 2.2)", () => {
  test("two of three repos share a line; the core keeps it, the third repo overrides it", () => {
    const base = ["Confirm the branch.", "Push when ready."];
    const overridden = [
      "Confirm the branch.",
      "> **repo-specific (wazuh-dashboard):** live bases include main and 5.0.0.",
    ];
    const variants = REPOS.map((repo) =>
      repo === "wazuh-dashboard"
        ? variant(repo, [
            {
              path: ["Section"],
              lines: overridden,
              markers: [{ lineIndex: 1, repo: "wazuh-dashboard" }],
            },
          ])
        : variant(repo, [{ path: ["Section"], lines: base }]),
    );

    const extracted = extractSkill("a-skill", variants);

    // The majority (wazuh-dashboard-plugins + wazuh-indexer) is the core —
    // "Push when ready." is NOT relegated to an op just because one repo of
    // three deviates.
    expect(extracted.core).toHaveLength(1);
    expect(flatten(extracted.core[0]!)).toEqual(base);

    const ops = extracted.overrides.get("wazuh-dashboard")!;
    expect(ops).toHaveLength(1);
    expect(ops[0]!.anchor).toBe("Confirm the branch.");
    expect(ops[0]!.content).toEqual([
      "> **repo-specific (wazuh-dashboard):** live bases include main and 5.0.0.",
    ]);
    expect(ops[0]!.attribution).toBe("override");

    // The majority repos get no op at all — they reconstruct from the core
    // alone.
    expect(extracted.overrides.get("wazuh-dashboard-plugins")).toEqual([]);
    expect(extracted.overrides.get("wazuh-indexer")).toEqual([]);
  });
});

describe("a marked divergence becomes an op attributed to the repos in its group (task 2.3)", () => {
  test("the op is attributed exactly to the named group's repos, not to every repo", () => {
    const base = ["Open the PR."];
    const overridden = ["> **repo-specific (wazuh-indexer):** tag the release manager."];
    const variants = REPOS.map((repo) =>
      repo === "wazuh-indexer"
        ? variant(repo, [
            { path: ["Section"], lines: overridden, markers: [{ lineIndex: 0, repo: "wazuh-indexer" }] },
          ])
        : variant(repo, [{ path: ["Section"], lines: base }]),
    );

    const extracted = extractSkill("a-skill", variants);

    // wazuh-dashboard + wazuh-dashboard-plugins are the majority: "Open the
    // PR." is core, and only wazuh-indexer's deviation is an op.
    expect(flatten(extracted.core[0]!)).toEqual(base);

    const op = extracted.overrides.get("wazuh-indexer")!;
    expect(op).toHaveLength(1);
    expect(op[0]!.repos).toEqual(["wazuh-indexer"]);
    expect(op[0]!.attribution).toBe("override");

    expect(extracted.overrides.get("wazuh-dashboard")).toEqual([]);
    expect(extracted.overrides.get("wazuh-dashboard-plugins")).toEqual([]);
  });
});

describe("an unmarked divergence goes to conflicts, never to any overrides/<repo> (task 2.4)", () => {
  test("the conflict is present in extracted.conflicts and absent from EVERY repo's overrides", () => {
    // Majority (wazuh-dashboard + wazuh-indexer, both "affected area") is
    // core; the minority (wazuh-dashboard-plugins, unmarked) is the
    // conflict.
    const variants = [
      variant("wazuh-dashboard", [{ path: ["Section"], lines: ["affected area"] }]),
      variant("wazuh-dashboard-plugins", [{ path: ["Section"], lines: ["affected plugin(s)"] }]),
      variant("wazuh-indexer", [{ path: ["Section"], lines: ["affected area"] }]),
    ];

    const extracted = extractSkill("a-skill", variants);

    expect(flatten(extracted.core[0]!)).toEqual(["affected area"]);
    expect(extracted.conflicts).toHaveLength(1);
    expect(extracted.conflicts[0]!.repos).toEqual(["wazuh-dashboard-plugins"]);
    expect(extracted.conflicts.every((op) => op.attribution === "conflict")).toBe(true);

    // The hard assertion: absence, not just presence elsewhere.
    for (const repo of REPOS) {
      const ops = extracted.overrides.get(repo)!;
      expect(ops.some((op) => op.attribution === "conflict")).toBe(false);
      expect(ops).toEqual([]);
    }
    expect(extracted.distributable).toBe(false);
    expect(extracted.blockingConflicts.length).toBeGreaterThan(0);
  });
});

describe("an unnamed-marker divergence is attributed to no single repo (task 2.5)", () => {
  test("a bare '> **repo-specific:**' op carries every repo in its (minority) group, not one owner", () => {
    // Five repos so the shared-marker group can be the genuine MINORITY
    // (two of five) while still being multi-repo — task 2.5 is about
    // attribution width, not about which side wins the majority.
    const base = ["Open the PR."];
    const shared = ["> **repo-specific:** two of the five plugin repos need this."];
    const majorityRepos = ["wazuh-dashboard", "wazuh-dashboard-alerting", "wazuh-dashboard-reporting"];
    const minorityRepos = ["wazuh-dashboard-plugins", "wazuh-indexer"];

    const variants = [
      ...majorityRepos.map((repo) => variant(repo, [{ path: ["Section"], lines: base }])),
      ...minorityRepos.map((repo) =>
        variant(repo, [{ path: ["Section"], lines: shared, markers: [{ lineIndex: 0, repo: null }] }]),
      ),
    ];

    const extracted = extractSkill("a-skill", variants);

    expect(flatten(extracted.core[0]!)).toEqual(base);

    const sharedOps = minorityRepos.flatMap((repo) =>
      (extracted.overrides.get(repo) ?? []).filter((op) => op.attribution === "sharedOverride"),
    );
    expect(sharedOps.length).toBeGreaterThan(0);
    for (const op of sharedOps) {
      expect(op.repos.length).toBeGreaterThan(1);
      expect([...op.repos].sort()).toEqual([...minorityRepos].sort());
    }
    // Materialised into BOTH minority repos' override lists, since
    // reconstruction is per repo — but owned by neither alone.
    for (const repo of minorityRepos) {
      expect(extracted.overrides.get(repo)!.some((o) => o.attribution === "sharedOverride")).toBe(true);
    }
    for (const repo of majorityRepos) {
      expect(extracted.overrides.get(repo)).toEqual([]);
    }
  });
});

describe("the core share is computed and reported per skill (task 2.6)", () => {
  test("a skill with a small minority divergence reports a high core share", () => {
    const base = ["one", "two", "three", "four", "five"];
    const overridden = ["one", "two", "> **repo-specific (wazuh-dashboard):** three-alt", "four", "five"];
    const variants = REPOS.map((repo) =>
      repo === "wazuh-dashboard"
        ? variant(repo, [
            { path: ["Section"], lines: overridden, markers: [{ lineIndex: 2, repo: "wazuh-dashboard" }] },
          ])
        : variant(repo, [{ path: ["Section"], lines: base }]),
    );

    const extracted = extractSkill("a-skill", variants);
    // Core: "one","two","four","five" (anchors) + "three" (majority slot) = 5
    // lines; the minority op is 1 line. 5 / 6.
    expect(extracted.coreShare).toBeCloseTo(5 / 6, 5);
  });

  test("an N-way tie with no majority is broken deterministically, and recorded", () => {
    // All three repos disagree — no group has more repos than another, so
    // the pick falls to the alphabetically-first repo name, and the
    // position is recorded as tied rather than silently resolved.
    const variants = [
      variant("wazuh-dashboard", [{ path: ["Section"], lines: ["dashboard-only content, wall to wall"] }]),
      variant("wazuh-dashboard-plugins", [{ path: ["Section"], lines: ["plugins-only content, wall to wall"] }]),
      variant("wazuh-indexer", [{ path: ["Section"], lines: ["indexer-only content, wall to wall"] }]),
    ];

    const extracted = extractSkill("a-skill", variants);

    // "wazuh-dashboard" sorts first among the three tied candidates.
    expect(flatten(extracted.core[0]!)).toEqual(["dashboard-only content, wall to wall"]);
    expect(extracted.tiedPositions.length).toBeGreaterThan(0);
    // One core line against two minority (conflict) op lines: 1 / 3.
    expect(extracted.coreShare).toBeCloseTo(1 / 3, 5);
  });
});

describe("a section absent in one variant surfaces as divergence, not silent omission", () => {
  test("the absent repo is recorded on the core section and gets no op for it", () => {
    const variants = [
      variant("wazuh-dashboard", [{ path: ["Extra"], lines: ["only wazuh-dashboard has this"] }]),
      variant("wazuh-dashboard-plugins", []),
      variant("wazuh-indexer", []),
    ];

    const extracted = extractSkill("a-skill", variants);
    const section = coreFor(extracted, ["Extra"]);
    expect(section).toBeDefined();
    expect([...section.absentFor].sort()).toEqual(["wazuh-dashboard-plugins", "wazuh-indexer"]);
    expect(flatten(section)).toEqual(["only wazuh-dashboard has this"]);
  });
});

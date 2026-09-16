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
 * No fixture files: every input is a literal in this file.
 */

import { describe, expect, test } from "bun:test";
import { diffSkill } from "./diff.ts";
import { extractSkill } from "./extract.ts";
import type { SectionMarker, SkillVariant } from "./types.ts";

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

describe("a section with no divergent blocks goes to the core whole (task 2.1)", () => {
  test("its full body lands in core.sections, no override, no conflict", () => {
    const lines = ["Run the standard checks.", "Nothing repo-specific here."];
    const variants = REPOS.map((repo) => variant(repo, [{ path: ["Section"], lines }]));

    const extracted = extractSkill(diffSkill("a-skill", variants));

    expect(extracted.core).toHaveLength(1);
    expect(extracted.core[0]!.path).toEqual(["Section"]);
    expect(extracted.core[0]!.lines).toEqual(lines);
    expect(extracted.core[0]!.absentFor).toEqual([]);
    for (const repo of REPOS) {
      expect(extracted.overrides.get(repo)).toEqual([]);
    }
    expect(extracted.conflicts).toEqual([]);
  });
});

describe("a section with divergent blocks contributes common lines, ops replace the rest (task 2.2)", () => {
  test("the core holds the anchors; the divergent position becomes an op", () => {
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

    const extracted = extractSkill(diffSkill("a-skill", variants));

    // The core keeps only what every variant shares — "Push when ready." is
    // NOT in the core, because wazuh-dashboard replaced it.
    expect(extracted.core).toHaveLength(1);
    expect(extracted.core[0]!.lines).toEqual(["Confirm the branch."]);

    const ops = extracted.overrides.get("wazuh-dashboard")!;
    expect(ops).toHaveLength(1);
    expect(ops[0]!.anchor).toBe("Confirm the branch.");
    expect(ops[0]!.content).toBe(
      "> **repo-specific (wazuh-dashboard):** live bases include main and 5.0.0.",
    );
    expect(ops[0]!.attribution).toBe("override");

    // The other two repos' own baseline line ("Push when ready.") is ALSO
    // not universal — wazuh-dashboard replaced it — so it is not core
    // either. It reconstructs through its own op, anchored at the same
    // common line, attributed to the repos that share it.
    for (const repo of ["wazuh-dashboard-plugins", "wazuh-indexer"]) {
      const baseline = extracted.overrides.get(repo)!;
      expect(baseline).toHaveLength(1);
      expect(baseline[0]!.anchor).toBe("Confirm the branch.");
      expect(baseline[0]!.content).toBe("Push when ready.");
    }
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

    const extracted = extractSkill(diffSkill("a-skill", variants));

    const op = extracted.overrides.get("wazuh-indexer")!;
    expect(op).toHaveLength(1);
    expect(op[0]!.repos).toEqual(["wazuh-indexer"]);
    expect(op[0]!.attribution).toBe("override");

    // The majority's own baseline line is equally not universal (the whole
    // section is one line, and wazuh-indexer's differs), so it too needs an
    // op — attributed to the majority, not to wazuh-indexer.
    for (const repo of ["wazuh-dashboard", "wazuh-dashboard-plugins"]) {
      const baseline = extracted.overrides.get(repo)!;
      expect(baseline).toHaveLength(1);
      expect(baseline[0]!.content).toBe("Open the PR.");
      expect(baseline[0]!.repos).not.toContain("wazuh-indexer");
    }
  });
});

describe("an unmarked divergence goes to conflicts, never to any overrides/<repo> (task 2.4)", () => {
  test("the conflict is present in extracted.conflicts and absent from EVERY repo's overrides", () => {
    const variants = [
      variant("wazuh-dashboard", [{ path: ["Section"], lines: ["affected area"] }]),
      variant("wazuh-dashboard-plugins", [{ path: ["Section"], lines: ["affected plugin(s)"] }]),
      variant("wazuh-indexer", [{ path: ["Section"], lines: ["affected area"] }]),
    ];

    const extracted = extractSkill(diffSkill("a-skill", variants));

    expect(extracted.conflicts.length).toBeGreaterThan(0);
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
  test("a bare '> **repo-specific:**' op carries every repo in its group, not one owner", () => {
    const base = ["Open the PR."];
    const shared = ["> **repo-specific:** two of the three plugin repos need this."];
    const variants = [
      variant("wazuh-dashboard", [{ path: ["Section"], lines: base }]),
      variant("wazuh-dashboard-plugins", [
        { path: ["Section"], lines: shared, markers: [{ lineIndex: 0, repo: null }] },
      ]),
      variant("wazuh-indexer", [{ path: ["Section"], lines: shared, markers: [{ lineIndex: 0, repo: null }] }]),
    ];

    const extracted = extractSkill(diffSkill("a-skill", variants));

    const sharedOps = [
      ...(extracted.overrides.get("wazuh-dashboard-plugins") ?? []),
      ...(extracted.overrides.get("wazuh-indexer") ?? []),
    ].filter((op) => op.attribution === "sharedOverride");

    expect(sharedOps.length).toBeGreaterThan(0);
    for (const op of sharedOps) {
      expect(op.repos.length).toBeGreaterThan(1);
      expect([...op.repos].sort()).toEqual(["wazuh-dashboard-plugins", "wazuh-indexer"]);
    }
    // Materialised into BOTH member repos' override lists, since
    // reconstruction is per repo — but owned by neither alone.
    expect(extracted.overrides.get("wazuh-dashboard-plugins")!.some((o) => o.attribution === "sharedOverride")).toBe(
      true,
    );
    expect(extracted.overrides.get("wazuh-indexer")!.some((o) => o.attribution === "sharedOverride")).toBe(true);
  });
});

describe("the core share is computed and reported per skill (task 2.6)", () => {
  test("a skill with a small divergence reports a high core share", () => {
    const base = ["one", "two", "three", "four", "five"];
    const overridden = ["one", "two", "> **repo-specific (wazuh-dashboard):** three-alt", "four", "five"];
    const variants = REPOS.map((repo) =>
      repo === "wazuh-dashboard"
        ? variant(repo, [
            { path: ["Section"], lines: overridden, markers: [{ lineIndex: 2, repo: "wazuh-dashboard" }] },
          ])
        : variant(repo, [{ path: ["Section"], lines: base }]),
    );

    const extracted = extractSkill(diffSkill("a-skill", variants));
    expect(extracted.coreShare).toBeGreaterThan(0.5);
    expect(extracted.coreShare).toBeLessThanOrEqual(1);
  });

  test("a skill that is entirely one divergent block reports a low core share", () => {
    const variants = [
      variant("wazuh-dashboard", [{ path: ["Section"], lines: ["dashboard-only content, wall to wall"] }]),
      variant("wazuh-dashboard-plugins", [{ path: ["Section"], lines: ["plugins-only content, wall to wall"] }]),
      variant("wazuh-indexer", [{ path: ["Section"], lines: ["indexer-only content, wall to wall"] }]),
    ];

    const extracted = extractSkill(diffSkill("a-skill", variants));
    expect(extracted.coreShare).toBe(0);
  });
});

describe("a section absent in one variant surfaces as divergence, not silent omission", () => {
  test("the absent repo is recorded on the core section and gets no op for it", () => {
    const variants = [
      variant("wazuh-dashboard", [{ path: ["Extra"], lines: ["only wazuh-dashboard has this"] }]),
      variant("wazuh-dashboard-plugins", []),
      variant("wazuh-indexer", []),
    ];

    const extracted = extractSkill(diffSkill("a-skill", variants));
    const section = extracted.core.find((s) => s.path.join() === "Extra")!;
    expect(section).toBeDefined();
    expect([...section.absentFor].sort()).toEqual(["wazuh-dashboard-plugins", "wazuh-indexer"]);
  });
});

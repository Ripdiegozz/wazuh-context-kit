/**
 * `diffSkill` — `SkillVariant[]` -> `SkillDiff` (tasks 2.1–2.13).
 *
 * Revised TWICE against real data, each time by an independent oracle:
 *
 * 1. Whole-section granularity produced 21 CONFLICTs out of 61 sections, some
 *    of them a single differing line inside a ten-plus-line section. Fixed by
 *    reporting only the DIFFERING LINES and their magnitude, not the whole
 *    body — grouping stayed whole-section, reporting became line-level.
 * 2. A real `develop-issue` section then surfaced a second, deeper defect: it
 *    carried BOTH a declared `repo-specific (wazuh-dashboard)` override AND a
 *    separate, unmarked wording disagreement a few lines apart. One
 *    section-wide label loses information whichever way it goes — `override`
 *    hides the undeclared divergence, `conflict` buries the declared one.
 *    SPEC 2.4's own unit is "todo bloque divergente", the divergent BLOCK, not
 *    the section — so a section now SEGMENTS into independent blocks (using
 *    the lines common to every variant as anchors) and each block is
 *    classified on its own.
 *
 * Revised a THIRD time: an independent oracle found a real `resolve-cve`
 * position where one group's marker was explicitly attributed
 * (`> **repo-specific (wazuh-dashboard):**`) while a sibling group in the SAME
 * block carried only a bare marker. The block's single `category` collapsed
 * to `sharedOverride`, which erased the wazuh-dashboard attribution the
 * author wrote down — the same collapsing bug fixed at section-to-block and
 * block-to-group, one level further down: group-to-category. A position
 * whose groups disagree on marker KIND now SPLITS into a separate `override`
 * and `sharedOverride` block rather than being forced under one label.
 *
 * Every literal below is a section's raw lines, exactly as `parseSkill` would
 * produce them — no fixture file, so no fixture can share the classifier's
 * own blind spot.
 */

import { describe, expect, test } from "bun:test";
import { diffSkill as diffSkillUnchecked } from "./diff.ts";
import type { SectionMarker, SkillDiff, SkillVariant } from "./types.ts";

/**
 * The invariant this file exists to hold, applied to EVERY test in this
 * file, not just the one written for it: no block may be reported under a
 * category that discards an attribution present in one of its own groups. A
 * `sharedOverride` block carrying a `named` group, or a `conflict` block
 * carrying any marked group, is exactly the class of bug an oracle found in
 * `resolve-cve` — cheap and total to check, so every call site gets it for
 * free through this wrapper rather than relying on one dedicated test.
 */
function assertNoDiscardedAttribution(result: SkillDiff): void {
  for (const section of result.sections) {
    for (const block of section.blocks) {
      const named = block.groups.filter((g) => g.marker === "named");
      const unnamed = block.groups.filter((g) => g.marker === "unnamed");
      if (block.category !== "override" && named.length > 0) {
        throw new Error(
          `assertNoDiscardedAttribution: section ${JSON.stringify(section.path)} has a ` +
            `'${block.category}' block carrying a named group (${named.map((g) => g.repos).join(",")})`,
        );
      }
      if (block.category === "conflict" && unnamed.length > 0) {
        throw new Error(
          `assertNoDiscardedAttribution: section ${JSON.stringify(section.path)} has a ` +
            "'conflict' block carrying an unnamed-marker group",
        );
      }
    }
  }
}

function diffSkill(skillName: string, variants: readonly SkillVariant[]): SkillDiff {
  const result = diffSkillUnchecked(skillName, variants);
  assertNoDiscardedAttribution(result);
  return result;
}

const REPOS = [
  "wazuh-dashboard",
  "wazuh-dashboard-plugins",
  "wazuh-dashboard-alerting",
  "wazuh-dashboard-notifications",
  "wazuh-dashboard-reporting",
  "wazuh-dashboard-security-analytics",
  "wazuh-security-dashboards-plugin",
] as const;

function variant(
  repo: string,
  lines: readonly string[],
  markers: readonly SectionMarker[] = [],
  path: readonly string[] = ["Section"],
): SkillVariant {
  return {
    repo,
    skill: {
      frontmatter: { name: "a-skill", description: `${repo}'s description` },
      sections: [{ path, lines, markers }],
    },
  };
}

describe("one group is common: zero blocks (task 2.1)", () => {
  test("seven identical variants classify as fully common — no block to report", () => {
    const lines = ["Run the standard checks.", "Nothing repo-specific here."];
    const variants = REPOS.map((repo) => variant(repo, lines));

    const result = diffSkill("a-skill", variants);

    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]!.blocks).toEqual([]);
  });
});

describe("two groups, minority's own differing lines carry a named marker -> override (task 2.2)", () => {
  test("attributed to the repos in that group, reporting only the differing line", () => {
    const base = ["Confirm the branch.", "Push when ready."];
    const overridden = [
      "Confirm the branch.",
      "> **repo-specific (wazuh-dashboard):** live bases include main and 5.0.0.",
    ];

    const variants = REPOS.map((repo) =>
      repo === "wazuh-dashboard"
        ? variant(repo, overridden, [{ lineIndex: 1, repo: "wazuh-dashboard" }])
        : variant(repo, base),
    );

    const result = diffSkill("a-skill", variants);
    const section = result.sections[0]!;

    expect(section.blocks).toHaveLength(1);
    const block = section.blocks[0]!;

    expect(block.category).toBe("override");
    expect(block.magnitude).toEqual({ total: 2, common: 1, differing: 1 });

    const overrideGroup = block.groups.find((g) => g.repos.includes("wazuh-dashboard"))!;
    expect(overrideGroup.repos).toEqual(["wazuh-dashboard"]);
    expect(overrideGroup.marker).toBe("named");
    // Only the differing line is reported, not the whole two-line body.
    expect(overrideGroup.diffLines).toEqual([
      "> **repo-specific (wazuh-dashboard):** live bases include main and 5.0.0.",
    ]);

    const baseGroup = block.groups.find((g) => !g.repos.includes("wazuh-dashboard"))!;
    expect(baseGroup.repos).toHaveLength(6);
    // No group is privileged as "the base" (design decision 1): the six-repo
    // group's own line, "Push when ready.", is not part of what is common to
    // EVERY group either — wazuh-dashboard's variant does not have it — so it
    // is reported as that group's own differing line, symmetrically.
    expect(baseGroup.diffLines).toEqual(["Push when ready."]);
  });
});

describe("two groups, minority's differing lines carry an unnamed marker -> sharedOverride (task 2.3)", () => {
  test("attributed to no repository", () => {
    const base = ["Run the checks.", "Fix failures."];
    const overridden = ["Run the checks.", "> **repo-specific:** true of several repos at once."];

    const minority = ["wazuh-dashboard-alerting", "wazuh-dashboard-notifications"];
    const variants = REPOS.map((repo) =>
      minority.includes(repo)
        ? variant(repo, overridden, [{ lineIndex: 1, repo: null }])
        : variant(repo, base),
    );

    const result = diffSkill("a-skill", variants);
    const block = result.sections[0]!.blocks[0]!;

    expect(block.category).toBe("sharedOverride");
    const sharedGroup = block.groups.find((g) => g.marker === "unnamed")!;
    expect([...sharedGroup.repos].sort()).toEqual([...minority].sort());
    expect(sharedGroup.diffLines).toEqual(["> **repo-specific:** true of several repos at once."]);

    // Never attributed to a single repository — this IS the point of the category.
    expect(result.skill).toBe("a-skill");
  });
});

describe("two groups, no marker on the differing lines -> CONFLICT (task 2.4)", () => {
  test("both variants and their repos are carried, and neither is selected", () => {
    const yes = ["Run typecheck.", "typecheck: yes"];
    const no = ["Run typecheck.", "typecheck: no"];

    const yesRepos = ["wazuh-dashboard", "wazuh-dashboard-plugins", "wazuh-dashboard-alerting"];
    const variants = REPOS.map((repo) => variant(repo, yesRepos.includes(repo) ? yes : no));

    const result = diffSkill("a-skill", variants);
    const block = result.sections[0]!.blocks[0]!;

    expect(block.category).toBe("conflict");
    expect(block.groups).toHaveLength(2);

    const yesGroup = block.groups.find((g) => g.repos.includes("wazuh-dashboard"))!;
    const noGroup = block.groups.find((g) => !g.repos.includes("wazuh-dashboard"))!;
    expect(yesGroup.diffLines).toEqual(["typecheck: yes"]);
    expect(noGroup.diffLines).toEqual(["typecheck: no"]);
    expect(yesGroup.marker).toBe("none");
    expect(noGroup.marker).toBe("none");

    const allRepos = block.groups.flatMap((g) => g.repos).sort();
    expect(allRepos).toEqual([...REPOS].sort());
  });
});

describe("a marker elsewhere does not launder an unrelated divergence (task 2.5)", () => {
  test("a marker present in the body, but not on the actually-differing line, still yields CONFLICT", () => {
    // Both variants share the SAME marker line verbatim (it explains some
    // other, unrelated concern) — only the second line, `typecheck`, differs,
    // and it carries no marker of its own.
    const markerLine = "> **repo-specific (wazuh-dashboard):** this explains a DIFFERENT, shared line.";
    const withYes = [markerLine, "typecheck: yes"];
    const withNo = [markerLine, "typecheck: no"];

    const variants = REPOS.map((repo, i) =>
      variant(repo, i === 0 ? withYes : withNo, [{ lineIndex: 0, repo: "wazuh-dashboard" }]),
    );

    const result = diffSkill("a-skill", variants);
    const section = result.sections[0]!;

    // The marker line itself is common to every variant, so it never becomes
    // part of anyone's diffLines — the only divergence is the unmarked
    // `typecheck` line, so this is ONE block, CONFLICT, not override.
    expect(section.blocks).toHaveLength(1);
    const block = section.blocks[0]!;
    expect(block.category).toBe("conflict");
    for (const group of block.groups) {
      expect(group.diffLines).not.toContain(markerLine);
      expect(group.marker).toBe("none");
    }
  });
});

describe("one section, several independent findings (the develop-issue acid test)", () => {
  test("two unrelated conflicts and a declared override, in one section, are all reported separately", () => {
    // Reproduces the shape a second independent oracle confirmed against
    // `develop-issue`'s `Workflow/1. Plan`: TWO unrelated, unmarked
    // disagreements (a wording split and an unrelated changelog-policy split,
    // partitioning the seven repos two DIFFERENT ways) plus ONE explicitly
    // marked block only `wazuh-dashboard` carries. Three anchors —
    // "Intro.", "Step 1.", "Step 3.", "Outro." — are common to all seven and
    // must separate the three findings; a marker recorded at one anchor must
    // not explain a markerless divergence at another.
    const [dashboard, ...others] = REPOS; // others has 6 repos
    const [req0, opt0, opt1, req1, opt2, opt3] = others as [string, string, string, string, string, string];

    const line = (wording: "old" | "new", changelog: "required" | "optional") => [
      "Intro.",
      "Step 1.",
      `${wording} wording line`,
      "Step 3.",
      `changelog: ${changelog}`,
      "Outro.",
    ];

    const variants: SkillVariant[] = [
      variant(dashboard, [...line("old", "required"), "> **repo-specific (wazuh-dashboard):** know where you are working."], [
        { lineIndex: 6, repo: "wazuh-dashboard" },
      ]),
      variant(req0, line("old", "required")),
      variant(opt0, line("old", "optional")),
      variant(opt1, line("old", "optional")),
      variant(req1, line("new", "required")),
      variant(opt2, line("new", "optional")),
      variant(opt3, line("new", "optional")),
    ];

    const result = diffSkill("a-skill", variants);
    const section = result.sections[0]!;

    // Three independent findings, not one section-wide label and not one
    // finding exploded per repo.
    expect(section.blocks).toHaveLength(3);
    expect(section.blocks.filter((b) => b.category === "conflict")).toHaveLength(2);
    expect(section.blocks.filter((b) => b.category === "override")).toHaveLength(1);

    const wordingBlock = section.blocks.find((b) => b.groups.some((g) => g.diffLines.includes("old wording line")))!;
    const oldGroup = wordingBlock.groups.find((g) => g.diffLines.includes("old wording line"))!;
    const newGroup = wordingBlock.groups.find((g) => g.diffLines.includes("new wording line"))!;
    expect(wordingBlock.category).toBe("conflict");
    expect([...oldGroup.repos].sort()).toEqual([dashboard, req0, opt0, opt1].sort());
    expect([...newGroup.repos].sort()).toEqual([req1, opt2, opt3].sort());
    expect(oldGroup.marker).toBe("none");
    expect(newGroup.marker).toBe("none");

    const changelogBlock = section.blocks.find((b) =>
      b.groups.some((g) => g.diffLines.includes("changelog: required")),
    )!;
    const requiredGroup = changelogBlock.groups.find((g) => g.diffLines.includes("changelog: required"))!;
    const optionalGroup = changelogBlock.groups.find((g) => g.diffLines.includes("changelog: optional"))!;
    expect(changelogBlock.category).toBe("conflict");
    // This split cuts across the wording split differently — proof the two
    // conflicts are genuinely independent, not the same partition twice.
    expect([...requiredGroup.repos].sort()).toEqual([dashboard, req0, req1].sort());
    expect([...optionalGroup.repos].sort()).toEqual([opt0, opt1, opt2, opt3].sort());
    expect(requiredGroup.marker).toBe("none");
    expect(optionalGroup.marker).toBe("none");

    const overrideBlock = section.blocks.find((b) => b.category === "override")!;
    const overrideGroup = overrideBlock.groups.find((g) => g.repos.includes(dashboard))!;
    expect(overrideGroup.repos).toEqual([dashboard]);
    expect(overrideGroup.marker).toBe("named");
    expect(overrideGroup.diffLines).toEqual([
      "> **repo-specific (wazuh-dashboard):** know where you are working.",
    ]);
    // The other six repos carry nothing at this position — the override
    // belongs to wazuh-dashboard alone, not to "everyone who differs".
    const restGroup = overrideBlock.groups.find((g) => !g.repos.includes(dashboard))!;
    expect(restGroup.repos).toHaveLength(6);

    expect(result.counts.override).toBe(1);
    expect(result.counts.conflict).toBe(2);
    expect(result.counts.common).toBe(0);
  });
});

describe("one finding per divergent position, not one per group (the mirror-image defect)", () => {
  test("all seven repos disagreeing at the SAME position is one conflict with seven groups, not seven conflicts", () => {
    // The mirror image of the section-collapsing bug: emitting one finding
    // per GROUP's differing lines, instead of one finding per anchor
    // position, turns a single seven-way disagreement into seven separate
    // findings — measured on real data as 236 conflicts across 61 sections.
    // Grouping by exact content within one anchor-bounded position is what
    // keeps this "the same passage, seven variants" as ONE finding.
    const variants = REPOS.map((repo, i) => variant(repo, ["Common line.", `variant ${i}`, "Common tail."]));

    const result = diffSkill("a-skill", variants);
    const section = result.sections[0]!;

    expect(section.blocks).toHaveLength(1);
    expect(section.blocks[0]!.category).toBe("conflict");
    expect(section.blocks[0]!.groups).toHaveLength(7);
    expect(result.counts.conflict).toBe(1);
  });
});

describe("a category never discards an attribution present in one of its own groups (the resolve-cve defect)", () => {
  test("a named group and a bare-marker group at the same position split into an override and a sharedOverride, not one collapsed sharedOverride", () => {
    // Reproduces the real `resolve-cve`, `Workflow/4. Verify` shape: exactly
    // two groups at one position, no unmarked baseline at all. One is
    // attributed to wazuh-dashboard by name; the other carries only a bare
    // `> **repo-specific:**` marker. The old rule ("any unnamed marker in the
    // block -> sharedOverride") folded the attributed group's identity away.
    const named = ["> **repo-specific (wazuh-dashboard):** re-resolve and test on the host:"];
    const bare = ["> **repo-specific:** re-resolve using the shared runner:"];

    const others = REPOS.slice(1); // six repos, all sharing the bare-marker text
    const variants: SkillVariant[] = [
      variant("wazuh-dashboard", named, [{ lineIndex: 0, repo: "wazuh-dashboard" }]),
      ...others.map((repo) => variant(repo, bare, [{ lineIndex: 0, repo: null }])),
    ];

    const result = diffSkill("a-skill", variants);
    const section = result.sections[0]!;

    // Two separate findings, not one section-wide/block-wide label.
    expect(section.blocks).toHaveLength(2);

    const overrideBlock = section.blocks.find((b) => b.category === "override")!;
    const sharedOverrideBlock = section.blocks.find((b) => b.category === "sharedOverride")!;
    expect(overrideBlock).toBeDefined();
    expect(sharedOverrideBlock).toBeDefined();

    // The attribution survives: the override is wazuh-dashboard's, alone.
    expect(overrideBlock.groups).toHaveLength(1);
    expect(overrideBlock.groups[0]!.repos).toEqual(["wazuh-dashboard"]);
    expect(overrideBlock.groups[0]!.marker).toBe("named");

    // The bare marker's group is reported too, attributed to no repository.
    expect(sharedOverrideBlock.groups).toHaveLength(1);
    expect([...sharedOverrideBlock.groups[0]!.repos].sort()).toEqual([...others].sort());
    expect(sharedOverrideBlock.groups[0]!.marker).toBe("unnamed");

    expect(result.counts.override).toBe(1);
    expect(result.counts.sharedOverride).toBe(1);
    expect(result.counts.conflict).toBe(0);
  });

  test("the invariant itself: no sharedOverride or conflict block may carry a named group", () => {
    // A direct, minimal regression for the exact defect shape reported: this
    // would have failed before the fix (the whole block was 'sharedOverride'
    // despite containing a named group), and the wrapper used throughout this
    // file applies the same check to every other test's output too.
    const named = ["> **repo-specific (wazuh-dashboard):** know where you are working."];
    const bare = ["> **repo-specific:** true of several repos at once."];
    const others = REPOS.slice(1);

    const result = diffSkill("a-skill", [
      variant("wazuh-dashboard", named, [{ lineIndex: 0, repo: "wazuh-dashboard" }]),
      ...others.map((repo) => variant(repo, bare, [{ lineIndex: 0, repo: null }])),
    ]);

    for (const section of result.sections) {
      for (const block of section.blocks) {
        const hasNamedGroup = block.groups.some((g) => g.marker === "named");
        if (hasNamedGroup) {
          expect(block.category).toBe("override");
        }
      }
    }
  });
});

describe("grouping, not pairwise (task 2.6)", () => {
  test("a 3-identical / 4-identical split reports two populations, not six differences", () => {
    const groupA = ["Variant A line."];
    const groupB = ["Variant B line."];
    const aRepos = REPOS.slice(0, 3);
    const bRepos = REPOS.slice(3);

    const variants = REPOS.map((repo) => variant(repo, aRepos.includes(repo) ? groupA : groupB));
    const result = diffSkill("a-skill", variants);
    const block = result.sections[0]!.blocks[0]!;

    expect(block.groups).toHaveLength(2);
    expect(block.groups.map((g) => g.repos.length).sort()).toEqual([3, 4]);
  });
});

describe("magnitude is exact (task 2.7)", () => {
  test("a 13-line section with two separate differing positions reports each as its own block, magnitude against the section total", () => {
    // Mirrors the real shape that exposed the whole-section defect:
    // `analyze-dashboard-vuln`'s "Input/Repo map" section, 13 lines with 2
    // differing — here, two distinct, UNRELATED positions each carry a
    // repo-specific example path. A second oracle correction (the
    // develop-issue acid test) established that two independent divergent
    // positions are two independent findings, not one combined finding — so
    // each reports its own 1-line magnitude against the same 13-line total,
    // rather than one finding claiming both differing lines at once.
    const shared = Array.from({ length: 11 }, (_, i) => `shared line ${i}`);
    const a = [
      ...shared.slice(0, 4),
      "example: plugins/wazuh-alerting",
      ...shared.slice(4, 8),
      "owner: wazuh-alerting team",
      ...shared.slice(8),
    ];
    const b = [
      ...shared.slice(0, 4),
      "example: plugins/wazuh-reporting",
      ...shared.slice(4, 8),
      "owner: wazuh-reporting team",
      ...shared.slice(8),
    ];
    expect(a).toHaveLength(13);
    expect(b).toHaveLength(13);

    const variants = REPOS.map((repo, i) => variant(repo, i === 0 ? a : b));
    const result = diffSkill("a-skill", variants);
    const section = result.sections[0]!;

    expect(section.blocks).toHaveLength(2);
    for (const block of section.blocks) {
      expect(block.magnitude).toEqual({ total: 13, common: 12, differing: 1 });
    }
  });
});

describe("absence is divergence too (task 2.8)", () => {
  test("a section present in six variants and absent in one is classified, not silently common", () => {
    const present = ["Only some repos carry this section."];
    const variants: SkillVariant[] = REPOS.slice(0, 6).map((repo) => variant(repo, present));
    // The seventh variant's skill has no section with this path at all.
    variants.push({
      repo: REPOS[6],
      skill: { frontmatter: { name: "a-skill", description: "x" }, sections: [] },
    });

    const result = diffSkill("a-skill", variants);
    const section = result.sections[0]!;

    expect(section.blocks).toHaveLength(1);
    const block = section.blocks[0]!;
    expect(block.category).toBe("conflict");
    const absentGroup = block.groups.find((g) => g.body === null)!;
    expect(absentGroup.repos).toEqual([REPOS[6]]);
    expect(absentGroup.diffLines).toEqual([]);
    const presentGroup = block.groups.find((g) => g.body !== null)!;
    expect(presentGroup.diffLines).toEqual(present);
  });

  test("a present-but-EMPTY section and a genuinely ABSENT section are never merged (CodeRabbit PR #16 finding 3)", () => {
    // Both produce zero lines at a slot, so keying purely on joined text
    // (`"".join("\\n")`) makes them indistinguishable. A section a repo does
    // not have and a section it has with no body are different facts, and
    // collapsing them invents content for the absent repo (or erases the
    // presence of an intentionally empty one).
    const withBody = ["Body line."];
    const majority = REPOS.slice(0, 5).map((repo) => variant(repo, withBody));
    const presentEmpty = variant(REPOS[5], []); // the heading exists; nothing follows it
    const absent: SkillVariant = {
      repo: REPOS[6],
      skill: { frontmatter: { name: "a-skill", description: "x" }, sections: [] },
    };

    const result = diffSkill("a-skill", [...majority, presentEmpty, absent]);
    const section = result.sections[0]!;

    expect(section.blocks).toHaveLength(1);
    const block = section.blocks[0]!;

    // Three distinct groups, not two: the present-empty and absent repos
    // must NOT collapse into one.
    expect(block.groups).toHaveLength(3);

    const absentGroup = block.groups.find((g) => g.repos.includes(REPOS[6]))!;
    const presentEmptyGroup = block.groups.find((g) => g.repos.includes(REPOS[5]))!;
    expect(absentGroup.repos).toEqual([REPOS[6]]);
    expect(absentGroup.body).toBeNull();
    expect(presentEmptyGroup.repos).toEqual([REPOS[5]]);
    // Present-but-empty is real content (an empty string), not absence.
    expect(presentEmptyGroup.body).toBe("");
    expect(presentEmptyGroup.body).not.toBeNull();
  });
});

describe("classification is total (task 2.9)", () => {
  test("the sum of the categories equals the number of sections when every section yields at most one block", () => {
    const variants: SkillVariant[] = [
      {
        repo: "wazuh-dashboard",
        skill: {
          frontmatter: { name: "a-skill", description: "x" },
          sections: [
            { path: ["Common"], lines: ["same"], markers: [] },
            { path: ["Conflict1"], lines: ["v1"], markers: [] },
            { path: ["Conflict2"], lines: ["v1"], markers: [] },
          ],
        },
      },
      {
        repo: "wazuh-dashboard-plugins",
        skill: {
          frontmatter: { name: "a-skill", description: "y" },
          sections: [
            { path: ["Common"], lines: ["same"], markers: [] },
            { path: ["Conflict1"], lines: ["v2"], markers: [] },
            { path: ["Conflict2"], lines: ["v2"], markers: [] },
          ],
        },
      },
    ];

    const result = diffSkill("a-skill", variants);
    const { total, common: c, override, sharedOverride, conflict } = result.counts;
    expect(total).toBe(3);
    expect(c + override + sharedOverride + conflict).toBe(total);
    expect(c).toBe(1);
    expect(conflict).toBe(2);
  });
});

describe("frontmatter (task 2.10)", () => {
  test("a name mismatch across variants is a hard error", () => {
    const variants: SkillVariant[] = [
      { repo: "a", skill: { frontmatter: { name: "one-name", description: "d" }, sections: [] } },
      { repo: "b", skill: { frontmatter: { name: "different-name", description: "d" }, sections: [] } },
    ];

    expect(() => diffSkill("one-name", variants)).toThrow(/name/i);
  });

  test("description divergence is its own row, not a CONFLICT", () => {
    const variants: SkillVariant[] = [
      { repo: "a", skill: { frontmatter: { name: "s", description: "for repo a" }, sections: [] } },
      { repo: "b", skill: { frontmatter: { name: "s", description: "for repo b" }, sections: [] } },
    ];

    const result = diffSkill("s", variants);
    expect(result.descriptions).toEqual([
      { repo: "a", description: "for repo a" },
      { repo: "b", description: "for repo b" },
    ]);
    expect(result.counts.conflict).toBe(0);
  });
});

describe("per-skill counts (task 2.11)", () => {
  test("total, common, override, sharedOverride, conflict are all emitted", () => {
    const variants: SkillVariant[] = [
      { repo: "a", skill: { frontmatter: { name: "s", description: "d" }, sections: [] } },
    ];
    const result = diffSkill("s", variants);
    expect(Object.keys(result.counts).sort()).toEqual(
      ["total", "common", "override", "sharedOverride", "conflict"].sort(),
    );
  });
});

describe("anchors are a true multi-way common subsequence, not a pairwise reduction (the resolve-cve/create-pr defect)", () => {
  test("a line present in every variant is never dropped, even when a pairwise reduction would drop it", () => {
    // The exact counter-example an independent oracle reported: reducing
    // ["a","b"] against ["b","a"] pairwise can select "b" (a valid, but not
    // the only, optimal 2-way LCS); reducing THAT against ["a"] then finds
    // NO match, even though "a" is present in all three bodies. A dropped
    // anchor merges positions that should stay separable and silently
    // changes block boundaries — likely the source of the residual
    // disagreement in override/conflict counts against the real repos.
    const variants: SkillVariant[] = [
      variant("repo-1", ["a", "b"]),
      variant("repo-2", ["b", "a"]),
      variant("repo-3", ["a"]),
    ];

    const result = diffSkill("a-skill", variants);
    const section = result.sections[0]!;

    // "a" is common to every variant, so it must never appear as a
    // differing line in ANY block — it is context, not a finding.
    for (const block of section.blocks) {
      for (const group of block.groups) {
        expect(group.diffLines).not.toContain("a");
      }
    }

    // And the magnitude must reflect that "a" was recognised as shared: at
    // least one line of the 2-line section is common, in every block.
    for (const block of section.blocks) {
      expect(block.magnitude.common).toBeGreaterThan(0);
    }
  });
});

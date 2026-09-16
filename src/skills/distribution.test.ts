/**
 * Distribution gating — `ExtractedSkill.distributable` (SPEC 2.1: "conflicts
 * live in their own layer and block distribution", design decision 2).
 *
 * `extract.test.ts` already exercises `distributable` in passing (task 2.4's
 * conflict test). This file makes it the SUBJECT: task 5.1 wants "a skill
 * carrying at least one unresolved conflict is reported undistributable,
 * with the blocking conflicts named" as its own assertion, independent of
 * whatever else that section happened to be testing.
 *
 * Git merge is the named precedent (proposal.md): materialise the conflict,
 * block the operation that would publish it, require a person. The
 * `distributable` flag is that block; `blockingConflicts` is what
 * materialises it for the person who has to act.
 */

import { describe, expect, test } from "bun:test";
import { diffSkill } from "./diff.ts";
import { extractSkill } from "./extract.ts";
import type { SectionMarker, SkillVariant } from "./types.ts";

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

describe("a skill carrying at least one unresolved conflict is undistributable (task 5.1)", () => {
  test("distributable is false and the blocking conflict is named", () => {
    const variants = [
      variant("wazuh-dashboard", [{ path: ["Disputed"], lines: ["area"] }]),
      variant("wazuh-dashboard-plugins", [{ path: ["Disputed"], lines: ["plugin(s)"] }]),
    ];

    const extracted = extractSkill(diffSkill("check-standards", variants));

    expect(extracted.distributable).toBe(false);
    expect(extracted.blockingConflicts).toHaveLength(1);
    expect(extracted.blockingConflicts[0]).toContain("Disputed");
  });

  test("a skill with several unrelated conflicts names every one of them", () => {
    const variants = [
      variant("wazuh-dashboard", [
        { path: ["First"], lines: ["area"] },
        { path: ["Second"], lines: ["x"] },
      ]),
      variant("wazuh-dashboard-plugins", [
        { path: ["First"], lines: ["plugin(s)"] },
        { path: ["Second"], lines: ["y"] },
      ]),
    ];

    const extracted = extractSkill(diffSkill("check-standards", variants));

    expect(extracted.distributable).toBe(false);
    expect(extracted.blockingConflicts).toHaveLength(2);
    expect(extracted.blockingConflicts.some((c) => c.includes("First"))).toBe(true);
    expect(extracted.blockingConflicts.some((c) => c.includes("Second"))).toBe(true);
  });
});

describe("a skill whose every divergence carries a marker is distributable (task 5.2)", () => {
  test("distributable is true and blockingConflicts is empty", () => {
    const variants = [
      variant("wazuh-dashboard", [
        {
          path: ["Section"],
          lines: ["common line", "> **repo-specific (wazuh-dashboard):** dashboard-only line"],
          markers: [{ lineIndex: 1, repo: "wazuh-dashboard" }],
        },
      ]),
      variant("wazuh-dashboard-plugins", [{ path: ["Section"], lines: ["common line"] }]),
    ];

    const extracted = extractSkill(diffSkill("analyze-dashboard-vuln", variants));

    expect(extracted.conflicts).toEqual([]);
    expect(extracted.distributable).toBe(true);
    expect(extracted.blockingConflicts).toEqual([]);
  });

  test("a fully common skill (no divergence at all) is distributable", () => {
    const lines = ["one shared body"];
    const variants = ["wazuh-dashboard", "wazuh-indexer"].map((repo) =>
      variant(repo, [{ path: ["Section"], lines }]),
    );

    const extracted = extractSkill(diffSkill("create-pr", variants));

    expect(extracted.distributable).toBe(true);
    expect(extracted.blockingConflicts).toEqual([]);
  });
});

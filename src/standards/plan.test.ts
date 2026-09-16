/**
 * `planSync` — SPEC 2.3's "sync never distributes a skill carrying
 * conflicts" and "sync with everything blocked is reported, not failed"
 * (tasks 1.1–1.3).
 *
 * Every fixture here is a hand-built `ExtractedSkill`, the same discipline
 * `core-floor.test.ts` established in the sibling package: a pure function's
 * test must not assert against a fixture built from the same understanding
 * as the code under test, so nothing here is round-tripped through
 * `extractSkill` itself.
 */

import { describe, expect, test } from "bun:test";
import type { ExtractedSkill, PatchOp } from "../skills/extract.ts";
import { planSync } from "./plan.ts";

const TOOL = "wazuh-ctx@0.1.0";

function cleanSkill(name: string, repo: string): ExtractedSkill {
  return {
    skill: name,
    repos: [repo],
    core: [{ path: [], anchors: [], slots: [[`${name}'s shared body`]], absentFor: [] }],
    overrides: new Map([[repo, []]]),
    conflicts: [],
    coreShare: 1,
    conflictsShare: 0,
    distributable: true,
    blockingConflicts: [],
    tiedPositions: [],
  };
}

function blockedSkill(name: string, repo: string, reasons: readonly string[]): ExtractedSkill {
  const conflictOp: PatchOp = {
    heading: ["Disputed"],
    anchor: null,
    occurrence: 0,
    offset: 0,
    content: ["disputed content"],
    repos: [repo],
    attribution: "conflict",
  };
  return {
    skill: name,
    repos: [repo],
    core: [{ path: ["Disputed"], anchors: [], slots: [[]], absentFor: [] }],
    overrides: new Map([[repo, []]]),
    conflicts: [conflictOp],
    coreShare: 0.5,
    conflictsShare: 0.5,
    distributable: false,
    blockingConflicts: [...reasons],
    tiedPositions: [],
  };
}

describe("a skill with no conflicts is planned for distribution (task 1.1)", () => {
  test("it appears in `distributed`, not `blocked`", () => {
    const plan = planSync([cleanSkill("create-pr", "wazuh-dashboard")], "wazuh-dashboard", TOOL);

    expect(plan.distributed).toHaveLength(1);
    expect(plan.distributed[0]!.skill).toBe("create-pr");
    expect(plan.blocked).toHaveLength(0);
  });
});

describe("a skill with conflicts is blocked, carrying its reasons (task 1.1)", () => {
  test("it appears in `blocked` with the blocking conflicts named, not in `distributed`", () => {
    const plan = planSync(
      [blockedSkill("check-standards", "wazuh-dashboard", ["Disputed: (start of section)"])],
      "wazuh-dashboard",
      TOOL,
    );

    expect(plan.distributed).toHaveLength(0);
    expect(plan.blocked).toHaveLength(1);
    expect(plan.blocked[0]!.skill).toBe("check-standards");
    expect(plan.blocked[0]!.reasons).toEqual(["Disputed: (start of section)"]);
  });
});

describe("the gate is a filter, not a guard clause (task 1.2)", () => {
  test("with six blocked skills, all six reasons are reported, not just the first", () => {
    const skills = ["a", "b", "c", "d", "e", "f"].map((letter) =>
      blockedSkill(letter, "wazuh-dashboard", [`${letter}: reason`]),
    );

    const plan = planSync(skills, "wazuh-dashboard", TOOL);

    expect(plan.distributed).toHaveLength(0);
    expect(plan.blocked).toHaveLength(6);
    for (const letter of ["a", "b", "c", "d", "e", "f"]) {
      const entry = plan.blocked.find((b) => b.skill === letter);
      expect(entry).toBeDefined();
      expect(entry!.reasons).toEqual([`${letter}: reason`]);
    }
  });
});

describe("a clean skill is planned while another is blocked (task 1.3)", () => {
  test("one does not hold the other hostage", () => {
    const plan = planSync(
      [
        cleanSkill("create-pr", "wazuh-dashboard"),
        blockedSkill("check-standards", "wazuh-dashboard", ["Disputed: (start of section)"]),
      ],
      "wazuh-dashboard",
      TOOL,
    );

    expect(plan.distributed).toHaveLength(1);
    expect(plan.distributed[0]!.skill).toBe("create-pr");
    expect(plan.blocked).toHaveLength(1);
    expect(plan.blocked[0]!.skill).toBe("check-standards");
  });
});

describe("the manifest is built from the same plan it accompanies (design decision 2)", () => {
  test("it carries the tool version and one entry per distributed file, hashed", () => {
    const plan = planSync([cleanSkill("create-pr", "wazuh-dashboard")], "wazuh-dashboard", TOOL);

    expect(plan.manifest.tool).toBe(TOOL);
    expect(plan.manifest.files).toHaveLength(1);
    expect(plan.manifest.files[0]!.path).toBe(plan.distributed[0]!.path);
    expect(plan.manifest.files[0]!.hash).toBe(plan.distributed[0]!.hash);
    // The same content hashed twice is the same hash — no clock, no
    // environment, nothing but the bytes.
    expect(plan.manifest.payloadHash).toBe(planSync([cleanSkill("create-pr", "wazuh-dashboard")], "wazuh-dashboard", TOOL).manifest.payloadHash);
  });

  test("an empty plan still carries a manifest, with zero files", () => {
    const plan = planSync([], "wazuh-dashboard", TOOL);

    expect(plan.manifest.files).toEqual([]);
    expect(plan.manifest.tool).toBe(TOOL);
  });
});

describe("a skill the target repo has no copy of is neither distributed nor silently dropped", () => {
  test("it is reported as blocked, naming the repository", () => {
    const plan = planSync([cleanSkill("create-pr", "wazuh-indexer")], "wazuh-dashboard", TOOL);

    expect(plan.distributed).toHaveLength(0);
    expect(plan.blocked).toHaveLength(1);
    expect(plan.blocked[0]!.skill).toBe("create-pr");
    expect(plan.blocked[0]!.reasons[0]).toContain("wazuh-dashboard");
  });
});

describe("sync fails fatally on an unresolvable anchor (task 3.3, SPEC 2.1.1)", () => {
  test("an override anchor that resolves to more than one position is fatal, not a warning", () => {
    // Constructed case (per exploration.md finding 5 and the spec's own
    // note): after `skills-core` introduced heading scoping and ordinals,
    // the real 42-file corpus produces zero ambiguous anchors, so this shape
    // has to be built by hand rather than found. `anchors` repeats "shared
    // line" twice, and the override op below requests its THIRD occurrence
    // — fewer matches than the requested ordinal, which `resolveAnchor`
    // (`anchor.ts`) treats as fatal regardless of whether the count is zero
    // or merely short (SPEC 2.1.1: "zero positions, or more than the
    // requested occurrence" — both are the same failure, "not exactly the
    // one requested").
    const ambiguous: ExtractedSkill = {
      skill: "check-standards",
      repos: ["wazuh-dashboard"],
      core: [
        {
          path: ["Workflow"],
          anchors: ["shared line", "shared line"],
          slots: [[], [], []],
          absentFor: [],
        },
      ],
      overrides: new Map([
        [
          "wazuh-dashboard",
          [
            {
              heading: ["Workflow"],
              anchor: "shared line",
              occurrence: 3,
              offset: 0,
              content: ["dashboard-only line"],
              repos: ["wazuh-dashboard"],
              attribution: "override" as const,
            },
          ],
        ],
      ]),
      conflicts: [],
      coreShare: 0.5,
      conflictsShare: 0,
      distributable: true,
      blockingConflicts: [],
      tiedPositions: [],
    };

    expect(() => planSync([ambiguous], "wazuh-dashboard", TOOL)).toThrow(/occurrence/);
  });
});

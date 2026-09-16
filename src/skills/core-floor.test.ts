/**
 * The core floor — SPEC 2.4's companion to reconstruction (tasks 4.1–4.2).
 *
 * exploration.md finding 1: "≥ 35 of 42 byte-identical reconstructions" is
 * trivially satisfiable — an empty `core/` with every file whole as its own
 * override reconstructs 42 of 42 having extracted nothing. Reconstruction
 * proves the patches invert the split; it says nothing about whether the
 * split means anything. This suite tests the companion constraint directly,
 * separate from `extract.test.ts` and `reconstruct.test.ts`, because it is a
 * DIFFERENT property: not "does it round-trip" but "does the round-trip
 * prove anything."
 *
 * The test below builds an `ExtractedSkill` BY HAND rather than through
 * `extractSkill`, on purpose — `meetsCoreFloor` must fail this shape
 * regardless of what produced it, and a hand-built object is the only way
 * to represent "some other extraction strategy chose to put everything in
 * an override" without needing `extractSkill` itself to ever do so.
 */

import { describe, expect, test } from "bun:test";
import { computeCoreShare, meetsCoreFloor } from "./extract.ts";
import { reconstructRepo } from "./reconstruct.ts";
import type { ExtractedSkill, PatchOp } from "./extract.ts";

describe("an extraction placing every file whole into its own override reconstructs everything and still fails (task 4.1)", () => {
  test("empty core, full-content overrides: reconstruction succeeds, the floor does not", () => {
    const original = ["line one", "line two", "line three", "line four"];

    const wholeFileAsOverride: PatchOp = {
      heading: [],
      anchor: null,
      occurrence: 0,
      offset: 0,
      content: original,
      repos: ["wazuh-dashboard"],
      attribution: "override",
    };

    const extracted: ExtractedSkill = {
      skill: "a-skill",
      repos: ["wazuh-dashboard"],
      core: [], // nothing extracted — the trap this test exists to close
      overrides: new Map([["wazuh-dashboard", [wholeFileAsOverride]]]),
      conflicts: [],
      coreShare: 1, // deliberately wrong, to prove meetsCoreFloor never trusts this field
      distributable: true,
      blockingConflicts: [],
      tiedPositions: [],
    };

    // Reconstruction succeeds — the patches DO invert the split.
    expect(reconstructRepo(extracted, "wazuh-dashboard")).toEqual(original);

    // And the floor still fails, because computeCoreShare is derived from
    // `core`/`overrides`/`conflicts` directly, never from the (here,
    // deliberately wrong) `coreShare` field.
    expect(computeCoreShare(extracted)).toBe(0);
    expect(meetsCoreFloor(extracted)).toBe(false);
  });
});

describe("the share is reported per skill (task 2.6 / 4.2 companion)", () => {
  test("a skill whose core holds every line reports a share of 1", () => {
    const extracted: ExtractedSkill = {
      skill: "a-skill",
      repos: ["wazuh-dashboard", "wazuh-indexer"],
      core: [{ path: ["Section"], anchors: ["a", "b", "c"], slots: [[], [], [], []], absentFor: [] }],
      overrides: new Map([
        ["wazuh-dashboard", []],
        ["wazuh-indexer", []],
      ]),
      conflicts: [],
      coreShare: 0, // deliberately wrong, same reason as above
      distributable: true,
      blockingConflicts: [],
      tiedPositions: [],
    };

    expect(computeCoreShare(extracted)).toBe(1);
    expect(meetsCoreFloor(extracted)).toBe(true);
  });

  test("a 50/50 split sits exactly on the floor and passes it", () => {
    const op: PatchOp = {
      heading: ["Section"],
      anchor: "shared",
      occurrence: 1,
      offset: 0,
      content: ["divergent line"],
      repos: ["wazuh-dashboard"],
      attribution: "override",
    };
    const extracted: ExtractedSkill = {
      skill: "a-skill",
      repos: ["wazuh-dashboard"],
      core: [{ path: ["Section"], anchors: ["shared"], slots: [[], []], absentFor: [] }],
      overrides: new Map([["wazuh-dashboard", [op]]]),
      conflicts: [],
      coreShare: 0,
      distributable: true,
      blockingConflicts: [],
      tiedPositions: [],
    };

    expect(computeCoreShare(extracted)).toBe(0.5);
    expect(meetsCoreFloor(extracted)).toBe(true);
  });
});

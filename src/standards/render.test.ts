/**
 * `renderSyncSummary` — the readable stdout summary for `sync` (following
 * the coordinator's review: dumping every conflict body onto one
 * semicolon-joined line made a skill with many conflicts unreadable, which
 * defeats the whole point of exiting `0` with a message instead of failing —
 * SPEC's own reasoning is that the message IS the mitigation for "exit 0
 * reads as success", and an unreadable message mitigates nothing).
 *
 * Pure, like every other `render.ts` in this project (`src/skills/render.ts`,
 * `src/crosscheck/render-live.ts`): built from literals, never from a
 * fixture written from the same understanding as the code.
 */

import { describe, expect, test } from "bun:test";
import type { BlockedSkill, DistributedFile, SyncPlan } from "./plan.ts";
import { renderSyncSummary } from "./render.ts";

const TOOL = "wazuh-ctx@0.1.0";

function plan(distributed: readonly DistributedFile[], blocked: readonly BlockedSkill[]): SyncPlan {
  return {
    repo: "wazuh-dashboard",
    distributed,
    blocked,
    manifest: {
      tool: TOOL,
      payloadHash: "sha256:whatever",
      files: distributed.map((d) => ({ path: d.path, hash: d.hash })),
    },
  };
}

function distributedFile(skill: string): DistributedFile {
  return { skill, path: `skills/${skill}/SKILL.md`, content: "body", hash: "sha256:abc" };
}

describe("the load-bearing '0 of N distributed' message (SPEC 2.3)", () => {
  test("everything blocked states the count plainly", () => {
    const blocked: BlockedSkill = {
      skill: "check-standards",
      reasons: ["Disputed: (start of section)"],
      conflictHeadings: [{ heading: "Disputed", count: 1 }],
    };

    const summary = renderSyncSummary(plan([], [blocked]));

    expect(summary).toContain("0 of 1 distributed");
  });

  test("a partial distribution states the real count too", () => {
    const summary = renderSyncSummary(
      plan([distributedFile("create-pr")], [
        { skill: "check-standards", reasons: ["Disputed: x"], conflictHeadings: [{ heading: "Disputed", count: 1 }] },
      ]),
    );

    expect(summary).toContain("1 of 2 distributed");
  });
});

describe("a skill with many conflicts is scannable, not a wall of text", () => {
  test("it names the skill, its total conflict count, and never prints a conflict body", () => {
    const blocked: BlockedSkill = {
      skill: "create-pr",
      reasons: [
        "Golden rules (do not skip): (start of section)",
        "Issue source: public vs internal: `https://...`",
        "Issue source: public vs internal: second anchor",
        "Workflow > 4. CHANGELOG entry: first",
        "Workflow > 4. CHANGELOG entry: second",
      ],
      conflictHeadings: [
        { heading: "Golden rules (do not skip)", count: 1 },
        { heading: "Issue source: public vs internal", count: 2 },
        { heading: "Workflow > 4. CHANGELOG entry", count: 2 },
      ],
    };

    const summary = renderSyncSummary(plan([], [blocked]));

    // The skill and a total count are both present, scannable at a glance.
    expect(summary).toContain("create-pr");
    expect(summary).toContain("5 conflicts");

    // The disputed CONTENT never appears — only heading paths and counts.
    // The conflict bodies live in conflicts/<skill>.yml, not on stdout.
    expect(summary).not.toContain("`https://...`");
    expect(summary).not.toContain("(start of section)");

    // The heading paths themselves are present, so a person knows WHERE.
    expect(summary).toContain("Golden rules (do not skip)");
    expect(summary).toContain("Issue source: public vs internal");

    // The count line is far shorter than the old semicolon-joined dump —
    // no single line should approach the ~1,200-character wall reported.
    const longestLine = Math.max(...summary.split("\n").map((line) => line.length));
    expect(longestLine).toBeLessThan(200);
  });

  test("more headings than the shown handful are summarised, not enumerated forever", () => {
    const conflictHeadings = Array.from({ length: 11 }, (_, i) => ({ heading: `Section ${i}`, count: 1 }));
    const blocked: BlockedSkill = {
      skill: "create-pr",
      reasons: conflictHeadings.map((h) => `${h.heading}: x`),
      conflictHeadings,
    };

    const summary = renderSyncSummary(plan([], [blocked]));

    expect(summary).toContain("11 conflicts");
    expect(summary).toContain("more");
    expect(summary).toContain("conflicts/create-pr.yml");
    // Not every one of the 11 headings needs to appear — only a handful plus
    // the "N more" pointer.
    expect(summary).not.toContain("Section 10");
  });
});

describe("a skill blocked for a non-conflict reason (no copy for this repo)", () => {
  test("its reason is shown; there is no conflict count to report", () => {
    const blocked: BlockedSkill = {
      skill: "wcs-management",
      reasons: ["repository 'wazuh-dashboard' has no copy of this skill"],
      conflictHeadings: [],
    };

    const summary = renderSyncSummary(plan([], [blocked]));

    expect(summary).toContain("wcs-management");
    expect(summary).toContain("has no copy of this skill");
    expect(summary).not.toContain("conflicts");
  });
});

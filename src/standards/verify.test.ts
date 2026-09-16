/**
 * `verifyStandards` — `check`'s pure core (SPEC 2.4's three-state
 * requirement). Pure: no fs, no network, no clock — `apply.ts` gathers the
 * bytes, this module only decides what they mean (tasks 2.1–2.5).
 *
 * Three states as an ENUM, never a boolean plus a special case (design
 * decision 3): a boolean invites `if (!ok)`, and that is exactly how "no
 * target" becomes "failed" or "fine" depending on which way the author
 * leaned. Every test below asserts the exact `state`, never a truthiness
 * shortcut on it.
 */

import { describe, expect, test } from "bun:test";
import { verifyStandards } from "./verify.ts";

const TOOL = "wazuh-ctx@0.1.0";

describe("an absent target is not-applicable, never in-sync (task 2.2, SPEC 2.4)", () => {
  test("targetExists: false reports not-applicable regardless of what else is supplied", () => {
    const result = verifyStandards({ targetExists: false, manifest: null, observed: [], currentTool: TOOL });

    expect(result.state).toBe("not-applicable");
    expect(result.drifted).toEqual([]);
  });
});

describe("a materialised target matching the manifest is in-sync (task 2.1)", () => {
  test("every manifest file present with a matching hash reports in-sync", () => {
    const result = verifyStandards({
      targetExists: true,
      manifest: {
        tool: TOOL,
        payloadHash: "sha256:payload",
        files: [{ path: "skills/create-pr/SKILL.md", hash: "sha256:abc" }],
      },
      observed: [{ path: "skills/create-pr/SKILL.md", hash: "sha256:abc" }],
      currentTool: TOOL,
    });

    expect(result.state).toBe("in-sync");
    expect(result.drifted).toEqual([]);
  });
});

describe("a locally edited file is drifted (task 2.1)", () => {
  test("a hash mismatch against the manifest reports drifted, naming the file", () => {
    const result = verifyStandards({
      targetExists: true,
      manifest: {
        tool: TOOL,
        payloadHash: "sha256:payload",
        files: [{ path: "skills/create-pr/SKILL.md", hash: "sha256:abc" }],
      },
      observed: [{ path: "skills/create-pr/SKILL.md", hash: "sha256:edited" }],
      currentTool: TOOL,
    });

    expect(result.state).toBe("drifted");
    expect(result.drifted).toHaveLength(1);
    expect(result.drifted[0]!.path).toBe("skills/create-pr/SKILL.md");
  });
});

describe("a partially-synced target is drifted, not not-applicable (task 2.3)", () => {
  test("a manifest file missing from disk is drifted, naming the missing file", () => {
    const result = verifyStandards({
      targetExists: true,
      manifest: {
        tool: TOOL,
        payloadHash: "sha256:payload",
        files: [
          { path: "skills/create-pr/SKILL.md", hash: "sha256:abc" },
          { path: "skills/check-standards/SKILL.md", hash: "sha256:def" },
        ],
      },
      observed: [{ path: "skills/create-pr/SKILL.md", hash: "sha256:abc" }],
      currentTool: TOOL,
    });

    expect(result.state).toBe("drifted");
    expect(result.drifted).toHaveLength(1);
    expect(result.drifted[0]!.path).toBe("skills/check-standards/SKILL.md");
    expect(result.drifted[0]!.reason).toBe("missing");
  });

  test("a file on disk the manifest never named is drifted too, not silently ignored", () => {
    const result = verifyStandards({
      targetExists: true,
      manifest: {
        tool: TOOL,
        payloadHash: "sha256:payload",
        files: [{ path: "skills/create-pr/SKILL.md", hash: "sha256:abc" }],
      },
      observed: [
        { path: "skills/create-pr/SKILL.md", hash: "sha256:abc" },
        { path: "skills/rogue/SKILL.md", hash: "sha256:xyz" },
      ],
      currentTool: TOOL,
    });

    expect(result.state).toBe("drifted");
    expect(result.drifted).toHaveLength(1);
    expect(result.drifted[0]!.path).toBe("skills/rogue/SKILL.md");
    expect(result.drifted[0]!.reason).toBe("unexpected");
  });
});

describe("hashes compare exact bytes, never normalised content (task 2.4)", () => {
  test("a trailing-newline-only difference in the recorded hash is still drift", () => {
    // The hash itself is opaque to this module — it never re-derives content
    // from a hash. What this asserts is that verifyStandards does not try to
    // be clever about "close enough" hashes: any mismatch, however the bytes
    // that produced it differed, is drift.
    const result = verifyStandards({
      targetExists: true,
      manifest: {
        tool: TOOL,
        payloadHash: "sha256:payload",
        files: [{ path: "skills/create-pr/SKILL.md", hash: "sha256:no-trailing-newline" }],
      },
      observed: [{ path: "skills/create-pr/SKILL.md", hash: "sha256:with-trailing-newline" }],
      currentTool: TOOL,
    });

    expect(result.state).toBe("drifted");
    expect(result.drifted[0]!.reason).toBe("modified");
  });
});

describe("a manifest from a different tool version reports that, not a false 'edited locally' (task 2.5)", () => {
  test("a hash mismatch under a differing tool version is reported with a distinct reason", () => {
    const result = verifyStandards({
      targetExists: true,
      manifest: {
        tool: "wazuh-ctx@0.0.9",
        payloadHash: "sha256:payload",
        files: [{ path: "skills/create-pr/SKILL.md", hash: "sha256:old" }],
      },
      observed: [{ path: "skills/create-pr/SKILL.md", hash: "sha256:new" }],
      currentTool: TOOL,
    });

    expect(result.state).toBe("drifted");
    expect(result.drifted[0]!.reason).toBe("tool-version-mismatch");
    expect(result.drifted[0]!.reason).not.toBe("modified");
    expect(result.message).toContain("wazuh-ctx@0.0.9");
    expect(result.message).not.toContain("edited locally");
  });

  test("matching hashes under a differing tool version is still in-sync — the bytes are what matters", () => {
    const result = verifyStandards({
      targetExists: true,
      manifest: {
        tool: "wazuh-ctx@0.0.9",
        payloadHash: "sha256:payload",
        files: [{ path: "skills/create-pr/SKILL.md", hash: "sha256:same" }],
      },
      observed: [{ path: "skills/create-pr/SKILL.md", hash: "sha256:same" }],
      currentTool: TOOL,
    });

    expect(result.state).toBe("in-sync");
  });
});

describe("a target present but carrying no manifest cannot be verified as in-sync", () => {
  test("it is reported as drifted, not not-applicable and not in-sync", () => {
    const result = verifyStandards({
      targetExists: true,
      manifest: null,
      observed: [{ path: "skills/create-pr/SKILL.md", hash: "sha256:abc" }],
      currentTool: TOOL,
    });

    expect(result.state).toBe("drifted");
  });
});

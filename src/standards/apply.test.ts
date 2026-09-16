/**
 * `applySync` / `checkStandards` — the ONLY module under `src/standards/`
 * that touches the filesystem (SPEC 6.1's purity seam, mirroring
 * `src/skills/emit.ts`'s role for the sibling package). `plan.ts` and
 * `verify.ts` decide; this module only writes and reads bytes.
 *
 * Every test here uses a REAL temporary directory (`mkdtemp` under the OS
 * tmp dir), never an in-memory filesystem and never a mock — this project's
 * defects have repeatedly been the kind only real I/O catches (design
 * decision 5, and `cli-skills-diff.test.ts`'s own choice of a real, if tiny,
 * git history over a mocked one).
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtractedSkill } from "../skills/extract.ts";
import { applySync, checkStandards, STANDARDS_DIR } from "./apply.ts";
import { planSync } from "./plan.ts";

const TOOL = "wazuh-ctx@0.1.0";

function cleanSkill(name: string, repo: string, body = `${name}'s shared body`): ExtractedSkill {
  return {
    skill: name,
    repos: [repo],
    core: [{ path: [], anchors: [], slots: [[body]], absentFor: [] }],
    overrides: new Map([[repo, []]]),
    conflicts: [],
    coreShare: 1,
    conflictsShare: 0,
    distributable: true,
    blockingConflicts: [],
    tiedPositions: [],
  };
}

function blockedSkill(name: string, repo: string): ExtractedSkill {
  return {
    skill: name,
    repos: [repo],
    core: [{ path: ["Disputed"], anchors: [], slots: [[]], absentFor: [] }],
    overrides: new Map([[repo, []]]),
    conflicts: [
      {
        heading: ["Disputed"],
        anchor: null,
        occurrence: 0,
        offset: 0,
        content: ["disputed content"],
        repos: [repo],
        attribution: "conflict",
      },
    ],
    coreShare: 0.5,
    conflictsShare: 0.5,
    distributable: false,
    blockingConflicts: ["Disputed: (start of section)"],
    tiedPositions: [],
  };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "wazuh-ctx-standards-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("applySync writes the plan and a manifest recording exactly the bytes written (task 3.1)", () => {
  test("the manifest's hash matches the file actually on disk", async () => {
    await withTempDir(async (dir) => {
      const plan = planSync([cleanSkill("create-pr", "wazuh-dashboard")], "wazuh-dashboard", TOOL);

      const result = await applySync(plan, dir);

      const written = plan.distributed[0]!;
      const onDisk = await readFile(join(dir, STANDARDS_DIR, written.path), "utf8");
      expect(onDisk).toBe(written.content);

      const manifestRaw = await readFile(join(dir, STANDARDS_DIR, "manifest.json"), "utf8");
      const manifest = JSON.parse(manifestRaw) as { files: { path: string; hash: string }[] };
      expect(manifest.files).toHaveLength(1);
      expect(manifest.files[0]!.hash).toBe(written.hash);
      expect(result.written.length).toBeGreaterThan(0);
    });
  });
});

describe("a blocked skill leaves nothing behind (task 3.2)", () => {
  test("the clean skill's file exists; the blocked skill's does not", async () => {
    await withTempDir(async (dir) => {
      const plan = planSync(
        [cleanSkill("create-pr", "wazuh-dashboard"), blockedSkill("check-standards", "wazuh-dashboard")],
        "wazuh-dashboard",
        TOOL,
      );

      await applySync(plan, dir);

      const cleanPath = join(dir, STANDARDS_DIR, "skills", "create-pr", "SKILL.md");
      await expect(stat(cleanPath)).resolves.toBeDefined();

      const blockedPath = join(dir, STANDARDS_DIR, "skills", "check-standards");
      await expect(stat(blockedPath)).rejects.toThrow();
    });
  });
});

describe("everything blocked writes nothing at all, not even an empty manifest", () => {
  test("no .claude/standards/ directory is created", async () => {
    await withTempDir(async (dir) => {
      const plan = planSync([blockedSkill("check-standards", "wazuh-dashboard")], "wazuh-dashboard", TOOL);

      const result = await applySync(plan, dir);

      expect(result.written).toEqual([]);
      await expect(stat(join(dir, STANDARDS_DIR))).rejects.toThrow();
    });
  });
});

describe("checkStandards distinguishes the three states end to end against real files", () => {
  test("no .claude/standards/ at all is not-applicable", async () => {
    await withTempDir(async (dir) => {
      const result = await checkStandards(dir, TOOL);
      expect(result.state).toBe("not-applicable");
    });
  });

  test("freshly synced is in-sync", async () => {
    await withTempDir(async (dir) => {
      const plan = planSync([cleanSkill("create-pr", "wazuh-dashboard")], "wazuh-dashboard", TOOL);
      await applySync(plan, dir);

      const result = await checkStandards(dir, TOOL);
      expect(result.state).toBe("in-sync");
    });
  });

  test("an edited materialised file is drifted, naming it", async () => {
    await withTempDir(async (dir) => {
      const plan = planSync([cleanSkill("create-pr", "wazuh-dashboard")], "wazuh-dashboard", TOOL);
      await applySync(plan, dir);

      const filePath = join(dir, STANDARDS_DIR, plan.distributed[0]!.path);
      const original = await readFile(filePath, "utf8");
      await Bun.write(filePath, `${original}\nlocally added line\n`);

      const result = await checkStandards(dir, TOOL);
      expect(result.state).toBe("drifted");
      expect(result.drifted.map((d) => d.path)).toContain(plan.distributed[0]!.path);
    });
  });
});

describe("nothing under .cache/ is ever touched (design decision 6)", () => {
  test("applySync and checkStandards only ever write under the given target directory", async () => {
    await withTempDir(async (dir) => {
      const cacheMarker = join(dir, ".cache", "sentinel");
      const plan = planSync([cleanSkill("create-pr", "wazuh-dashboard")], "wazuh-dashboard", TOOL);
      await applySync(plan, dir);
      await checkStandards(dir, TOOL);

      await expect(stat(cacheMarker)).rejects.toThrow();
      await expect(stat(join(dir, ".cache"))).rejects.toThrow();
    });
  });
});

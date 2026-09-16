/**
 * The three-step demonstration SPEC 2.3 names by name (tasks 4.1–4.4).
 *
 * No repository under `wazuh/*` has `.claude/standards/`, and putting one
 * there needs a PR this project does not open (`exploration.md` finding 1).
 * Phase 2 therefore delivers the mechanism and ITS DEMONSTRATION, not the
 * mechanism operating against a real target — and the demonstration is what
 * makes "delivered" a word with content. It runs against
 * `fixtures/standards-target/`, a REAL directory this project owns: `sync`
 * materialises into it, `check` passes, a local edit is introduced, `check`
 * fails naming that file. Three steps, one test, real filesystem — not an
 * in-memory one and not a mock, because a mock agrees with whatever the code
 * does (design decision 5, and the standing rule this project has earned
 * five defects proving).
 *
 * The directory is created fresh and torn down by this test, never
 * committed — "lives in fixtures/" is about where the demonstration is
 * anchored in the repository layout, not about a checked-in artifact.
 */

import { describe, expect, test } from "bun:test";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtractedSkill } from "../skills/extract.ts";
import { applySync, checkStandards, STANDARDS_DIR } from "./apply.ts";
import { planSync } from "./plan.ts";

const TOOL = "wazuh-ctx@0.1.0";
const FIXTURE_ROOT = join(import.meta.dir, "..", "..", "fixtures", "standards-target");
const CACHE_ROOT = join(import.meta.dir, "..", "..", ".cache");

function demoSkill(): ExtractedSkill {
  return {
    skill: "create-pr",
    repos: ["fixture-repo"],
    core: [{ path: [], anchors: [], slots: [["Open a pull request against `master`."]], absentFor: [] }],
    overrides: new Map([["fixture-repo", []]]),
    conflicts: [],
    coreShare: 1,
    conflictsShare: 0,
    distributable: true,
    blockingConflicts: [],
    tiedPositions: [],
  };
}

interface CacheSnapshot {
  readonly names: readonly string[];
  readonly mtimes: readonly number[];
}

async function snapshotCache(): Promise<CacheSnapshot> {
  let entries: string[];
  try {
    entries = (await readdir(CACHE_ROOT)).sort();
  } catch {
    return { names: [], mtimes: [] };
  }
  const mtimes = await Promise.all(
    entries.map(async (name) => (await stat(join(CACHE_ROOT, name))).mtimeMs),
  );
  return { names: entries, mtimes };
}

describe("the full round: sync materialises, check passes, an edit drifts it (SPEC 2.3, task 4.1)", () => {
  test("three steps against a real fixture directory", async () => {
    const cacheBefore = await snapshotCache();

    await rm(FIXTURE_ROOT, { recursive: true, force: true });
    await mkdir(FIXTURE_ROOT, { recursive: true });

    try {
      // Step 0: before sync, there is genuinely nothing to check.
      const before = await checkStandards(FIXTURE_ROOT, TOOL);
      expect(before.state).toBe("not-applicable");

      // Step 1: sync materialises into the fixture.
      const plan = planSync([demoSkill()], "fixture-repo", TOOL);
      expect(plan.distributed).toHaveLength(1);
      const applied = await applySync(plan, FIXTURE_ROOT);
      expect(applied.written.length).toBeGreaterThan(0);

      // Step 2: check passes — freshly synced, untouched.
      const clean = await checkStandards(FIXTURE_ROOT, TOOL);
      expect(clean.state).toBe("in-sync");

      // Step 3: a local edit is introduced, and check fails naming that file.
      const editedPath = join(FIXTURE_ROOT, STANDARDS_DIR, plan.distributed[0]!.path);
      const original = await Bun.file(editedPath).text();
      await writeFile(editedPath, `${original}\nAn edit nobody declared.\n`, "utf8");

      const drifted = await checkStandards(FIXTURE_ROOT, TOOL);
      expect(drifted.state).toBe("drifted");
      expect(drifted.drifted.map((d) => d.path)).toContain(plan.distributed[0]!.path);
    } finally {
      await rm(FIXTURE_ROOT, { recursive: true, force: true });
    }

    // Task 4.3: nothing under .cache/ changed while this ran.
    const cacheAfter = await snapshotCache();
    expect(cacheAfter).toEqual(cacheBefore);
  });
});

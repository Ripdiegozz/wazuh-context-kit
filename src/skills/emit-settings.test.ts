/**
 * `emitSettings` — task 4.1 ("extraction emits `core/.claude/settings.json`
 * and per-repo overrides") and task 4.3 (determinism). Kept in its own file
 * rather than folded into `emit.test.ts`'s skills-focused suite, the same
 * way `settings-merge`'s pure modules live in their own `src/settings/`
 * package rather than inside `src/skills/` — one concept per file, even
 * though the WRITER is shared.
 *
 * Real temp directories on purpose, same as `emit.test.ts`: determinism and
 * "no fourth writer, no timestamp" are properties of written bytes, which
 * only exist once something actually writes them.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeSettings } from "../settings/merge.ts";
import { emitExtraction, emitSettings } from "./emit.ts";
import type { ExtractedSkill } from "./extract.ts";

async function listFilesRecursively(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await listFilesRecursively(full)));
    } else {
      results.push(full);
    }
  }
  return results.sort();
}

function sampleMerge() {
  return mergeSettings([
    { repo: "wazuh-dashboard", settings: { permissions: { allow: ["Bash(git status:*)", "Bash(yarn typecheck)"] } } },
    { repo: "wazuh-indexer-plugins", settings: { permissions: { allow: ["Bash(git status:*)"] } } },
    { repo: "reporting", settings: { permissions: { allow: ["Bash(git status:*)", "Bash(yarn lint)"] } } },
  ]);
}

describe("emitSettings lays out core/.claude/settings.json and per-repo overrides (task 4.1)", () => {
  test("core, both non-empty overrides, and no conflicts file, since there are none", async () => {
    const dir = await mkdtemp(join(tmpdir(), "emit-settings-layout-"));
    try {
      const merged = sampleMerge();
      const written = await emitSettings(dir, merged);

      expect(written).toContain(join(dir, "core", ".claude", "settings.json"));
      expect(written).toContain(join(dir, "overrides", "wazuh-dashboard", "settings.json"));
      expect(written).toContain(join(dir, "overrides", "reporting", "settings.json"));
      // wazuh-indexer-plugins has nothing to override — no file for it, the
      // same "no laundered emptiness" rule the skills' emit follows.
      expect(written).not.toContain(join(dir, "overrides", "wazuh-indexer-plugins", "settings.json"));
      expect(written).not.toContain(join(dir, "conflicts", "settings.json"));

      const core = JSON.parse(await readFile(join(dir, "core", ".claude", "settings.json"), "utf8"));
      expect(core).toEqual({ permissions: { allow: ["Bash(git status:*)"] } });

      const dashboardOverride = JSON.parse(
        await readFile(join(dir, "overrides", "wazuh-dashboard", "settings.json"), "utf8"),
      );
      expect(dashboardOverride).toEqual([{ path: ["permissions", "allow"], value: "Bash(yarn typecheck)" }]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a conflict is written to conflicts/settings.json, the same layer skill conflicts use", async () => {
    const dir = await mkdtemp(join(tmpdir(), "emit-settings-conflict-"));
    try {
      const merged = mergeSettings([
        { repo: "a", settings: { permissions: { allow: ["x", "y"] } } },
        { repo: "b", settings: { permissions: { allow: ["x", "y"] } } },
        { repo: "c", settings: { permissions: { allow: ["x"] } } },
      ]);
      expect(merged.conflicts).toHaveLength(1);

      const written = await emitSettings(dir, merged);

      expect(written).toContain(join(dir, "conflicts", "settings.json"));
      const conflicts = JSON.parse(await readFile(join(dir, "conflicts", "settings.json"), "utf8"));
      expect(conflicts).toEqual([
        { kind: "removed-from-core", path: ["permissions", "allow"], value: "y", missingFrom: "c" },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("emitExtraction folds settings into the same run when given merged settings", () => {
  test("the settings paths appear in emitExtraction's own `written` list", async () => {
    const dir = await mkdtemp(join(tmpdir(), "emit-extraction-with-settings-"));
    try {
      const extracted: readonly ExtractedSkill[] = [];
      const merged = sampleMerge();
      const { written } = await emitExtraction(dir, extracted, undefined, merged);

      expect(written).toContain(join(dir, "core", ".claude", "settings.json"));
      expect(written).toContain(join(dir, "overrides", "wazuh-dashboard", "settings.json"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("two frozen runs over unchanged inputs produce byte-identical settings output (task 4.3)", () => {
  test("core, overrides and conflicts match exactly across two temp dirs", async () => {
    const dirA = await mkdtemp(join(tmpdir(), "emit-settings-det-a-"));
    const dirB = await mkdtemp(join(tmpdir(), "emit-settings-det-b-"));
    try {
      // Same content, fresh merge each time, and each merge fed variants in
      // a DIFFERENT order — the determinism this task asks about is
      // supposed to hold regardless of processing order (design decision 5).
      const mergedA = mergeSettings([
        { repo: "a", settings: { permissions: { allow: ["x", "y", "z"] } } },
        { repo: "b", settings: { permissions: { allow: ["x", "y"] } } },
        { repo: "c", settings: { permissions: { allow: ["x", "w"] } } },
      ]);
      const mergedB = mergeSettings([
        { repo: "c", settings: { permissions: { allow: ["x", "w"] } } },
        { repo: "a", settings: { permissions: { allow: ["x", "y", "z"] } } },
        { repo: "b", settings: { permissions: { allow: ["x", "y"] } } },
      ]);

      await emitSettings(dirA, mergedA);
      await emitSettings(dirB, mergedB);

      const filesA = (await listFilesRecursively(dirA)).map((f) => f.slice(dirA.length));
      const filesB = (await listFilesRecursively(dirB)).map((f) => f.slice(dirB.length));
      expect(filesA).toEqual(filesB);
      expect(filesA.length).toBeGreaterThan(0);

      for (let i = 0; i < filesA.length; i++) {
        const contentA = await readFile(join(dirA, filesA[i]!), "utf8");
        const contentB = await readFile(join(dirB, filesB[i]!), "utf8");
        expect(contentA).toBe(contentB);
      }
    } finally {
      await rm(dirA, { recursive: true, force: true });
      await rm(dirB, { recursive: true, force: true });
    }
  });

  test("no ISO timestamp is written into any emitted settings file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "emit-settings-ts-"));
    try {
      const merged = sampleMerge();
      const written = await emitSettings(dir, merged);
      const isoTimestamp = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
      for (const file of written) {
        const content = await readFile(file, "utf8");
        expect(content).not.toMatch(isoTimestamp);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

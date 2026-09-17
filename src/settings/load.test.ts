/**
 * `loadSettingsVariants` — the only module in `src/settings/` allowed to
 * touch the filesystem (mirrors `src/skills/load.ts`'s role for skills,
 * SPEC 6.1's purity seam). `.claude/settings.json` sits beside
 * `.claude/skills/`, not inside it, so it needs its own loader rather than
 * being folded into `loadSkills` (whose own docblock states the exclusion is
 * structural).
 *
 * A repository with no `.claude/settings.json` is not an error — it is
 * reported the same way `loadSkills` reports a repository with no
 * `.claude/skills/`: named, with a reason, never silently dropped and never
 * thrown.
 */

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSettingsVariants } from "./load.ts";

async function makeRepo(root: string, repo: string): Promise<string> {
  const dir = join(root, repo);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function writeSettings(dir: string, content: string): Promise<void> {
  const settingsDir = join(dir, ".claude");
  await mkdir(settingsDir, { recursive: true });
  await writeFile(join(settingsDir, "settings.json"), content, "utf8");
}

describe("a repository carrying .claude/settings.json", () => {
  test("is loaded as a SettingsVariant", async () => {
    const root = await mkdtemp(join(tmpdir(), "wazuh-ctx-settings-load-"));
    try {
      const dir = await makeRepo(root, "wazuh-dashboard");
      await writeSettings(dir, JSON.stringify({ permissions: { allow: ["Bash(git status:*)"] } }));

      const result = await loadSettingsVariants([{ repo: "wazuh-dashboard", dir }]);

      expect(result.variants).toEqual([
        { repo: "wazuh-dashboard", settings: { permissions: { allow: ["Bash(git status:*)"] } } },
      ]);
      expect(result.missing).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("a repository with no .claude/settings.json (mirrors loadSkills' no-skills report)", () => {
  test("is reported as missing, not thrown and not silently dropped", async () => {
    const root = await mkdtemp(join(tmpdir(), "wazuh-ctx-settings-load-missing-"));
    try {
      const dir = await makeRepo(root, "wazuh-indexer-plugins");

      const result = await loadSettingsVariants([{ repo: "wazuh-indexer-plugins", dir }]);

      expect(result.variants).toEqual([]);
      expect(result.missing).toEqual([{ repo: "wazuh-indexer-plugins", reason: "no .claude/settings.json" }]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("an unparsable .claude/settings.json", () => {
  test("is reported as missing, not thrown", async () => {
    const root = await mkdtemp(join(tmpdir(), "wazuh-ctx-settings-load-bad-"));
    try {
      const dir = await makeRepo(root, "wazuh-dashboard");
      await writeSettings(dir, "{ not json");

      const result = await loadSettingsVariants([{ repo: "wazuh-dashboard", dir }]);

      expect(result.variants).toEqual([]);
      expect(result.missing).toEqual([{ repo: "wazuh-dashboard", reason: "unparsable .claude/settings.json" }]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("several repositories, some with settings, some without", () => {
  test("variants and missing are each sorted by repo, independent of input order", async () => {
    const root = await mkdtemp(join(tmpdir(), "wazuh-ctx-settings-load-mixed-"));
    try {
      const dirZ = await makeRepo(root, "z-repo");
      const dirA = await makeRepo(root, "a-repo");
      const dirM = await makeRepo(root, "m-repo");
      await writeSettings(dirZ, JSON.stringify({ $schema: "s" }));
      await writeSettings(dirA, JSON.stringify({ $schema: "s" }));
      // dirM has no settings.json at all.

      const result = await loadSettingsVariants([
        { repo: "z-repo", dir: dirZ },
        { repo: "m-repo", dir: dirM },
        { repo: "a-repo", dir: dirA },
      ]);

      expect(result.variants.map((v) => v.repo)).toEqual(["a-repo", "z-repo"]);
      expect(result.missing).toEqual([{ repo: "m-repo", reason: "no .claude/settings.json" }]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

/**
 * `loadSkills` — the only module in `src/skills/` allowed to touch the
 * filesystem (tasks 5.1–5.4; mirrors the `src/parse/` boundary, SPEC 6.1).
 *
 * Real temporary directories, not a fake IO seam: `src/parse/` reads
 * repository content directly off disk with no injected filesystem
 * abstraction (see `index-references.ts`), and this module follows the same
 * convention rather than inventing a second style for one command.
 */

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSkills } from "./load.ts";
import type { LoadTarget } from "./load.ts";

async function writeSkill(root: string, skillName: string, name: string, description: string): Promise<void> {
  const dir = join(root, ".claude", "skills", skillName);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nBody.\n`,
    "utf8",
  );
}

async function makeRepo(root: string, repo: string): Promise<string> {
  const dir = join(root, repo);
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Two repositories sharing one skill — the minimum shape that clears the
 * two-or-more threshold (task 5.6) and therefore enters the diff. */
async function twoRepoTargets(root: string, skillName: string): Promise<LoadTarget[]> {
  const dirA = await makeRepo(root, "repo-a");
  const dirB = await makeRepo(root, "repo-b");
  await writeSkill(dirA, skillName, skillName, "for repo-a");
  await writeSkill(dirB, skillName, skillName, "for repo-b");
  return [
    { repo: "repo-a", repoKind: "dashboard", dir: dirA },
    { repo: "repo-b", repoKind: "dashboard", dir: dirB },
  ];
}

describe("selection is by presence of .claude/skills/, not kind (task 5.1)", () => {
  test("a kind: platform repository with a shared skill is included", async () => {
    const root = await mkdtemp(join(tmpdir(), "wazuh-ctx-skills-load-"));
    try {
      const dirPlatform = await makeRepo(root, "wazuh-dashboard");
      const dirDashboard = await makeRepo(root, "wazuh-dashboard-plugins");
      await writeSkill(dirPlatform, "create-pr", "create-pr", "Prepare a PR.");
      await writeSkill(dirDashboard, "create-pr", "create-pr", "Prepare a PR.");

      const targets: LoadTarget[] = [
        { repo: "wazuh-dashboard", repoKind: "platform", dir: dirPlatform },
        { repo: "wazuh-dashboard-plugins", repoKind: "dashboard", dir: dirDashboard },
      ];
      const result = await loadSkills(targets);

      const selection = result.repos.find((r) => r.repo === "wazuh-dashboard")!;
      expect(selection.included).toBe(true);
      expect(result.variantsBySkill.get("create-pr")).toHaveLength(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("a repository with no skills is reported, not dropped (task 5.2)", () => {
  test("no .claude/skills at all", async () => {
    const root = await mkdtemp(join(tmpdir(), "wazuh-ctx-skills-load-"));
    try {
      const dir = await makeRepo(root, "wazuh-indexer");

      const targets: LoadTarget[] = [{ repo: "wazuh-indexer", repoKind: "indexer", dir }];
      const result = await loadSkills(targets);

      expect(result.repos).toEqual([
        { repo: "wazuh-indexer", included: false, reason: expect.stringContaining("no .claude/skills") },
      ]);
      expect(result.variantsBySkill.size).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("an empty .claude/skills/ directory is also reported as no skills", async () => {
    const root = await mkdtemp(join(tmpdir(), "wazuh-ctx-skills-load-"));
    try {
      const dir = await makeRepo(root, "wazuh-empty");
      await mkdir(join(dir, ".claude", "skills"), { recursive: true });

      const targets: LoadTarget[] = [{ repo: "wazuh-empty", repoKind: "dashboard", dir }];
      const result = await loadSkills(targets);

      expect(result.repos[0]!.included).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe(".claude/settings.json is never read (task 5.3)", () => {
  test("a settings.json that would fail SKILL.md parsing does not break the load", async () => {
    // If loadSkills ever opened this file as though it were a skill, parsing
    // it as frontmatter+markdown would throw -- SPEC promises settings.json
    // is out of scope, and this is the only place that can prove the promise
    // is kept rather than merely stated.
    const root = await mkdtemp(join(tmpdir(), "wazuh-ctx-skills-load-"));
    try {
      const targets = await twoRepoTargets(root, "create-pr");
      await mkdir(join(targets[0]!.dir, ".claude"), { recursive: true });
      await writeFile(
        join(targets[0]!.dir, ".claude", "settings.json"),
        '{"not":"a skill file, and not YAML frontmatter"}',
        "utf8",
      );

      const result = await loadSkills(targets);

      expect(result.repos.find((r) => r.repo === "repo-a")!.included).toBe(true);
      expect(result.variantsBySkill.has("settings")).toBe(false);
      expect(result.variantsBySkill.has("settings.json")).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("multiple repositories group into one entry per skill (task 5.4)", () => {
  test("the same skill name across two repos becomes two variants", async () => {
    const root = await mkdtemp(join(tmpdir(), "wazuh-ctx-skills-load-"));
    try {
      const dirA = await makeRepo(root, "wazuh-dashboard");
      const dirB = await makeRepo(root, "wazuh-dashboard-plugins");
      await writeSkill(dirA, "check-standards", "check-standards", "for A");
      await writeSkill(dirB, "check-standards", "check-standards", "for B");

      const targets: LoadTarget[] = [
        { repo: "wazuh-dashboard", repoKind: "platform", dir: dirA },
        { repo: "wazuh-dashboard-plugins", repoKind: "dashboard", dir: dirB },
      ];
      const result = await loadSkills(targets);

      const variants = result.variantsBySkill.get("check-standards")!;
      expect(variants.map((v) => v.repo).sort()).toEqual(["wazuh-dashboard", "wazuh-dashboard-plugins"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a skill directory without a SKILL.md is skipped, not fatal", async () => {
    const root = await mkdtemp(join(tmpdir(), "wazuh-ctx-skills-load-"));
    try {
      const targets = await twoRepoTargets(root, "create-pr");
      await mkdir(join(targets[0]!.dir, ".claude", "skills", "half-written"), { recursive: true });

      const result = await loadSkills(targets);

      expect(result.variantsBySkill.has("half-written")).toBe(false);
      expect(result.variantsBySkill.has("create-pr")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("a skill enters the diff only when two or more repositories share it (task 5.5, 5.6)", () => {
  // Reproduces the real defect: "has .claude/skills/" alone pulled
  // `wazuh-indexer-plugins` into the same comparison as the dashboard family,
  // merging two skill sets SPEC 2.2 says are a different family. The fix is a
  // measured threshold, not a name — this suite never references
  // `wazuh-indexer-plugins` or `wazuh-dashboard` by name for the RULE itself.
  test("a skill in exactly one repository does not enter variantsBySkill", async () => {
    const root = await mkdtemp(join(tmpdir(), "wazuh-ctx-skills-load-"));
    try {
      const dir = await makeRepo(root, "lone-repo");
      await writeSkill(dir, "solo-skill", "solo-skill", "only here");

      const targets: LoadTarget[] = [{ repo: "lone-repo", repoKind: "indexer", dir }];
      const result = await loadSkills(targets);

      expect(result.variantsBySkill.has("solo-skill")).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("that same skill is reported in singleRepoSkills, naming the skill and its repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "wazuh-ctx-skills-load-"));
    try {
      const dir = await makeRepo(root, "lone-repo");
      await writeSkill(dir, "solo-skill", "solo-skill", "only here");

      const targets: LoadTarget[] = [{ repo: "lone-repo", repoKind: "indexer", dir }];
      const result = await loadSkills(targets);

      expect(result.singleRepoSkills).toEqual([{ skill: "solo-skill", repo: "lone-repo", description: "only here" }]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a skill in exactly two repositories DOES enter the diff — the boundary is 2, not >2", async () => {
    const root = await mkdtemp(join(tmpdir(), "wazuh-ctx-skills-load-"));
    try {
      const targets = await twoRepoTargets(root, "shared-skill");
      const result = await loadSkills(targets);

      expect(result.variantsBySkill.get("shared-skill")).toHaveLength(2);
      expect(result.singleRepoSkills).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("a repository whose only skills are single-repo skills is excluded, distinctly (task 5.7)", () => {
  test("its exclusion reason differs from 'no .claude/skills'", async () => {
    const root = await mkdtemp(join(tmpdir(), "wazuh-ctx-skills-load-"));
    try {
      const dir = await makeRepo(root, "lone-repo");
      await writeSkill(dir, "solo-skill", "solo-skill", "only here");

      const targets: LoadTarget[] = [{ repo: "lone-repo", repoKind: "indexer", dir }];
      const result = await loadSkills(targets);

      const selection = result.repos.find((r) => r.repo === "lone-repo")!;
      expect(selection.included).toBe(false);
      expect(selection.reason).not.toContain("no .claude/skills");
      expect(selection.reason.toLowerCase()).toContain("2");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("one qualifying skill is enough to include a repository (task 5.8)", () => {
  test("a repository with one shared skill and one single-repo skill is still included", async () => {
    const root = await mkdtemp(join(tmpdir(), "wazuh-ctx-skills-load-"));
    try {
      const targets = await twoRepoTargets(root, "shared-skill");
      await writeSkill(targets[0]!.dir, "only-in-a", "only-in-a", "d");

      const result = await loadSkills(targets);

      const selection = result.repos.find((r) => r.repo === "repo-a")!;
      expect(selection.included).toBe(true);
      expect(result.variantsBySkill.has("shared-skill")).toBe(true);
      expect(result.singleRepoSkills).toEqual([{ skill: "only-in-a", repo: "repo-a", description: "d" }]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

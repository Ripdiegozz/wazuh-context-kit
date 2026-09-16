/**
 * CLI-level coverage for `wazuh-ctx skills-diff` (tasks 6.1–6.4).
 *
 * Every other `skills-diff` test is pure and needs no fixture on disk. This
 * file is the exception, because it exercises the wiring in `src/cli.ts`:
 * `loadSources` -> `fetchRepos` -> `loadSkills` -> `diffSkill` -> both
 * artifacts on disk. That wiring cannot be proven pure, so it is proven with a
 * real (but tiny, throwaway, LOCAL) git history instead of the 264 MB real
 * checkout — re-fetching the real seven repositories with the widened path
 * set is task 7.1, owned by the orchestrator, and does not belong to this
 * file's setup.
 *
 * The trick that keeps this hermetic: `fetchRepos` without `--refresh`
 * cache-hits on a purely local `git -C <dir> rev-parse HEAD` (see
 * `src/fetch/index.ts`). So a `.cache/<repo>@<ref>` directory that is already
 * a real git repository with a real commit, plus its sibling
 * `<repo>@<ref>.fetch.json` stamp, is indistinguishable from having "already
 * fetched" it — with zero network calls and zero dependency on this
 * checkout's real cache.
 */

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const CLI = join(REPO_ROOT, "src", "cli.ts");
const REF = "5.0.0";
const FROZEN_TIME = "2026-01-01T00:00:00Z";

interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function runCli(args: readonly string[], cwd: string): Promise<RunResult> {
  const child = Bun.spawn([process.execPath, CLI, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, stdout, stderr };
}

async function runGit(argv: readonly string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(["git", ...argv], { cwd, stdout: "ignore", stderr: "pipe" });
  const code = await proc.exited;
  if (code !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`git ${argv.join(" ")} failed: ${stderr}`);
  }
}

/** One skill file's frontmatter + a single section body, as a real SKILL.md string. */
function skillMd(name: string, description: string, sectionBody: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\n## Body\n\n${sectionBody}\n`;
}

/**
 * Builds a throwaway workdir whose `.cache/` already looks "fetched" for the
 * given repositories, entirely offline. `repoFiles` maps repo name -> a set
 * of relative-path -> content to commit (typically `.claude/skills/...`).
 */
async function buildWarmWorkdir(
  repoKinds: Record<string, "platform" | "dashboard" | "indexer">,
  repoFiles: Record<string, Record<string, string>>,
): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "wazuh-ctx-skills-diff-cli-"));
  const cacheRoot = join(cwd, ".cache");
  await mkdir(cacheRoot, { recursive: true });

  const repos = Object.keys(repoKinds).map((name) => ({ name, kind: repoKinds[name]! }));
  await writeFile(
    join(cwd, "sources.yml"),
    `refs:\n  - "${REF}"\nrepos:\n${repos.map((r) => `  - name: ${r.name}\n    kind: ${r.kind}`).join("\n")}\n`,
    "utf8",
  );

  for (const repo of repos) {
    const dir = join(cacheRoot, `${repo.name}@${REF}`);
    await mkdir(dir, { recursive: true });
    await runGit(["init", "--quiet", "--initial-branch", REF, "."], dir);
    await runGit(["config", "user.email", "test@example.invalid"], dir);
    await runGit(["config", "user.name", "wazuh-ctx test"], dir);

    for (const [path, content] of Object.entries(repoFiles[repo.name] ?? {})) {
      const absolute = join(dir, path);
      await mkdir(join(absolute, ".."), { recursive: true });
      await writeFile(absolute, content, "utf8");
    }
    // Every repo needs at least one file to commit, even one with no skills.
    await writeFile(join(dir, ".keep"), "", "utf8");

    await runGit(["add", "--all"], dir);
    await runGit(["commit", "--quiet", "--message", "fixture"], dir);

    const revProc = Bun.spawn(["git", "-C", dir, "rev-parse", "HEAD"], { stdout: "pipe" });
    const commit = (await new Response(revProc.stdout).text()).trim();
    await writeFile(`${dir}.fetch.json`, JSON.stringify({ ref: REF, commit, resolvedAt: FROZEN_TIME }), "utf8");
  }

  return cwd;
}

describe("wazuh-ctx skills-diff is wired up (task 6.3)", () => {
  test("it is no longer the notImplemented stub", async () => {
    const cwd = await buildWarmWorkdir({ "wazuh-empty": "dashboard" }, {});
    try {
      const result = await runCli(["skills-diff", "--ref", REF, "--frozen-time", FROZEN_TIME, "--out", join(cwd, "out")], cwd);
      expect(result.stderr).not.toContain("not implemented yet");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("--help lists the command", async () => {
    const result = await runCli(["--help"], REPO_ROOT);
    expect(result.stdout).toContain("skills-diff");
  });
});

describe("determinism (task 6.1)", () => {
  test("two runs at a frozen clock produce byte-identical artifacts", async () => {
    const cwd = await buildWarmWorkdir(
      { "wazuh-dashboard": "platform", "wazuh-dashboard-plugins": "dashboard" },
      {
        "wazuh-dashboard": { ".claude/skills/create-pr/SKILL.md": skillMd("create-pr", "for wazuh-dashboard", "Shared line.") },
        "wazuh-dashboard-plugins": {
          ".claude/skills/create-pr/SKILL.md": skillMd("create-pr", "for wazuh-dashboard-plugins", "Shared line."),
        },
      },
    );
    try {
      const outA = join(cwd, "out-a");
      const outB = join(cwd, "out-b");
      const first = await runCli(["skills-diff", "--ref", REF, "--frozen-time", FROZEN_TIME, "--out", outA], cwd);
      const second = await runCli(["skills-diff", "--ref", REF, "--frozen-time", FROZEN_TIME, "--out", outB], cwd);

      expect(first.code).toBe(0);
      expect(second.code).toBe(0);

      const [jsonA, jsonB] = await Promise.all([
        readFile(join(outA, REF, "skills-diff.json"), "utf8"),
        readFile(join(outB, REF, "skills-diff.json"), "utf8"),
      ]);
      const [mdA, mdB] = await Promise.all([
        readFile(join(outA, REF, "SKILLS-DIFF.md"), "utf8"),
        readFile(join(outB, REF, "SKILLS-DIFF.md"), "utf8"),
      ]);

      expect(jsonB).toBe(jsonA);
      expect(mdB).toBe(mdA);
      expect(JSON.parse(jsonA) as unknown).toMatchObject({ ref: REF });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("a conflict exits 0 (task 6.2)", () => {
  test("an unmarked divergence is CONFLICT, and the run still succeeds", async () => {
    const cwd = await buildWarmWorkdir(
      { "wazuh-dashboard": "platform", "wazuh-dashboard-plugins": "dashboard" },
      {
        "wazuh-dashboard": {
          ".claude/skills/check-standards/SKILL.md": skillMd("check-standards", "d", "typecheck: yes"),
        },
        "wazuh-dashboard-plugins": {
          ".claude/skills/check-standards/SKILL.md": skillMd("check-standards", "d", "typecheck: no"),
        },
      },
    );
    try {
      const out = join(cwd, "out");
      const result = await runCli(["skills-diff", "--ref", REF, "--frozen-time", FROZEN_TIME, "--out", out], cwd);

      expect(result.code).toBe(0);
      const json = JSON.parse(await readFile(join(out, REF, "skills-diff.json"), "utf8")) as {
        skills: Array<{ counts: { conflict: number } }>;
      };
      expect(json.skills.some((s) => s.counts.conflict > 0)).toBe(true);

      const markdown = await readFile(join(out, REF, "SKILLS-DIFF.md"), "utf8");
      expect(markdown).toContain("typecheck: yes");
      expect(markdown).toContain("typecheck: no");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("a different-family repository's own skills are reported, not merged into the diff", () => {
  // Reproduces the exact real-run defect: "repos included 8 of 9, skills 9"
  // when a third repository's OWN skills (never shared with the dashboard
  // family) were pulled into the same comparison. SPEC 2.2 and
  // exploration.md finding 2 both say this is a different family, reported
  // as process overlap and never merged.
  test("its skills land in singleRepoSkills, and it is excluded from repos", async () => {
    const cwd = await buildWarmWorkdir(
      { "wazuh-dashboard": "platform", "wazuh-dashboard-plugins": "dashboard", "wazuh-indexer-plugins": "indexer" },
      {
        "wazuh-dashboard": { ".claude/skills/create-pr/SKILL.md": skillMd("create-pr", "for wazuh-dashboard", "Shared line.") },
        "wazuh-dashboard-plugins": {
          ".claude/skills/create-pr/SKILL.md": skillMd("create-pr", "for wazuh-dashboard-plugins", "Shared line."),
        },
        "wazuh-indexer-plugins": {
          ".claude/skills/docs-review/SKILL.md": skillMd("docs-review", "for wazuh-indexer-plugins", "Indexer-only line."),
        },
      },
    );
    try {
      const out = join(cwd, "out");
      const result = await runCli(["skills-diff", "--ref", REF, "--frozen-time", FROZEN_TIME, "--out", out], cwd);
      expect(result.code).toBe(0);

      const json = JSON.parse(await readFile(join(out, REF, "skills-diff.json"), "utf8")) as {
        repos: Array<{ repo: string; included: boolean }>;
        skills: Array<{ skill: string }>;
        singleRepoSkills: Array<{ skill: string; repo: string; description: string }>;
      };

      expect(json.skills.map((s) => s.skill)).toEqual(["create-pr"]);
      expect(json.singleRepoSkills).toEqual([
        { skill: "docs-review", repo: "wazuh-indexer-plugins", description: "for wazuh-indexer-plugins" },
      ]);

      const indexerRepo = json.repos.find((r) => r.repo === "wazuh-indexer-plugins")!;
      expect(indexerRepo.included).toBe(false);

      const includedCount = json.repos.filter((r) => r.included).length;
      expect(includedCount).toBe(2);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }, 30_000);
});

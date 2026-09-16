/**
 * CLI-level coverage for `wazuh-ctx sync` and `wazuh-ctx check` (tasks
 * 5.1–5.3). Mirrors `cli-skills-diff.test.ts`'s trick exactly: a
 * `.cache/<repo>@<ref>` directory that is already a real (tiny, local) git
 * repository, plus its `.fetch.json` stamp, is indistinguishable from
 * "already fetched" to `fetchRepos` without `--refresh` — zero network,
 * zero dependency on this checkout's real 264 MB cache.
 */

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

function skillMd(name: string, description: string, sectionBody: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\n## Body\n\n${sectionBody}\n`;
}

async function buildWarmWorkdir(
  repoKinds: Record<string, "platform" | "dashboard" | "indexer">,
  repoFiles: Record<string, Record<string, string>>,
): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "wazuh-ctx-sync-check-cli-"));
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
    await writeFile(join(dir, ".keep"), "", "utf8");

    await runGit(["add", "--all"], dir);
    await runGit(["commit", "--quiet", "--message", "fixture"], dir);

    const revProc = Bun.spawn(["git", "-C", dir, "rev-parse", "HEAD"], { stdout: "pipe" });
    const commit = (await new Response(revProc.stdout).text()).trim();
    await writeFile(`${dir}.fetch.json`, JSON.stringify({ ref: REF, commit, resolvedAt: FROZEN_TIME }), "utf8");
  }

  return cwd;
}

describe("wazuh-ctx sync is wired up (task 5.3)", () => {
  test("it is no longer the notImplemented stub", async () => {
    const cwd = await buildWarmWorkdir({ "wazuh-empty": "dashboard" }, {});
    try {
      const result = await runCli(
        ["sync", "--ref", REF, "--repo", "wazuh-empty", "--target", join(cwd, "target")],
        cwd,
      );
      expect(result.stderr).not.toContain("not implemented yet");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("--help lists the command", async () => {
    const result = await runCli(["--help"], REPO_ROOT);
    expect(result.stdout).toContain("sync");
    expect(result.stdout).toContain("check");
  });
});

describe("sync with everything blocked exits 0, writes nothing, and states the count (task 5.1, SPEC)", () => {
  test("two repos with an undeclared divergence on the same section: 0 of 1 distributed", async () => {
    const cwd = await buildWarmWorkdir(
      { "wazuh-dashboard": "platform", "wazuh-dashboard-plugins": "dashboard" },
      {
        "wazuh-dashboard": {
          ".claude/skills/check-standards/SKILL.md": skillMd("check-standards", "for dashboard", "area"),
        },
        "wazuh-dashboard-plugins": {
          ".claude/skills/check-standards/SKILL.md": skillMd("check-standards", "for plugins", "plugin(s)"),
        },
      },
    );
    try {
      const target = join(cwd, "target");
      const result = await runCli(
        ["sync", "--ref", REF, "--repo", "wazuh-dashboard", "--target", target],
        cwd,
      );

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("0 of 1 distributed");
      expect(result.stdout).toContain("check-standards");

      // Nothing was written — no `.claude/standards/` at all under target.
      const check = await runCli(["check", "--target", target], cwd);
      expect(check.stdout).toContain("not-applicable");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

describe("sync distributes a clean skill, and check's exit mapping is all three states (task 5.1, 5.2)", () => {
  test("not-applicable -> 0, in-sync -> 0, drifted -> non-zero", async () => {
    const cwd = await buildWarmWorkdir(
      { "wazuh-dashboard": "platform", "wazuh-indexer": "indexer" },
      {
        "wazuh-dashboard": {
          ".claude/skills/create-pr/SKILL.md": skillMd("create-pr", "for dashboard", "Shared line."),
        },
        "wazuh-indexer": {
          ".claude/skills/create-pr/SKILL.md": skillMd("create-pr", "for indexer", "Shared line."),
        },
      },
    );
    try {
      const target = join(cwd, "target");

      // not-applicable: before sync runs at all.
      const before = await runCli(["check", "--target", target], cwd);
      expect(before.code).toBe(0);
      expect(before.stdout).toContain("not-applicable");

      // sync distributes the one clean, shared skill.
      const sync = await runCli(["sync", "--ref", REF, "--repo", "wazuh-dashboard", "--target", target], cwd);
      expect(sync.code).toBe(0);
      expect(sync.stdout).toContain("1 of 1 distributed");

      // in-sync: freshly materialised, untouched.
      const clean = await runCli(["check", "--target", target], cwd);
      expect(clean.code).toBe(0);
      expect(clean.stdout).toContain("in-sync");

      // drifted: a local edit makes check exit non-zero.
      const standardsFile = join(target, ".claude", "standards", "skills", "create-pr", "SKILL.md");
      const original = await Bun.file(standardsFile).text();
      await writeFile(standardsFile, `${original}\nlocal edit\n`, "utf8");

      const drifted = await runCli(["check", "--target", target], cwd);
      expect(drifted.code).not.toBe(0);
      expect(drifted.stdout).toContain("drifted");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

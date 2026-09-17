/**
 * Tests for world detection (design "World detection"; SPEC "The server
 * announces the world before the first query", "A ref mismatch is refused by
 * default and overridable explicitly").
 *
 * Strict TDD: written before `world.ts` exists, so the first `bun test` run
 * must fail on the import before anything is implemented.
 *
 * 5.1 is hermetic and uses REAL git against a real temp repository, following
 * `src/fetch/sparse-disk.test.ts` -- no network, no fake runner, because the
 * whole point of that test is proving what real `git config`/`rev-parse`
 * actually returns, which a fake runner cannot prove.
 *
 * 5.2-5.5 also use real git (same helper), but load the REAL committed
 * dataset and REAL `sources.yml` (as `dataset.test.ts` already does for
 * unit 4) rather than a hand-built `MatrixJson` fixture -- the shape of that
 * type is large and a hand-built fixture would drift from it silently.
 */

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGitRunner } from "../fetch/git-runner.ts";
import type { GitRunner } from "../fetch/types.ts";
import { loadDataset } from "./dataset.ts";
import { loadSources } from "../sources.ts";
import { resolveRepoName, resolveWorld } from "./world.ts";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const REAL_OUT_ROOT = join(REPO_ROOT, "out");
const REF = "5.0.0";

async function runOrThrow(run: GitRunner, argv: readonly string[], cwd: string): Promise<void> {
  const result = await run({ argv, cwd });
  if (result.code !== 0) {
    throw new Error(`git ${argv.join(" ")} failed (${result.code}): ${result.stderr.trim()}`);
  }
}

/**
 * Builds a real repository under a directory name chosen NOT to match its
 * declared remote -- proving name resolution reads the remote, never `cwd`'s
 * basename (task 5.1).
 */
async function createRepo(
  run: GitRunner,
  root: string,
  dirName: string,
  remoteUrl: string,
  initialBranch: string,
): Promise<string> {
  const dir = join(root, dirName);
  await mkdir(dir, { recursive: true });

  await runOrThrow(run, ["init", "--quiet", "--initial-branch", initialBranch, "."], dir);
  await runOrThrow(run, ["config", "user.email", "test@example.invalid"], dir);
  await runOrThrow(run, ["config", "user.name", "wazuh-ctx test"], dir);
  await runOrThrow(run, ["remote", "add", "origin", remoteUrl], dir);

  const filePath = join(dir, "README.md");
  await writeFile(filePath, "fixture\n", "utf8");
  await runOrThrow(run, ["add", "--all"], dir);
  await runOrThrow(run, ["commit", "--quiet", "--message", "fixture"], dir);

  return dir;
}

describe("resolveRepoName (task 5.1)", () => {
  test(
    "cwd resolves to a repository name via its remote, not its directory name",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "wazuh-ctx-world-"));
      const run = createGitRunner();

      try {
        // The directory name is deliberately unrelated to any repo name --
        // if resolution ever fell back to reading the basename, this would
        // resolve to "totally-unrelated-checkout-dir" instead.
        const dir = await createRepo(
          run,
          root,
          "totally-unrelated-checkout-dir",
          "https://github.com/wazuh/wazuh-dashboard-plugins.git",
          "some-local-branch",
        );

        const name = await resolveRepoName(run, dir);

        expect(name).toBe("wazuh-dashboard-plugins");
        expect(name).not.toBe("totally-unrelated-checkout-dir");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    30_000,
  );

  test(
    "strips scheme, host, and .git suffix regardless of remote form",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "wazuh-ctx-world-scp-"));
      const run = createGitRunner();

      try {
        const dir = await createRepo(
          run,
          root,
          "checkout",
          "git@github.com:wazuh/wazuh-indexer-plugins.git",
          "main",
        );

        const name = await resolveRepoName(run, dir);

        expect(name).toBe("wazuh-indexer-plugins");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    30_000,
  );

  test("a cwd that is not inside any git repository resolves to no name", async () => {
    const root = await mkdtemp(join(tmpdir(), "wazuh-ctx-world-none-"));
    const run = createGitRunner();

    try {
      const name = await resolveRepoName(run, root);
      expect(name).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("resolveWorld (tasks 5.2-5.5)", () => {
  test("5.2: a repository absent from sources.yml yields world unknown, not a guess", async () => {
    const root = await mkdtemp(join(tmpdir(), "wazuh-ctx-world-unknown-"));
    const run = createGitRunner();

    try {
      const dir = await createRepo(
        run,
        root,
        "checkout",
        "https://github.com/some-org/not-a-wazuh-repo.git",
        "main",
      );

      const sources = await loadSources(REPO_ROOT);
      const loaded = await loadDataset(REAL_OUT_ROOT, REF);
      if (!loaded.ok) throw new Error("expected real dataset to load");

      const resolution = await resolveWorld(run, dir, sources, loaded.matrix);

      expect(resolution.recognised).toBe(false);
      expect(resolution.world).toBe("unknown");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("recognised repo resolves the world the dataset classified it as", async () => {
    const root = await mkdtemp(join(tmpdir(), "wazuh-ctx-world-known-"));
    const run = createGitRunner();

    try {
      const dir = await createRepo(
        run,
        root,
        "checkout",
        "https://github.com/wazuh/wazuh-dashboard-plugins.git",
        REF,
      );

      const sources = await loadSources(REPO_ROOT);
      const loaded = await loadDataset(REAL_OUT_ROOT, REF);
      if (!loaded.ok) throw new Error("expected real dataset to load");
      const expectedPlugin = loaded.matrix.plugins.find((p) => p.repo === "wazuh-dashboard-plugins");
      expect(expectedPlugin).toBeDefined();
      if (expectedPlugin === undefined) throw new Error("unreachable");
      const expectedWorld = expectedPlugin.world;

      const resolution = await resolveWorld(run, dir, sources, loaded.matrix);

      expect(resolution.recognised).toBe(true);
      expect(resolution.world).toBe(expectedWorld);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

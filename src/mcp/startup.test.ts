/**
 * Tests for the ref gate and startup sequencing (design "`schema`: the
 * refusal gates run in order", steps 3-5; SPEC "A ref mismatch is refused by
 * default and overridable explicitly", "The server announces the world
 * before the first query is answered").
 *
 * Strict TDD: written before `startup.ts` exists, so the first `bun test`
 * run must fail on the import before anything is implemented.
 *
 * 5.3-5.5 use real git against real temp repositories (same helper as
 * `world.test.ts`) plus the REAL committed dataset and `sources.yml` --
 * following `dataset.test.ts`'s precedent of testing against the real
 * artifact rather than a hand-built fixture. 5.6 is pure sequencing and uses
 * a fake `GitRunner`, since it is about call order, not git behaviour.
 */

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGitRunner } from "../fetch/git-runner.ts";
import type { GitCommand, GitResult, GitRunner } from "../fetch/types.ts";
import { loadDataset } from "./dataset.ts";
import { loadSources, type Sources } from "../sources.ts";
import { runStartup } from "./startup.ts";
import type { WorldResolution } from "./world.ts";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const REAL_OUT_ROOT = join(REPO_ROOT, "out");
const REF = "5.0.0";
const KNOWN_REPO_URL = "https://github.com/wazuh/wazuh-dashboard-plugins.git";

async function runOrThrow(run: GitRunner, argv: readonly string[], cwd: string): Promise<void> {
  const result = await run({ argv, cwd });
  if (result.code !== 0) {
    throw new Error(`git ${argv.join(" ")} failed (${result.code}): ${result.stderr.trim()}`);
  }
}

/** A real repository recognised by `sources.yml`, checked out on `branch`. */
async function createKnownRepo(run: GitRunner, root: string, branch: string): Promise<string> {
  const dir = join(root, "checkout");
  await mkdir(dir, { recursive: true });

  await runOrThrow(run, ["init", "--quiet", "--initial-branch", branch, "."], dir);
  await runOrThrow(run, ["config", "user.email", "test@example.invalid"], dir);
  await runOrThrow(run, ["config", "user.name", "wazuh-ctx test"], dir);
  await runOrThrow(run, ["remote", "add", "origin", KNOWN_REPO_URL], dir);

  await writeFile(join(dir, "README.md"), "fixture\n", "utf8");
  await runOrThrow(run, ["add", "--all"], dir);
  await runOrThrow(run, ["commit", "--quiet", "--message", "fixture"], dir);

  return dir;
}

async function loadFixtures(): Promise<{ sources: Sources; matrix: Awaited<ReturnType<typeof loadDataset>> }> {
  const sources = await loadSources(REPO_ROOT);
  const matrix = await loadDataset(REAL_OUT_ROOT, REF);
  if (!matrix.ok) throw new Error("expected real dataset to load");
  return { sources, matrix };
}

describe("runStartup: the ref gate (tasks 5.3-5.5)", () => {
  test("5.3: branch !== dataset ref refuses, naming both refs", async () => {
    const root = await mkdtemp(join(tmpdir(), "wazuh-ctx-startup-mismatch-"));
    const run = createGitRunner();

    try {
      const dir = await createKnownRepo(run, root, "some-feature-branch");
      const { sources, matrix } = await loadFixtures();
      if (!matrix.ok) throw new Error("unreachable");

      const result = await runStartup({
        git: run,
        cwd: dir,
        sources,
        matrix: matrix.matrix,
        allowRefMismatch: false,
        announce: () => {},
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected the gate to refuse");
      expect(result.reason).toBe("ref-mismatch");
      if (result.reason !== "ref-mismatch") throw new Error("unreachable");
      expect(result.datasetRef).toBe(REF);
      expect(result.branch).toBe("some-feature-branch");
      expect(result.message).toContain(REF);
      expect(result.message).toContain("some-feature-branch");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("5.4: --allow-ref-mismatch serves that same mismatch", async () => {
    const root = await mkdtemp(join(tmpdir(), "wazuh-ctx-startup-allow-"));
    const run = createGitRunner();

    try {
      const dir = await createKnownRepo(run, root, "some-feature-branch");
      const { sources, matrix } = await loadFixtures();
      if (!matrix.ok) throw new Error("unreachable");

      const result = await runStartup({
        git: run,
        cwd: dir,
        sources,
        matrix: matrix.matrix,
        allowRefMismatch: true,
        announce: () => {},
      });

      expect(result.ok).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("5.5: detached HEAD refuses with a message distinct from 5.3's mismatch", async () => {
    const root = await mkdtemp(join(tmpdir(), "wazuh-ctx-startup-detached-"));
    const run = createGitRunner();

    try {
      const dir = await createKnownRepo(run, root, REF);
      await runOrThrow(run, ["checkout", "--detach", "HEAD"], dir);

      const { sources, matrix } = await loadFixtures();
      if (!matrix.ok) throw new Error("unreachable");

      const result = await runStartup({
        git: run,
        cwd: dir,
        sources,
        matrix: matrix.matrix,
        allowRefMismatch: false,
        announce: () => {},
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected the gate to refuse");
      expect(result.reason).toBe("branch-undeterminable");

      // Distinct from the 5.3 mismatch message: it must not claim to know a
      // branch, and it must not read like the "names both refs" message.
      expect(result.message).not.toContain(REF);
      expect(result.message).not.toBe(
        `dataset ref ${REF} does not match working-tree branch some-feature-branch`,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("an unrecognised repository serves, reporting world unknown -- never refused", async () => {
    const root = await mkdtemp(join(tmpdir(), "wazuh-ctx-startup-unrecognised-"));
    const run = createGitRunner();

    try {
      const dir = join(root, "checkout");
      await mkdir(dir, { recursive: true });
      await runOrThrow(run, ["init", "--quiet", "--initial-branch", "main", "."], dir);
      await runOrThrow(run, ["config", "user.email", "test@example.invalid"], dir);
      await runOrThrow(run, ["config", "user.name", "wazuh-ctx test"], dir);
      await runOrThrow(run, ["remote", "add", "origin", "https://github.com/some-org/unrelated.git"], dir);
      await writeFile(join(dir, "README.md"), "fixture\n", "utf8");
      await runOrThrow(run, ["add", "--all"], dir);
      await runOrThrow(run, ["commit", "--quiet", "--message", "fixture"], dir);

      const { sources, matrix } = await loadFixtures();
      if (!matrix.ok) throw new Error("unreachable");

      const result = await runStartup({
        git: run,
        cwd: dir,
        sources,
        matrix: matrix.matrix,
        allowRefMismatch: false,
        announce: () => {},
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.world.world).toBe("unknown");
      expect(result.world.recognised).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("runStartup: announcement ordering (task 5.6)", () => {
  const fakeGit: GitRunner = async (command: GitCommand): Promise<GitResult> => {
    const verb = command.argv[0];
    if (verb === "rev-parse") return { code: 0, stdout: "/fake/repo\n", stderr: "" };
    if (verb === "config") {
      return { code: 0, stdout: `${KNOWN_REPO_URL}\n`, stderr: "" };
    }
    if (verb === "symbolic-ref") return { code: 0, stdout: `${REF}\n`, stderr: "" };
    throw new Error(`unexpected git call in fake runner: ${command.argv.join(" ")}`);
  };

  test("the world is announced before the caller may answer its first query", async () => {
    const { sources, matrix } = await loadFixtures();
    if (!matrix.ok) throw new Error("unreachable");

    const events: string[] = [];
    let announced: WorldResolution | undefined;

    const result = await runStartup({
      git: fakeGit,
      cwd: "/fake/cwd",
      sources,
      matrix: matrix.matrix,
      allowRefMismatch: false,
      announce: (world) => {
        announced = world;
        events.push("announce");
      },
    });

    expect(result.ok).toBe(true);
    // The announce callback ran synchronously, inside `runStartup`, before
    // its promise resolved -- so by the time the caller is holding a
    // successful result it is already too late for a query to have been
    // answered without the world having been announced first.
    expect(events).toEqual(["announce"]);
    expect(announced?.recognised).toBe(true);

    // Simulates the caller's own first query, which by construction can only
    // happen after `await runStartup(...)` resolved -- i.e. after announce.
    events.push("first-query-answered");
    expect(events).toEqual(["announce", "first-query-answered"]);
  });

  test("announce is never called when the gate refuses", async () => {
    const detachedGit: GitRunner = async (command: GitCommand): Promise<GitResult> => {
      const verb = command.argv[0];
      if (verb === "rev-parse") return { code: 0, stdout: "/fake/repo\n", stderr: "" };
      if (verb === "config") return { code: 0, stdout: `${KNOWN_REPO_URL}\n`, stderr: "" };
      if (verb === "symbolic-ref") return { code: 128, stdout: "", stderr: "fatal: not a symbolic ref\n" };
      throw new Error(`unexpected git call: ${command.argv.join(" ")}`);
    };

    const { sources, matrix } = await loadFixtures();
    if (!matrix.ok) throw new Error("unreachable");

    let announceCalls = 0;

    const result = await runStartup({
      git: detachedGit,
      cwd: "/fake/cwd",
      sources,
      matrix: matrix.matrix,
      allowRefMismatch: false,
      announce: () => {
        announceCalls += 1;
      },
    });

    expect(result.ok).toBe(false);
    expect(announceCalls).toBe(0);
  });
});

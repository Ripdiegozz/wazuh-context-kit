/**
 * CLI-level regression coverage for `wazuh-ctx` (SPEC 1.1, task 12.2).
 *
 * Every other suite tests a module in isolation. Nothing tested `src/cli.ts`
 * itself, so its two load-bearing behaviours — `--fixtures` output parity and
 * the fatal exit-2 paths — survived only as manual observations and would not
 * have survived a refactor unnoticed.
 *
 * These tests spawn the CLI as a real process, because exit codes and stderr
 * are the contract here and an in-process call cannot observe `process.exit`.
 * None of them touch the network: the `--fixtures` runs never fetch, and the
 * two failure paths both abort before the first remote call.
 */

import { describe, expect, test } from "bun:test";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const CLI = join(REPO_ROOT, "src", "cli.ts");
const REF = "5.0.0";
const FROZEN_TIME = "2026-01-01T00:00:00Z";

/**
 * The `--fixtures` payload hash, pinned deliberately.
 *
 * Fixture facts are constants and `--frozen-time` removes the clock, so this
 * value is a pure function of the bundled fixtures plus the committed human
 * layers (`decisions.yml`, `annotations.yml`). Any change to either moves it,
 * which is the point: an intentional edit updates this literal in the same
 * commit, and an unintentional one fails review instead of passing silently.
 */
const FIXTURES_PAYLOAD_HASH =
  "sha256:ad56451d4204d72292b55b7f8667b779aa3791e836216398a603186e1a435277";
// Moved from sha256:1f9274f5… when `core` and `unresolvedDependencies` entered
// the hashed payload (design D5). The old value is kept in this comment on
// purpose: the pin exists so a payload change is a deliberate edit in the same
// commit, and a reviewer can see exactly which change moved it.

interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function runCli(
  args: readonly string[],
  options: { cwd?: string; env?: Record<string, string> } = {},
): Promise<RunResult> {
  const child = Bun.spawn([process.execPath, CLI, ...args], {
    cwd: options.cwd ?? REPO_ROOT,
    env: options.env ?? process.env,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  return { code, stdout, stderr };
}

/**
 * A `PATH` that resolves nothing, so a spawned `git` fails with ENOENT.
 *
 * `PATH=""` does NOT work: an empty or unset `PATH` makes libc fall back to a
 * built-in default (`/bin:/usr/bin`), where git usually lives, so the process
 * finds git anyway and the test silently starts hitting the network. Pointing
 * `PATH` at a real, empty directory is what actually makes git unresolvable.
 */
async function pathWithoutGit(): Promise<string> {
  return mkdtemp(join(tmpdir(), "wazuh-ctx-empty-bin-"));
}

/** A throwaway working directory holding one `sources.yml` and nothing else. */
async function workdirWithSources(fixture: "ok" | "bad"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `wazuh-ctx-cli-${fixture}-`));
  await copyFile(join(REPO_ROOT, "fixtures", "sources", fixture, "sources.yml"), join(dir, "sources.yml"));
  return dir;
}

describe("wazuh-ctx matrix --fixtures", () => {
  test(
    "produces the pinned payload hash and byte-identical output across runs",
    async () => {
      const outA = await mkdtemp(join(tmpdir(), "wazuh-ctx-cli-out-a-"));
      const outB = await mkdtemp(join(tmpdir(), "wazuh-ctx-cli-out-b-"));

      try {
        const first = await runCli([
          "matrix",
          "--fixtures",
          "--ref",
          REF,
          "--frozen-time",
          FROZEN_TIME,
          "--out",
          outA,
        ]);
        expect(first.code).toBe(0);
        expect(first.stdout).toContain(`payloadHash   ${FIXTURES_PAYLOAD_HASH}`);

        const second = await runCli([
          "matrix",
          "--fixtures",
          "--ref",
          REF,
          "--frozen-time",
          FROZEN_TIME,
          "--out",
          outB,
        ]);
        expect(second.code).toBe(0);

        const readBoth = (file: string) =>
          Promise.all([
            readFile(join(outA, REF, file), "utf8"),
            readFile(join(outB, REF, file), "utf8"),
          ]);

        const [jsonA, jsonB] = await readBoth("matrix.json");
        const [markdownA, markdownB] = await readBoth("MATRIX.md");

        expect(jsonB).toBe(jsonA);
        expect(markdownB).toBe(markdownA);
        expect((JSON.parse(jsonA) as { payloadHash: string }).payloadHash).toBe(
          FIXTURES_PAYLOAD_HASH,
        );
      } finally {
        await rm(outA, { recursive: true, force: true });
        await rm(outB, { recursive: true, force: true });
      }
    },
    60_000,
  );

  test("reaches no remote: it succeeds with git unresolvable", async () => {
    const out = await mkdtemp(join(tmpdir(), "wazuh-ctx-cli-out-nogit-"));
    const emptyPath = await pathWithoutGit();
    try {
      const result = await runCli(
        ["matrix", "--fixtures", "--ref", REF, "--frozen-time", FROZEN_TIME, "--out", out],
        { env: { ...process.env, PATH: emptyPath } },
      );
      expect(result.code).toBe(0);
      expect(result.stdout).toContain(`payloadHash   ${FIXTURES_PAYLOAD_HASH}`);
    } finally {
      await rm(out, { recursive: true, force: true });
      await rm(emptyPath, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("wazuh-ctx matrix fatal paths exit 2", () => {
  test("a schema-invalid sources.yml is fatal", async () => {
    const cwd = await workdirWithSources("bad");
    try {
      const result = await runCli(["matrix", "--ref", REF, "--out", join(cwd, "out")], { cwd });
      expect(result.code).toBe(2);
      expect(result.stderr).toContain("sources.yml");
      expect(result.stderr).toContain("invalid entry at");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }, 60_000);

  test("a missing sources.yml is fatal", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "wazuh-ctx-cli-nosources-"));
    try {
      const result = await runCli(["matrix", "--ref", REF, "--out", join(cwd, "out")], { cwd });
      expect(result.code).toBe(2);
      expect(result.stderr).toContain("sources.yml not found");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }, 60_000);

  test("git missing from PATH is fatal, and never becomes an unhandled crash", async () => {
    const cwd = await workdirWithSources("ok");
    const emptyPath = await pathWithoutGit();
    try {
      // A valid sources.yml gets the run past the config gate and into fetch/,
      // so the first spawn of `git` is what fails here — the ENOENT branch.
      const result = await runCli(["matrix", "--ref", REF, "--out", join(cwd, "out")], {
        cwd,
        env: { ...process.env, PATH: emptyPath },
      });
      expect(result.code).toBe(2);
      expect(result.stderr).toContain("git not found on PATH");
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(emptyPath, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("wazuh-ctx argument handling", () => {
  test("--version prints the version and exits 0", async () => {
    const result = await runCli(["--version"]);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("0.1.0");
  });

  test("an unknown command exits 64 and prints usage", async () => {
    const result = await runCli(["nonsense"]);
    expect(result.code).toBe(64);
    expect(result.stderr).toContain("unknown command 'nonsense'");
    expect(result.stdout).toContain("USAGE");
  });

  test("an unimplemented command exits 2 and names its SPEC section", async () => {
    const result = await runCli(["serve"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("not implemented yet");
  });

  test("crosscheck is no longer unimplemented", async () => {
    // SPEC 1.8 sits inside FASE 1 and returned notImplemented for the whole of
    // Phase 1. Pinned so it cannot quietly regress to a stub.
    const cwd = await mkdtemp(join(tmpdir(), "wazuh-ctx-cli-xcheck-"));
    try {
      const result = await runCli(["crosscheck", "--ref", REF, "--out", join(cwd, "out")], { cwd });
      expect(result.stderr).not.toContain("not implemented yet");
      // No sources.yml in this cwd, so it fails on config, not on being a stub.
      expect(result.code).toBe(2);
      expect(result.stderr).toContain("sources.yml not found");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("crosscheck reports git missing from PATH as fatal, like matrix does", async () => {
    const cwd = await workdirWithSources("ok");
    const emptyPath = await pathWithoutGit();
    try {
      const result = await runCli(["crosscheck", "--ref", REF, "--out", join(cwd, "out")], {
        cwd,
        env: { ...process.env, PATH: emptyPath },
      });
      expect(result.code).toBe(2);
      expect(result.stderr).toContain("git not found on PATH");
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(emptyPath, { recursive: true, force: true });
    }
  }, 60_000);
});

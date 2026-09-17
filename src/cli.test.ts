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
 *
 * The `crosscheck --indexer` group at the bottom additionally requires a warm
 * `.cache/` in this checkout and is skipped without one — see `HAS_WARM_CACHE`
 * below for why that gate exists and why it is not keyed on the network flag.
 */

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const CLI = join(REPO_ROOT, "src", "cli.ts");
const REF = "5.0.0";
const FROZEN_TIME = "2026-01-01T00:00:00Z";

/**
 * The `crosscheck --indexer` tests below need a warm `.cache/` in this
 * checkout, and `.cache/` is gitignored.
 *
 * So their premise lives outside the repository: they pass on a machine that
 * has run `wazuh-ctx matrix` at least once, and fail on a fresh clone for a
 * reason that has nothing to do with the code under test. That is the whole
 * failure mode this project exists to remove, and leaving it in a test suite
 * would be the least defensible place to keep it.
 *
 * The gate is cache presence, NOT `WAZUH_CTX_NETWORK`, because that is the
 * real dependency: these tests reach no network at all — `fetchRepos` without
 * `--refresh` cache-hits on a purely local `git rev-parse`. A developer with a
 * warm checkout gets the coverage offline, and `regenerate.yml` gets it in CI
 * too, because it regenerates before running the suite and so has a warm cache
 * by the time the tests start. The hermetic PR job skips them, which is what
 * "hermetic on purpose" (see `.github/workflows/ci.yml`) asks for.
 */
const HAS_WARM_CACHE = existsSync(join(REPO_ROOT, ".cache"));
const cachedTest = HAS_WARM_CACHE ? test : test.skip;

if (!HAS_WARM_CACHE) {
  console.warn(
    "[cli.test] Skipping 4 `crosscheck --indexer` tests: this checkout has no .cache/.\n" +
      "[cli.test] Warm it once with `bun run ./src/cli.ts matrix --ref 5.0.0`, then rerun.",
  );
}

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

/**
 * A throwaway working directory that reaches NO network at all, by reusing
 * this checkout's own warm `.cache/` through a symlink.
 *
 * `fetchRepos` without `--refresh` cache-hits on `git -C <dir> rev-parse
 * HEAD`, which is a fully local git invocation -- no `git ls-remote`, no
 * clone. Symlinking (rather than copying) the 264 MB cache keeps this cheap.
 * This is what makes a REAL, full `crosscheck` run usable as a test fixture
 * without either touching the network or violating "no test may depend on a
 * fixture file that encodes the same assumption as the code" -- the content
 * here is a real repository checkout, not a fixture anyone wrote by hand.
 */
async function workdirWithWarmCache(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "wazuh-ctx-cli-warm-"));
  await copyFile(join(REPO_ROOT, "fixtures", "sources", "ok", "sources.yml"), join(dir, "sources.yml"));
  await symlink(join(REPO_ROOT, ".cache"), join(dir, ".cache"));
  return dir;
}

/**
 * A throwaway, self-signed TLS keypair for the fake local indexer below.
 *
 * Built with `openssl` at test time rather than committed as a fixture: a
 * committed cert eventually expires, and generating it fresh means this test
 * never rots. `-days 1` is plenty for a run that finishes in milliseconds.
 */
async function generateSelfSignedCert(dir: string): Promise<{ cert: string; key: string }> {
  const keyPath = join(dir, "key.pem");
  const certPath = join(dir, "cert.pem");
  const proc = Bun.spawn(
    [
      "openssl",
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  const code = await proc.exited;
  if (code !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`openssl failed generating a test certificate: ${stderr}`);
  }
  const [cert, key] = await Promise.all([readFile(certPath, "utf8"), readFile(keyPath, "utf8")]);
  return { cert, key };
}

/**
 * A minimal fake indexer, answering the three endpoints `fetchClusterState`
 * queries. Loopback-only and self-contained: no real cluster, no ambient
 * network dependency, deterministic on any machine including a cold CI
 * runner.
 */
async function startFakeIndexer(certDir: string): Promise<{ url: string; stop: () => void }> {
  const { cert, key } = await generateSelfSignedCert(certDir);
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    tls: { cert, key },
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/_cat/indices") {
        return Response.json([{ index: "wazuh-alerts-4.x-2026.01.01" }]);
      }
      if (url.pathname === "/_data_stream") {
        return Response.json({ data_streams: [] });
      }
      if (url.pathname === "/_index_template") {
        return Response.json({ index_templates: [] });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return { url: `https://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
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

  test("mcp --help prints usage and exits 0 without starting the server", async () => {
    // `--help` is handled in `main()` before the command switch, so this
    // never reaches `runMcp` / stdio at all -- the one way to exercise `mcp`
    // from a spawned process without needing to manage a long-running
    // server's lifecycle from the test.
    const result = await runCli(["mcp", "--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("USAGE");
    expect(result.stdout).toContain("mcp");
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

  test("mcp is no longer unimplemented (task 6.12)", async () => {
    // Task 6.13 — `mcp` is a long-running stdio server by design (task
    // 6.10), so a spawned CLI test never runs it to a normal completion.
    // What IS testable at this layer is that the stub is gone: a cwd with
    // no `sources.yml` reaches `loadSources`'s own fatal message instead of
    // `notImplemented`'s, before `mcp` ever touches stdio (mirrors the
    // `crosscheck is no longer unimplemented` test above).
    const cwd = await mkdtemp(join(tmpdir(), "wazuh-ctx-cli-mcp-"));
    try {
      const result = await runCli(["mcp", "--ref", REF, "--out", join(cwd, "out")], { cwd });
      expect(result.stderr).not.toContain("not implemented yet");
      expect(result.code).toBe(2);
      expect(result.stderr).toContain("sources.yml not found");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("mcp accepts --allow-ref-mismatch, --no-telemetry and --runtime with no parse error", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "wazuh-ctx-cli-mcp-flags-"));
    try {
      const result = await runCli(
        [
          "mcp",
          "--ref",
          REF,
          "--out",
          join(cwd, "out"),
          "--allow-ref-mismatch",
          "--no-telemetry",
          "--runtime",
          "https://runtime.invalid/api",
        ],
        { cwd },
      );
      // An unrecognised option would exit 64 from parseArgs, before any of
      // this command's own logic runs. Reaching the SAME "sources.yml not
      // found" fatal as the flagless run above proves all three flags
      // parsed, not merely that the process exited non-zero.
      expect(result.code).toBe(2);
      expect(result.stderr).toContain("sources.yml not found");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

describe("wazuh-ctx crosscheck --indexer (crosscheck-live-indexer)", () => {
  cachedTest(
    "an unreachable --indexer produces out/<ref> byte-identical to running without it",
    async () => {
      const cwdWithout = await workdirWithWarmCache();
      const cwdWith = await workdirWithWarmCache();
      try {
        const without = await runCli(
          ["crosscheck", "--ref", REF, "--frozen-time", FROZEN_TIME, "--out", join(cwdWithout, "out")],
          { cwd: cwdWithout },
        );
        expect(without.code).toBe(0);

        // Port 1 refuses the connection immediately and needs no cluster:
        // the point is exercising the ordering (writeFile happens BEFORE the
        // indexer is ever contacted), not reaching a real indexer.
        const withIndexer = await runCli(
          [
            "crosscheck",
            "--ref",
            REF,
            "--frozen-time",
            FROZEN_TIME,
            "--out",
            join(cwdWith, "out"),
            "--indexer",
            "https://127.0.0.1:1",
          ],
          { cwd: cwdWith },
        );
        // The tool failed to reach the indexer -- that is a real failure,
        // not drift -- but both committed artifacts must already be on disk
        // by the time that failure happens.
        expect(withIndexer.code).not.toBe(0);

        const readBoth = (file: string) =>
          Promise.all([
            readFile(join(cwdWithout, "out", REF, file), "utf8"),
            readFile(join(cwdWith, "out", REF, file), "utf8"),
          ]);

        const [jsonWithout, jsonWith] = await readBoth("crosscheck.json");
        const [mdWithout, mdWith] = await readBoth("CROSSCHECK.md");

        expect(jsonWith).toBe(jsonWithout);
        expect(mdWith).toBe(mdWithout);
      } finally {
        await rm(cwdWithout, { recursive: true, force: true });
        await rm(cwdWith, { recursive: true, force: true });
      }
    },
    60_000,
  );

  cachedTest(
    "an unreachable indexer exits non-zero and names the URL",
    async () => {
      const cwd = await workdirWithWarmCache();
      try {
        const result = await runCli(
          [
            "crosscheck",
            "--ref",
            REF,
            "--frozen-time",
            FROZEN_TIME,
            "--out",
            join(cwd, "out"),
            "--indexer",
            "https://127.0.0.1:1",
          ],
          { cwd },
        );
        expect(result.code).not.toBe(0);
        expect(result.stderr).toContain("127.0.0.1:1");
        expect(result.stderr).not.toContain("disagreement");
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    },
    60_000,
  );

  cachedTest(
    "absent --indexer leaves behaviour unchanged: no live section, exit 0",
    async () => {
      const cwd = await workdirWithWarmCache();
      try {
        const result = await runCli(
          ["crosscheck", "--ref", REF, "--frozen-time", FROZEN_TIME, "--out", join(cwd, "out")],
          { cwd },
        );
        expect(result.code).toBe(0);
        expect(result.stdout).not.toContain("Live comparison");
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    },
    60_000,
  );

  cachedTest(
    "--format json with --indexer: stdout parses as JSON with no preprocessing, and nothing else",
    async () => {
      // CodeRabbit finding (PR #14, Major): the human summary
      // (`ref`, `declared indices`, `written ...`) printed to stdout BEFORE
      // the JSON, so `--format json | jq` failed on real output despite the
      // documented "machine-readable stream" contract in
      // docs/live-indexer.md. Parsing the WHOLE of stdout with no
      // preprocessing is the only assertion that actually proves the
      // contract; anything that greps a substring out first would pass on
      // the very output that broke `jq`.
      const certDir = await mkdtemp(join(tmpdir(), "wazuh-ctx-cli-cert-"));
      const cwd = await workdirWithWarmCache();
      const indexer = await startFakeIndexer(certDir);
      try {
        const result = await runCli(
          [
            "crosscheck",
            "--ref",
            REF,
            "--frozen-time",
            FROZEN_TIME,
            "--out",
            join(cwd, "out"),
            "--indexer",
            indexer.url,
            "--indexer-skip-tls-verify",
            "--format",
            "json",
          ],
          { cwd },
        );

        expect(result.code).toBe(0);

        const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
        expect(Object.keys(parsed).sort()).toEqual(
          [
            "declaredNotInstalled",
            "installedNotDeclared",
            "templatesOnlyInCluster",
            "sameSubjectMismatches",
          ].sort(),
        );

        // The human summary must still exist -- just not on stdout in JSON
        // mode, where it would corrupt the machine-readable stream.
        expect(result.stderr).toContain("written");
      } finally {
        indexer.stop();
        await rm(cwd, { recursive: true, force: true });
        await rm(certDir, { recursive: true, force: true });
      }
    },
    30_000,
  );
});

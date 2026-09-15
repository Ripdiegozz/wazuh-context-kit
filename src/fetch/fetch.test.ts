/**
 * Tests for src/fetch/ (SPEC 1.4, 1.9, D3, D4).
 *
 * Every test uses a recording `GitRunner` defined here — the *only* way
 * `fetch/` can reach git in these tests, so an empty network-verb slice in
 * the recorded call list is structural proof, not inference (design finding
 * 2). No test in this file touches the real network or a real git binary.
 */

import { describe, expect, test } from "bun:test";
import type { RepoSource } from "../sources.ts";
import { cacheDirFor, cloneRepo, refreshRepo, sparsePathsFor } from "./clone.ts";
import { createFetchIo, isNetworkGitCommand, offlineGuard } from "./git-runner.ts";
import { fetchRepos } from "./index.ts";
import { resolveRemoteRef } from "./ls-remote.ts";
import type { FetchIo, GitCommand, GitResult, GitRunner } from "./types.ts";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);

function recordingRunner(
  script: (cmd: GitCommand) => GitResult,
): { run: GitRunner; calls: GitCommand[] } {
  const calls: GitCommand[] = [];
  const run: GitRunner = async (command) => {
    calls.push(command);
    return script(command);
  };
  return { run, calls };
}

function fakeIo(run: GitRunner, options: { stamps?: Map<string, string>; clock?: string[] } = {}): FetchIo {
  const stamps = options.stamps ?? new Map<string, string>();
  const clock = options.clock ?? [];
  let clockIndex = 0;
  return {
    run,
    now: () => clock[clockIndex++] ?? "2026-09-14T00:00:00.000Z",
    readStamp: async (path) => stamps.get(path) ?? null,
    writeStamp: async (path, body) => {
      stamps.set(path, body);
    },
    // A no-op in tests: fetchRepos must never touch the real filesystem
    // through this seam, only through the recording runner and the fakes here.
    ensureDir: async () => {},
  };
}

/** Extracts the effective git subcommand, whether or not it is `-C`-prefixed. */
function verbOf(argv: readonly string[]): string | undefined {
  return argv[0] === "-C" ? argv[2] : argv[0];
}

/**
 * Models a cache that starts cold and warms up as clones land.
 *
 * A blunt "every rev-parse fails" stub cannot express this: `cloneRepo` reads
 * the resulting commit with the very same `-C <dir> rev-parse HEAD` it uses to
 * probe the cache beforehand. Failing both makes a successful clone look like
 * a failed one, which is a property of the stub and not of the code.
 *
 * Here `rev-parse <dir>` fails until a `clone` has created `<dir>`, and
 * succeeds afterwards — which is what git actually does.
 */
function coldCacheScript(
  overrides: (cmd: GitCommand) => GitResult | null,
): (cmd: GitCommand) => GitResult {
  const clonedCommits = new Map<string, string>();

  return (cmd) => {
    const override = overrides(cmd);
    if (override !== null) return override;

    const verb = verbOf(cmd.argv);

    if (verb === "clone") {
      const dir = cmd.argv.at(-1);
      if (dir !== undefined) clonedCommits.set(dir, SHA_A);
      return { code: 0, stdout: "", stderr: "" };
    }

    if (verb === "rev-parse") {
      const dir = cmd.argv[1];
      const commit = dir === undefined ? undefined : clonedCommits.get(dir);
      return commit === undefined
        ? { code: 128, stdout: "", stderr: "fatal: not a git repository\n" }
        : { code: 0, stdout: `${commit}\n`, stderr: "" };
    }

    return { code: 0, stdout: "", stderr: "" };
  };
}

const platformRepo: RepoSource = { name: "wazuh-dashboard", kind: "platform" };
const dashboardRepo: RepoSource = { name: "wazuh-dashboard-plugins", kind: "dashboard" };
const indexerRepo: RepoSource = { name: "wazuh-indexer-plugins", kind: "indexer" };

describe("isNetworkGitCommand", () => {
  test.each([
    ["ls-remote", true],
    ["clone", true],
    ["fetch", true],
    ["rev-parse", false],
    ["checkout", false],
    ["sparse-checkout", false],
    ["reset", false],
  ])("%s -> %s", (verb, expected) => {
    expect(isNetworkGitCommand([verb, "extra"])).toBe(expected);
  });

  test("classifies a -C-prefixed fetch as network too", () => {
    expect(isNetworkGitCommand(["-C", "/cache/x@5.0.0", "fetch", "origin", "5.0.0"])).toBe(true);
  });

  test("classifies a -C-prefixed rev-parse as local", () => {
    expect(isNetworkGitCommand(["-C", "/cache/x@5.0.0", "rev-parse", "HEAD"])).toBe(false);
  });
});

describe("offlineGuard", () => {
  test("rejects a network-verb command when called directly", async () => {
    const { run } = recordingRunner(() => ({ code: 0, stdout: "", stderr: "" }));
    const guarded = offlineGuard(run);

    await expect(
      guarded({ argv: ["ls-remote", "--heads", "url", "5.0.0"], cwd: "/cache" }),
    ).rejects.toThrow();
  });

  test("passes a local command through unchanged", async () => {
    const { run, calls } = recordingRunner(() => ({ code: 0, stdout: "abc\n", stderr: "" }));
    const guarded = offlineGuard(run);

    const result = await guarded({ argv: ["-C", "/cache/x@5.0.0", "rev-parse", "HEAD"], cwd: "/cache" });

    expect(result.stdout).toBe("abc\n");
    expect(calls).toHaveLength(1);
  });
});

describe("resolveRemoteRef", () => {
  test("returns found:true with the sha from ls-remote stdout", async () => {
    const { run } = recordingRunner(() => ({
      code: 0,
      stdout: `${SHA_A}\trefs/heads/5.0.0\n`,
      stderr: "",
    }));

    const result = await resolveRemoteRef(run, "https://github.com/wazuh/x.git", "5.0.0", "/cache");

    expect(result).toEqual({ found: true, sha: SHA_A });
  });

  test("returns found:false reason absent on empty stdout", async () => {
    const { run } = recordingRunner(() => ({ code: 0, stdout: "", stderr: "" }));

    const result = await resolveRemoteRef(run, "https://github.com/wazuh/x.git", "5.0.0", "/cache");

    expect(result.found).toBe(false);
    if (!result.found) expect(result.reason).toBe("absent");
  });

  test("returns found:false reason unavailable on non-zero exit, distinct from absent", async () => {
    const { run } = recordingRunner(() => ({
      code: 128,
      stdout: "",
      stderr: "fatal: unable to access 'https://github.com/wazuh/x.git/'\n",
    }));

    const result = await resolveRemoteRef(run, "https://github.com/wazuh/x.git", "5.0.0", "/cache");

    expect(result.found).toBe(false);
    if (!result.found) {
      expect(result.reason).toBe("unavailable");
      expect(result.reason).not.toBe("absent");
    }
  });
});

describe("sparsePathsFor", () => {
  test("platform -> [src/plugins], the OSD core plugin tree", () => {
    expect(sparsePathsFor("platform")).toEqual(["src/plugins"]);
  });

  test("platform does NOT declare the git-ignored root-level plugins/", () => {
    // `wazuh-dashboard` has both `src/plugins` (real content) and a root
    // `plugins/` that is git-ignored and empty. Matching on "plugins" alone
    // picks the wrong one and yields a silently empty parse.
    expect(sparsePathsFor("platform")).not.toContain("plugins");
  });

  test("dashboard -> [plugins]", () => {
    expect(sparsePathsFor("dashboard")).toEqual(["plugins"]);
  });

  test("indexer -> SPEC 1.2 verified paths", () => {
    expect(sparsePathsFor("indexer")).toEqual([
      "plugins/setup/src/main/resources/templates",
      "plugins/content-manager/src/main/resources/mappings",
      "wcs",
    ]);
  });
});

describe("cloneRepo", () => {
  test("cold clone issues SPEC 1.4 flags, then sparse-checkout, then checkout", async () => {
    const dir = "/cache/wazuh-dashboard-plugins@5.0.0";
    const { run, calls } = recordingRunner((cmd) => {
      if (verbOf(cmd.argv) === "rev-parse") return { code: 0, stdout: `${SHA_A}\n`, stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    });

    const result = await cloneRepo(
      run,
      "/cache",
      dir,
      "https://github.com/wazuh/wazuh-dashboard-plugins.git",
      "5.0.0",
      ["plugins"],
    );

    expect(calls[0]?.argv).toEqual([
      "clone",
      "--depth",
      "1",
      "--branch",
      "5.0.0",
      "--filter=blob:none",
      "--no-checkout",
      "https://github.com/wazuh/wazuh-dashboard-plugins.git",
      dir,
    ]);
    expect(calls.some((c) => c.argv.includes("sparse-checkout") && c.argv.includes("init"))).toBe(true);
    expect(
      calls.some((c) => c.argv.includes("sparse-checkout") && c.argv.includes("set") && c.argv.includes("plugins")),
    ).toBe(true);
    expect(calls.some((c) => verbOf(c.argv) === "checkout")).toBe(true);
    expect(calls.every((c) => c.cwd === "/cache")).toBe(true);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.commit).toBe(SHA_A);
  });

  test("skips sparse-checkout set when the path set is empty (platform)", async () => {
    const dir = "/cache/wazuh-dashboard@5.0.0";
    const { run, calls } = recordingRunner((cmd) => {
      if (verbOf(cmd.argv) === "rev-parse") return { code: 0, stdout: `${SHA_B}\n`, stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    });

    await cloneRepo(run, "/cache", dir, "https://github.com/wazuh/wazuh-dashboard.git", "5.0.0", []);

    expect(calls.some((c) => c.argv.includes("sparse-checkout") && c.argv.includes("set"))).toBe(false);
    expect(calls.some((c) => c.argv.includes("sparse-checkout") && c.argv.includes("init"))).toBe(true);
  });
});

describe("refreshRepo", () => {
  test("issues fetch + sparse-checkout set + reset --hard FETCH_HEAD, never clone", async () => {
    const dir = "/cache/wazuh-dashboard-plugins@5.0.0";
    const { run, calls } = recordingRunner((cmd) => {
      if (verbOf(cmd.argv) === "rev-parse") return { code: 0, stdout: `${SHA_C}\n`, stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    });

    const result = await refreshRepo(run, "/cache", dir, "5.0.0", ["plugins"]);

    const verbs = calls.map((c) => verbOf(c.argv));
    expect(verbs).not.toContain("clone");
    expect(verbs).toContain("fetch");
    expect(verbs).toContain("reset");
    const resetCall = calls.find((c) => verbOf(c.argv) === "reset");
    expect(resetCall?.argv).toEqual(["-C", dir, "reset", "--hard", "FETCH_HEAD"]);
    expect(result.ok).toBe(true);
  });
});

describe("fetchRepos — cache hit (D3)", () => {
  test("runs only rev-parse HEAD, nothing else", async () => {
    const dir = cacheDirFor("/cache", "wazuh-dashboard", "5.0.0");
    const { run, calls } = recordingRunner((cmd) => {
      if (cmd.argv.join(" ") === `-C ${dir} rev-parse HEAD`) {
        return { code: 0, stdout: `${SHA_A}\n`, stderr: "" };
      }
      throw new Error(`unexpected command in cache-hit test: ${cmd.argv.join(" ")}`);
    });
    const io = fakeIo(run);

    const outcome = await fetchRepos({
      repos: [platformRepo],
      ref: "5.0.0",
      cacheRoot: "/cache",
      refresh: false,
      io,
    });

    expect(calls.map((c) => c.argv)).toEqual([["-C", dir, "rev-parse", "HEAD"]]);
    expect(outcome.fetched).toEqual([{ repo: "wazuh-dashboard", dir, commit: SHA_A }]);
  });

  test("performs zero network-touching subprocesses (structural proof, design finding 2)", async () => {
    const dir = cacheDirFor("/cache", "wazuh-dashboard", "5.0.0");
    const { run, calls } = recordingRunner((cmd) => {
      if (cmd.argv.join(" ") === `-C ${dir} rev-parse HEAD`) {
        return { code: 0, stdout: `${SHA_A}\n`, stderr: "" };
      }
      throw new Error("unexpected command");
    });
    const io = fakeIo(run);

    await fetchRepos({ repos: [platformRepo], ref: "5.0.0", cacheRoot: "/cache", refresh: false, io });

    expect(calls.filter((c) => isNetworkGitCommand(c.argv))).toEqual([]);
  });

  test("resolvedAt on a hit comes from the stamp, never from the clock (design finding 1)", async () => {
    const dir = cacheDirFor("/cache", "wazuh-dashboard", "5.0.0");
    const stampPath = `${dir}.fetch.json`;
    const { run } = recordingRunner((cmd) => {
      if (verbOf(cmd.argv) === "rev-parse") return { code: 0, stdout: `${SHA_A}\n`, stderr: "" };
      throw new Error("unexpected command");
    });
    const stamps = new Map([
      [stampPath, JSON.stringify({ ref: "5.0.0", commit: SHA_A, resolvedAt: "2020-01-01T00:00:00.000Z" })],
    ]);
    const io = fakeIo(run, { stamps, clock: ["SHOULD-NOT-BE-USED"] });

    await fetchRepos({ repos: [platformRepo], ref: "5.0.0", cacheRoot: "/cache", refresh: false, io });

    const raw = await io.readStamp(stampPath);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string).resolvedAt).toBe("2020-01-01T00:00:00.000Z");
  });

  test("writes the stamp once with now() when missing on a hit, then stays stable", async () => {
    const dir = cacheDirFor("/cache", "wazuh-dashboard", "5.0.0");
    const stampPath = `${dir}.fetch.json`;
    const { run } = recordingRunner((cmd) => {
      if (verbOf(cmd.argv) === "rev-parse") return { code: 0, stdout: `${SHA_A}\n`, stderr: "" };
      throw new Error("unexpected command");
    });
    const io = fakeIo(run, { clock: ["2026-01-01T00:00:00.000Z", "SHOULD-NOT-BE-USED-AGAIN"] });

    await fetchRepos({ repos: [platformRepo], ref: "5.0.0", cacheRoot: "/cache", refresh: false, io });
    const first = JSON.parse((await io.readStamp(stampPath)) as string);
    expect(first.resolvedAt).toBe("2026-01-01T00:00:00.000Z");

    await fetchRepos({ repos: [platformRepo], ref: "5.0.0", cacheRoot: "/cache", refresh: false, io });
    const second = JSON.parse((await io.readStamp(stampPath)) as string);
    expect(second.resolvedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("fetchRepos — cache miss and skip paths", () => {
  test("absent ref -> skipped naming the ref, no clone attempted", async () => {
    const { run, calls } = recordingRunner((cmd) => {
      if (verbOf(cmd.argv) === "rev-parse") return { code: 128, stdout: "", stderr: "fatal: not a git repository\n" };
      if (verbOf(cmd.argv) === "ls-remote") return { code: 0, stdout: "", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    });
    const io = fakeIo(run);
    const mlRepo: RepoSource = { name: "wazuh-dashboard-ml-commons", kind: "dashboard" };

    const outcome = await fetchRepos({ repos: [mlRepo], ref: "5.0.0", cacheRoot: "/cache", refresh: false, io });

    expect(outcome.fetched).toEqual([]);
    expect(outcome.skipped).toHaveLength(1);
    expect(outcome.skipped[0]?.repo).toBe("wazuh-dashboard-ml-commons");
    expect(outcome.skipped[0]?.reason).toMatch(/5\.0\.0/);
    expect(calls.some((c) => verbOf(c.argv) === "clone")).toBe(false);
  });

  test("unavailable ls-remote yields a reason distinct from absent", async () => {
    const { run } = recordingRunner((cmd) => {
      if (verbOf(cmd.argv) === "rev-parse") return { code: 128, stdout: "", stderr: "fatal: not a git repository\n" };
      if (verbOf(cmd.argv) === "ls-remote") {
        return { code: 128, stdout: "", stderr: "fatal: unable to access\n" };
      }
      return { code: 0, stdout: "", stderr: "" };
    });
    const io = fakeIo(run);

    const outcome = await fetchRepos({
      repos: [dashboardRepo],
      ref: "5.0.0",
      cacheRoot: "/cache",
      refresh: false,
      io,
    });

    expect(outcome.skipped[0]?.reason).toMatch(/ref lookup failed/);
    expect(outcome.skipped[0]?.reason).not.toMatch(/no 5\.0\.0 branch/);
  });

  test("cache dir present but unusable -> the actionable delete-and-retry reason", async () => {
    const { run } = recordingRunner((cmd) => {
      if (verbOf(cmd.argv) === "rev-parse") return { code: 128, stdout: "", stderr: "fatal: not a git repository\n" };
      if (verbOf(cmd.argv) === "ls-remote") return { code: 0, stdout: `${SHA_A}\trefs/heads/5.0.0\n`, stderr: "" };
      if (verbOf(cmd.argv) === "clone") {
        return {
          code: 128,
          stdout: "",
          stderr: "fatal: destination path 'x' already exists and is not an empty directory.\n",
        };
      }
      return { code: 0, stdout: "", stderr: "" };
    });
    const io = fakeIo(run);

    const outcome = await fetchRepos({
      repos: [dashboardRepo],
      ref: "5.0.0",
      cacheRoot: "/cache",
      refresh: false,
      io,
    });

    expect(outcome.skipped[0]?.reason).toMatch(/delete/);
    expect(outcome.skipped[0]?.reason).toMatch(/retry/);
    expect(outcome.skipped[0]?.reason).toContain("wazuh-dashboard-plugins@5.0.0");
  });

  test("one repo's clone failing does not drop the other repos from fetched", async () => {
    const { run } = recordingRunner(
      coldCacheScript((cmd) => {
        if (verbOf(cmd.argv) === "ls-remote") {
          return { code: 0, stdout: `${SHA_A}\trefs/heads/5.0.0\n`, stderr: "" };
        }
        if (verbOf(cmd.argv) === "clone" && cmd.argv.some((a) => a.includes("wazuh-dashboard-plugins"))) {
          return { code: 128, stdout: "", stderr: "fatal: unable to connect\n" };
        }
        return null;
      }),
    );
    const io = fakeIo(run);

    const outcome = await fetchRepos({
      repos: [indexerRepo, dashboardRepo],
      ref: "5.0.0",
      cacheRoot: "/cache",
      refresh: false,
      io,
    });

    expect(outcome.fetched.some((f) => f.repo === "wazuh-indexer-plugins")).toBe(true);
    expect(outcome.skipped.some((s) => s.repo === "wazuh-dashboard-plugins")).toBe(true);
  });

  test("resolvedRefs population — all-but-one resolve, the unresolved carries no commit anywhere", async () => {
    const { run } = recordingRunner(
      coldCacheScript((cmd) => {
        if (verbOf(cmd.argv) === "ls-remote" && cmd.argv.some((a) => a.includes("wazuh-dashboard-ml-commons"))) {
          return { code: 0, stdout: "", stderr: "" };
        }
        if (verbOf(cmd.argv) === "ls-remote") {
          return { code: 0, stdout: `${SHA_A}\trefs/heads/5.0.0\n`, stderr: "" };
        }
        return null;
      }),
    );
    const io = fakeIo(run);
    const mlRepo: RepoSource = { name: "wazuh-dashboard-ml-commons", kind: "dashboard" };

    const outcome = await fetchRepos({
      repos: [dashboardRepo, mlRepo],
      ref: "5.0.0",
      cacheRoot: "/cache",
      refresh: false,
      io,
    });

    expect(outcome.fetched).toHaveLength(1);
    expect(outcome.fetched[0]?.repo).toBe("wazuh-dashboard-plugins");
    expect(outcome.skipped).toHaveLength(1);
    expect(outcome.skipped[0]?.repo).toBe("wazuh-dashboard-ml-commons");
  });
});

describe("fetchRepos — --refresh", () => {
  test("always refreshes in place, bypassing the cache-hit shortcut", async () => {
    const { run, calls } = recordingRunner((cmd) => {
      if (verbOf(cmd.argv) === "rev-parse") return { code: 0, stdout: `${SHA_A}\n`, stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    });
    const io = fakeIo(run);

    await fetchRepos({ repos: [platformRepo], ref: "5.0.0", cacheRoot: "/cache", refresh: true, io });

    const verbs = calls.map((c) => verbOf(c.argv));
    expect(verbs).toContain("fetch");
    expect(verbs).not.toContain("clone");
  });
});

describe("fetchRepos — command allow-list (threat matrix: push state, PR commands)", () => {
  test("every emitted subcommand is within the allow-list; never push/remote/submodule", async () => {
    const ALLOWED = new Set(["rev-parse", "ls-remote", "clone", "sparse-checkout", "checkout", "fetch", "reset"]);
    const { run, calls } = recordingRunner((cmd) => {
      if (verbOf(cmd.argv) === "rev-parse") return { code: 128, stdout: "", stderr: "fatal: not a git repository\n" };
      if (verbOf(cmd.argv) === "ls-remote") return { code: 0, stdout: `${SHA_A}\trefs/heads/5.0.0\n`, stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    });
    const io = fakeIo(run);

    await fetchRepos({ repos: [dashboardRepo], ref: "5.0.0", cacheRoot: "/cache", refresh: false, io });

    for (const call of calls) {
      const verb = verbOf(call.argv);
      expect(verb === undefined ? false : ALLOWED.has(verb)).toBe(true);
    }
    expect(calls.some((c) => verbOf(c.argv) === "push")).toBe(false);
    expect(calls.some((c) => verbOf(c.argv) === "remote")).toBe(false);
    expect(calls.some((c) => verbOf(c.argv) === "submodule")).toBe(false);
  });
});

describe("fetchRepos — path and name safety (threat matrix: git repository selection, commit state)", () => {
  test("rejects an invalid ref before any runner call", async () => {
    const { run, calls } = recordingRunner(() => ({ code: 0, stdout: "", stderr: "" }));
    const io = fakeIo(run);

    await expect(
      fetchRepos({ repos: [platformRepo], ref: "-evil", cacheRoot: "/cache", refresh: false, io }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  test("skips a repo with an invalid name before any runner call for it", async () => {
    const badRepo: RepoSource = { name: "../evil", kind: "dashboard" };
    const { run, calls } = recordingRunner((cmd) => {
      if (verbOf(cmd.argv) === "rev-parse") return { code: 0, stdout: `${SHA_A}\n`, stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    });
    const io = fakeIo(run);

    const outcome = await fetchRepos({ repos: [badRepo], ref: "5.0.0", cacheRoot: "/cache", refresh: false, io });

    expect(outcome.skipped).toHaveLength(1);
    expect(outcome.skipped[0]?.repo).toBe("../evil");
    expect(outcome.skipped[0]?.reason).toMatch(/invalid/i);
    expect(calls.filter((c) => c.argv.some((a) => a.includes("../evil")))).toHaveLength(0);
  });

  test("every -C / clone-target argument stays inside the resolved cacheRoot", async () => {
    const cacheRoot = "/cache";
    const expectedDir = cacheDirFor(cacheRoot, dashboardRepo.name, "5.0.0");
    const { run, calls } = recordingRunner((cmd) => {
      if (verbOf(cmd.argv) === "rev-parse") return { code: 128, stdout: "", stderr: "fatal: not a git repository\n" };
      if (verbOf(cmd.argv) === "ls-remote") return { code: 0, stdout: `${SHA_A}\trefs/heads/5.0.0\n`, stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    });
    const io = fakeIo(run);

    await fetchRepos({ repos: [dashboardRepo], ref: "5.0.0", cacheRoot, refresh: false, io });

    for (const call of calls) {
      if (call.argv[0] === "-C") {
        expect(call.argv[1]).toBe(expectedDir);
      }
      if (verbOf(call.argv) === "clone") {
        expect(call.argv.at(-1)).toBe(expectedDir);
      }
    }
  });
});

describe("createFetchIo", () => {
  test("readStamp returns null on ENOENT instead of throwing", async () => {
    const io = createFetchIo();

    const result = await io.readStamp("/definitely/does/not/exist/anywhere.fetch.json");

    expect(result).toBeNull();
  });

  test("now() returns an ISO-8601 string", () => {
    const io = createFetchIo();

    expect(io.now()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

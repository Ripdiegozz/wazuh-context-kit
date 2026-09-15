/**
 * The real `GitRunner`, the network classifier, and the offline guard
 * (SPEC 1.4, 1.9, D3).
 *
 * `isNetworkGitCommand` is production code, not a test-only assertion: the
 * cache-hit path in `fetch/index.ts` wraps the injected runner in
 * `offlineGuard`, so "no network on a cache hit" is a structural property of
 * this module, not something a test merely observes today.
 */

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { FetchIo, GitCommand, GitResult, GitRunner } from "./types.ts";

const NETWORK_VERBS = new Set(["ls-remote", "clone", "fetch"]);

/** The effective git subcommand, whether or not the command is `-C`-prefixed. */
function verbOf(argv: readonly string[]): string | undefined {
  return argv[0] === "-C" ? argv[2] : argv[0];
}

/** One shared definition of "network-touching", used by production code and tests alike. */
export function isNetworkGitCommand(argv: readonly string[]): boolean {
  const verb = verbOf(argv);
  return verb !== undefined && NETWORK_VERBS.has(verb);
}

/** Wraps a runner so a network-verb command rejects instead of running (D3). */
export function offlineGuard(run: GitRunner): GitRunner {
  return async (command: GitCommand) => {
    if (isNetworkGitCommand(command.argv)) {
      throw new Error(
        `offlineGuard: refused network-touching command on a cache hit: git ${command.argv.join(" ")}`,
      );
    }
    return run(command);
  };
}

/**
 * Real argv spawn. No shell, so a ref/URL string can never be interpreted as
 * shell syntax. A spawn failure (e.g. `git` missing from PATH) rejects the
 * promise, distinguishable from a command that ran and exited non-zero.
 */
export function createGitRunner(): GitRunner {
  return (command: GitCommand) =>
    new Promise<GitResult>((resolve, reject) => {
      const child = spawn("git", [...command.argv], { cwd: command.cwd, shell: false });
      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.once("error", (error) => reject(error));
      child.once("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    });
}

/** The whole I/O surface of fetch/: the real runner plus the cache-stamp sidecar. */
export function createFetchIo(): FetchIo {
  return {
    run: createGitRunner(),
    now: () => new Date().toISOString(),
    readStamp: async (path: string) => {
      try {
        return await readFile(path, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    writeStamp: async (path: string, body: string) => {
      await writeFile(path, body, "utf8");
    },
    ensureDir: async (path: string) => {
      await mkdir(path, { recursive: true });
    },
  };
}

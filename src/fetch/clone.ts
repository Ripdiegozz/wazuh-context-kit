/**
 * Blobless sparse clone and in-place refresh (SPEC 1.2, 1.4).
 *
 * Every local command targets the repo directory through `-C <dir>`, never
 * through the spawned process's own `cwd`, and `cwd` is always the resolved
 * `cacheRoot` — which is guaranteed to exist (see `fetchRepos`) — so
 * `git -C <dir> …` can fail cleanly with a non-zero exit when `dir` does not
 * exist yet, instead of the spawn itself throwing.
 */

import { join } from "node:path";
import type { RepoKind } from "../matrix/types.ts";
import type { GitRunner } from "./types.ts";

export function cacheDirFor(cacheRoot: string, repo: string, ref: string): string {
  return join(cacheRoot, `${repo}@${ref}`);
}

/** SPEC 1.2 verified paths, one path set per RepoKind. */
export function sparsePathsFor(kind: RepoKind): string[] {
  switch (kind) {
    case "platform":
      return [];
    case "dashboard":
      return ["plugins"];
    case "indexer":
      return [
        "plugins/setup/src/main/resources/templates",
        "plugins/content-manager/src/main/resources/mappings",
        "wcs",
      ];
  }
}

export interface CloneOutcome {
  readonly ok: true;
  readonly commit: string;
}

export interface CloneFailure {
  readonly ok: false;
  readonly reason: string;
}

function firstStderrLine(stderr: string): string {
  return stderr.split("\n")[0]?.trim() || "unknown git error";
}

function isDestinationUnusable(stderr: string): boolean {
  return /already exists and is not an? empty directory/i.test(stderr);
}

export async function cloneRepo(
  run: GitRunner,
  cacheRoot: string,
  dir: string,
  url: string,
  ref: string,
  sparsePaths: readonly string[],
): Promise<CloneOutcome | CloneFailure> {
  const cloneResult = await run({
    argv: ["clone", "--depth", "1", "--branch", ref, "--filter=blob:none", "--no-checkout", url, dir],
    cwd: cacheRoot,
  });
  if (cloneResult.code !== 0) {
    if (isDestinationUnusable(cloneResult.stderr)) {
      return { ok: false, reason: `cache directory unusable; delete ${dir} and retry` };
    }
    return { ok: false, reason: `clone failed: ${firstStderrLine(cloneResult.stderr)}` };
  }

  const initResult = await run({ argv: ["-C", dir, "sparse-checkout", "init", "--cone"], cwd: cacheRoot });
  if (initResult.code !== 0) {
    return { ok: false, reason: `clone failed: ${firstStderrLine(initResult.stderr)}` };
  }

  if (sparsePaths.length > 0) {
    const setResult = await run({
      argv: ["-C", dir, "sparse-checkout", "set", ...sparsePaths],
      cwd: cacheRoot,
    });
    if (setResult.code !== 0) {
      return { ok: false, reason: `clone failed: ${firstStderrLine(setResult.stderr)}` };
    }
  }

  const checkoutResult = await run({ argv: ["-C", dir, "checkout"], cwd: cacheRoot });
  if (checkoutResult.code !== 0) {
    return { ok: false, reason: `clone failed: ${firstStderrLine(checkoutResult.stderr)}` };
  }

  const revResult = await run({ argv: ["-C", dir, "rev-parse", "HEAD"], cwd: cacheRoot });
  if (revResult.code !== 0) {
    return { ok: false, reason: `clone failed: ${firstStderrLine(revResult.stderr)}` };
  }

  return { ok: true, commit: revResult.stdout.trim() };
}

/** Updates an existing cache dir in place. Never deletes, never clones. */
export async function refreshRepo(
  run: GitRunner,
  cacheRoot: string,
  dir: string,
  ref: string,
  sparsePaths: readonly string[],
): Promise<CloneOutcome | CloneFailure> {
  const fetchResult = await run({
    argv: ["-C", dir, "fetch", "--depth", "1", "--filter=blob:none", "origin", ref],
    cwd: cacheRoot,
  });
  if (fetchResult.code !== 0) {
    return { ok: false, reason: `refresh failed: ${firstStderrLine(fetchResult.stderr)}` };
  }

  if (sparsePaths.length > 0) {
    const setResult = await run({
      argv: ["-C", dir, "sparse-checkout", "set", ...sparsePaths],
      cwd: cacheRoot,
    });
    if (setResult.code !== 0) {
      return { ok: false, reason: `refresh failed: ${firstStderrLine(setResult.stderr)}` };
    }
  }

  const resetResult = await run({ argv: ["-C", dir, "reset", "--hard", "FETCH_HEAD"], cwd: cacheRoot });
  if (resetResult.code !== 0) {
    return { ok: false, reason: `refresh failed: ${firstStderrLine(resetResult.stderr)}` };
  }

  const revResult = await run({ argv: ["-C", dir, "rev-parse", "HEAD"], cwd: cacheRoot });
  if (revResult.code !== 0) {
    return { ok: false, reason: `refresh failed: ${firstStderrLine(revResult.stderr)}` };
  }

  return { ok: true, commit: revResult.stdout.trim() };
}

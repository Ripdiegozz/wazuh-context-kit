/**
 * `fetchRepos` — the per-repo cache-hit / miss / --refresh orchestration
 * (SPEC 1.4, 1.9, D3, D4).
 *
 * The only module allowed to reach network and git (SPEC 6.1). Everything
 * here goes through the injected `FetchIo` — no other fs, network, or git
 * access exists in this file. `io.ensureDir(cacheRoot)` resolves open
 * question A1: a spawned process needs an existing `cwd`, and `.cache/` may
 * not exist yet on a fresh checkout.
 */

import type { Skipped } from "../matrix/types.ts";
import type { RepoSource } from "../sources.ts";
import { cacheDirFor, cloneRepo, refreshRepo, sparsePathsFor } from "./clone.ts";
import { offlineGuard } from "./git-runner.ts";
import { resolveRemoteRef } from "./ls-remote.ts";
import type { FetchIo, FetchOptions, FetchOutcome, FetchedRepo, FetchStamp } from "./types.ts";

// Defense in depth: repo names come from sources.yml, refs from --ref. Both
// end up inside a `-C <dir>` argument or a spawned argv; reject anything that
// is not a plain path segment before it ever reaches a runner call.
const REPO_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const REF_PATTERN = /^[A-Za-z0-9._/-]+$/;
const FORTY_HEX = /^[0-9a-f]{40}$/;

function isValidRepoName(name: string): boolean {
  return REPO_NAME_PATTERN.test(name) && !name.startsWith("-");
}

function isValidRef(ref: string): boolean {
  return REF_PATTERN.test(ref) && !ref.startsWith("-");
}

function repoUrl(name: string): string {
  return `https://github.com/wazuh/${name}.git`;
}

function stampPathFor(dir: string): string {
  return `${dir}.fetch.json`;
}

async function readParsedStamp(io: FetchIo, stampPath: string): Promise<FetchStamp | null> {
  const raw = await io.readStamp(stampPath);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as FetchStamp;
  } catch {
    return null;
  }
}

interface RepoResult {
  fetched?: FetchedRepo;
  skipped?: Skipped;
}

async function fetchOneRepo(
  repo: RepoSource,
  ref: string,
  cacheRoot: string,
  refresh: boolean,
  io: FetchIo,
): Promise<RepoResult> {
  if (!isValidRepoName(repo.name)) {
    return { skipped: { repo: repo.name, reason: `invalid repository name: '${repo.name}'` } };
  }

  const dir = cacheDirFor(cacheRoot, repo.name, ref);
  const stampPath = stampPathFor(dir);
  const sparsePaths = sparsePathsFor(repo.kind);

  if (!refresh) {
    const guardedRun = offlineGuard(io.run);
    const rev = await guardedRun({ argv: ["-C", dir, "rev-parse", "HEAD"], cwd: cacheRoot });
    const commit = rev.stdout.trim();

    if (rev.code === 0 && FORTY_HEX.test(commit)) {
      let stamp = await readParsedStamp(io, stampPath);
      if (stamp === null) {
        stamp = { ref, commit, resolvedAt: io.now() };
        await io.writeStamp(stampPath, JSON.stringify(stamp));
      }
      return { fetched: { repo: repo.name, dir, commit } };
    }
  } else {
    const result = await refreshRepo(io.run, cacheRoot, dir, ref, sparsePaths);
    if (!result.ok) {
      return { skipped: { repo: repo.name, reason: result.reason } };
    }
    const stamp: FetchStamp = { ref, commit: result.commit, resolvedAt: io.now() };
    await io.writeStamp(stampPath, JSON.stringify(stamp));
    return { fetched: { repo: repo.name, dir, commit: result.commit } };
  }

  const remoteRef = await resolveRemoteRef(io.run, repoUrl(repo.name), ref, cacheRoot);
  if (!remoteRef.found) {
    const reason = remoteRef.reason === "absent" ? `no ${ref} branch` : `ref lookup failed: ${remoteRef.detail}`;
    return { skipped: { repo: repo.name, reason } };
  }

  const cloneResult = await cloneRepo(io.run, cacheRoot, dir, repoUrl(repo.name), ref, sparsePaths);
  if (!cloneResult.ok) {
    return { skipped: { repo: repo.name, reason: cloneResult.reason } };
  }

  const stamp: FetchStamp = { ref, commit: cloneResult.commit, resolvedAt: io.now() };
  await io.writeStamp(stampPath, JSON.stringify(stamp));
  return { fetched: { repo: repo.name, dir, commit: cloneResult.commit } };
}

export async function fetchRepos(options: FetchOptions): Promise<FetchOutcome> {
  const { repos, ref, cacheRoot, refresh, io } = options;

  if (!isValidRef(ref)) {
    throw new Error(`fetchRepos: invalid ref '${ref}'`);
  }

  await io.ensureDir(cacheRoot);

  const fetched: FetchedRepo[] = [];
  const skipped: Skipped[] = [];

  for (const repo of repos) {
    const result = await fetchOneRepo(repo, ref, cacheRoot, refresh, io);
    if (result.fetched) fetched.push(result.fetched);
    if (result.skipped) skipped.push(result.skipped);
  }

  return { fetched, skipped };
}

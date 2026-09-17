/**
 * World detection (design "World detection"): `cwd` -> repository root ->
 * remote -> repository name -> `sources.yml` entry -> world from the dataset.
 *
 * This is the composition edge (design "The one structural decision"): it
 * shells out to git, which `matrix/` is not allowed to do. Everything below
 * goes through an injected `GitRunner` (`src/fetch/types.ts`), exactly as
 * `fetch/` already does, so the pure logic here needs no real repository to
 * test -- only the hermetic tests in `world.test.ts` deliberately use the
 * real runner against real temp repositories.
 *
 * Matching happens on the **remote**, never the directory name: a checkout
 * can live in a directory called anything (design "World detection").
 */

import type { GitRunner } from "../fetch/types.ts";
import type { MatrixJson, World } from "../matrix/types.ts";
import type { Sources } from "../sources.ts";

/**
 * The working tree's branch, or the fact that there isn't one. Detached HEAD
 * is reported as its own case rather than folded into "no repository" or
 * "unrecognised repository" -- SPEC "A ref mismatch is refused by default":
 * "the message says the branch could not be determined... distinct from the
 * message for a mismatch between two known refs".
 */
export type BranchStatus = { readonly kind: "known"; readonly branch: string } | { readonly kind: "detached" };

/**
 * `git rev-parse --show-toplevel` from `cwd`. `null` when `cwd` is not inside
 * a git repository at all -- step 1 of the design's three-step sequence,
 * failing means "no repository to resolve", not an error to throw.
 */
export async function repoRootFrom(git: GitRunner, cwd: string): Promise<string | null> {
  const result = await git({ argv: ["rev-parse", "--show-toplevel"], cwd });
  if (result.code !== 0) return null;
  const root = result.stdout.trim();
  return root.length > 0 ? root : null;
}

/**
 * `git config --get remote.origin.url` from `repoRoot`. `null` when there is
 * no `origin` remote configured -- step 2 of the design's sequence.
 */
export async function remoteUrlFrom(git: GitRunner, repoRoot: string): Promise<string | null> {
  const result = await git({ argv: ["config", "--get", "remote.origin.url"], cwd: repoRoot });
  if (result.code !== 0) return null;
  const url = result.stdout.trim();
  return url.length > 0 ? url : null;
}

/**
 * Normalises a remote URL to a bare repository name -- strips the `.git`
 * suffix, then the scheme and host (whether HTTPS-form or `git@host:`
 * SCP-like form), leaving the final path segment (design "World detection",
 * step 2: "strip `.git`, scheme, host").
 */
export function repoNameFromRemote(url: string): string {
  let cleaned = url.trim().replace(/\.git$/, "");

  const scpMatch = /^[^/@]+@[^:]+:(.+)$/.exec(cleaned);
  if (scpMatch?.[1] !== undefined) {
    cleaned = scpMatch[1];
  } else {
    cleaned = cleaned.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "");
    const slashIndex = cleaned.indexOf("/");
    if (slashIndex !== -1) cleaned = cleaned.slice(slashIndex + 1);
  }

  const segments = cleaned.split("/").filter((segment) => segment.length > 0);
  return segments.length > 0 ? segments[segments.length - 1]! : cleaned;
}

/**
 * `cwd` -> repository name via its remote (task 5.1). `null` when either step
 * of the design's sequence fails: not in a repository, or no `origin` remote.
 */
export async function resolveRepoName(git: GitRunner, cwd: string): Promise<string | null> {
  const repoRoot = await repoRootFrom(git, cwd);
  if (repoRoot === null) return null;

  const remoteUrl = await remoteUrlFrom(git, repoRoot);
  if (remoteUrl === null) return null;

  return repoNameFromRemote(remoteUrl);
}

/** `git symbolic-ref --short HEAD`. Non-zero (or empty) means detached HEAD. */
export async function currentBranch(git: GitRunner, cwd: string): Promise<BranchStatus> {
  const result = await git({ argv: ["symbolic-ref", "--short", "HEAD"], cwd });
  if (result.code !== 0) return { kind: "detached" };
  const branch = result.stdout.trim();
  return branch.length > 0 ? { kind: "known", branch } : { kind: "detached" };
}

function worldFromMatrix(matrix: MatrixJson, repoName: string): World {
  const plugin = matrix.plugins.find((candidate) => candidate.repo === repoName);
  return plugin?.world ?? "unknown";
}

/**
 * The whole world resolution (design "World detection", step 3): a repo name
 * resolved from `cwd`, whether it is a `sources.yml` entry, the world the
 * dataset classified it as, and the working tree's branch.
 *
 * `recognised` is what `startup.ts`'s ref gate keys on (design table): an
 * unrecognised repository -- including "not in a git repository at all" --
 * has no position to contradict the dataset's ref, so it is never refused
 * on that basis; only a recognised repository's branch is compared.
 */
export interface WorldResolution {
  readonly repoName: string | null;
  readonly recognised: boolean;
  readonly world: World;
  readonly branch: BranchStatus | null;
}

export async function resolveWorld(
  git: GitRunner,
  cwd: string,
  sources: Sources,
  matrix: MatrixJson,
): Promise<WorldResolution> {
  const repoRoot = await repoRootFrom(git, cwd);
  if (repoRoot === null) {
    return { repoName: null, recognised: false, world: "unknown", branch: null };
  }

  const remoteUrl = await remoteUrlFrom(git, repoRoot);
  const repoName = remoteUrl === null ? null : repoNameFromRemote(remoteUrl);
  const recognised = repoName !== null && sources.repos.some((repo) => repo.name === repoName);
  const world = recognised && repoName !== null ? worldFromMatrix(matrix, repoName) : "unknown";
  const branch = await currentBranch(git, repoRoot);

  return { repoName, recognised, world, branch };
}

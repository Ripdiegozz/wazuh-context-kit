/**
 * The mapping validator (design "The validator"; SPEC "The version mapping is
 * validated against reality, not trusted").
 *
 * An ALARM, not an inference: each `docsVersionMap` entry is checked against
 * two independent sources of truth --
 *
 *   1. the mapped documentation path answers with `content-type:
 *      text/markdown` (the same signal `docs.ts` checks at request time);
 *   2. the release state of `wazuh-dashboard-plugins`, read read-only via
 *      `git ls-remote --tags` through the injected `GitRunner`, still
 *      matches what the entry assumes.
 *
 * A disagreement fails loudly, naming the entry and its `lastReviewed`. It
 * NEVER rewrites `sources.yml` -- the join between a code ref and a
 * documentation path is a human convention with a named owner and a review
 * date; a validator that "fixed" the file would be deriving that convention
 * through the back door, exactly what the SPEC's twelfth §3.6 criterion
 * forbids. Every function below only reads its inputs.
 */

import type { GitRunner } from "../fetch/types.ts";
import { repoCloneUrl } from "../github.ts";
import type { DocsVersionMap } from "../sources.ts";
import { buildDocsUrls, type DocsFetchLike } from "./docs.ts";

/**
 * research-docs-contract.md finding 3's known-good probe page: measured 200
 * on every version path this project has ever mapped to (`/current/`,
 * `/4.14/`, `/4.2/`, `/3.13/`, `/5.0-beta/`), so a probe failure here means
 * the ENTRY's path is dead, not that this particular page moved.
 */
const DEFAULT_PROBE_PATH = "getting-started/components/index";

const RELEASE_TAGS_REPO = "wazuh-dashboard-plugins";
const RELEASE_TAGS_URL = repoCloneUrl(RELEASE_TAGS_REPO);

/** A mapped path that assumes pre-GA, e.g. `"5.0-beta"`, `"4.14-rc2"`. */
const PRERELEASE_PATH_PATTERN = /-(alpha|beta|rc)\d*$/i;

export interface DocsMapEntryResult {
  readonly ref: string;
  readonly versionPath: string;
  readonly ok: boolean;
  readonly problems: readonly string[];
}

export interface DocsMapValidationResult {
  readonly ok: boolean;
  readonly entries: readonly DocsMapEntryResult[];
}

export interface ValidateDocsMapInput {
  readonly transport: DocsFetchLike;
  readonly git: GitRunner;
  readonly docsVersionMap: DocsVersionMap;
  /** `git ls-remote` targets a remote URL, so any existing directory works. */
  readonly cwd: string;
  readonly probePath?: string;
}

/** `git ls-remote --tags` output: `<sha>\trefs/tags/<name>[^{}]`, one per line. */
function parseTagNames(lsRemoteStdout: string): string[] {
  return lsRemoteStdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split("\t")[1] ?? "")
    .filter((tagRef) => tagRef.startsWith("refs/tags/"))
    .map((tagRef) => tagRef.slice("refs/tags/".length).replace(/\^\{\}$/, ""));
}

/** Read-only: `git ls-remote --tags` against the remote, never a local clone. */
async function fetchReleaseTags(git: GitRunner, cwd: string): Promise<string[]> {
  const result = await git({ argv: ["ls-remote", "--tags", RELEASE_TAGS_URL], cwd });
  if (result.code !== 0) return [];
  return parseTagNames(result.stdout);
}

function gaTagFor(ref: string): string {
  return `v${ref}`;
}

async function probeMappedPath(
  transport: DocsFetchLike,
  ref: string,
  versionPath: string,
  lastReviewed: string,
  probePath: string,
): Promise<string | null> {
  const { mdUrl } = buildDocsUrls(versionPath, probePath);

  let response;
  try {
    response = await transport(mdUrl, { method: "GET" });
  } catch (error) {
    return (
      `entry "${ref}" -> "${versionPath}" (lastReviewed ${lastReviewed}) could not be reached: ` +
      `${(error as Error).message}`
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (response.status !== 200 || !contentType.toLowerCase().includes("text/markdown")) {
    return (
      `entry "${ref}" -> "${versionPath}" (lastReviewed ${lastReviewed}) is dead: ` +
      `${mdUrl} answered with status ${response.status}, content-type "${contentType || "(none)"}"`
    );
  }

  return null;
}

function checkReleaseState(
  ref: string,
  versionPath: string,
  lastReviewed: string,
  releaseTags: readonly string[],
): string | null {
  if (!PRERELEASE_PATH_PATTERN.test(versionPath)) return null;

  const gaTag = gaTagFor(ref);
  if (!releaseTags.includes(gaTag)) return null;

  return (
    `entry "${ref}" -> "${versionPath}" (lastReviewed ${lastReviewed}) assumed no GA release ` +
    `yet, but tag ${gaTag} now exists on ${RELEASE_TAGS_REPO} -- the release state has changed`
  );
}

async function validateEntry(
  transport: DocsFetchLike,
  ref: string,
  versionPath: string,
  lastReviewed: string,
  probePath: string,
  releaseTags: readonly string[],
): Promise<DocsMapEntryResult> {
  const problems: string[] = [];

  const deadPathProblem = await probeMappedPath(transport, ref, versionPath, lastReviewed, probePath);
  if (deadPathProblem !== null) problems.push(deadPathProblem);

  const releaseStateProblem = checkReleaseState(ref, versionPath, lastReviewed, releaseTags);
  if (releaseStateProblem !== null) problems.push(releaseStateProblem);

  return { ref, versionPath, ok: problems.length === 0, problems };
}

/**
 * Never rewrites `input.docsVersionMap` -- every step here only reads from
 * it. Nothing in this module holds a write handle to `sources.yml` at all.
 */
export async function validateDocsMap(input: ValidateDocsMapInput): Promise<DocsMapValidationResult> {
  const probePath = input.probePath ?? DEFAULT_PROBE_PATH;
  const releaseTags = await fetchReleaseTags(input.git, input.cwd);

  const entries = await Promise.all(
    Object.entries(input.docsVersionMap.map).map(([ref, versionPath]) =>
      validateEntry(input.transport, ref, versionPath, input.docsVersionMap.lastReviewed, probePath, releaseTags),
    ),
  );

  return { ok: entries.every((entry) => entry.ok), entries };
}

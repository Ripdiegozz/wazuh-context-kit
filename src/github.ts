/**
 * Single source of truth for `github.com/wazuh/<repo>` URLs.
 *
 * Before this module existed, the "wazuh" org prefix was hardcoded three
 * times independently: `src/fetch/index.ts`'s clone URL, `src/mcp/docs-
 * validate.ts`'s release-tags remote, and `ui/src/components/matrix/
 * EvidenceBadge.tsx`'s client-side *guess* at a browse URL (the UI has no
 * API field naming the org, so it assumed one in a comment). That last one
 * is the same mistake `docsVersionMap` just argued against elsewhere in this
 * project: a join that looks derivable but is actually an unversioned
 * convention. The fix is one function, used everywhere the convention is
 * needed, so the UI never has to guess it again.
 *
 * Pure and side-effect-free: string formatting only, no fs, no network.
 */

const ORG = "wazuh";

/** `https://github.com/wazuh` — the base every repo lives under. */
export function orgBaseUrl(): string {
  return `https://github.com/${ORG}`;
}

/** `https://github.com/wazuh/<repo>.git` — what `git clone`/`ls-remote` target. */
export function repoCloneUrl(repo: string): string {
  return `${orgBaseUrl()}/${repo}.git`;
}

/** `https://github.com/wazuh/<repo>/blob/<commit>/<path>` — a browsable file URL. */
export function repoBrowseUrl(repo: string, commit: string, path: string): string {
  return `${orgBaseUrl()}/${repo}/blob/${commit}/${path}`;
}

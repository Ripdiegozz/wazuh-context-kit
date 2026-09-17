/**
 * `docs`: mapping, fetch, citation (design "`docs`: mapping, fetch,
 * citation"; SPEC "`docs` returns Markdown and cites the canonical HTML",
 * "The version mapping is explicit configuration, never derived", "A broken
 * 1-to-1 guarantee fails loudly").
 *
 * Two failure modes are kept DISTINCT on purpose (design, same section):
 * - `"unmapped-ref"` -- no entry in `sources.yml`'s `docsVersionMap`. A
 *   configuration gap.
 * - `"unavailable"` -- the entry exists but the fetch did not come back as a
 *   real `.md` page: a non-200, the wrong content-type, or an HTML body under
 *   a `.md` path (research-docs-contract.md finding 5: there is no soft-404,
 *   so a real hit is 200 + `text/markdown` and both signals agree; a status
 *   check alone would miss a 200 that serves the HTML error page).
 *
 * The transport is injected, following `src/indexer/client.ts`'s discipline
 * (design "Every file that touches the world takes its dependency
 * injected"): nothing here opens a socket, so this module's tests
 * (`docs.test.ts`) run with no network. The network canary
 * (`docs.integration.test.ts`) passes the real global `fetch`, which is
 * structurally compatible with `DocsFetchLike`.
 *
 * `/current/` is never used as a fallback for a pinned ref (SPEC: "MUST NOT
 * default to `/current/` when a ref is pinned") -- an unmapped ref fails
 * instead of silently answering with the wrong version's documentation
 * (research-docs-contract.md finding 3: `/current/` is byte-identical to
 * `/4.14/`, not to whatever a pinned ref like `5.0.0` actually maps to).
 */

import type { DocsVersionMap } from "../sources.ts";

export const DOCS_BASE_URL = "https://documentation.wazuh.com";

/** Real `.md` bodies never start with this; the shared HTML error page does. */
const HTML_ERROR_PAGE_PREFIX = "<!DOCTYPE";

/** Never longer than this: a hung connect must not hang the whole request. */
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * The minimal shape needed from a fetch-like function -- narrowed to what
 * this module reads, mirroring `src/indexer/types.ts`'s `FetchLike`.
 * Structurally compatible with the real WHATWG/Bun `fetch`.
 */
export interface DocsHttpRequestInit {
  readonly method: "GET";
  readonly signal?: AbortSignal;
}

export interface DocsHttpResponseLike {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type DocsFetchLike = (url: string, init: DocsHttpRequestInit) => Promise<DocsHttpResponseLike>;

export interface DocsRequest {
  /** Code ref, e.g. `"5.0.0"` -- looked up in `docsVersionMap.map`. */
  readonly ref: string;
  /** `<section>/<page>`, no extension -- e.g. `"getting-started/components/index"`. */
  readonly path: string;
}

export interface DocsSuccess {
  readonly ok: true;
  readonly markdown: string;
  /** The `.html` twin at the same path (SPEC "cites the canonical HTML"). */
  readonly citationUrl: string;
  readonly requestedUrl: string;
}

export type DocsFailureReason = "unmapped-ref" | "unavailable";

export interface DocsFailure {
  readonly ok: false;
  readonly reason: DocsFailureReason;
  readonly message: string;
}

export type DocsResult = DocsSuccess | DocsFailure;

function stripExtension(path: string): string {
  return path.replace(/^\/+/, "").replace(/\.(md|html)$/i, "");
}

/** URL template from research-docs-contract.md: `<versionPath>/<section>/<page>.md`. */
export function buildDocsUrls(
  versionPath: string,
  path: string,
): { readonly mdUrl: string; readonly htmlUrl: string } {
  const trimmed = stripExtension(path);
  return {
    mdUrl: `${DOCS_BASE_URL}/${versionPath}/${trimmed}.md`,
    htmlUrl: `${DOCS_BASE_URL}/${versionPath}/${trimmed}.html`,
  };
}

export interface FetchDocsOptions {
  readonly timeoutMs?: number;
}

export async function fetchDocs(
  transport: DocsFetchLike,
  docsVersionMap: DocsVersionMap | undefined,
  request: DocsRequest,
  options: FetchDocsOptions = {},
): Promise<DocsResult> {
  const versionPath = docsVersionMap?.map[request.ref];
  if (versionPath === undefined) {
    return {
      ok: false,
      reason: "unmapped-ref",
      message:
        `docs unavailable: no documentation mapping for ref "${request.ref}" -- ` +
        "add an entry to sources.yml's docsVersionMap. This is a configuration " +
        "gap, distinct from a fetch failure on a mapped-but-dead path.",
    };
  }

  const { mdUrl, htmlUrl } = buildDocsUrls(versionPath, request.path);

  let response: DocsHttpResponseLike;
  try {
    response = await transport(mdUrl, {
      method: "GET",
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      ok: false,
      reason: "unavailable",
      message: `docs unavailable: could not reach ${mdUrl} -- ${(error as Error).message}`,
    };
  }

  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.text();

  const isMarkdownHit =
    response.status === 200 &&
    contentType.toLowerCase().includes("text/markdown") &&
    !body.startsWith(HTML_ERROR_PAGE_PREFIX);

  if (!isMarkdownHit) {
    return {
      ok: false,
      reason: "unavailable",
      message:
        `docs unavailable for ${mdUrl}: received status ${response.status}, ` +
        `content-type "${contentType || "(none)"}" -- expected 200 + text/markdown. ` +
        "The mapped path exists in sources.yml but did not answer as documentation " +
        "(research-docs-contract.md: a real hit is 200 + text/markdown; anything " +
        "else -- including a 200 serving the HTML error page -- must not be " +
        "returned as documentation).",
    };
  }

  return { ok: true, markdown: body, citationUrl: htmlUrl, requestedUrl: mdUrl };
}

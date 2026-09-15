/**
 * `fetchClusterState` — the only module that touches the network
 * (crosscheck-live-indexer design decision 1; SPEC 6.1 purity seam).
 *
 * Three read-only GETs, nothing else: `_cat/indices`, `_data_stream`,
 * `_index_template`. The transport is injected (design decision 1, same
 * discipline as `src/fetch/types.ts`'s `GitRunner`), so a test can assert
 * "these three requests, all GET" without a socket ever opening.
 *
 * This module returns RAW shapes and makes NO judgement about what a name
 * means -- that decision belongs entirely to `src/crosscheck/live.ts`, the
 * pure layer, where a test can state it as a literal.
 */

import type {
  FetchLike,
  HttpRequestInit,
  IndexerCredentials,
  RawClusterState,
} from "./types.ts";
import { IndexerError } from "./types.ts";

/** Never longer than this: a hung TCP connect must not hang the whole command. */
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Every `code` Bun/Node is known to raise for a certificate that does not
 * validate. Probed directly against the reference stack's self-signed cert
 * (evidence.md): `UNABLE_TO_VERIFY_LEAF_SIGNATURE` is the one actually
 * observed; the others are the well-known siblings for the same class of
 * failure across Node's TLS implementation.
 */
const CERTIFICATE_ERROR_CODES = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_HAS_EXPIRED",
]);

export interface FetchClusterStateOptions {
  readonly skipTlsVerify: boolean;
  readonly timeoutMs?: number;
}

function basicAuthHeader(credentials: IndexerCredentials): string {
  const raw = `${credentials.username}:${credentials.password}`;
  return `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
}

function buildHeaders(credentials: IndexerCredentials | undefined): Record<string, string> {
  if (!credentials) return {};
  return { authorization: basicAuthHeader(credentials) };
}

/**
 * Translates a raw transport failure into the taxonomy from design decision
 * 6. Never includes a credential value -- there is none in scope here, only
 * the URL and the underlying error's own message, which the transport layer
 * (TCP, TLS) never carries credentials in.
 */
function classifyTransportError(error: unknown, url: string): IndexerError {
  const err = error as { code?: string; name?: string };

  // No "wazuh-ctx:" prefix here: `src/cli.ts` already prefixes every printed
  // error with "wazuh-ctx crosscheck: ". Adding a second one here doubled it
  // on a real run -- "wazuh-ctx crosscheck: wazuh-ctx: certificate
  // verification failed ...". One place adds the prefix; this is not it.
  if (err.code && CERTIFICATE_ERROR_CODES.has(err.code)) {
    return new IndexerError(
      "certificate",
      `certificate verification failed for ${url}. ` +
        "Pass --indexer-skip-tls-verify to accept it for this run.",
    );
  }

  if (err.name === "AbortError" || err.name === "TimeoutError") {
    return new IndexerError("timeout", `timed out reaching ${url}.`);
  }

  if (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND" || err.code === "EHOSTUNREACH") {
    return new IndexerError("unreachable", `could not reach indexer at ${url}.`);
  }

  return new IndexerError("unreachable", `could not reach indexer at ${url}.`);
}

async function get(
  transport: FetchLike,
  url: string,
  credentials: IndexerCredentials | undefined,
  options: FetchClusterStateOptions,
  requestUrl: string,
): Promise<unknown> {
  const init: HttpRequestInit = {
    method: "GET",
    headers: buildHeaders(credentials),
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    // Scoped to this one request (design decision 5). NEVER
    // NODE_TLS_REJECT_UNAUTHORIZED, which is process-global and would weaken
    // every other TLS call in the process to solve a one-request problem.
    ...(options.skipTlsVerify ? { tls: { rejectUnauthorized: false } } : {}),
  };

  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await transport(requestUrl, init);
  } catch (error) {
    throw classifyTransportError(error, url);
  }

  if (response.status === 401) {
    throw new IndexerError(
      "auth",
      "the indexer rejected the credentials (401). Set " +
        "WAZUH_CTX_INDEXER_USERNAME and WAZUH_CTX_INDEXER_PASSWORD — a 401 " +
        "does not distinguish missing credentials from wrong ones.",
    );
  }

  if (response.status < 200 || response.status >= 300) {
    throw new IndexerError(
      "unreachable",
      `indexer at ${url} answered with HTTP ${response.status}.`,
    );
  }

  return response.json();
}

interface RawCatIndicesEntry {
  readonly index?: string;
}

interface RawDataStreamsBody {
  readonly data_streams?: {
    readonly name?: string;
    readonly template?: string;
    readonly indices?: { readonly index_name?: string }[];
  }[];
}

interface RawIndexTemplatesBody {
  readonly index_templates?: {
    readonly name?: string;
    readonly index_template?: { readonly index_patterns?: string[] };
  }[];
}

export async function fetchClusterState(
  transport: FetchLike,
  url: string,
  credentials: IndexerCredentials | undefined,
  options: FetchClusterStateOptions,
): Promise<RawClusterState> {
  const base = url.endsWith("/") ? url.slice(0, -1) : url;

  // `expand_wildcards=all` on `_cat/indices` ONLY (design decision 8 /
  // evidence.md): the default listing excludes hidden indices -- 52 of 103
  // on the reference stack -- and several Wazuh-declared patterns
  // (`.wazuh-settings`, `.wazuh-internal-state`, ...) are installed and
  // hidden. `_data_stream` rejects this parameter outright, and does not
  // need it: it already reports every stream regardless of visibility.
  const [catIndicesRaw, dataStreamRaw, indexTemplateRaw] = await Promise.all([
    get(transport, url, credentials, options, `${base}/_cat/indices?format=json&expand_wildcards=all`),
    get(transport, url, credentials, options, `${base}/_data_stream`),
    get(transport, url, credentials, options, `${base}/_index_template`),
  ]);

  const indices = (Array.isArray(catIndicesRaw) ? (catIndicesRaw as RawCatIndicesEntry[]) : [])
    .filter((entry): entry is { index: string } => typeof entry.index === "string")
    .map((entry) => ({ name: entry.index }));

  const dataStreams = ((dataStreamRaw as RawDataStreamsBody).data_streams ?? [])
    .filter(
      (ds): ds is { name: string; template: string; indices: { index_name?: string }[] } =>
        typeof ds.name === "string" && typeof ds.template === "string",
    )
    .map((ds) => ({
      name: ds.name,
      template: ds.template,
      backingIndices: (ds.indices ?? [])
        .map((i) => i.index_name)
        .filter((name): name is string => typeof name === "string"),
    }));

  const indexTemplates = ((indexTemplateRaw as RawIndexTemplatesBody).index_templates ?? [])
    .filter((t): t is { name: string; index_template: { index_patterns?: string[] } } =>
      typeof t.name === "string" && t.index_template !== undefined,
    )
    .map((t) => ({
      name: t.name,
      indexPatterns: (t.index_template.index_patterns ?? []).filter(
        (p): p is string => typeof p === "string",
      ),
    }));

  return { indices, dataStreams, indexTemplates };
}

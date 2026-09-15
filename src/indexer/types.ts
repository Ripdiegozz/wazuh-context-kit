/**
 * Types for `src/indexer/` — the only new module that touches the network
 * (SPEC 6.1, crosscheck-live-indexer design decision 1).
 *
 * `RawClusterState` is deliberately dumb: it carries exactly what the cluster
 * said, normalised only in structure. The moment this shape starts deciding
 * what a name MEANS -- which index belongs to which stream, which template is
 * "ours" -- that decision becomes untestable without a live cluster. Keeping
 * it raw pushes every judgement into `src/crosscheck/live.ts`, where a test
 * can state the input as a literal instead of a fixture recorded from a real
 * cluster.
 */

/** One `_cat/indices?format=json` entry, kept to the one field live.ts needs. */
export interface RawIndex {
  readonly name: string;
}

/**
 * One `_data_stream` entry.
 *
 * `backingIndices` is the cluster's own report of which concrete indices this
 * stream owns -- data, not a `.ds-<stream>-NNNNNN` naming convention. A
 * backing index with an unconventional name still resolves correctly this
 * way, because ownership is never inferred from the name.
 */
export interface RawDataStream {
  readonly name: string;
  readonly template: string;
  readonly backingIndices: readonly string[];
}

/** One `_index_template` entry. */
export interface RawIndexTemplate {
  readonly name: string;
  readonly indexPatterns: readonly string[];
}

/** Exactly what `fetchClusterState` returns: three raw, unjudged shapes. */
export interface RawClusterState {
  readonly indices: readonly RawIndex[];
  readonly dataStreams: readonly RawDataStream[];
  readonly indexTemplates: readonly RawIndexTemplate[];
}

/**
 * Credentials read once from the environment in `src/cli.ts` and passed in.
 *
 * Never read from `process.env` inside the client itself: a test that
 * constructs one of these touches no environment variable, and a credential
 * value never has to travel through a call site that might log it.
 */
export interface IndexerCredentials {
  readonly username: string;
  readonly password: string;
}

/**
 * The error taxonomy from design decision 6. `code` is what a caller
 * branches on; `message` is what a human reads. Neither ever carries a
 * credential value.
 */
export type IndexerErrorCode = "certificate" | "auth" | "unreachable" | "timeout";

export class IndexerError extends Error {
  readonly code: IndexerErrorCode;

  constructor(code: IndexerErrorCode, message: string) {
    super(message);
    this.name = "IndexerError";
    this.code = code;
  }
}

/**
 * The minimal shape the client needs from a fetch-like function, so a test
 * can inject a fake with no real network, TLS or timeout behaviour.
 *
 * Modelled on Bun/WHATWG `fetch`, narrowed to what `fetchClusterState` uses.
 */
export interface HttpRequestInit {
  readonly method: "GET";
  readonly headers: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
  /** Bun's per-request TLS override (design decision 5). Never process-global. */
  readonly tls?: { readonly rejectUnauthorized: boolean };
}

export interface HttpResponseLike {
  readonly status: number;
  json(): Promise<unknown>;
}

export type FetchLike = (url: string, init: HttpRequestInit) => Promise<HttpResponseLike>;

/** Every GET this client is allowed to send, and nothing else (SPEC read-only). */
export interface RecordedRequest {
  readonly method: "GET";
  readonly url: string;
}

/**
 * `runtime`: the optional resource (design "`runtime`: optional resource;
 * conditional registration"; SPEC "`runtime` absent never blocks `docs` or
 * `schema`").
 *
 * SPEC 3.3 names two surfaces that only a live instance can answer -- the
 * dashboard's configuration registry (populated at boot by each plugin, not
 * a static file: "no se puede grepear") and effective cluster roles/
 * permissions. Neither has an established wire contract anywhere in this
 * project, unlike `src/indexer/client.ts`'s three named `_cat`/`_data_stream`/
 * `_index_template` GETs. So this module does not invent one: it makes ONE
 * GET against a configured instance URL and returns the body RAW and
 * UNJUDGED (mirroring `src/indexer/types.ts`'s `RawClusterState` docblock:
 * "deliberately dumb... the moment this shape starts deciding what a name
 * MEANS... that decision becomes untestable without a live instance").
 * Interpreting that body into typed configuration keys or roles is future
 * work behind a real contract, not a shape guessed here.
 *
 * **There is no protocol-level way to mark one resource unavailable**
 * (design "SDK choice and its consequences"). So this module never throws:
 * every failure -- no instance configured, unreachable, non-2xx -- collapses
 * to `null`, and `server.ts` (unit 6's composition edge) is the one place
 * that turns a `null` into "do not call `registerResource('runtime', ...)`
 * at all". `docs` and `schema` never see this decision, by construction.
 *
 * The transport is injected, following `src/indexer/client.ts` and
 * `docs.ts`'s discipline: nothing here opens a real socket, so
 * `runtime.test.ts` runs with no network.
 */

/** One configured live instance to read `runtime` from. */
export interface RuntimeInstanceConfig {
  readonly url: string;
}

export interface RuntimeHttpRequestInit {
  readonly method: "GET";
  readonly signal?: AbortSignal;
}

export interface RuntimeHttpResponseLike {
  readonly status: number;
  json(): Promise<unknown>;
}

/** Narrowed to what this module uses -- structurally compatible with the real WHATWG/Bun `fetch`. */
export type RuntimeFetchLike = (
  url: string,
  init: RuntimeHttpRequestInit,
) => Promise<RuntimeHttpResponseLike>;

/** Never longer than this: a hung connect must not hang the whole startup sequence. */
const DEFAULT_TIMEOUT_MS = 10_000;

export interface ResolveRuntimeOptions {
  readonly timeoutMs?: number;
}

/** The RAW body from the configured instance -- no interpretation (module doc). */
export interface RuntimeSnapshot {
  readonly url: string;
  readonly data: unknown;
}

/**
 * Resolves the `runtime` backend, or `null` on any failure whatsoever --
 * including "no instance configured" (SPEC scenario "No instance
 * configured") and "a configured instance that does not respond" (SPEC
 * scenario "Instance unreachable at startup"). Both scenarios require the
 * SAME outcome here: startup must still succeed and `docs`/`schema` must
 * still serve, so this function never throws and never distinguishes the
 * two failure shapes in its return type -- only `null` vs a snapshot.
 */
export async function resolveRuntimeBackend(
  transport: RuntimeFetchLike,
  instance: RuntimeInstanceConfig | undefined,
  options: ResolveRuntimeOptions = {},
): Promise<RuntimeSnapshot | null> {
  if (instance === undefined) return null;

  let response: RuntimeHttpResponseLike;
  try {
    response = await transport(instance.url, {
      method: "GET",
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch {
    return null;
  }

  if (response.status < 200 || response.status >= 300) return null;

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return null;
  }

  return { url: instance.url, data };
}

export interface RuntimeSnapshotResponse {
  readonly available: true;
  readonly url: string;
  readonly data: unknown;
}

export interface RuntimeHandlers {
  readonly snapshot: () => RuntimeSnapshotResponse;
}

/** Builds the `runtime` handlers for one already-resolved snapshot (mirrors `schema.ts`'s `schemaHandlers`). */
export function runtimeHandlers(snapshot: RuntimeSnapshot): RuntimeHandlers {
  return {
    snapshot: () => ({ available: true, url: snapshot.url, data: snapshot.data }),
  };
}

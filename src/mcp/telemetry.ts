/**
 * `telemetry`: the local `(plugin, field, resolved)` sink (SPEC "Telemetry
 * is local, contentless, and opt-out"; design "Telemetry").
 *
 * Three rules, each load-bearing:
 *
 * - **Contentless.** Only `plugin`, `field`, `resolved` and a timestamp are
 *   ever written. No query text, argument value, or response body reaches
 *   this module -- callers (`server.ts`) never pass it any.
 * - **Opt-out at construction, not at each call site.** `--no-telemetry`
 *   produces a sink whose `record` is a no-op, rather than an
 *   `undefined`/optional-chained sink that every call site would need to
 *   remember to check. `server.ts` always calls `sink.record(...)`
 *   unconditionally; there is no `if` to forget (design "Telemetry":
 *   "an absent sink... so there is no path where a check is forgotten").
 * - **Bounded, oldest-first drop.** SPEC says local and opt-out; it does not
 *   say unbounded. A log that grows forever on a developer machine is a
 *   defect nobody reports (design "Telemetry").
 *
 * This is the composition edge for this concern (design "The one structural
 * decision"): it reads and writes a real file directly, following
 * `dataset.ts`'s precedent rather than taking an injected filesystem --
 * `telemetry.test.ts` exercises it against real temporary files, the same
 * choice `dataset.test.ts` made for the same reason (this module's entire
 * job IS the file).
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** ISO-8601. Injected so nothing in this module reads the real clock. */
export type Clock = () => string;

/** What a caller reports about one query -- never the query itself. */
export interface TelemetryEvent {
  readonly plugin: string;
  readonly field: string;
  readonly resolved: boolean;
}

export interface TelemetryRecord extends TelemetryEvent {
  readonly recordedAt: string;
}

export interface TelemetrySink {
  record(event: TelemetryEvent): Promise<void>;
}

/** Never bounded by anything else unless a caller passes a smaller value in tests. */
const DEFAULT_MAX_ENTRIES = 10_000;

export interface CreateTelemetrySinkOptions {
  readonly enabled: boolean;
  readonly path: string;
  readonly clock: Clock;
  readonly maxEntries?: number;
}

/** One JSONL line per record, oldest first -- `[]` when the file does not exist yet. */
export async function readTelemetryRecords(path: string): Promise<TelemetryRecord[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as TelemetryRecord);
}

async function writeTelemetryRecords(path: string, records: readonly TelemetryRecord[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const body = records.map((record) => JSON.stringify(record)).join("\n");
  await writeFile(path, body.length > 0 ? `${body}\n` : "", "utf8");
}

/** A sink whose `record` never writes anything -- the whole of `--no-telemetry`. */
const noopSink: TelemetrySink = {
  record: async () => {
    // Intentionally does nothing (SPEC "Opt-out writes nothing").
  },
};

/**
 * Builds the `telemetry` sink. `options.enabled === false` returns
 * `noopSink` -- an absent sink in behaviour, never in the caller's type, so
 * `server.ts` can call `.record(...)` unconditionally either way.
 */
export function createTelemetrySink(options: CreateTelemetrySinkOptions): TelemetrySink {
  if (!options.enabled) return noopSink;

  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;

  return {
    async record(event) {
      const existing = await readTelemetryRecords(options.path);
      const next = [...existing, { ...event, recordedAt: options.clock() }];
      // Oldest-first drop (design "Telemetry"): keep only the newest `maxEntries`.
      const bounded = next.length > maxEntries ? next.slice(next.length - maxEntries) : next;
      await writeTelemetryRecords(options.path, bounded);
    },
  };
}

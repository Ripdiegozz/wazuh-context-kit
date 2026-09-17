/**
 * `orderUnknownsByTelemetry` — the `/api/unknowns` work queue (SPEC "GET
 * /api/unknowns cola de trabajo, ordenada por telemetría (5.5)"; SPEC 5.5:
 * "`unknowns[]` deja de ser una lista alfabética y pasa a estar ordenada por
 * dolor real").
 *
 * Pure: takes `matrix.unknowns` and an already-read array of
 * `TelemetryRecord` (from `src/mcp/telemetry.ts`'s `readTelemetryRecords`)
 * and joins them by `(plugin, field)`. Never reads a file itself -- the
 * caller (`handlers.ts`) owns both reads.
 *
 * "Dolor real" (SPEC's own phrase) is read literally: an unknown queried 40
 * times and still unresolved every time is more urgent than one nobody has
 * asked about, so the primary sort key is the unresolved-query count, not the
 * alphabetical plugin name the un-ordered `matrix.json` array carries.
 */

import type { Unknown } from "../matrix/types.ts";
import type { TelemetryRecord } from "../mcp/telemetry.ts";

export interface UnknownWithTelemetry extends Unknown {
  readonly totalQueries: number;
  readonly unresolvedQueries: number;
}

function keyOf(plugin: string, field: string): string {
  return `${plugin}::${field}`;
}

export function orderUnknownsByTelemetry(
  unknowns: readonly Unknown[],
  records: readonly TelemetryRecord[],
): UnknownWithTelemetry[] {
  const totals = new Map<string, number>();
  const unresolved = new Map<string, number>();

  for (const record of records) {
    const key = keyOf(record.plugin, record.field);
    totals.set(key, (totals.get(key) ?? 0) + 1);
    if (!record.resolved) {
      unresolved.set(key, (unresolved.get(key) ?? 0) + 1);
    }
  }

  return [...unknowns]
    .map((unknown) => {
      const key = keyOf(unknown.plugin, unknown.field);
      return {
        ...unknown,
        totalQueries: totals.get(key) ?? 0,
        unresolvedQueries: unresolved.get(key) ?? 0,
      };
    })
    .sort((a, b) => {
      if (a.unresolvedQueries !== b.unresolvedQueries) {
        return b.unresolvedQueries - a.unresolvedQueries;
      }
      if (a.totalQueries !== b.totalQueries) {
        return b.totalQueries - a.totalQueries;
      }
      return (
        a.plugin.localeCompare(b.plugin) || a.field.localeCompare(b.field)
      );
    });
}

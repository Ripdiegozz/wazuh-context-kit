/**
 * Tests for `orderUnknownsByTelemetry` (SPEC 5.5: "`unknowns[]` deja de ser
 * una lista alfabética y pasa a estar ordenada por dolor real"; SPEC "GET
 * /api/unknowns cola de trabajo, ordenada por telemetría").
 *
 * Strict TDD: written before `unknowns.ts` exists.
 */

import { describe, expect, test } from "bun:test";
import type { TelemetryRecord } from "../mcp/telemetry.ts";
import type { Unknown } from "../matrix/types.ts";
import { orderUnknownsByTelemetry } from "./unknowns.ts";

function record(overrides: Partial<TelemetryRecord> = {}): TelemetryRecord {
  return {
    plugin: "securityAnalyticsDashboards",
    field: "indexerAccess",
    resolved: false,
    recordedAt: "2026-09-17T00:00:00.000Z",
    ...overrides,
  };
}

describe("orderUnknownsByTelemetry", () => {
  test("orders by unresolved query count, most-queried first (SPEC 5.5 example)", () => {
    const unknowns: Unknown[] = [
      { plugin: "quiet", field: "world", reason: "no manifest field" },
      {
        plugin: "securityAnalyticsDashboards",
        field: "indexerAccess",
        reason: "no manifest field",
      },
    ];

    const records: TelemetryRecord[] = [
      ...Array.from({ length: 40 }, () => record()),
      record({ plugin: "quiet", field: "world" }),
    ];

    const ordered = orderUnknownsByTelemetry(unknowns, records);

    expect(ordered[0]?.plugin).toBe("securityAnalyticsDashboards");
    expect(ordered[0]?.totalQueries).toBe(40);
    expect(ordered[0]?.unresolvedQueries).toBe(40);
    expect(ordered[1]?.plugin).toBe("quiet");
    expect(ordered[1]?.totalQueries).toBe(1);
  });

  test("an unknown with no matching telemetry sorts last, and reports zero counts", () => {
    const unknowns: Unknown[] = [
      { plugin: "neverQueried", field: "world", reason: "no manifest field" },
      { plugin: "hot", field: "world", reason: "no manifest field" },
    ];
    const records: TelemetryRecord[] = [record({ plugin: "hot", field: "world" })];

    const ordered = orderUnknownsByTelemetry(unknowns, records);

    expect(ordered[0]?.plugin).toBe("hot");
    expect(ordered[1]?.plugin).toBe("neverQueried");
    expect(ordered[1]?.totalQueries).toBe(0);
    expect(ordered[1]?.unresolvedQueries).toBe(0);
  });

  test("ties break alphabetically by plugin then field, for a deterministic order", () => {
    const unknowns: Unknown[] = [
      { plugin: "zeta", field: "world", reason: "x" },
      { plugin: "alpha", field: "world", reason: "x" },
    ];

    const ordered = orderUnknownsByTelemetry(unknowns, []);

    expect(ordered.map((u) => u.plugin)).toEqual(["alpha", "zeta"]);
  });

  test("a resolved query counts toward total but not toward unresolved", () => {
    const unknowns: Unknown[] = [{ plugin: "p", field: "world", reason: "x" }];
    const records: TelemetryRecord[] = [
      record({ plugin: "p", field: "world", resolved: true }),
      record({ plugin: "p", field: "world", resolved: true }),
    ];

    const ordered = orderUnknownsByTelemetry(unknowns, records);

    expect(ordered[0]?.totalQueries).toBe(2);
    expect(ordered[0]?.unresolvedQueries).toBe(0);
  });
});

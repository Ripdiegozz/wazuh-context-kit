/**
 * Tests for the local `(plugin, field, resolved)` telemetry sink (SPEC
 * "Telemetry is local, contentless, and opt-out"; design "Telemetry").
 *
 * Strict TDD: written before `telemetry.ts` exists, so the first `bun test`
 * run must fail on the import before anything is implemented.
 *
 * Real temporary files, following `dataset.test.ts`'s precedent -- this
 * module's whole job is a local file, so faking the filesystem would test
 * the fake instead of the sink.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTelemetrySink, readTelemetryRecords } from "./telemetry.ts";

const FIXED_NOW = "2026-09-17T00:00:00.000Z";
const clock = () => FIXED_NOW;

describe("createTelemetrySink", () => {
  test("6.8: records (plugin, field, resolved) with no query content", async () => {
    const root = await mkdtemp(join(tmpdir(), "wazuh-ctx-telemetry-"));
    const path = join(root, "telemetry.jsonl");
    try {
      const sink = createTelemetrySink({ enabled: true, path, clock });

      await sink.record({ plugin: "docs", field: "getting-started/index", resolved: true });

      const records = await readTelemetryRecords(path);
      expect(records).toHaveLength(1);
      expect(records[0]).toEqual({
        plugin: "docs",
        field: "getting-started/index",
        resolved: true,
        recordedAt: FIXED_NOW,
      });

      // No query CONTENT anywhere in the persisted line -- only the field
      // name/id, never a query string, argument value, or response body.
      const raw = await readFile(path, "utf8");
      expect(raw).not.toContain("SELECT");
      expect(raw).not.toContain("query");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("6.8: --no-telemetry (enabled: false) writes nothing", async () => {
    const root = await mkdtemp(join(tmpdir(), "wazuh-ctx-telemetry-off-"));
    const path = join(root, "telemetry.jsonl");
    try {
      const sink = createTelemetrySink({ enabled: false, path, clock });

      await sink.record({ plugin: "schema", field: "matrix", resolved: true });
      await sink.record({ plugin: "docs", field: "index", resolved: false });

      const exists = await readFile(path, "utf8").then(
        () => true,
        () => false,
      );
      expect(exists).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("6.8: the sink is bounded -- oldest entries drop first", async () => {
    const root = await mkdtemp(join(tmpdir(), "wazuh-ctx-telemetry-bound-"));
    const path = join(root, "telemetry.jsonl");
    try {
      const sink = createTelemetrySink({ enabled: true, path, clock, maxEntries: 3 });

      for (let i = 0; i < 5; i += 1) {
        await sink.record({ plugin: "docs", field: `page-${i}`, resolved: true });
      }

      const records = await readTelemetryRecords(path);
      expect(records).toHaveLength(3);
      // The two oldest (page-0, page-1) dropped; the three newest survive, in order.
      expect(records.map((r) => r.field)).toEqual(["page-2", "page-3", "page-4"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

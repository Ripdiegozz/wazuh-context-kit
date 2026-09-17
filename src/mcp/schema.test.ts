/**
 * Tests for the `schema` resource handlers (SPEC "schema serves the
 * published dataset without network"; "Every schema response carries its
 * provenance"; "A dataset older than 30 days warns on every response").
 *
 * These sit "directly, below the protocol boundary" (design "Testing splits
 * in two") -- plain functions over an already-loaded dataset and an injected
 * clock, no MCP transport involved. Protocol wiring is unit 6.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadDataset, type DatasetLoaded } from "./dataset.ts";
import { schemaHandlers } from "./schema.ts";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const REAL_OUT_ROOT = join(REPO_ROOT, "out");
const REF = "5.0.0";

async function loadRealDataset(): Promise<DatasetLoaded> {
  const result = await loadDataset(REAL_OUT_ROOT, REF);
  if (!result.ok) throw new Error("expected the committed dataset to load");
  return result;
}

describe("schemaHandlers", () => {
  test("4.4/4.6: every handler's response carries ref, payloadHash, resolvedAt", async () => {
    const loaded = await loadRealDataset();
    const clock = () => loaded.matrix.resolvedAt;
    const handlers = schemaHandlers(loaded, clock);

    for (const response of [
      handlers.matrix(),
      handlers.indexTemplates(),
      handlers.wcsModules(),
    ]) {
      expect(response.ref).toBe(loaded.matrix.ref);
      expect(response.payloadHash).toBe(loaded.matrix.payloadHash);
      expect(response.resolvedAt).toBe(loaded.matrix.resolvedAt);
    }
  });

  test("4.6: matrix() returns the full matrix as data", async () => {
    const loaded = await loadRealDataset();
    const handlers = schemaHandlers(loaded, () => loaded.matrix.resolvedAt);

    expect(handlers.matrix().data).toEqual(loaded.matrix);
  });

  test("4.6: indexTemplates() and wcsModules() return the indexer sub-sections", async () => {
    const loaded = await loadRealDataset();
    const handlers = schemaHandlers(loaded, () => loaded.matrix.resolvedAt);

    expect(handlers.indexTemplates().data).toEqual(loaded.matrix.indexer.templates);
    expect(handlers.wcsModules().data).toEqual(loaded.matrix.indexer.wcsModules);
  });

  test("4.5: a stale dataset carries the staleness warning on every handler", async () => {
    const loaded = await loadRealDataset();
    const resolvedAtMs = Date.parse(loaded.matrix.resolvedAt);
    const fortyDaysLater = () =>
      new Date(resolvedAtMs + 40 * 24 * 60 * 60 * 1000).toISOString();
    const handlers = schemaHandlers(loaded, fortyDaysLater);

    expect(handlers.matrix().stalenessWarning).toBeDefined();
    expect(handlers.indexTemplates().stalenessWarning).toBeDefined();
    expect(handlers.wcsModules().stalenessWarning).toBeDefined();
  });

  test("4.5: a fresh dataset (29 days) carries no staleness warning", async () => {
    const loaded = await loadRealDataset();
    const resolvedAtMs = Date.parse(loaded.matrix.resolvedAt);
    const twentyNineDaysLater = () =>
      new Date(resolvedAtMs + 29 * 24 * 60 * 60 * 1000).toISOString();
    const handlers = schemaHandlers(loaded, twentyNineDaysLater);

    expect(handlers.matrix().stalenessWarning).toBeUndefined();
  });
});

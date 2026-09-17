/**
 * Tests for `schema`'s dataset loader (SPEC "schema serves the published
 * dataset without network"; "schema refuses to start on a dataset whose hash
 * does not validate"; "Every schema response carries its provenance"; "A
 * dataset older than 30 days warns on every response").
 *
 * Strict TDD: this file is written before `dataset.ts` exists, so the very
 * first run of `bun test` must fail on the import before anything is
 * implemented.
 *
 * No network anywhere in this file -- SPEC's whole point for `schema`.
 */

import { describe, expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadDataset,
  provenanceFor,
  STALE_AFTER_MS,
  type DatasetLoaded,
} from "./dataset.ts";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const REAL_OUT_ROOT = join(REPO_ROOT, "out");
const REF = "5.0.0";

describe("loadDataset", () => {
  test("4.1: loads out/<ref>/matrix.json from the committed dataset, no network", async () => {
    const result = await loadDataset(REAL_OUT_ROOT, REF);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected load to succeed");
    expect(result.matrix.ref).toBe(REF);
    expect(result.matrix.payloadHash).toStartWith("sha256:");
  });

  test("4.2: a matrix.json with one byte altered refuses, naming expected and actual hashes", async () => {
    // Built by copying the real dataset and mutating a byte -- never a
    // hand-written fake matrix, so the assertion is about the real shape.
    const tmpRoot = await mkdtemp(join(tmpdir(), "wazuh-ctx-mcp-dataset-"));
    try {
      const datasetDir = join(tmpRoot, REF);
      await cp(join(REAL_OUT_ROOT, REF), datasetDir, { recursive: true });

      const matrixPath = join(datasetDir, "matrix.json");
      const original = await readFile(matrixPath, "utf8");

      // Flip one character inside a plugin id -- guaranteed to exist and to
      // change the canonicalised payload without breaking JSON.parse.
      const marker = '"pluginId"';
      const index = original.indexOf(marker);
      expect(index).toBeGreaterThan(-1);
      const valueStart = original.indexOf('"', index + marker.length + 1) + 1;
      const mutated =
        original.slice(0, valueStart) + "X" + original.slice(valueStart + 1);
      expect(mutated).not.toBe(original);
      await writeFile(matrixPath, mutated, "utf8");

      const result = await loadDataset(tmpRoot, REF);

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected load to refuse");
      expect(result.reason).toBe("hash-mismatch");
      if (result.reason !== "hash-mismatch") throw new Error("unreachable");
      expect(result.expected).toStartWith("sha256:");
      expect(result.actual).toStartWith("sha256:");
      expect(result.expected).not.toBe(result.actual);
      expect(result.message).toContain(result.expected);
      expect(result.message).toContain(result.actual);
    } finally {
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });

  test("4.3: an absent dataset refuses, naming the path", async () => {
    const tmpRoot = await mkdtemp(join(tmpdir(), "wazuh-ctx-mcp-dataset-absent-"));
    try {
      const result = await loadDataset(tmpRoot, "9.9.9");

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected load to refuse");
      expect(result.reason).toBe("absent");
      const expectedPath = join(tmpRoot, "9.9.9", "matrix.json");
      expect(result.path).toBe(expectedPath);
      expect(result.message).toContain(expectedPath);
    } finally {
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });
});

describe("provenanceFor", () => {
  async function loadRealDataset(): Promise<DatasetLoaded> {
    const result = await loadDataset(REAL_OUT_ROOT, REF);
    if (!result.ok) throw new Error("expected the committed dataset to load");
    return result;
  }

  test("4.4: every response carries ref, payloadHash and resolvedAt", async () => {
    const loaded = await loadRealDataset();
    const clock = () => loaded.matrix.resolvedAt; // frozen, right at resolvedAt

    const provenance = provenanceFor(loaded.matrix, clock);

    expect(provenance.ref).toBe(loaded.matrix.ref);
    expect(provenance.payloadHash).toBe(loaded.matrix.payloadHash);
    expect(provenance.resolvedAt).toBe(loaded.matrix.resolvedAt);
  });

  test("4.5: resolvedAt 40 days old warns; 29 days does not. Clock is injected.", async () => {
    const loaded = await loadRealDataset();
    const resolvedAtMs = Date.parse(loaded.matrix.resolvedAt);
    const dayMs = 24 * 60 * 60 * 1000;

    const fortyDaysLater = () => new Date(resolvedAtMs + 40 * dayMs).toISOString();
    const twentyNineDaysLater = () => new Date(resolvedAtMs + 29 * dayMs).toISOString();

    const stale = provenanceFor(loaded.matrix, fortyDaysLater);
    expect(stale.stalenessWarning).toBeDefined();
    expect(stale.stalenessWarning).toContain("40");

    const fresh = provenanceFor(loaded.matrix, twentyNineDaysLater);
    expect(fresh.stalenessWarning).toBeUndefined();

    // Sanity: the 30-day boundary this test relies on matches the exported
    // constant, not a re-derived literal.
    expect(STALE_AFTER_MS).toBe(30 * dayMs);
  });
});

/**
 * Tests for the one chokepoint every write in `src/serve/` must pass through
 * (SPEC 1.5.3 criterion 1: "La UI no escribe fuera de decisions.yml,
 * annotations.yml y decisions.local.yml").
 *
 * Strict TDD: written before `write-guard.ts` exists, so the first `bun test`
 * run fails on the import.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertAllowedWrite, WriteRefused } from "./write-guard.ts";

describe("assertAllowedWrite", () => {
  test("allows decisions.yml, annotations.yml, decisions.local.yml", async () => {
    const root = await mkdtemp(join(tmpdir(), "wazuh-ctx-serve-guard-"));
    try {
      expect(assertAllowedWrite(root, "decisions.yml")).toBe(join(root, "decisions.yml"));
      expect(assertAllowedWrite(root, "annotations.yml")).toBe(join(root, "annotations.yml"));
      expect(assertAllowedWrite(root, "decisions.local.yml")).toBe(
        join(root, "decisions.local.yml"),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("refuses matrix.json", async () => {
    const root = await mkdtemp(join(tmpdir(), "wazuh-ctx-serve-guard-"));
    try {
      expect(() => assertAllowedWrite(root, "matrix.json")).toThrow(WriteRefused);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("refuses out/5.0.0/matrix.json", async () => {
    const root = await mkdtemp(join(tmpdir(), "wazuh-ctx-serve-guard-"));
    try {
      expect(() => assertAllowedWrite(root, "out/5.0.0/matrix.json")).toThrow(WriteRefused);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("refuses sources.yml", async () => {
    const root = await mkdtemp(join(tmpdir(), "wazuh-ctx-serve-guard-"));
    try {
      expect(() => assertAllowedWrite(root, "sources.yml")).toThrow(WriteRefused);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("refuses a path-traversal attempt, compared AFTER normalization", async () => {
    const root = await mkdtemp(join(tmpdir(), "wazuh-ctx-serve-guard-"));
    try {
      expect(() => assertAllowedWrite(root, "../../etc/passwd")).toThrow(WriteRefused);
      // Also refuses a traversal that LOOKS like it resolves to an allowed
      // name after enough ".." segments -- normalization must not be fooled
      // by a path that happens to end in "decisions.yml".
      expect(() => assertAllowedWrite(root, "../decisions.yml")).toThrow(WriteRefused);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("refuses an absolute path outside root even if it names an allowed filename", async () => {
    const root = await mkdtemp(join(tmpdir(), "wazuh-ctx-serve-guard-"));
    const other = await mkdtemp(join(tmpdir(), "wazuh-ctx-serve-guard-other-"));
    try {
      const outsideDecisions = join(other, "decisions.yml");
      expect(() => assertAllowedWrite(root, outsideDecisions)).toThrow(WriteRefused);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(other, { recursive: true, force: true });
    }
  });
});

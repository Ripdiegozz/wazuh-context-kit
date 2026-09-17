/**
 * Tests for `diffEntries` (SPEC 1.5.1: "El botón de guardar no muta estado:
 * produce un diff para commitear" / SPEC 1.5.3 criterion 4: "Guardar produce
 * un diff YAML mostrado al usuario antes de escribir").
 *
 * The diff is computed over PARSED structures (the same `Decision[]` /
 * `Annotation[]` shapes `src/decisions/schema.ts` already validates), never
 * over raw YAML text -- so these tests build plain arrays, not strings.
 *
 * Strict TDD: written before `yaml-diff.ts` exists.
 */

import { describe, expect, test } from "bun:test";
import type { Decision } from "../decisions/schema.ts";
import { diffEntries } from "./yaml-diff.ts";

function decision(overrides: Partial<Decision> = {}): Decision {
  return {
    plugin: "wazuhCheck",
    field: "world",
    value: "wazuh-native",
    author: "diego.garcia@wazuh.com",
    date: "2026-09-17",
    reason: "manifest is silent on this",
    status: "active",
    ...overrides,
  };
}

describe("diffEntries", () => {
  test("reports an entry present only in `proposed` as added", () => {
    const existing: Decision[] = [];
    const proposed: Decision[] = [decision()];

    const diff = diffEntries(existing, proposed, (d) => `${d.plugin}::${d.field}`);

    expect(diff.added).toEqual([decision()]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
  });

  test("reports an entry present only in `existing` as removed", () => {
    const existing: Decision[] = [decision()];
    const proposed: Decision[] = [];

    const diff = diffEntries(existing, proposed, (d) => `${d.plugin}::${d.field}`);

    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([decision()]);
    expect(diff.changed).toEqual([]);
  });

  test("reports an entry present in both, with a different value, as changed", () => {
    const existing: Decision[] = [decision({ value: "unknown" })];
    const proposed: Decision[] = [decision({ value: "wazuh-native" })];

    const diff = diffEntries(existing, proposed, (d) => `${d.plugin}::${d.field}`);

    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([
      {
        key: "wazuhCheck::world",
        before: decision({ value: "unknown" }),
        after: decision({ value: "wazuh-native" }),
      },
    ]);
  });

  test("an entry present in both, byte-identical, is neither added, removed, nor changed", () => {
    const existing: Decision[] = [decision()];
    const proposed: Decision[] = [decision()];

    const diff = diffEntries(existing, proposed, (d) => `${d.plugin}::${d.field}`);

    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
  });

  test("empty diff has no summary lines", () => {
    const diff = diffEntries<Decision>([], [], (d) => `${d.plugin}::${d.field}`);
    expect(formatDiffLines(diff)).toEqual([]);
  });
});

// Imported lazily below to keep the "no summary lines" test self-contained
// about what it exercises.
import { formatDiffLines } from "./yaml-diff.ts";

describe("formatDiffLines", () => {
  test("names added, changed, and removed entries by key", () => {
    const diff = diffEntries<Decision>(
      [decision({ plugin: "a", value: "unknown" }), decision({ plugin: "removedOne" })],
      [decision({ plugin: "a", value: "wazuh-native" }), decision({ plugin: "addedOne" })],
      (d) => d.plugin,
    );

    const lines = formatDiffLines(diff);
    expect(lines).toContain("+ addedOne");
    expect(lines).toContain("~ a");
    expect(lines).toContain("- removedOne");
  });
});

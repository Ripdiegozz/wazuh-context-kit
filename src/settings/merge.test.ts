/**
 * `mergeSettings` — tasks 1.1–1.10.
 *
 * Every input here is a literal `SettingsVariant[]`, never a fixture file —
 * the standing rule earned six times: no test in the pure layer may assert
 * against a fixture written from the same understanding as the code.
 *
 * `exploration.md` measured the real corpus as purely additive with zero
 * conflicts, so the conflict-producing tests below (1.3, 1.4) are exactly
 * the "constructed cases, not real data" the proposal warns is this
 * change's biggest risk. `randomTrial` at the bottom exists for the same
 * reason `tasks.md` asks for it: hand-written cases have missed real bugs
 * twice before, and a small seeded generator over MANY additive-only shapes
 * checks invariants no single literal can — without adding a dependency.
 */

import { describe, expect, test } from "bun:test";
import { mergeSettings } from "./merge.ts";
import type { SettingsTree, SettingsVariant } from "./types.ts";

function variant(repo: string, settings: SettingsTree): SettingsVariant {
  return { repo, settings };
}

describe("a leaf value present in every variant (task 1.1)", () => {
  test("lands in the core and in no override", () => {
    const variants = [
      variant("wazuh-dashboard", { permissions: { allow: ["Bash(git status:*)", "Bash(git diff:*)"] } }),
      variant("wazuh-indexer-plugins", { permissions: { allow: ["Bash(git status:*)", "Bash(git diff:*)"] } }),
      variant("wazuh-security-dashboards-plugin", {
        permissions: { allow: ["Bash(git status:*)", "Bash(git diff:*)"] },
      }),
    ];

    const merged = mergeSettings(variants);

    expect(merged.core).toEqual({ permissions: { allow: ["Bash(git diff:*)", "Bash(git status:*)"] } });
    for (const repo of variants.map((v) => v.repo)) expect(merged.overrides.get(repo)).toEqual([]);
    expect(merged.conflicts).toEqual([]);
  });
});

describe("a list entry present in some variants (task 1.2)", () => {
  test("is an override for those, absent from the core", () => {
    const variants = [
      variant("wazuh-dashboard", { permissions: { allow: ["Bash(git status:*)", "Bash(yarn typecheck)"] } }),
      variant("wazuh-indexer-plugins", { permissions: { allow: ["Bash(git status:*)"] } }),
      variant("reporting", { permissions: { allow: ["Bash(git status:*)", "Bash(yarn lint)"] } }),
    ];

    const merged = mergeSettings(variants);

    expect(merged.core).toEqual({ permissions: { allow: ["Bash(git status:*)"] } });
    expect(merged.overrides.get("wazuh-dashboard")).toEqual([
      { path: ["permissions", "allow"], value: "Bash(yarn typecheck)" },
    ]);
    expect(merged.overrides.get("wazuh-indexer-plugins")).toEqual([]);
    expect(merged.overrides.get("reporting")).toEqual([{ path: ["permissions", "allow"], value: "Bash(yarn lint)" }]);
    expect(merged.conflicts).toEqual([]);
  });
});

describe("a list entry present in all but one repository — the removal case (task 1.3)", () => {
  test("is a conflict naming the value and the repository lacking it, never an override", () => {
    const variants = [
      variant("a", { permissions: { allow: ["Bash(git status:*)", "Bash(yarn test)"] } }),
      variant("b", { permissions: { allow: ["Bash(git status:*)", "Bash(yarn test)"] } }),
      variant("c", { permissions: { allow: ["Bash(git status:*)"] } }),
    ];

    const merged = mergeSettings(variants);

    expect(merged.conflicts).toEqual([
      { kind: "removed-from-core", path: ["permissions", "allow"], value: "Bash(yarn test)", missingFrom: "c" },
    ]);
    // Never emitted as an override for anybody — not even the two repos
    // that still carry it.
    expect(merged.overrides.get("a")).toEqual([]);
    expect(merged.overrides.get("b")).toEqual([]);
    expect(merged.overrides.get("c")).toEqual([]);
    expect(merged.core).toEqual({ permissions: { allow: ["Bash(git status:*)"] } });
  });
});

describe("a scalar differing between variants (task 1.4)", () => {
  test("is a conflict carrying every variant and its value, with none selected", () => {
    const variants = [
      variant("a", { $schema: "https://json.schemastore.org/claude-code-settings.json" }),
      variant("b", { $schema: "https://json.schemastore.org/claude-code-settings-v2.json" }),
    ];

    const merged = mergeSettings(variants);

    expect(merged.conflicts).toEqual([
      {
        kind: "scalar-disagreement",
        path: ["$schema"],
        variants: [
          { repo: "a", value: "https://json.schemastore.org/claude-code-settings.json" },
          { repo: "b", value: "https://json.schemastore.org/claude-code-settings-v2.json" },
        ],
      },
    ]);
    // No value was picked — the leaf simply does not appear in the core.
    expect(merged.core).toEqual({});
  });
});

describe("two repos adding different entries to the same list (task 1.5)", () => {
  test("both are overrides and neither is reported as a conflict", () => {
    const variants = [
      variant("a", { permissions: { allow: ["Bash(git status:*)", "Bash(yarn cypress)"] } }),
      variant("b", { permissions: { allow: ["Bash(git status:*)", "Bash(yarn knip)"] } }),
      variant("c", { permissions: { allow: ["Bash(git status:*)"] } }),
    ];

    const merged = mergeSettings(variants);

    expect(merged.conflicts).toEqual([]);
    expect(merged.overrides.get("a")).toEqual([{ path: ["permissions", "allow"], value: "Bash(yarn cypress)" }]);
    expect(merged.overrides.get("b")).toEqual([{ path: ["permissions", "allow"], value: "Bash(yarn knip)" }]);
    expect(merged.overrides.get("c")).toEqual([]);
  });
});

describe("the `n - 1` threshold has a floor (task 1.6)", () => {
  test("with two variants, asymmetry is an addition, not a removal", () => {
    const variants = [
      variant("a", { permissions: { allow: ["Bash(git status:*)", "Bash(yarn test)"] } }),
      variant("b", { permissions: { allow: ["Bash(git status:*)"] } }),
    ];

    const merged = mergeSettings(variants);

    // Without the floor, "present in 1 of 2" satisfies `n - 1` and this
    // would wrongly become a `removed-from-core` conflict for `b`.
    expect(merged.conflicts).toEqual([]);
    expect(merged.overrides.get("a")).toEqual([{ path: ["permissions", "allow"], value: "Bash(yarn test)" }]);
    expect(merged.overrides.get("b")).toEqual([]);
    expect(merged.core).toEqual({ permissions: { allow: ["Bash(git status:*)"] } });
  });
});

describe("leaf paths are walked, not objects (task 1.7)", () => {
  test("a difference nested inside an object is reported at its leaf, not at the top", () => {
    const variants = [
      variant("a", { permissions: { allow: ["x"], deny: [] } }),
      variant("b", { permissions: { allow: ["x", "y"], deny: [] } }),
      variant("c", { permissions: { allow: ["x"], deny: [] } }),
    ];

    const merged = mergeSettings(variants);

    // `permissions.deny` is identical everywhere and stays whole in the
    // core; `permissions.allow` is judged entry by entry, independently —
    // a whole-object comparison would have reported the entire `permissions`
    // object as diverging because ONE of its two leaves differs.
    expect(merged.core).toEqual({ permissions: { allow: ["x"], deny: [] } });
    expect(merged.overrides.get("b")).toEqual([{ path: ["permissions", "allow"], value: "y" }]);
    expect(merged.overrides.get("a")).toEqual([]);
    expect(merged.overrides.get("c")).toEqual([]);
    expect(merged.conflicts).toEqual([]);
  });
});

describe("duplicate entries within one variant (task 1.8)", () => {
  test("are reported, not silently deduplicated", () => {
    const variants = [
      variant("a", { permissions: { allow: ["Bash(git status:*)", "Bash(git status:*)"] } }),
      variant("b", { permissions: { allow: ["Bash(git status:*)"] } }),
      variant("c", { permissions: { allow: ["Bash(git status:*)"] } }),
    ];

    const merged = mergeSettings(variants);

    expect(merged.duplicates).toEqual([
      { path: ["permissions", "allow"], repo: "a", value: "Bash(git status:*)", count: 2 },
    ]);
    // Membership is still computed correctly — the duplicate does not make
    // the entry look "more common" or break the core.
    expect(merged.core).toEqual({ permissions: { allow: ["Bash(git status:*)"] } });
    expect(merged.conflicts).toEqual([]);
  });
});

describe("entries differing only by whitespace (task 1.9)", () => {
  test("are different entries — no normalisation", () => {
    const variants = [
      variant("a", { permissions: { allow: ["Bash(yarn test)"] } }),
      variant("b", { permissions: { allow: ["Bash(yarn test )"] } }),
      variant("c", { permissions: { allow: [] } }),
    ];

    const merged = mergeSettings(variants);

    // Neither string is common (they are not byte-equal), so both are
    // overrides for their own repo, never merged into one core entry and
    // never treated as a removal of the other.
    expect(merged.core).toEqual({ permissions: { allow: [] } });
    expect(merged.overrides.get("a")).toEqual([{ path: ["permissions", "allow"], value: "Bash(yarn test)" }]);
    expect(merged.overrides.get("b")).toEqual([{ path: ["permissions", "allow"], value: "Bash(yarn test )" }]);
    expect(merged.conflicts).toEqual([]);
  });
});

/** A tiny seeded PRNG (mulberry32) — deterministic and dependency-free, so a
 * failing run is reproducible from the printed seed without pulling in a
 * property-testing library this project does not otherwise depend on. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(rng: () => number, items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

// Sized so the worst case (4 common + 6 repos x 2 additions = 16) always
// fits without any two repos ever drawing the same pool entry.
const CANDIDATE_ENTRIES = Array.from({ length: 20 }, (_, i) => `Bash(entry-${i}:*)`);

/**
 * Builds a random ADDITIVE-ONLY scenario — a random common set (present in
 * every variant) plus random per-repo additions drawn from DISJOINT slices
 * of the remaining pool, mirroring the real corpus's measured shape
 * (design's "no repository removes a common entry"). Disjoint slices matter:
 * two repos coincidentally drawing the SAME addition would make that entry
 * present in more than one but fewer than all variants, which is exactly
 * the shape `mergeSettings` is specified to treat as a possible removal
 * (task 1.3) — a correct merge does NOT owe this generator zero conflicts
 * unless the generator itself never produces that shape.
 */
function randomAdditiveScenario(rng: () => number): { readonly variants: SettingsVariant[]; readonly common: string[] } {
  const repoCount = 3 + Math.floor(rng() * 4); // 3..6 repos
  const repos = Array.from({ length: repoCount }, (_, i) => `repo-${i}`);

  const pool = shuffled(rng, CANDIDATE_ENTRIES);
  const commonCount = 1 + Math.floor(rng() * 4);
  const common = pool.slice(0, commonCount);

  let cursor = commonCount;
  const variants = repos.map((repo) => {
    const additionCount = Math.floor(rng() * 3);
    const additions = pool.slice(cursor, cursor + additionCount);
    cursor += additionCount;
    return variant(repo, { permissions: { allow: [...common, ...additions] } });
  });

  return { variants, common };
}

describe("randomised trial: additive-only corpora never produce a conflict (design's caution)", () => {
  test("100 random additive-only scenarios each report zero conflicts and a correct core", () => {
    const rng = mulberry32(20260917);

    for (let trial = 0; trial < 100; trial++) {
      const { variants, common } = randomAdditiveScenario(rng);
      const merged = mergeSettings(variants);

      if (merged.conflicts.length !== 0) {
        throw new Error(
          `trial ${trial}: additive-only input produced a conflict — ${JSON.stringify(merged.conflicts)} ` +
            `for variants ${JSON.stringify(variants)}`,
        );
      }

      const coreAllow = (merged.core["permissions"] as { allow?: readonly string[] } | undefined)?.allow ?? [];
      const expectedCore = [...new Set(common)].sort((a, b) => a.localeCompare(b));
      if (JSON.stringify(coreAllow) !== JSON.stringify(expectedCore)) {
        throw new Error(
          `trial ${trial}: expected core ${JSON.stringify(expectedCore)}, got ${JSON.stringify(coreAllow)} ` +
            `for variants ${JSON.stringify(variants)}`,
        );
      }

      // Every override belongs to a repo that actually carries that entry,
      // and never repeats an entry already in the core.
      for (const [repo, ops] of merged.overrides) {
        const original = variants.find((v) => v.repo === repo)!;
        const originalAllow = (original.settings["permissions"] as { allow: readonly string[] }).allow;
        for (const op of ops) {
          if (!originalAllow.includes(op.value)) {
            throw new Error(`trial ${trial}: override '${op.value}' for '${repo}' was never in its own input`);
          }
          if (expectedCore.includes(op.value)) {
            throw new Error(`trial ${trial}: override '${op.value}' for '${repo}' duplicates a core entry`);
          }
        }
      }
    }
  });
});

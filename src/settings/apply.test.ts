/**
 * `applySettings` — tasks 2.1–2.5, the inverse of `mergeSettings` for one
 * repository.
 *
 * `apply.ts` exists to PROVE `merge.ts` correct, the same argument
 * `skills/reconstruct.ts`'s docblock makes for its own package: two
 * independent transformations — partitioning into core/overrides/conflicts,
 * then replaying core plus one repo's overrides — composing to the identity
 * is an assertion no fixture can agree with (task 2.1's load-bearing round
 * trip). Every input here is a literal, never a fixture file.
 */

import { describe, expect, test } from "bun:test";
import { applySettings } from "./apply.ts";
import { mergeSettings } from "./merge.ts";
import type { SettingsTree, SettingsVariant } from "./types.ts";

function variant(repo: string, settings: SettingsTree): SettingsVariant {
  return { repo, settings };
}

describe("the round trip (task 2.1) — the load-bearing test", () => {
  test("apply(merge(x)) == x, value for value, for a purely additive corpus", () => {
    // Shaped like the real corpus (exploration.md): a $schema scalar
    // identical everywhere, and `permissions.allow` with a shared core plus
    // per-repo additions. List entries are written here already in the
    // sorted order `mergeSettings` produces (design decision 5), which is
    // what makes byte-for-byte equality meaningful for a literal rather
    // than accidental.
    const schema = "https://json.schemastore.org/claude-code-settings.json";
    const original: Record<string, SettingsTree> = {
      "wazuh-dashboard": {
        $schema: schema,
        permissions: {
          allow: ["Bash(git diff:*)", "Bash(git status:*)", "Bash(yarn test:jest_integration)", "Bash(yarn typecheck)"],
          deny: [],
          ask: [],
        },
      },
      "wazuh-dashboard-plugins": {
        $schema: schema,
        permissions: {
          allow: ["Bash(git diff:*)", "Bash(git status:*)", "Bash(yarn format)", "Bash(yarn knip)"],
          deny: [],
          ask: [],
        },
      },
      "reporting": {
        $schema: schema,
        permissions: {
          allow: ["Bash(git diff:*)", "Bash(git status:*)", "Bash(yarn test)"],
          deny: [],
          ask: [],
        },
      },
    };

    const variants = Object.entries(original).map(([repo, settings]) => variant(repo, settings));
    const merged = mergeSettings(variants);

    for (const [repo, expected] of Object.entries(original)) {
      expect(applySettings(merged, repo)).toEqual(expected);
    }
  });

  test("apply(merge(x)) == x when there is nothing to override at all", () => {
    const settings: SettingsTree = { $schema: "s", permissions: { allow: ["Bash(git status:*)"], deny: [], ask: [] } };
    const variants = [variant("a", settings), variant("b", settings)];

    const merged = mergeSettings(variants);

    expect(applySettings(merged, "a")).toEqual(settings);
    expect(applySettings(merged, "b")).toEqual(settings);
  });
});

describe("repository processing order does not change the core or any override (task 2.2)", () => {
  test("running the same input in two orders produces identical merges", () => {
    const a = variant("a", { permissions: { allow: ["x", "y", "z"] } });
    const b = variant("b", { permissions: { allow: ["x", "y"] } });
    const c = variant("c", { permissions: { allow: ["x", "w"] } });

    const forward = mergeSettings([a, b, c]);
    const reversed = mergeSettings([c, b, a]);
    const shuffled = mergeSettings([b, c, a]);

    for (const repo of ["a", "b", "c"]) {
      expect(applySettings(forward, repo)).toEqual(applySettings(reversed, repo));
      expect(applySettings(forward, repo)).toEqual(applySettings(shuffled, repo));
    }
    expect(forward.core).toEqual(reversed.core);
    expect(forward.core).toEqual(shuffled.core);
  });
});

describe("list entries are emitted sorted (task 2.3)", () => {
  test("output does not depend on which repo contributed an entry", () => {
    const variants = [
      variant("z-repo", { permissions: { allow: ["Bash(yarn zzz)"] } }),
      variant("a-repo", { permissions: { allow: ["Bash(yarn aaa)"] } }),
    ];

    const merged = mergeSettings(variants);
    const applied = applySettings(merged, "z-repo") as { permissions: { allow: string[] } };

    // `z-repo` contributed the FIRST entry in input order, but the
    // reconstructed list is alphabetical, not insertion-order.
    expect(applied.permissions.allow).toEqual(["Bash(yarn zzz)"]);
  });

  test("two variants swapped in input order still produce the same sorted override list", () => {
    const repoA = variant("repo-a", { permissions: { allow: ["Bash(m)", "Bash(a)", "Bash(z)"] } });

    const merged1 = mergeSettings([repoA, variant("repo-b", { permissions: { allow: [] } })]);
    const merged2 = mergeSettings([variant("repo-b", { permissions: { allow: [] } }), repoA]);

    expect(applySettings(merged1, "repo-a")).toEqual(applySettings(merged2, "repo-a"));
    const applied = applySettings(merged1, "repo-a") as { permissions: { allow: string[] } };
    expect(applied.permissions.allow).toEqual(["Bash(a)", "Bash(m)", "Bash(z)"]);
  });
});

/** Same seeded PRNG as `merge.test.ts` — duplicated deliberately, so each
 * test file stays self-contained (no shared fixture module for the pure
 * layer to disagree with). */
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

function shuffledArray<T>(rng: () => number, items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

const CANDIDATE_ENTRIES = Array.from({ length: 20 }, (_, i) => `Bash(entry-${i}:*)`);

describe("randomised trial: round trip holds across many additive-only corpora", () => {
  test("100 random scenarios each satisfy apply(merge(x)) == x for every repo", () => {
    const rng = mulberry32(20260917);

    for (let trial = 0; trial < 100; trial++) {
      const repoCount = 3 + Math.floor(rng() * 4);
      const repos = Array.from({ length: repoCount }, (_, i) => `repo-${i}`);
      const pool = shuffledArray(rng, CANDIDATE_ENTRIES);
      const commonCount = 1 + Math.floor(rng() * 4);
      const common = [...pool.slice(0, commonCount)].sort((x, y) => x.localeCompare(y));

      let cursor = commonCount;
      const originals = new Map<string, SettingsTree>();
      for (const repo of repos) {
        const additionCount = Math.floor(rng() * 3);
        const additions = [...pool.slice(cursor, cursor + additionCount)].sort((x, y) => x.localeCompare(y));
        cursor += additionCount;
        // Entries are constructed pre-sorted (common first, in order, then
        // this repo's own sorted additions) — exactly the order
        // `mergeSettings`/`applySettings` reconstruct in, so the trial
        // proves the round trip rather than merely a set-equality.
        const merged = [...common, ...additions].sort((x, y) => x.localeCompare(y));
        originals.set(repo, { permissions: { allow: merged } });
      }

      const variantList = [...originals.entries()].map(([repo, settings]) => variant(repo, settings));
      const mergedSettings = mergeSettings(variantList);

      for (const [repo, expected] of originals) {
        const actual = applySettings(mergedSettings, repo);
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          throw new Error(
            `trial ${trial}: round trip failed for '${repo}' — expected ${JSON.stringify(expected)}, ` +
              `got ${JSON.stringify(actual)}`,
          );
        }
      }
    }
  });
});

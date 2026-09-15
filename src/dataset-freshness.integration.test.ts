/**
 * Opt-in guard: the committed dataset must match a real run (SPEC 5.1;
 * matrix-pipeline delta requirement 4).
 *
 * `out/` is the product. It once shipped carrying the `--fixtures` output
 * instead of the real one — 5 plugins instead of 9, 0 index templates instead
 * of 20 — and nothing caught it, because the only test that pins a payload
 * hash pins the fixtures hash, correctly. Comparing the committed product
 * against reality needs network, which is why this lives behind the same
 * `WAZUH_CTX_NETWORK=1` gate as the other integration suite.
 *
 * Lives at `src/` rather than `src/matrix/` on purpose: it spans fetch, parse
 * and matrix, and `src/matrix/` is the pure core (SPEC 6.1). Grepping that
 * directory for `node:fs` must return nothing, test files included.
 *
 * Honest limit: this guard only fails once somebody runs it with network. It
 * does not make a stale commit impossible; it makes one detectable by a
 * command that exists. Wiring it into the SPEC 5.4 regeneration workflow is
 * what would close the loop, and that workflow is still unwritten.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadHumanLayers } from "./decisions/load.ts";
import { createFetchIo } from "./fetch/git-runner.ts";
import { fetchRepos } from "./fetch/index.ts";
import { parseFetchedRepos, toParseTargets } from "./parse/index.ts";
import { loadSources } from "./sources.ts";
import { buildMatrix } from "./matrix/build.ts";

const NETWORK_ENABLED = process.env.WAZUH_CTX_NETWORK === "1";
const maybeTest = NETWORK_ENABLED ? test : test.skip;

const REPO_ROOT = join(import.meta.dir, "..");
const REF = "5.0.0";

describe("the committed dataset matches a real run", () => {
  maybeTest(
    `out/${REF} carries the payload hash a real run produces`,
    async () => {
      const cacheRoot = await mkdtemp(join(tmpdir(), "wazuh-ctx-freshness-"));

      try {
        const sources = await loadSources(REPO_ROOT);
        const layers = await loadHumanLayers(REPO_ROOT);
        const io = createFetchIo();

        const fetched = await fetchRepos({
          repos: sources.repos,
          ref: REF,
          cacheRoot,
          refresh: false,
          io,
        });
        const parsed = await parseFetchedRepos(toParseTargets(sources, fetched.fetched));

        const committedRaw = await readFile(join(REPO_ROOT, "out", REF, "matrix.json"), "utf8");
        const committed = JSON.parse(committedRaw) as {
          payloadHash: string;
          resolvedAt: string;
          resolvedRefs: Record<string, string>;
          plugins: unknown[];
          core?: unknown[];
          indexer: { templates: unknown[]; wcsModules: unknown[] };
        };

        const freshRefs = Object.fromEntries(fetched.fetched.map((f) => [f.repo, f.commit]));

        // `resolvedAt` is taken from the committed file rather than pinned to
        // an arbitrary instant. It sits inside the hashed payload, so using the
        // committed value is what makes a hash comparison meaningful at all —
        // any difference that survives is a difference in content.
        const fresh = buildMatrix({
          decisions: layers.decisions,
          annotations: layers.annotations,
          ref: REF,
          facts: parsed.facts,
          coreRepos: parsed.coreRepos,
          templates: parsed.templates,
          wcsModules: parsed.wcsModules,
          resolvedRefs: freshRefs,
          resolvedAt: committed.resolvedAt,
          generatedAt: "1970-01-01T00:00:00Z",
          tool: "wazuh-ctx@freshness-check",
          skipped: fetched.skipped,
        });

        // 1. Shape parity. This is what actually catches a fixtures build
        //    published as the product: that build has 5 plugins, no core
        //    section, 0 templates and 0 WCS modules, where a real run has 9,
        //    a populated core section, 20 and 39.
        expect(committed.plugins.length).toBe(fresh.plugins.length);
        expect(committed.core?.length ?? 0).toBe(fresh.core.length);
        expect(committed.indexer.templates.length).toBe(fresh.indexer.templates.length);
        expect(committed.indexer.wcsModules.length).toBe(fresh.indexer.wcsModules.length);
        expect(Object.keys(committed.resolvedRefs).sort()).toEqual(Object.keys(freshRefs).sort());

        // 2. Hash parity, but only when the two runs saw the same commits.
        //    Upstream moving is not the defect this guard exists to catch, and
        //    failing on it would train everyone to ignore the guard.
        //
        //    Compared entry by entry, NOT by stringifying both objects: key
        //    insertion order differs between the committed file and a fresh
        //    build, so a string comparison is false even when the commits are
        //    identical — and a guard that always takes the weak path is a
        //    guard that lies about what it checked.
        const movedRepos = Object.keys(freshRefs)
          .filter((repo) => committed.resolvedRefs[repo] !== freshRefs[repo])
          .sort();

        if (movedRepos.length === 0) {
          expect(committed.payloadHash).toBe(fresh.payloadHash);
        } else {
          console.log(
            `freshness: skipping hash comparison, upstream moved for ${movedRepos.join(", ")}`,
          );
        }
      } finally {
        await rm(cacheRoot, { recursive: true, force: true });
      }
    },
    600_000,
  );

  test("is skipped in the default suite, so `bun test` needs no network", () => {
    // The last cycle shipped a test that quietly reached github.com for eleven
    // seconds while looking like a unit test. This pins the gate itself.
    if (!NETWORK_ENABLED) {
      expect(maybeTest).toBe(test.skip);
    } else {
      expect(maybeTest).toBe(test);
    }
  });
});

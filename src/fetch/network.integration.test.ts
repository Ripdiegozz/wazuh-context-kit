/**
 * Opt-in integration test against the real `wazuh-indexer-plugins` repo on
 * github.com (SPEC 1.9). Proves the `>= 18 templates` and full-determinism
 * criteria honestly: an offline synthetic fixture would only prove something
 * about the fixture, not the repo (design's Testing Strategy note).
 *
 * Skipped unless `WAZUH_CTX_NETWORK=1`. Never part of the default `bun test`.
 */

import { describe, test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMatrix } from "../matrix/build.ts";
import type { BuildInput } from "../matrix/types.ts";
import { renderMatrixMarkdown } from "../matrix/render.ts";
import { parseFetchedRepos, toParseTargets } from "../parse/index.ts";
import { createFetchIo } from "./git-runner.ts";
import { fetchRepos } from "./index.ts";

const NETWORK_ENABLED = process.env.WAZUH_CTX_NETWORK === "1";
const maybeTest = NETWORK_ENABLED ? test : test.skip;

describe("fetch/ + parse/ against the real wazuh-indexer-plugins checkout", () => {
  maybeTest(
    "cold clone yields >= 18 templates, and two runs over one cache are byte-identical",
    async () => {
      const cacheRoot = await mkdtemp(join(tmpdir(), "wazuh-ctx-network-"));
      const repos = [{ name: "wazuh-indexer-plugins", kind: "indexer" as const }];
      const sources = { repos };

      try {
        const io = createFetchIo();

        const first = await fetchRepos({ repos, ref: "5.0.0", cacheRoot, refresh: false, io });
        expect(first.skipped).toEqual([]);
        expect(first.fetched).toHaveLength(1);

        const firstParsed = await parseFetchedRepos(toParseTargets(sources, first.fetched));
        expect(firstParsed.templates.length).toBeGreaterThanOrEqual(18);

        const baseInput = (
          fetched: typeof first.fetched,
          parsed: typeof firstParsed,
        ): BuildInput => ({
          ref: "5.0.0",
          facts: parsed.facts,
          templates: parsed.templates,
          wcsModules: parsed.wcsModules,
          resolvedRefs: Object.fromEntries(fetched.map((f) => [f.repo, f.commit])),
          resolvedAt: "2026-09-14T00:00:00Z",
          generatedAt: "2026-09-14T00:00:00Z",
          tool: "wazuh-ctx@0.1.0",
          skipped: first.skipped,
        });

        const firstMatrix = buildMatrix(baseInput(first.fetched, firstParsed));
        const firstMarkdown = renderMatrixMarkdown(firstMatrix);

        // Second run must be a cache hit: same cacheRoot, no --refresh.
        const second = await fetchRepos({ repos, ref: "5.0.0", cacheRoot, refresh: false, io });
        const secondParsed = await parseFetchedRepos(toParseTargets(sources, second.fetched));
        const secondMatrix = buildMatrix(baseInput(second.fetched, secondParsed));
        const secondMarkdown = renderMatrixMarkdown(secondMatrix);

        expect(secondMatrix.payloadHash).toBe(firstMatrix.payloadHash);
        expect(secondMarkdown).toBe(firstMarkdown);
      } finally {
        await rm(cacheRoot, { recursive: true, force: true });
      }
    },
    120_000,
  );
});

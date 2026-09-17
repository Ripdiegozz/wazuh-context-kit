/**
 * Tests for the sources.yml loader (SPEC 1.3).
 *
 * `sources.yml` is our own config, not a foreign repo, so a malformed file is
 * fatal (D5 boundary) — the opposite treatment from parse/'s robust-empty
 * rule for `wazuh/*` content.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadSources } from "./sources.ts";

const FIXTURES_ROOT = join(import.meta.dir, "..", "fixtures", "sources");

describe("loadSources", () => {
  test("loads a valid sources.yml into { refs, repos }", async () => {
    const result = await loadSources(join(FIXTURES_ROOT, "ok"));

    expect(result.refs).toEqual(["5.0.0"]);
    expect(result.repos).toEqual([
      { name: "wazuh-dashboard", kind: "platform" },
      { name: "wazuh-dashboard-plugins", kind: "dashboard" },
      { name: "wazuh-indexer-plugins", kind: "indexer" },
    ]);
  });

  test("throws naming the offending field for an invalid kind", async () => {
    await expect(loadSources(join(FIXTURES_ROOT, "bad"))).rejects.toThrow(/kind/);
  });

  /**
   * SPEC: credentials come from the environment, never from committed
   * configuration ("a `sources.yml` carrying a username or password field" —
   * the requirement does not scope this to one shape). `sources.yml` is
   * committed, so a username or password field in it is a credential in git
   * -- it must be rejected outright, not silently stripped and quietly
   * ignored.
   *
   * CodeRabbit finding (PR #14): only the repo-nested shape was ever tested.
   * `sourcesFileSchema` is a plain (non-strict) `z.object()` at the top level
   * -- deliberately, so the real `docsVersionMap` block keeps working -- and
   * a plain `z.object()` STRIPS an unrecognised key instead of rejecting it.
   * A `username`/`password` field at the TOP level of the file therefore
   * validated successfully and vanished silently: a passing test for an
   * unmet requirement, which is worse than no test at all.
   */
  test("rejects a repo entry carrying a username or password field, rather than honouring it", async () => {
    await expect(loadSources(join(FIXTURES_ROOT, "creds"))).rejects.toThrow(/username|password/);
  });

  test("rejects a TOP-LEVEL username or password field, rather than silently stripping it", async () => {
    await expect(loadSources(join(FIXTURES_ROOT, "creds-top-level"))).rejects.toThrow(/username|password/);
  });

  test("a legitimate top-level block (docsVersionMap) still loads fine", async () => {
    const projectRoot = join(import.meta.dir, "..");
    // The real sources.yml carries docsVersionMap at the top level (SPEC
    // 3.1); rejecting username/password there must not collaterally reject
    // this or any other legitimate top-level block.
    await expect(loadSources(projectRoot)).resolves.toBeDefined();
  });

  test("throws naming the path when sources.yml is missing", async () => {
    const missingRoot = join(FIXTURES_ROOT, "does-not-exist");

    await expect(loadSources(missingRoot)).rejects.toThrow(/sources\.yml/);
  });

  test("the project's real sources.yml loads with 10 repos", async () => {
    const projectRoot = join(import.meta.dir, "..");

    const result = await loadSources(projectRoot);

    expect(result.repos).toHaveLength(10);
    expect(result.repos.some((r) => r.name === "wazuh-dashboard-ml-commons" && r.kind === "dashboard")).toBe(
      true,
    );
    // Declared on purpose despite contributing no facts -- see the comment in
    // sources.yml. Pinned here so removing it is a deliberate act.
    expect(
      result.repos.some((r) => r.name === "wazuh-indexer-security-analytics" && r.kind === "indexer"),
    ).toBe(true);
    // The singular spelling. Both spellings mirror the same SHA at 5.0.0.
    expect(result.repos.some((r) => r.name === "wazuh-dashboard-reporting")).toBe(true);
    expect(result.repos.some((r) => r.name === "wazuh-dashboards-reporting")).toBe(false);
  });
});

/**
 * `docsVersionMap` (SPEC 3.1, unit 2): hand-maintained code-ref -> docs-path
 * mapping, validated on load rather than derived.
 */
describe("docsVersionMap", () => {
  test("a well-formed block parses, exposing owner, lastReviewed and map", async () => {
    const result = await loadSources(join(FIXTURES_ROOT, "docs-map-ok"));

    expect(result.docsVersionMap).toEqual({
      owner: "diego.garcia",
      lastReviewed: "2026-09-17",
      map: {
        "5.0.0": "5.0-beta",
        "4.14.0": "4.14",
      },
    });
  });

  test("a malformed block throws naming the file and the offending path", async () => {
    const path = join(FIXTURES_ROOT, "docs-map-bad", "sources.yml");

    await expect(loadSources(join(FIXTURES_ROOT, "docs-map-bad"))).rejects.toThrow(
      /docsVersionMap\.map/,
    );
    await expect(loadSources(join(FIXTURES_ROOT, "docs-map-bad"))).rejects.toThrow(
      new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  });

  test("an absent block is tolerated -- the loader stays non-fatal for a file that predates this change", async () => {
    const result = await loadSources(join(FIXTURES_ROOT, "docs-map-absent"));

    expect(result.docsVersionMap).toBeUndefined();
  });
});

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
   * configuration. `sources.yml` is committed, so a username or password
   * field in it is a credential in git -- it must be rejected outright, not
   * silently stripped and quietly ignored.
   */
  test("rejects a repo entry carrying a username or password field, rather than honouring it", async () => {
    await expect(loadSources(join(FIXTURES_ROOT, "creds"))).rejects.toThrow();
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

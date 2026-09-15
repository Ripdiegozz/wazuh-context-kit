/**
 * Tests for core plugin parsing (source-parse delta, tasks 2.1–2.7).
 *
 * A `platform` repository is the OpenSearch Dashboards fork. Its plugins live
 * under `src/plugins/<name>/opensearch_dashboards.json` and are the destination
 * of every wazuh-native `requiredPlugins` edge. They are parsed into a narrower
 * shape than `RawPluginFacts` — see design D3 for why reusing that type would
 * mean teaching `build.ts` to suppress a rule for one caller.
 */

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parsePlatformRepo } from "./core-plugins.ts";
import type { ParseTarget } from "./types.ts";

const COMMIT = "f".repeat(40);

/** Writes a throwaway checkout from a path -> contents map. */
async function makeCheckout(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "wazuh-ctx-core-"));
  for (const [path, body] of Object.entries(files)) {
    const absolute = join(root, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, body, "utf8");
  }
  return root;
}

function targetFor(dir: string): ParseTarget {
  return { repo: "wazuh-dashboard", repoKind: "platform", dir, commit: COMMIT };
}

describe("parsePlatformRepo", () => {
  test("emits one core plugin per src/plugins manifest, with dependency fields intact", async () => {
    const dir = await makeCheckout({
      "package.json": '{"name":"opensearch-dashboards","version":"3.6.0"}',
      "src/plugins/navigation/opensearch_dashboards.json": JSON.stringify({
        id: "navigation",
        requiredPlugins: ["data"],
        optionalPlugins: ["home"],
        requiredBundles: ["opensearchDashboardsReact"],
      }),
      "src/plugins/data/opensearch_dashboards.json": JSON.stringify({
        id: "data",
        requiredPlugins: ["expressions", "uiActions"],
      }),
      "src/plugins/discover/opensearch_dashboards.json": JSON.stringify({ id: "discover" }),
    });

    try {
      const result = await parsePlatformRepo(targetFor(dir));

      expect(result.repo).toBe("wazuh-dashboard");
      expect(result.commit).toBe(COMMIT);
      expect(result.facts).toHaveLength(3);

      const ids = result.facts.map((p) => p.pluginId);
      expect(ids).toEqual(["data", "discover", "navigation"]);

      const navigation = result.facts.find((p) => p.pluginId === "navigation")!;
      expect(navigation.manifest.requiredPlugins).toEqual(["data"]);
      expect(navigation.manifest.optionalPlugins).toEqual(["home"]);
      expect(navigation.pluginDir).toBe("src/plugins/navigation");
      expect(navigation.manifestPath).toBe("src/plugins/navigation/opensearch_dashboards.json");

      // parse/ emits the manifest verbatim; absent keys stay absent rather
      // than being normalised to []. Normalisation is build/'s job, and the
      // fixture-driven hazard in parse.test.ts is exactly about not writing
      // `undefined` into an exactOptionalPropertyTypes object.
      const discover = result.facts.find((p) => p.pluginId === "discover")!;
      expect(Object.hasOwn(discover.manifest, "requiredPlugins")).toBe(false);
      expect(Object.hasOwn(discover.manifest, "requiredBundles")).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("retains requiredBundles, which every real core manifest declares", async () => {
    const dir = await makeCheckout({
      "package.json": '{"version":"3.6.0"}',
      "src/plugins/data/opensearch_dashboards.json": JSON.stringify({
        id: "data",
        requiredBundles: ["usageCollection", "opensearchDashboardsUtils", "inspector"],
      }),
    });

    try {
      const result = await parsePlatformRepo(targetFor(dir));
      expect(result.facts[0]!.manifest.requiredBundles).toEqual([
        "usageCollection",
        "opensearchDashboardsUtils",
        "inspector",
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("parses a manifest with no sibling package.json", async () => {
    // 62 of the 64 real core plugins have no sibling package.json. Requiring
    // one would drop almost the entire core tree on the floor.
    const dir = await makeCheckout({
      "package.json": '{"version":"3.6.0"}',
      "src/plugins/navigation/opensearch_dashboards.json": '{"id":"navigation"}',
    });

    try {
      const result = await parsePlatformRepo(targetFor(dir));
      expect(result.facts).toHaveLength(1);
      expect(result.facts[0]!.pluginId).toBe("navigation");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("takes the version from the repository root package.json, once", async () => {
    const dir = await makeCheckout({
      "package.json": '{"name":"opensearch-dashboards","version":"3.6.0"}',
      "src/plugins/a/opensearch_dashboards.json": '{"id":"a"}',
      "src/plugins/b/opensearch_dashboards.json": '{"id":"b"}',
    });

    try {
      const result = await parsePlatformRepo(targetFor(dir));
      expect(result.version).toBe("3.6.0");
      // The version belongs to the repository. Repeating it per plugin would
      // invite a reader to believe the repetitions could disagree.
      for (const fact of result.facts) {
        expect(Object.hasOwn(fact, "version")).toBe(false);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a missing root package.json yields a null version, not an unknown", async () => {
    const dir = await makeCheckout({
      "src/plugins/a/opensearch_dashboards.json": '{"id":"a"}',
    });

    try {
      const result = await parsePlatformRepo(targetFor(dir));
      expect(result.version).toBeNull();
      expect(result.facts).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("skips a manifest with no id", async () => {
    // A manifest we cannot name cannot be the destination of a dependency
    // edge, so it has no use in this section.
    const dir = await makeCheckout({
      "package.json": '{"version":"3.6.0"}',
      "src/plugins/good/opensearch_dashboards.json": '{"id":"good"}',
      "src/plugins/nameless/opensearch_dashboards.json": '{"requiredPlugins":["data"]}',
    });

    try {
      const result = await parsePlatformRepo(targetFor(dir));
      expect(result.facts.map((p) => p.pluginId)).toEqual(["good"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("never reads the git-ignored root-level plugins/ directory", async () => {
    // This is the trap: `wazuh-dashboard` has both. Matching on "plugins"
    // instead of "src/plugins" finds the wrong tree, and because that tree is
    // empty upstream the mistake looks like a successful parse of nothing.
    const dir = await makeCheckout({
      "package.json": '{"version":"3.6.0"}',
      "src/plugins/real/opensearch_dashboards.json": '{"id":"real"}',
      "plugins/decoy/opensearch_dashboards.json": '{"id":"decoy"}',
    });

    try {
      const result = await parsePlatformRepo(targetFor(dir));
      expect(result.facts.map((p) => p.pluginId)).toEqual(["real"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("does not descend past one level under src/plugins", async () => {
    // Real core plugins nest their own fixture manifests deeper (packages/
    // holds optimizer mock repos). Only the top level is a plugin.
    const dir = await makeCheckout({
      "package.json": '{"version":"3.6.0"}',
      "src/plugins/real/opensearch_dashboards.json": '{"id":"real"}',
      "src/plugins/real/mock/nested/opensearch_dashboards.json": '{"id":"nested-fixture"}',
    });

    try {
      const result = await parsePlatformRepo(targetFor(dir));
      expect(result.facts.map((p) => p.pluginId)).toEqual(["real"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("mixed manifest version values do not change classification", async () => {
    // 47 of the 64 real manifests say "opensearchDashboards", 9 say "8.0.0",
    // 8 say "1.0.0". The field does not discriminate; `kind` does.
    const dir = await makeCheckout({
      "package.json": '{"version":"3.6.0"}',
      "src/plugins/a/opensearch_dashboards.json": '{"id":"a","version":"opensearchDashboards"}',
      "src/plugins/b/opensearch_dashboards.json": '{"id":"b","version":"1.0.0"}',
    });

    try {
      const result = await parsePlatformRepo(targetFor(dir));
      expect(result.facts).toHaveLength(2);
      for (const fact of result.facts) {
        expect(Object.hasOwn(fact, "world")).toBe(false);
        expect(Object.hasOwn(fact, "versionScheme")).toBe(false);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a malformed manifest never crashes the parse", async () => {
    const dir = await makeCheckout({
      "package.json": '{"version":"3.6.0"}',
      "src/plugins/broken/opensearch_dashboards.json": "{ not json",
      "src/plugins/fine/opensearch_dashboards.json": '{"id":"fine"}',
    });

    try {
      const result = await parsePlatformRepo(targetFor(dir));
      // Broken has no id once parsing fails, so it is skipped by the same rule.
      expect(result.facts.map((p) => p.pluginId)).toEqual(["fine"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a checkout with no src/plugins yields an empty plugin list, not a throw", async () => {
    const dir = await makeCheckout({ "package.json": '{"version":"3.6.0"}' });

    try {
      const result = await parsePlatformRepo(targetFor(dir));
      expect(result.facts).toEqual([]);
      expect(result.version).toBe("3.6.0");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/**
 * Tests for the core plugin section and the unresolved-dependency report
 * (matrix-pipeline delta; tasks 3.1–3.4, 4.1–4.5).
 *
 * `buildMatrix` stays pure here: every input is a literal, and no test touches
 * fs, network, or the clock.
 */

import { describe, expect, test } from "bun:test";
import { buildMatrix } from "./build.ts";
import type { BuildInput, RawCoreRepo, RawManifest, RawPluginFacts } from "./types.ts";

const COMMIT = "a".repeat(40);
const CORE_COMMIT = "b".repeat(40);

function pluginFacts(
  pluginId: string,
  manifest: RawManifest,
  repo = "wazuh-dashboard-plugins",
): RawPluginFacts {
  return {
    repo,
    repoKind: "dashboard",
    pluginDir: `plugins/${pluginId}`,
    manifestPath: `plugins/${pluginId}/opensearch_dashboards.json`,
    packageJsonPath: `plugins/${pluginId}/package.json`,
    commit: COMMIT,
    manifest: { id: pluginId, ...manifest },
    packageVersion: "5.0.0",
  };
}

function coreRepo(ids: readonly string[], version: string | null = "3.6.0"): RawCoreRepo {
  return {
    repo: "wazuh-dashboard",
    commit: CORE_COMMIT,
    version,
    facts: ids.map((id) => ({
      pluginId: id,
      pluginDir: `src/plugins/${id}`,
      manifestPath: `src/plugins/${id}/opensearch_dashboards.json`,
      manifest: { id },
    })),
  };
}

function baseInput(overrides: Partial<BuildInput> = {}): BuildInput {
  return {
    ref: "5.0.0",
    facts: [],
    resolvedRefs: {},
    resolvedAt: "2026-01-01T00:00:00Z",
    generatedAt: "2026-01-01T00:00:00Z",
    tool: "wazuh-ctx@test",
    ...overrides,
  };
}

describe("core plugin section", () => {
  test("core plugins land in core[] and never in plugins[]", () => {
    const matrix = buildMatrix(
      baseInput({
        facts: [pluginFacts("wazuh", { requiredPlugins: ["navigation"] })],
        coreRepos: [coreRepo(["navigation", "data"])],
      }),
    );

    expect(matrix.plugins.map((p) => p.pluginId)).toEqual(["wazuh"]);
    expect(matrix.core).toHaveLength(1);
    expect(matrix.core[0]!.repo).toBe("wazuh-dashboard");
    expect(matrix.core[0]!.version).toBe("3.6.0");
    expect(matrix.core[0]!.plugins.map((p) => p.pluginId)).toEqual(["data", "navigation"]);

    const pluginIds = new Set(matrix.plugins.map((p) => p.pluginId));
    for (const core of matrix.core[0]!.plugins) {
      expect(pluginIds.has(core.pluginId)).toBe(false);
    }
  });

  test("a core plugin carries evidence but no world, versionScheme, or serverApiAccess", () => {
    const matrix = buildMatrix(baseInput({ coreRepos: [coreRepo(["navigation"])] }));
    const navigation = matrix.core[0]!.plugins[0]!;

    expect(navigation.evidence).toEqual({
      kind: "derived",
      manifestPath: "src/plugins/navigation/opensearch_dashboards.json",
      packageJsonPath: null,
      commit: CORE_COMMIT,
    });
    expect(Object.hasOwn(navigation, "world")).toBe(false);
    expect(Object.hasOwn(navigation, "versionScheme")).toBe(false);
    expect(Object.hasOwn(navigation, "serverApiAccess")).toBe(false);
  });

  test("64 core plugins with no package.json add exactly zero unknowns", () => {
    // The real number, not a stand-in. 62 of the 64 core plugins at 5.0.0 have
    // no sibling package.json; pushing them through the wazuh-native shape
    // would turn a 3-entry unknowns list into a 65-entry one and destroy the
    // signal it exists to carry.
    const ids = Array.from({ length: 64 }, (_, i) => `core${String(i).padStart(2, "0")}`);
    const matrix = buildMatrix(baseInput({ coreRepos: [coreRepo(ids)] }));

    expect(matrix.core[0]!.plugins).toHaveLength(64);
    expect(matrix.unknowns).toEqual([]);
  });

  test("adding core input leaves every pre-existing section untouched", () => {
    // D5: payloadHash DOES change, because the payload genuinely has new
    // content. What must not change is any existing key's name or value.
    const facts = [pluginFacts("wazuh", { requiredPlugins: ["navigation"] })];
    const without = buildMatrix(baseInput({ facts }));
    const with_ = buildMatrix(baseInput({ facts, coreRepos: [coreRepo(["navigation"])] }));

    expect(with_.plugins).toEqual(without.plugins);
    expect(with_.unknowns).toEqual(without.unknowns);
    expect(with_.skipped).toEqual(without.skipped);
    expect(with_.resolvedRefs).toEqual(without.resolvedRefs);
    expect(with_.reconciliation).toEqual(without.reconciliation);
    expect(with_.indexer).toEqual(without.indexer);
  });

  test("no core input yields an empty section, not a missing key", () => {
    const matrix = buildMatrix(baseInput({ facts: [pluginFacts("wazuh", {})] }));
    expect(matrix.core).toEqual([]);
    expect(matrix.unresolvedDependencies).toEqual([]);
  });
});

describe("unresolved dependencies", () => {
  test("reports a requiredPlugins entry that resolves to nothing", () => {
    const matrix = buildMatrix(
      baseInput({ facts: [pluginFacts("wazuh", { requiredPlugins: ["ghost"] })] }),
    );

    expect(matrix.unresolvedDependencies).toEqual([
      {
        plugin: "wazuh",
        repo: "wazuh-dashboard-plugins",
        dependency: "ghost",
        field: "requiredPlugins",
      },
    ]);
  });

  test("reports an unresolved requiredBundles entry too", () => {
    const matrix = buildMatrix(
      baseInput({ facts: [pluginFacts("wazuh", { requiredBundles: ["ghostBundle"] })] }),
    );

    expect(matrix.unresolvedDependencies).toEqual([
      {
        plugin: "wazuh",
        repo: "wazuh-dashboard-plugins",
        dependency: "ghostBundle",
        field: "requiredBundles",
      },
    ]);
  });

  test("navigation resolves for all four wazuh-native plugins once core is visible", () => {
    // This is the reason the change exists. Before the core section, every one
    // of these edges pointed at nothing.
    const natives = ["wazuh", "wazuhCore", "wazuhAiAssistant", "wazuhCheckUpdates"];
    const facts = natives.map((id) => pluginFacts(id, { requiredPlugins: ["navigation"] }));

    const before = buildMatrix(baseInput({ facts }));
    expect(before.unresolvedDependencies).toHaveLength(4);

    const after = buildMatrix(baseInput({ facts, coreRepos: [coreRepo(["navigation"])] }));
    expect(after.unresolvedDependencies).toEqual([]);
  });

  test("absent optionalPlugins are not reported", () => {
    // An optional dependency that is absent is the feature working as
    // designed. Reporting it would be noise indistinguishable from signal.
    const matrix = buildMatrix(
      baseInput({ facts: [pluginFacts("wazuh", { optionalPlugins: ["maybeGhost"] })] }),
    );
    expect(matrix.unresolvedDependencies).toEqual([]);
  });

  test("a core plugin's own unresolved dependency is reported", () => {
    const matrix = buildMatrix(
      baseInput({
        coreRepos: [
          {
            repo: "wazuh-dashboard",
            commit: CORE_COMMIT,
            version: "3.6.0",
            facts: [
              {
                pluginId: "dashboard",
                pluginDir: "src/plugins/dashboard",
                manifestPath: "src/plugins/dashboard/opensearch_dashboards.json",
                manifest: { id: "dashboard", requiredPlugins: ["missingCore"] },
              },
            ],
          },
        ],
      }),
    );

    expect(matrix.unresolvedDependencies).toEqual([
      {
        plugin: "dashboard",
        repo: "wazuh-dashboard",
        dependency: "missingCore",
        field: "requiredPlugins",
      },
    ]);
  });

  test("output is sorted by repo, plugin, field, dependency", () => {
    const matrix = buildMatrix(
      baseInput({
        facts: [
          pluginFacts("zeta", { requiredPlugins: ["zGhost", "aGhost"] }, "repo-b"),
          pluginFacts("alpha", { requiredPlugins: ["mGhost"], requiredBundles: ["bGhost"] }, "repo-a"),
        ],
      }),
    );

    expect(matrix.unresolvedDependencies.map((u) => [u.repo, u.plugin, u.field, u.dependency])).toEqual([
      ["repo-a", "alpha", "requiredBundles", "bGhost"],
      ["repo-a", "alpha", "requiredPlugins", "mGhost"],
      ["repo-b", "zeta", "requiredPlugins", "aGhost"],
      ["repo-b", "zeta", "requiredPlugins", "zGhost"],
    ]);
  });

  test("the same unresolved id from two plugins is reported twice, once each", () => {
    const matrix = buildMatrix(
      baseInput({
        facts: [
          pluginFacts("one", { requiredPlugins: ["ghost"] }),
          pluginFacts("two", { requiredPlugins: ["ghost"] }),
        ],
      }),
    );

    expect(matrix.unresolvedDependencies.map((u) => u.plugin)).toEqual(["one", "two"]);
  });
});

describe("a repository that resolves but contributes no facts", () => {
  test("appears in resolvedRefs and NOT in skipped", () => {
    // `skipped[]` means "could not be resolved". A repository that resolved
    // and simply carries nothing the declared path set matches is a different
    // outcome, and collapsing the two would make a healthy repo look broken.
    // This is the shape of both `wazuh-indexer-security-analytics` and, before
    // this change, `wazuh-dashboard`.
    const matrix = buildMatrix(
      baseInput({
        facts: [pluginFacts("wazuh", {})],
        resolvedRefs: {
          "wazuh-dashboard-plugins": COMMIT,
          "wazuh-indexer-security-analytics": "c".repeat(40),
        },
        skipped: [{ repo: "wazuh-dashboard-ml-commons", reason: "no 5.0.0 branch" }],
      }),
    );

    expect(Object.keys(matrix.resolvedRefs)).toContain("wazuh-indexer-security-analytics");
    expect(matrix.skipped.map((s) => s.repo)).not.toContain("wazuh-indexer-security-analytics");
    expect(matrix.plugins.map((p) => p.repo)).not.toContain("wazuh-indexer-security-analytics");
    // And the genuine failure stays a failure.
    expect(matrix.skipped.map((s) => s.repo)).toContain("wazuh-dashboard-ml-commons");
  });
});

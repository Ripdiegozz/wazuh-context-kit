/**
 * Acceptance tests for SPEC 1.9.
 *
 * Every test here runs against fixtures: no network, no git, no cache.
 * That is the payoff of keeping matrix/ pure (SPEC 6.1).
 */

import { describe, expect, test } from "bun:test";
import {
  allFacts,
  anonymousPlugin,
  securityAnalytics,
  wazuhMain,
} from "../../fixtures/facts.ts";
import { buildMatrix } from "./build.ts";
import { verifyPayloadHash } from "./hash.ts";
import { renderMatrixMarkdown } from "./render.ts";
import type { BuildInput } from "./types.ts";

const RESOLVED_REFS = {
  "wazuh-dashboard-plugins": "5157de35aa0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d",
  "wazuh-dashboard-security-analytics": "a91c02f1bb2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e",
};

function input(overrides: Partial<BuildInput> = {}): BuildInput {
  return {
    ref: "5.0.0",
    facts: allFacts,
    resolvedRefs: RESOLVED_REFS,
    resolvedAt: "2026-09-14T00:00:00Z",
    generatedAt: "2026-09-14T00:00:00Z",
    tool: "wazuh-ctx@0.1.0",
    skipped: [{ repo: "wazuh-dashboard-ml-commons", reason: "no 5.0.0 branch" }],
    ...overrides,
  };
}

describe("plugin identity", () => {
  test("detects the four wazuh-dashboard-plugins plugins by their real ids", () => {
    const matrix = buildMatrix(input());
    const ids = matrix.plugins
      .filter((p) => p.repo === "wazuh-dashboard-plugins")
      .map((p) => p.pluginId)
      .sort();

    expect(ids).toEqual([
      "wazuh",
      "wazuhAiAssistant",
      "wazuhCheckUpdates",
      "wazuhCore",
    ]);
  });

  test("never falls back to the directory name when the manifest has no id", () => {
    const matrix = buildMatrix(input({ facts: [anonymousPlugin] }));
    const plugin = matrix.plugins[0]!;

    expect(plugin.pluginId).toBe("unknown");
    expect(plugin.pluginId).not.toBe("alerting-dashboards");
    expect(matrix.unknowns.some((u) => u.field === "pluginId")).toBe(true);
  });
});

describe("world classification", () => {
  test("wazuh is wazuh-native", () => {
    const matrix = buildMatrix(input({ facts: [wazuhMain] }));
    expect(matrix.plugins[0]!.world).toBe("wazuh-native");
  });

  test("securityAnalyticsDashboards is upstream-fork with its own configPath", () => {
    const matrix = buildMatrix(input({ facts: [securityAnalytics] }));
    const plugin = matrix.plugins[0]!;

    expect(plugin.world).toBe("upstream-fork");
    expect(plugin.versionScheme).toBe("osd");
    expect(plugin.configPath).toEqual(["opensearch_security_analytics"]);
  });
});

describe("backend access — the conflation guard", () => {
  test("no indexerAccess anywhere contains 'wazuh-core'", () => {
    const matrix = buildMatrix(input());

    for (const plugin of matrix.plugins) {
      // wazuh-core is Server API surface only. It carries no OpenSearch client
      // and is not an indexer access path (SPEC 4, 1.5.3).
      expect(plugin.indexerAccess as string[]).not.toContain("wazuh-core");
    }
  });

  test("serverApiAccess and indexerAccess never hold the same value", () => {
    const matrix = buildMatrix(input());

    for (const plugin of matrix.plugins) {
      expect(plugin.indexerAccess as string[]).not.toContain(plugin.serverApiAccess);
    }
  });

  test("security-analytics emits all three indexer paths simultaneously", () => {
    const matrix = buildMatrix(input({ facts: [securityAnalytics] }));

    expect(matrix.plugins[0]!.indexerAccess.sort()).toEqual([
      "os-plugin-bound",
      "osd-data",
      "osd-data-source",
    ]);
  });

  test("wazuh-native plugins reach the Server API via wazuh-core", () => {
    const matrix = buildMatrix(input({ facts: [wazuhMain] }));
    expect(matrix.plugins[0]!.serverApiAccess).toBe("wazuh-core");
  });

  test("every plugin with an empty indexerAccess appears in unknowns", () => {
    const matrix = buildMatrix(input());

    const empty = matrix.plugins.filter((p) => p.indexerAccess.length === 0);
    expect(empty.length).toBeGreaterThan(0);

    for (const plugin of empty) {
      const handle = plugin.pluginId === "unknown" ? plugin.pluginDir : plugin.pluginId;
      const reported = matrix.unknowns.some(
        (u) => u.plugin === handle && u.field === "indexerAccess",
      );
      expect(reported).toBe(true);
    }
  });
});

describe("evidence", () => {
  test("every plugin declares evidence.kind, and derived ones carry a commit", () => {
    const matrix = buildMatrix(input());

    for (const plugin of matrix.plugins) {
      expect(plugin.evidence.kind).toBeDefined();
      if (plugin.evidence.kind === "derived") {
        expect(plugin.evidence.commit).not.toBe("");
        expect(plugin.evidence.manifestPath).not.toBe("");
      }
    }
  });

  test("resolvedRefs carries a SHA per non-skipped repo", () => {
    const matrix = buildMatrix(input());
    const repos = new Set(matrix.plugins.map((p) => p.repo));

    for (const repo of repos) {
      expect(matrix.resolvedRefs[repo]).toBeTruthy();
    }
  });

  test("skipped repos are reported and do not crash the build", () => {
    const matrix = buildMatrix(input());
    expect(matrix.skipped[0]!.repo).toBe("wazuh-dashboard-ml-commons");
  });
});

describe("determinism", () => {
  test("two runs over identical input produce an identical payloadHash", () => {
    const a = buildMatrix(input());
    const b = buildMatrix(input());
    expect(a.payloadHash).toBe(b.payloadHash);
  });

  test("generatedAt does not leak into payloadHash", () => {
    const a = buildMatrix(input({ generatedAt: "2026-01-01T00:00:00Z" }));
    const b = buildMatrix(input({ generatedAt: "2099-12-31T23:59:59Z" }));

    expect(a.meta.generatedAt).not.toBe(b.meta.generatedAt);
    expect(a.payloadHash).toBe(b.payloadHash);
  });

  test("fact ordering does not leak into payloadHash", () => {
    const a = buildMatrix(input({ facts: allFacts }));
    const b = buildMatrix(input({ facts: [...allFacts].reverse() }));
    expect(a.payloadHash).toBe(b.payloadHash);
  });

  test("MATRIX.md is byte-identical across runs", () => {
    const a = renderMatrixMarkdown(buildMatrix(input({ generatedAt: "2026-01-01T00:00:00Z" })));
    const b = renderMatrixMarkdown(buildMatrix(input({ generatedAt: "2099-12-31T23:59:59Z" })));
    expect(a).toBe(b);
  });

  test("resolvedAt IS part of the payload and must not be pinned by --frozen-time", () => {
    // Regression guard. The CLI once derived resolvedAt from --frozen-time,
    // which leaked the wall clock into the rendered footer. resolvedAt
    // describes when the SHAs were resolved; generatedAt describes when the
    // process ran. Only the second is allowed to be arbitrary.
    const a = buildMatrix(input({ resolvedAt: "2026-01-01T00:00:00Z" }));
    const b = buildMatrix(input({ resolvedAt: "2026-06-01T00:00:00Z" }));

    expect(a.payloadHash).not.toBe(b.payloadHash);
    expect(renderMatrixMarkdown(a)).not.toBe(renderMatrixMarkdown(b));
  });

  test("MATRIX.md never renders generatedAt", () => {
    const markdown = renderMatrixMarkdown(
      buildMatrix(input({ generatedAt: "2031-07-07T07:07:07Z" })),
    );
    expect(markdown).not.toContain("2031-07-07");
  });
});

describe("integrity verification (SPEC 5.3)", () => {
  test("an untampered dataset verifies", () => {
    expect(verifyPayloadHash(buildMatrix(input())).ok).toBe(true);
  });

  test("a single mutated cell is detected", () => {
    const matrix = buildMatrix(input());
    matrix.plugins[0]!.world = "platform";

    const result = verifyPayloadHash(matrix);
    expect(result.ok).toBe(false);
    expect(result.actual).not.toBe(result.expected);
  });
});

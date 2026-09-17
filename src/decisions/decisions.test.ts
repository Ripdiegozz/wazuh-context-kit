/**
 * Tests for the human layers (SPEC 1.7, 5.2, 5.4).
 */

import { describe, expect, test } from "bun:test";
import { allFacts, securityAnalytics, wazuhCore } from "../../fixtures/facts.ts";
import { buildMatrix } from "../matrix/build.ts";
import { renderMatrixMarkdown } from "../matrix/render.ts";
import type { Annotation, BuildInput, Decision } from "../matrix/types.ts";

function input(overrides: Partial<BuildInput> = {}): BuildInput {
  return {
    ref: "5.0.0",
    facts: allFacts,
    resolvedRefs: { "wazuh-dashboard-plugins": "5157de35", "wazuh-dashboard-security-analytics": "a91c02f1" },
    resolvedAt: "2026-09-14T00:00:00Z",
    generatedAt: "2026-09-14T00:00:00Z",
    tool: "wazuh-ctx@0.1.0",
    ...overrides,
  };
}

const wazuhCoreWorldDecision: Decision = {
  plugin: "wazuhCore",
  field: "world",
  value: "wazuh-native",
  author: "diego.garcia",
  date: "2026-09-14",
  reason: "wazuh-core provides the contract and cannot declare itself as a dependency.",
  evidence: "plugins/wazuh-core/opensearch_dashboards.json",
  status: "active",
};

describe("the wazuhCore self-reference hole", () => {
  test("without a decision, wazuh-core classifies as unknown", () => {
    const matrix = buildMatrix(input({ facts: [wazuhCore] }));

    expect(matrix.plugins[0]!.world).toBe("unknown");
    expect(matrix.unknowns.some((u) => u.plugin === "wazuhCore" && u.field === "world")).toBe(true);
  });

  test("the decision resolves it and marks it as a human assertion", () => {
    const matrix = buildMatrix(
      input({ facts: [wazuhCore], decisions: [wazuhCoreWorldDecision] }),
    );
    const plugin = matrix.plugins[0]!;

    expect(plugin.world).toBe("wazuh-native");
    expect(plugin.assertions.world?.kind).toBe("human-assertion");
    expect(plugin.assertions.world?.author).toBe("diego.garcia");
    expect(plugin.assertions.world?.source).toBe("decisions.yml");
  });

  test("a resolved field stops appearing as pending work", () => {
    const matrix = buildMatrix(
      input({ facts: [wazuhCore], decisions: [wazuhCoreWorldDecision] }),
    );

    expect(matrix.unknowns.some((u) => u.field === "world")).toBe(false);
  });

  test("the plugin record still carries its derivation provenance", () => {
    const matrix = buildMatrix(
      input({ facts: [wazuhCore], decisions: [wazuhCoreWorldDecision] }),
    );
    const plugin = matrix.plugins[0]!;

    // An asserted cell does not erase where the plugin itself came from.
    expect(plugin.evidence.kind).toBe("derived");
    if (plugin.evidence.kind === "derived") {
      expect(plugin.evidence.commit).not.toBe("");
    }
  });
});

describe("derived beats asserted", () => {
  test("a decision on a derivable field is superseded, not applied", () => {
    const stale: Decision = {
      ...wazuhCoreWorldDecision,
      plugin: "securityAnalyticsDashboards",
      field: "world",
      value: "wazuh-native",
    };

    const matrix = buildMatrix(input({ facts: [securityAnalytics], decisions: [stale] }));

    // The derived value wins. A stale decision must never shadow a fact.
    expect(matrix.plugins[0]!.world).toBe("upstream-fork");
    expect(matrix.plugins[0]!.assertions.world).toBeUndefined();

    const entry = matrix.reconciliation.find((r) => r.field === "world")!;
    expect(entry.status).toBe("superseded");
    expect(entry.conflict).toBe(true);
  });

  test("a superseded decision that agrees is flagged for retirement, not as a conflict", () => {
    const agreeing: Decision = {
      ...wazuhCoreWorldDecision,
      plugin: "securityAnalyticsDashboards",
      field: "world",
      value: "upstream-fork",
    };

    const matrix = buildMatrix(input({ facts: [securityAnalytics], decisions: [agreeing] }));
    const entry = matrix.reconciliation.find((r) => r.field === "world")!;

    expect(entry.status).toBe("superseded");
    expect(entry.conflict).toBe(false);
    expect(entry.note).toContain("retire");
  });

  test("a decision for a plugin that no longer exists is orphaned, not dropped", () => {
    const gone: Decision = { ...wazuhCoreWorldDecision, plugin: "somePluginThatVanished" };
    const matrix = buildMatrix(input({ facts: [securityAnalytics], decisions: [gone] }));

    const entry = matrix.reconciliation.find((r) => r.plugin === "somePluginThatVanished")!;
    expect(entry.status).toBe("orphaned");
  });
});

describe("the decision layer cannot reintroduce the conflation", () => {
  test("'wazuh-core' as an indexerAccess value is rejected", () => {
    const bad: Decision = {
      ...wazuhCoreWorldDecision,
      plugin: "wazuhCore",
      field: "indexerAccess",
      value: ["wazuh-core"],
    };

    expect(() => buildMatrix(input({ facts: [wazuhCore], decisions: [bad] }))).toThrow(
      /not an indexer access path/,
    );
  });

  test("a value outside a field's domain is rejected loudly", () => {
    const bad: Decision = { ...wazuhCoreWorldDecision, value: "sort-of-native" };

    expect(() => buildMatrix(input({ facts: [wazuhCore], decisions: [bad] }))).toThrow(
      /expected one of/,
    );
  });
});

describe("annotations are additive only", () => {
  const annotation: Annotation = {
    plugin: "wazuhCore",
    kind: "warning",
    text: "Server API surface only. No OpenSearch client.",
    author: "diego.garcia",
    date: "2026-09-14",
  };

  test("an annotation attaches without changing any derived value", () => {
    const plain = buildMatrix(input({ facts: [wazuhCore] }));
    const annotated = buildMatrix(input({ facts: [wazuhCore], annotations: [annotation] }));

    expect(annotated.plugins[0]!.annotations).toHaveLength(1);
    expect(annotated.plugins[0]!.world).toBe(plain.plugins[0]!.world);
    expect(annotated.plugins[0]!.indexerAccess).toEqual(plain.plugins[0]!.indexerAccess);
  });

  test("an annotation for an absent plugin is ignored, never invented", () => {
    const matrix = buildMatrix(
      input({ facts: [securityAnalytics], annotations: [annotation] }),
    );
    expect(matrix.plugins[0]!.annotations).toHaveLength(0);
  });
});

/**
 * `overlay: "local"` marking (SPEC "A cell overridden by decisions.local.yml
 * is marked overlay: 'local'", unit 3). Marking lives in the domain layer
 * (`applyHumanLayers`) so every consumer of the matrix carries it, not only
 * the `schema` response -- and it must cost nothing when there is no local
 * file, which is what the byte-identical `payloadHash` below proves.
 */
describe("overlay: local marking", () => {
  test("a cell written from decisions.local.yml carries overlay: local", () => {
    const localDecision: Decision = {
      ...wazuhCoreWorldDecision,
      author: "diego.garcia",
    };

    const matrix = buildMatrix(
      input({
        facts: [wazuhCore],
        decisions: [localDecision],
        localOverrides: new Set(["wazuhCore::world"]),
      }),
    );
    const plugin = matrix.plugins[0]!;

    expect(plugin.world).toBe("wazuh-native");
    expect(plugin.assertions.world?.overlay).toBe("local");
  });

  test("a cell resolved from decisions.yml (not local) carries no overlay key", () => {
    const matrix = buildMatrix(
      input({ facts: [wazuhCore], decisions: [wazuhCoreWorldDecision] }),
    );
    const plugin = matrix.plugins[0]!;

    expect(plugin.assertions.world?.overlay).toBeUndefined();
  });

  /**
   * No `decisions.local.yml` means an empty `localOverrides` set, which must
   * be free: `canonicalize` drops `undefined` keys, so an absent marker must
   * leave `payloadHash` byte-identical to the value produced before this
   * change existed. Captured against the actual pre-change implementation
   * (before `localOverrides` was threaded into `applyHumanLayers`) with this
   * exact fixture input, so this is a real assertion on a real hash, not a
   * tautology -- if threading the set ever perturbs the untouched path, this
   * fails.
   */
  test("with no local file, no cell carries an overlay key and payloadHash is byte-identical to the pre-change value", () => {
    const matrix = buildMatrix(
      input({
        facts: allFacts,
        resolvedRefs: {
          "wazuh-dashboard-plugins": "5157de35",
          "wazuh-dashboard-security-analytics": "a91c02f1",
        },
      }),
    );

    for (const plugin of matrix.plugins) {
      for (const assertion of Object.values(plugin.assertions)) {
        expect(assertion.overlay).toBeUndefined();
      }
    }

    expect(matrix.payloadHash).toBe(
      "sha256:4009de2a3c7bd993f74ea381a0b2ba1ef8946ffe3e6817096e751b03c9e050ae",
    );
  });
});

describe("determinism survives the overlay", () => {
  test("identical input with decisions yields an identical payloadHash", () => {
    const a = buildMatrix(input({ decisions: [wazuhCoreWorldDecision] }));
    const b = buildMatrix(input({ decisions: [wazuhCoreWorldDecision] }));
    expect(a.payloadHash).toBe(b.payloadHash);
  });

  test("applying a decision changes the payload, and says so", () => {
    const without = buildMatrix(input());
    const with_ = buildMatrix(input({ decisions: [wazuhCoreWorldDecision] }));

    expect(without.payloadHash).not.toBe(with_.payloadHash);
    expect(with_.unknowns.length).toBeLessThan(without.unknowns.length);
  });

  test("MATRIX.md marks asserted cells and lists their reason", () => {
    const markdown = renderMatrixMarkdown(
      buildMatrix(input({ decisions: [wazuhCoreWorldDecision] })),
    );

    expect(markdown).toContain("†");
    expect(markdown).toContain("Human assertions");
    expect(markdown).toContain("diego.garcia");
  });
});

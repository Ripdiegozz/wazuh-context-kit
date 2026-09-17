/**
 * Tests for `buildCrosscheckView` (SPEC 1.5.1: crosscheck "no es una tabla:
 * es un grafo bipartito ... con huérfanos de los dos lados"; SPEC 1.5.3
 * criterion 2: "Vista de crosscheck como grafo, con huérfanos de ambos lados
 * visibles").
 *
 * `CrosscheckJson.matched` carries the pairs that DID join, so the view draws
 * a real bipartite graph: declared indices on one side, referencing sites on
 * the other, an edge per match, and the two orphan fringes touching no edge.
 *
 * The invariant worth defending is that a node is never drawn as connected AND
 * abandoned at once. An index declared once and reached from two files is one
 * node with two edges, not two nodes sharing a label.
 */

import { describe, expect, test } from "bun:test";
import type { CrosscheckJson } from "../matrix/types.ts";
import { buildCrosscheckView } from "./crosscheck-view.ts";

function fixture(overrides: Partial<CrosscheckJson> = {}): CrosscheckJson {
  return {
    meta: { generatedAt: "2026-09-17T00:00:00.000Z", tool: "wazuh-ctx@0.1.0" },
    ref: "5.0.0",
    coverage: { recoveredNames: 3, scannedRepos: ["wazuh-dashboard-plugins"], uncovered: [] },
    declaredUnreferenced: [{ pattern: "wazuh-a*", template: "a.json", group: "states" }],
    referencedUndeclared: [
      { name: "wazuh-b", file: "plugins/main/common/constants.ts", line: 10, via: "import" },
    ],
    matched: [],
    wcsWithoutConsumer: ["content/decoders"],
    competingCatalogs: [{ name: "wazuh-c", files: ["a.ts", "b.ts"] }],
    ...overrides,
  };
}

describe("buildCrosscheckView", () => {
  test("carries meta, ref, coverage, wcsWithoutConsumer and competingCatalogs through untouched", () => {
    const view = buildCrosscheckView(fixture());
    expect(view.meta).toEqual({ generatedAt: "2026-09-17T00:00:00.000Z", tool: "wazuh-ctx@0.1.0" });
    expect(view.ref).toBe("5.0.0");
    expect(view.coverage.recoveredNames).toBe(3);
    expect(view.wcsWithoutConsumer).toEqual(["content/decoders"]);
    expect(view.competingCatalogs).toEqual([{ name: "wazuh-c", files: ["a.ts", "b.ts"] }]);
  });

  test("orphans carries BOTH declaredUnreferenced and referencedUndeclared", () => {
    const view = buildCrosscheckView(fixture());
    expect(view.orphans.declaredUnreferenced).toEqual([
      { pattern: "wazuh-a*", template: "a.json", group: "states" },
    ]);
    expect(view.orphans.referencedUndeclared).toEqual([
      { name: "wazuh-b", file: "plugins/main/common/constants.ts", line: 10, via: "import" },
    ]);
  });

  test("nodes include one entry per orphan, tagged by side", () => {
    const view = buildCrosscheckView(fixture());
    const declaredNodes = view.nodes.filter((n) => n.side === "declared");
    const referencedNodes = view.nodes.filter((n) => n.side === "referenced");
    expect(declaredNodes).toHaveLength(1);
    expect(referencedNodes).toHaveLength(1);
    expect(declaredNodes[0]?.label).toBe("wazuh-a*");
    expect(referencedNodes[0]?.label).toBe("wazuh-b");
  });

  test("every node produced this way is orphan: true, and edges is empty (no matched-pair data in the source)", () => {
    const view = buildCrosscheckView(fixture());
    expect(view.nodes.every((n) => n.orphan)).toBe(true);
    expect(view.edges).toEqual([]);
  });

  test("real fixture out/5.0.0/crosscheck.json shapes without throwing", async () => {
    const raw = await Bun.file(
      new URL("../../out/5.0.0/crosscheck.json", import.meta.url),
    ).json();
    const view = buildCrosscheckView(raw as CrosscheckJson);
    expect(view.ref).toBe("5.0.0");
    expect(Array.isArray(view.nodes)).toBe(true);
  });
});

describe("the graph has real edges", () => {
  test("a matched pair becomes an edge between a declared node and a referencing site", () => {
    const view = buildCrosscheckView(
      fixture({
        declaredUnreferenced: [],
        referencedUndeclared: [],
        matched: [
          {
            pattern: "wazuh-alerts*",
            template: "alerts.json",
            reference: {
              name: "wazuh-alerts",
              file: "plugins/main/common/constants.ts",
              line: 24,
              via: "catalog-literal",
            },
          },
        ],
      }),
    );

    expect(view.edges).toHaveLength(1);
    expect(view.edges[0]!.source).toBe("declared:wazuh-alerts*");
    expect(view.edges[0]!.target).toBe("referenced:plugins/main/common/constants.ts:24");
    expect(view.edges[0]!.file).toBe("plugins/main/common/constants.ts");
    expect(view.edges[0]!.line).toBe(24);

    // Both endpoints exist as nodes, and neither is an orphan: an edge is
    // proof that something reaches it.
    expect(view.nodes).toHaveLength(2);
    expect(view.nodes.every((n) => n.orphan === false)).toBe(true);
  });

  test("one declaration reached from two files is ONE node with two edges", () => {
    const reference = (file: string, line: number) =>
      ({ name: "wazuh-alerts", file, line, via: "import" }) as const;

    const view = buildCrosscheckView(
      fixture({
        declaredUnreferenced: [],
        referencedUndeclared: [],
        matched: [
          { pattern: "wazuh-alerts*", template: "alerts.json", reference: reference("a.ts", 1) },
          { pattern: "wazuh-alerts*", template: "alerts.json", reference: reference("b.ts", 2) },
        ],
      }),
    );

    expect(view.edges).toHaveLength(2);
    const declaredNodes = view.nodes.filter((n) => n.side === "declared");
    expect(declaredNodes).toHaveLength(1);
    expect(view.nodes.filter((n) => n.side === "referenced")).toHaveLength(2);
  });

  test("orphans on both sides are nodes that no edge touches", () => {
    const view = buildCrosscheckView(fixture());

    expect(view.edges).toEqual([]);
    const orphans = view.nodes.filter((n) => n.orphan);
    expect(orphans).toHaveLength(2);
    expect(orphans.map((n) => n.side).sort()).toEqual(["declared", "referenced"]);

    const touched = new Set(view.edges.flatMap((e) => [e.source, e.target]));
    expect(orphans.every((n) => !touched.has(n.id))).toBe(true);
  });

  test("a node is never both connected and abandoned", () => {
    // The same declared pattern appears matched AND in the orphan list. That
    // should be impossible upstream, but if it ever happens the graph must not
    // draw a contradiction -- one real edge disproves "nobody reaches this".
    const view = buildCrosscheckView(
      fixture({
        declaredUnreferenced: [{ pattern: "wazuh-a*", template: "a.json", group: "states" }],
        referencedUndeclared: [],
        matched: [
          {
            pattern: "wazuh-a*",
            template: "a.json",
            reference: { name: "wazuh-a", file: "x.ts", line: 3, via: "import" },
          },
        ],
      }),
    );

    const declared = view.nodes.filter((n) => n.side === "declared");
    expect(declared).toHaveLength(1);
    expect(declared[0]!.orphan).toBe(false);
  });
});

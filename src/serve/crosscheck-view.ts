/**
 * `buildCrosscheckView` — shapes `CrosscheckJson` (SPEC 1.8) into the
 * bipartite-graph payload the inspector draws (SPEC 1.5.1: the crosscheck "no
 * es una tabla: es un grafo bipartito ... con huérfanos de los dos lados";
 * SPEC 1.5.3 criterion 2).
 *
 * Declared indices on one side, the code that reaches them on the other, an
 * edge per matched pair, and the two orphan fringes that belong to neither.
 *
 * > An earlier version of this module returned `edges: []` and said so plainly,
 * > because `crosscheck.json` genuinely did not carry the matched pairs —
 * > `buildCrosscheck` computed the join and persisted only its leftovers. That
 * > was honest, and it was also a graph with no edges, which is a list. The fix
 * > went to the source: `CrosscheckJson.matched` now survives, and this module
 * > draws it.
 *
 * Node identity is the VALUE, not the array position. Two references to the
 * same index from two files are two edges into one node, and an id derived from
 * a list index would have made them two unrelated nodes that happen to share a
 * label.
 *
 * Pure. No fs, no clock, no network.
 */

import type {
  CompetingCatalog,
  Coverage,
  CrosscheckJson,
  DeclaredIndex,
  IndexReference,
} from "../matrix/types.ts";

export interface CrosscheckNode {
  readonly id: string;
  readonly side: "declared" | "referenced";
  readonly label: string;
  /** No edge touches this node: declared with no consumer, or referenced with no declaration. */
  readonly orphan: boolean;
  readonly detail: DeclaredIndex | IndexReference;
}

export interface CrosscheckEdge {
  readonly source: string;
  readonly target: string;
  /** Where the reference sits, so the UI can send a reader straight to it. */
  readonly file: string;
  readonly line: number;
}

export interface CrosscheckOrphans {
  readonly declaredUnreferenced: readonly DeclaredIndex[];
  readonly referencedUndeclared: readonly IndexReference[];
}

export interface CrosscheckView {
  readonly meta: { readonly generatedAt: string; readonly tool: string };
  readonly ref: string;
  readonly coverage: Coverage;
  readonly nodes: readonly CrosscheckNode[];
  readonly edges: readonly CrosscheckEdge[];
  readonly orphans: CrosscheckOrphans;
  readonly wcsWithoutConsumer: readonly string[];
  readonly competingCatalogs: readonly CompetingCatalog[];
}

export function declaredNodeId(pattern: string): string {
  return `declared:${pattern}`;
}

/**
 * A referencing SITE, not a name. The same index reached from two files is two
 * things to fix, which is the rule `referencedUndeclared` already follows.
 */
export function referencedNodeId(reference: Pick<IndexReference, "file" | "line">): string {
  return `referenced:${reference.file}:${reference.line}`;
}

export function buildCrosscheckView(crosscheck: CrosscheckJson): CrosscheckView {
  const nodes = new Map<string, CrosscheckNode>();

  const addNode = (node: CrosscheckNode): void => {
    const existing = nodes.get(node.id);
    // A node is an orphan only while nothing connects it. Matched wins, because
    // one real edge disproves "nobody reaches this".
    if (existing) {
      if (existing.orphan && !node.orphan) nodes.set(node.id, { ...existing, orphan: false });
      return;
    }
    nodes.set(node.id, node);
  };

  const edges: CrosscheckEdge[] = crosscheck.matched.map((pair) => {
    addNode({
      id: declaredNodeId(pair.pattern),
      side: "declared",
      label: pair.pattern,
      orphan: false,
      detail: { pattern: pair.pattern, template: pair.template, group: "" },
    });
    addNode({
      id: referencedNodeId(pair.reference),
      side: "referenced",
      label: pair.reference.name,
      orphan: false,
      detail: pair.reference,
    });

    return {
      source: declaredNodeId(pair.pattern),
      target: referencedNodeId(pair.reference),
      file: pair.reference.file,
      line: pair.reference.line,
    };
  });

  for (const entry of crosscheck.declaredUnreferenced) {
    addNode({
      id: declaredNodeId(entry.pattern),
      side: "declared",
      label: entry.pattern,
      orphan: true,
      detail: entry,
    });
  }

  for (const entry of crosscheck.referencedUndeclared) {
    addNode({
      id: referencedNodeId(entry),
      side: "referenced",
      label: entry.name,
      orphan: true,
      detail: entry,
    });
  }

  return {
    meta: crosscheck.meta,
    ref: crosscheck.ref,
    coverage: crosscheck.coverage,
    nodes: [...nodes.values()],
    edges,
    orphans: {
      declaredUnreferenced: crosscheck.declaredUnreferenced,
      referencedUndeclared: crosscheck.referencedUndeclared,
    },
    wcsWithoutConsumer: crosscheck.wcsWithoutConsumer,
    competingCatalogs: crosscheck.competingCatalogs,
  };
}

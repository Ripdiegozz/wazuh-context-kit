import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { api } from "@/api/client";
import { useAsync } from "@/api/useApi";
import type { CrosscheckEdge, CrosscheckNode, CrosscheckView } from "@/api/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

/**
 * SPEC 1.5.3 criterion 2 -- the crosscheck as a GRAPH, with orphans on both
 * sides visible. Real data: 818 edges, 35 connected declared patterns, 5
 * declared orphans, 24 referenced orphans, and up to 304 referencing sites
 * for one pattern. A naive force-directed layout of ~850 nodes is a
 * hairball, so this is a deliberate two-column bipartite layout: declared
 * patterns on the left, referencing sites on the right, with a FOCUS
 * interaction -- selecting one side's node narrows the other column to
 * exactly its neighbourhood and draws the edges between them. Unfocused, the
 * right column shows only the small, high-signal set (orphans); the full
 * referenced side is reachable through search.
 */

interface Point {
  x: number;
  y: number;
}

function nodeLabel(node: CrosscheckNode): string {
  if (node.side === "declared") return node.label;
  const ref = node.detail as { file: string; line: number };
  return `${node.label} — ${ref.file}:${ref.line}`;
}

function NodeRow({
  node,
  degree,
  focused,
  onClick,
  registerRef,
}: {
  node: CrosscheckNode;
  degree: number;
  focused: boolean;
  onClick: () => void;
  registerRef: (el: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      ref={registerRef}
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors",
        focused ? "border-primary bg-primary/10" : "border-transparent hover:bg-accent",
      )}
    >
      <span
        className="mt-0.5 size-2 shrink-0 rounded-full"
        style={{
          backgroundColor: node.orphan
            ? "var(--node-orphan)"
            : node.side === "declared"
              ? "var(--node-declared)"
              : "var(--node-referenced)",
        }}
      />
      <span className="flex-1 truncate font-mono">{nodeLabel(node)}</span>
      {node.orphan ? (
        <Badge variant="destructive" className="shrink-0">
          orphan
        </Badge>
      ) : (
        <Badge variant="outline" className="shrink-0">
          {degree}
        </Badge>
      )}
    </button>
  );
}

export function CrosscheckGraphView() {
  const { data, error, loading } = useAsync(() => api.getCrosscheck(), []);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [searchDeclared, setSearchDeclared] = useState("");
  const [searchReferenced, setSearchReferenced] = useState("");
  const [onlyOrphans, setOnlyOrphans] = useState(true);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const leftRefs = useRef(new Map<string, HTMLButtonElement>());
  const rightRefs = useRef(new Map<string, HTMLButtonElement>());
  const [lines, setLines] = useState<{ from: Point; to: Point; id: string }[]>([]);

  const declaredNodes = useMemo(() => (data ? data.nodes.filter((n) => n.side === "declared") : []), [data]);
  const referencedNodes = useMemo(
    () => (data ? data.nodes.filter((n) => n.side === "referenced") : []),
    [data],
  );

  const edgesByDeclared = useMemo(() => {
    const map = new Map<string, CrosscheckEdge[]>();
    if (!data) return map;
    for (const edge of data.edges) {
      const list = map.get(edge.source) ?? [];
      list.push(edge);
      map.set(edge.source, list);
    }
    return map;
  }, [data]);

  const edgesByReferenced = useMemo(() => {
    const map = new Map<string, CrosscheckEdge>();
    if (!data) return map;
    for (const edge of data.edges) map.set(edge.target, edge);
    return map;
  }, [data]);

  const focusedDeclaredEdges = focusId ? (edgesByDeclared.get(focusId) ?? []) : [];
  const focusedReferencedEdge = focusId ? edgesByReferenced.get(focusId) : undefined;

  const visibleDeclared = useMemo(() => {
    const needle = searchDeclared.trim().toLowerCase();
    return declaredNodes.filter((n) => !needle || n.label.toLowerCase().includes(needle));
  }, [declaredNodes, searchDeclared]);

  const visibleReferenced = useMemo(() => {
    const needle = searchReferenced.trim().toLowerCase();

    if (focusId && edgesByDeclared.has(focusId)) {
      const targets = new Set(focusedDeclaredEdges.map((e) => e.target));
      return referencedNodes.filter((n) => targets.has(n.id));
    }
    if (focusId && focusedReferencedEdge) {
      return referencedNodes.filter((n) => n.id === focusId);
    }

    return referencedNodes.filter((n) => {
      if (needle) return nodeLabel(n).toLowerCase().includes(needle);
      return onlyOrphans ? n.orphan : true;
    });
  }, [
    referencedNodes,
    searchReferenced,
    onlyOrphans,
    focusId,
    edgesByDeclared,
    focusedDeclaredEdges,
    focusedReferencedEdge,
  ]);

  const visibleDeclaredForFocus = useMemo(() => {
    if (!focusId) return visibleDeclared;
    if (edgesByDeclared.has(focusId)) return visibleDeclared.filter((n) => n.id === focusId);
    if (focusedReferencedEdge) return declaredNodes.filter((n) => n.id === focusedReferencedEdge.source);
    return visibleDeclared;
  }, [focusId, visibleDeclared, edgesByDeclared, focusedReferencedEdge, declaredNodes]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !focusId) {
      setLines([]);
      return;
    }
    const containerRect = container.getBoundingClientRect();

    function centerRight(el: Element): Point {
      const r = el.getBoundingClientRect();
      return { x: r.left - containerRect.left, y: r.top - containerRect.top + r.height / 2 };
    }
    function centerLeft(el: Element): Point {
      const r = el.getBoundingClientRect();
      return { x: r.right - containerRect.left, y: r.top - containerRect.top + r.height / 2 };
    }

    const next: { from: Point; to: Point; id: string }[] = [];

    if (edgesByDeclared.has(focusId)) {
      const leftEl = leftRefs.current.get(focusId);
      if (leftEl) {
        const from = centerLeft(leftEl);
        for (const edge of focusedDeclaredEdges) {
          const rightEl = rightRefs.current.get(edge.target);
          if (rightEl) next.push({ from, to: centerRight(rightEl), id: `${edge.source}->${edge.target}` });
        }
      }
    } else if (focusedReferencedEdge) {
      const rightEl = rightRefs.current.get(focusId);
      const leftEl = leftRefs.current.get(focusedReferencedEdge.source);
      if (rightEl && leftEl) {
        next.push({
          from: centerLeft(leftEl),
          to: centerRight(rightEl),
          id: `${focusedReferencedEdge.source}->${focusedReferencedEdge.target}`,
        });
      }
    }

    setLines(next);
    // Recompute on resize too -- row positions shift when the window changes.
  }, [focusId, focusedDeclaredEdges, focusedReferencedEdge, visibleDeclaredForFocus, visibleReferenced]);

  if (loading) return <p className="p-4 text-sm text-muted-foreground">Loading crosscheck…</p>;
  if (error) return <p className="p-4 text-sm text-destructive">Failed to load crosscheck: {error.message}</p>;
  if (!data) return null;

  return (
    <div className="flex flex-col gap-4">
      <CoverageStrip data={data} />

      <Card>
        <CardHeader>
          <CardTitle>Crosscheck graph</CardTitle>
          <CardDescription>
            {data.nodes.filter((n) => n.side === "declared").length} declared patterns ·{" "}
            {data.edges.length} edges · {data.orphans.declaredUnreferenced.length} declared orphans ·{" "}
            {data.orphans.referencedUndeclared.length} referenced orphans. Click a node to focus its
            neighbourhood; orphans are the findings, matches are the boring case.
          </CardDescription>
          {focusId ? (
            <Button size="sm" variant="secondary" className="w-fit" onClick={() => setFocusId(null)}>
              Clear focus
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          <div ref={containerRef} className="relative grid grid-cols-2 gap-6">
            <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden>
              {lines.map((line) => (
                <line
                  key={line.id}
                  x1={line.from.x}
                  y1={line.from.y}
                  x2={line.to.x}
                  y2={line.to.y}
                  stroke="var(--primary)"
                  strokeOpacity={0.55}
                  strokeWidth={1.25}
                />
              ))}
            </svg>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-muted-foreground">
                  Declared indices ({visibleDeclaredForFocus.length})
                </h4>
              </div>
              <Input
                placeholder="Search declared pattern…"
                value={searchDeclared}
                onChange={(e) => setSearchDeclared(e.target.value)}
              />
              <ScrollArea className="h-[55vh] rounded-md border border-border p-1">
                <div className="flex flex-col gap-1 p-1">
                  {visibleDeclaredForFocus.map((node) => (
                    <NodeRow
                      key={node.id}
                      node={node}
                      degree={edgesByDeclared.get(node.id)?.length ?? 0}
                      focused={node.id === focusId}
                      onClick={() => setFocusId(node.id === focusId ? null : node.id)}
                      registerRef={(el) => {
                        if (el) leftRefs.current.set(node.id, el);
                        else leftRefs.current.delete(node.id);
                      }}
                    />
                  ))}
                </div>
              </ScrollArea>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-muted-foreground">
                  Referencing sites ({visibleReferenced.length})
                </h4>
                {!focusId && (
                  <Button size="sm" variant="ghost" onClick={() => setOnlyOrphans((v) => !v)}>
                    {onlyOrphans ? "Show all" : "Orphans only"}
                  </Button>
                )}
              </div>
              <Input
                placeholder="Search referencing site or index name…"
                value={searchReferenced}
                onChange={(e) => setSearchReferenced(e.target.value)}
              />
              <ScrollArea className="h-[55vh] rounded-md border border-border p-1">
                <div className="flex flex-col gap-1 p-1">
                  {visibleReferenced.map((node) => (
                    <NodeRow
                      key={node.id}
                      node={node}
                      degree={1}
                      focused={node.id === focusId}
                      onClick={() => setFocusId(node.id === focusId ? null : node.id)}
                      registerRef={(el) => {
                        if (el) rightRefs.current.set(node.id, el);
                        else rightRefs.current.delete(node.id);
                      }}
                    />
                  ))}
                </div>
              </ScrollArea>
            </div>
          </div>
        </CardContent>
      </Card>

      {data.competingCatalogs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Competing catalogs</CardTitle>
            <CardDescription>
              Two or more modules declare the same index name as authoritative.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-xs">
            {data.competingCatalogs.map((c) => (
              <div key={c.name} className="rounded-md border border-border p-2">
                <div className="font-mono font-medium">{c.name}</div>
                <div className="text-muted-foreground">{c.files.join(", ")}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function CoverageStrip({ data }: { data: CrosscheckView }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Coverage</CardTitle>
          <CardDescription>
            "No consumer found" is not "no consumer exists" -- {data.coverage.recoveredNames} names
            recovered across {data.coverage.scannedRepos.length} repos,{" "}
            {data.coverage.uncovered.length} sites the scan could not resolve.
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
          {open ? "Hide" : "Show"} uncovered sites
        </Button>
      </CardHeader>
      {open && (
        <CardContent className="flex flex-col gap-1 text-xs">
          {data.coverage.uncovered.map((u, i) => (
            <div key={i} className="rounded border border-border p-2 font-mono">
              <span className="text-muted-foreground">[{u.kind}]</span> {u.file}:{u.line} — {u.note}
            </div>
          ))}
          {data.coverage.uncovered.length === 0 && <p className="text-muted-foreground">None recorded.</p>}
        </CardContent>
      )}
    </Card>
  );
}

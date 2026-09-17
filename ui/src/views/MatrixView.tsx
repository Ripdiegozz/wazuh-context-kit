import { useMemo, useState } from "react";
import { api } from "@/api/client";
import { useAsync } from "@/api/useApi";
import type { MatrixPlugin, Evidence } from "@/api/types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EvidenceCell } from "@/components/matrix/EvidenceBadge";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AnnotationEditDialog } from "@/components/edit/AnnotationEditDialog";

/** Fields worth their own column -- the ones a maintainer checks evidence for. */
const FIELDS: { key: keyof MatrixPlugin; label: string }[] = [
  { key: "world", label: "world" },
  { key: "versionScheme", label: "version scheme" },
  { key: "serverApiAccess", label: "server API" },
  { key: "indexerAccess", label: "indexer access" },
  { key: "configPath", label: "config path" },
];

function fieldValue(plugin: MatrixPlugin, key: keyof MatrixPlugin): string {
  const value = plugin[key];
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  return value == null || value === "" ? "—" : String(value);
}

/** A field's evidence is the assertion when present (SPEC 1.7.1), else the plugin's own evidence. */
function evidenceFor(plugin: MatrixPlugin, field: string): Evidence {
  return plugin.assertions[field] ?? plugin.evidence;
}

export function MatrixView() {
  const { data, error, loading } = useAsync(() => api.getMatrix(), []);
  const [filter, setFilter] = useState("");
  const [worldFilter, setWorldFilter] = useState<string>("all");
  const [annotating, setAnnotating] = useState<string | undefined>();

  const plugins = data?.matrix.plugins ?? [];

  const worlds = useMemo(() => {
    const set = new Set(plugins.map((p) => p.world));
    return ["all", ...set];
  }, [plugins]);

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return plugins.filter((p) => {
      if (worldFilter !== "all" && p.world !== worldFilter) return false;
      if (!needle) return true;
      return (
        p.pluginId.toLowerCase().includes(needle) ||
        p.repo.toLowerCase().includes(needle)
      );
    });
  }, [plugins, filter, worldFilter]);

  if (loading) return <p className="p-4 text-sm text-muted-foreground">Loading matrix…</p>;
  if (error) return <p className="p-4 text-sm text-destructive">Failed to load matrix: {error.message}</p>;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Plugins × fields</CardTitle>
            <CardDescription>
              {plugins.length} plugins, ref {data?.matrix.ref}. Each cell names its evidence kind and origin
              (SPEC 1.5.3 criterion 3) -- derived cells link to file + commit; assertions show source, author,
              date, and reason.
            </CardDescription>
            <div className="flex gap-2 pt-2">
              <Input
                placeholder="Filter by plugin id or repo…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="max-w-xs"
              />
              <select
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                value={worldFilter}
                onChange={(e) => setWorldFilter(e.target.value)}
              >
                {worlds.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
              <Badge variant="outline" className="ml-auto self-center">
                {filtered.length} shown
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[70vh]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 bg-card">plugin</TableHead>
                    <TableHead>repo</TableHead>
                    {FIELDS.map((f) => (
                      <TableHead key={f.key}>{f.label}</TableHead>
                    ))}
                    <TableHead>annotations</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((plugin) => (
                    <TableRow key={`${plugin.repo}::${plugin.pluginId}`}>
                      <TableCell className="sticky left-0 bg-card font-medium">{plugin.pluginId}</TableCell>
                      <TableCell className="text-muted-foreground">{plugin.repo}</TableCell>
                      {FIELDS.map((f) => (
                        <TableCell key={f.key}>
                          <div className="flex flex-col gap-1">
                            <span>{fieldValue(plugin, f.key)}</span>
                            <EvidenceCell evidence={evidenceFor(plugin, f.key)} />
                          </div>
                        </TableCell>
                      ))}
                      <TableCell className="max-w-48">
                        {plugin.annotations.length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <div className="flex flex-col gap-1">
                            {plugin.annotations.map((a, i) => (
                              <div key={i} className="text-xs">
                                <Badge variant="annotation" className="mr-1">
                                  {a.kind}
                                </Badge>
                                {a.text}
                              </div>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button size="sm" variant="ghost" onClick={() => setAnnotating(plugin.pluginId)}>
                          Annotate…
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {annotating && (
        <AnnotationEditDialog
          open={Boolean(annotating)}
          onOpenChange={(open) => !open && setAnnotating(undefined)}
          plugin={annotating}
        />
      )}
    </TooltipProvider>
  );
}

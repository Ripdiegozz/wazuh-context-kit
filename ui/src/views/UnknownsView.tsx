import { useState } from "react";
import { api } from "@/api/client";
import { useAsync } from "@/api/useApi";
import type { UnknownWithTelemetry } from "@/api/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DecisionEditDialog } from "@/components/edit/DecisionEditDialog";

/** SPEC 5.5: unknowns ordered by "dolor real" -- real pain, i.e. telemetry, not alphabetically. */
export function UnknownsView() {
  const { data, error, loading, refetch } = useUnknowns();
  const [editing, setEditing] = useState<UnknownWithTelemetry | undefined>();

  if (loading) return <p className="p-4 text-sm text-muted-foreground">Loading unknowns…</p>;
  if (error) return <p className="p-4 text-sm text-destructive">Failed to load unknowns: {error.message}</p>;

  const unknowns = data?.unknowns ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Unknowns work queue</CardTitle>
        <CardDescription>
          {unknowns.length} unresolved fields, ordered by unresolved query count then total queries -- the
          field asked about most and still unanswered sits first.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>plugin</TableHead>
              <TableHead>field</TableHead>
              <TableHead>reason</TableHead>
              <TableHead>unresolved queries</TableHead>
              <TableHead>total queries</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {unknowns.map((u) => (
              <TableRow key={`${u.plugin}::${u.field}`}>
                <TableCell className="font-medium">{u.plugin}</TableCell>
                <TableCell className="font-mono text-xs">{u.field}</TableCell>
                <TableCell className="text-muted-foreground">{u.reason}</TableCell>
                <TableCell>
                  <Badge variant={u.unresolvedQueries > 0 ? "destructive" : "outline"}>
                    {u.unresolvedQueries}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">{u.totalQueries}</TableCell>
                <TableCell>
                  <Button size="sm" variant="outline" onClick={() => setEditing(u)}>
                    Resolve…
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {unknowns.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  No unknowns -- every field is either derived or asserted.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>

      {editing && (
        <DecisionEditDialog
          open={Boolean(editing)}
          onOpenChange={(open) => !open && setEditing(undefined)}
          plugin={editing.plugin}
          field={editing.field}
          onSaved={() => refetch()}
        />
      )}
    </Card>
  );
}

function useUnknowns() {
  const [nonce, setNonce] = useState(0);
  const state = useAsync(() => api.getUnknowns(), [nonce]);
  return { ...state, refetch: () => setNonce((n) => n + 1) };
}

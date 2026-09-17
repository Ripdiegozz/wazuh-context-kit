import { cn } from "@/lib/utils";

/**
 * SPEC 1.5.3 criterion 4 / SPEC 1.5.1: "El botón de guardar no muta estado:
 * produce un diff para commitear." This renders exactly the `lines` the
 * server already formatted (`+`/`~`/`-` per entry, `src/serve/yaml-diff.ts`'s
 * `formatDiffLines`) -- never re-derived client-side, so the UI can never
 * show a diff that disagrees with what a write would actually do.
 */
export function DiffPreview({ lines }: { lines: string[] }) {
  if (lines.length === 0) {
    return <p className="text-xs text-muted-foreground">No changes -- this entry already matches the file.</p>;
  }
  return (
    <pre className="max-h-64 overflow-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-xs">
      {lines.map((line, i) => (
        <div
          key={i}
          className={cn(
            line.startsWith("+") && "text-emerald-400",
            line.startsWith("~") && "text-amber-400",
            line.startsWith("-") && "text-red-400",
          )}
        >
          {line}
        </div>
      ))}
    </pre>
  );
}

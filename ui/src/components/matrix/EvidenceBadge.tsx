import type { AssertedEvidence, DerivedEvidence, Evidence } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * SPEC 1.5.3 criterion 3: every cell shows its evidence.kind and origin, and a
 * derived cell links to file + commit -- not hidden behind a click-through
 * only. The badge label is always visible; the tooltip adds the full origin
 * without requiring a click.
 *
 * The link target is `evidence.url`, computed server-side (src/github.ts's
 * `repoBrowseUrl`, wired in `src/serve/handlers.ts`). This file used to
 * construct it client-side by assuming those repos live under
 * `github.com/wazuh/<repo>` -- an assumption that was never an API field.
 * The UI must not guess it; it only renders what the server already resolved.
 */

function commitShort(commit: string): string {
  return commit.length > 10 ? commit.slice(0, 10) : commit;
}

export function DerivedOrigin({ evidence }: { evidence: DerivedEvidence }) {
  const url = evidence.url;
  return (
    <span className="flex flex-col gap-0.5">
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-xs text-primary underline underline-offset-2"
        >
          {evidence.manifestPath}
        </a>
      ) : (
        <span className="font-mono text-xs text-foreground/90">{evidence.manifestPath}</span>
      )}
      <span className="font-mono text-[11px] text-muted-foreground">@ {commitShort(evidence.commit)}</span>
      {evidence.packageJsonPath ? (
        <span className="font-mono text-[11px] text-muted-foreground">{evidence.packageJsonPath}</span>
      ) : null}
    </span>
  );
}

export function AssertedOrigin({ evidence }: { evidence: AssertedEvidence }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-xs text-foreground/90">{evidence.source}</span>
      <span className="text-[11px] text-muted-foreground">
        {evidence.author} · {evidence.date}
      </span>
      <span className="text-[11px] text-muted-foreground italic">{evidence.reason}</span>
    </span>
  );
}

export function EvidenceCell({ evidence }: { evidence: Evidence }) {
  if (evidence.kind === "derived") {
    return (
      <div className="flex flex-col gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="derived">derived</Badge>
          </TooltipTrigger>
          <TooltipContent>
            <DerivedOrigin evidence={evidence} />
          </TooltipContent>
        </Tooltip>
        <DerivedOrigin evidence={evidence} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="assertion" className={evidence.overlay === "local" ? "ring-1 ring-primary" : undefined}>
            human-assertion{evidence.overlay === "local" ? " (local)" : ""}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <AssertedOrigin evidence={evidence} />
        </TooltipContent>
      </Tooltip>
      <AssertedOrigin evidence={evidence} />
    </div>
  );
}

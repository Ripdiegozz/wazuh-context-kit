import { useState } from "react";
import { api } from "@/api/client";
import type { Decision, DecisionsTarget, SaveResponseBody } from "@/api/types";
import { decisionKey, upsert } from "@/lib/entries";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DiffPreview } from "./DiffPreview";

/**
 * Authors one decision entry and requires the mandatory diff-before-write
 * step (SPEC 1.5.1: "La UI es una herramienta de autoría de PRs, no un panel
 * de administración"). `entries` sent to `POST /api/decisions` REPLACES the
 * target file wholesale (`handlers.ts` stringifies exactly the proposed
 * array), so this dialog first reads the current entries via `GET
 * /api/decisions` -- a real read endpoint, not a write-endpoint side effect --
 * upserts this one entry client-side, then previews and only writes on
 * explicit confirm.
 */

export interface DecisionEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plugin: string;
  field: string;
  onSaved?: () => void;
}

type Step = "form" | "diff" | "done";

export function DecisionEditDialog({ open, onOpenChange, plugin, field, onSaved }: DecisionEditDialogProps) {
  const [target, setTarget] = useState<DecisionsTarget>("decisions.yml");
  const [value, setValue] = useState("");
  const [author, setAuthor] = useState("");
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  const [step, setStep] = useState<Step>("form");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | undefined>();
  const [preview, setPreview] = useState<SaveResponseBody<Decision> | undefined>();
  const [fullEntries, setFullEntries] = useState<Decision[]>([]);

  function reset() {
    setStep("form");
    setPreview(undefined);
    setErrorMsg(undefined);
    setFullEntries([]);
  }

  async function handlePreview() {
    setBusy(true);
    setErrorMsg(undefined);
    try {
      const entry: Decision = { plugin, field, value: parseValue(value), author, date, reason };

      const current = await api.getDecisions(target);
      const next = upsert(current.entries, entry, decisionKey);

      const result = await api.postDecisions({ target, confirm: false, entries: next });
      setFullEntries(next);
      setPreview(result);
      setStep("diff");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm() {
    setBusy(true);
    setErrorMsg(undefined);
    try {
      await api.postDecisions({ target, confirm: true, entries: fullEntries });
      setStep("done");
      onSaved?.();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Resolve {plugin} · {field}</DialogTitle>
          <DialogDescription>
            Authors one decision entry. Saving never mutates state directly -- it produces a diff to
            commit, and only writes after you confirm.
          </DialogDescription>
        </DialogHeader>

        {step === "form" && (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs">
              Target file
              <select
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                value={target}
                onChange={(e) => setTarget(e.target.value as DecisionsTarget)}
              >
                <option value="decisions.yml">decisions.yml (shared)</option>
                <option value="decisions.local.yml">decisions.local.yml (local escape hatch, gitignored)</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              Value
              <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. wazuh-native" />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              Author
              <Input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="you@wazuh.com" />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              Date
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              Reason
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="why this value" />
            </label>
            {errorMsg && <p className="text-xs text-destructive">{errorMsg}</p>}
          </div>
        )}

        {step === "diff" && preview && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">
              Diff against <span className="font-mono">{preview.target}</span>:
            </p>
            <DiffPreview lines={preview.lines} />
            {errorMsg && <p className="text-xs text-destructive">{errorMsg}</p>}
          </div>
        )}

        {step === "done" && <p className="text-sm text-emerald-400">Saved to {target}.</p>}

        <DialogFooter>
          {step === "form" && (
            <Button onClick={handlePreview} disabled={busy || !author || !reason}>
              {busy ? "Computing diff…" : "Preview diff"}
            </Button>
          )}
          {step === "diff" && (
            <>
              <Button variant="secondary" onClick={() => setStep("form")} disabled={busy}>
                Back
              </Button>
              <Button onClick={handleConfirm} disabled={busy}>
                {busy ? "Writing…" : "Confirm and write"}
              </Button>
            </>
          )}
          {step === "done" && <Button onClick={() => onOpenChange(false)}>Close</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function parseValue(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw.trim() !== "" && !Number.isNaN(Number(raw))) return Number(raw);
  return raw;
}

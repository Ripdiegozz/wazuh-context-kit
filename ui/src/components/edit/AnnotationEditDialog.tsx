import { useState } from "react";
import { api } from "@/api/client";
import type { Annotation, SaveResponseBody } from "@/api/types";
import { ANNOTATIONS_TARGET } from "@/api/types";
import { annotationKey, upsert } from "@/lib/entries";
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

export interface AnnotationEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plugin: string;
  onSaved?: () => void;
}

type Step = "form" | "diff" | "done";

/**
 * Same two-step preview-then-confirm shape as DecisionEditDialog (SPEC
 * 1.5.3 criterion 4), for Layer 3 annotations -- additive only, never
 * changing a value above (SPEC 1.7.2). Reads the current entries via
 * `GET /api/annotations` -- never by peeking at the write endpoint's diff.
 */
export function AnnotationEditDialog({ open, onOpenChange, plugin, onSaved }: AnnotationEditDialogProps) {
  const [kind, setKind] = useState<Annotation["kind"]>("note");
  const [text, setText] = useState("");
  const [author, setAuthor] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  const [step, setStep] = useState<Step>("form");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | undefined>();
  const [preview, setPreview] = useState<SaveResponseBody<Annotation> | undefined>();
  const [fullEntries, setFullEntries] = useState<Annotation[]>([]);

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
      const entry: Annotation = { plugin, kind, text, author, date };

      const current = await api.getAnnotations();
      const next = upsert(current.entries, entry, annotationKey);

      const result = await api.postAnnotations({ target: ANNOTATIONS_TARGET, confirm: false, entries: next });
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
      await api.postAnnotations({ target: ANNOTATIONS_TARGET, confirm: true, entries: fullEntries });
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
          <DialogTitle>Annotate {plugin}</DialogTitle>
          <DialogDescription>
            Layer 3, additive only. Saving produces a diff to commit -- it never writes until confirmed.
          </DialogDescription>
        </DialogHeader>

        {step === "form" && (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs">
              Kind
              <select
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                value={kind}
                onChange={(e) => setKind(e.target.value as Annotation["kind"])}
              >
                <option value="note">note</option>
                <option value="warning">warning</option>
                <option value="ownership">ownership</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              Text
              <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="annotation text" />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              Author
              <Input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="you@wazuh.com" />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              Date
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
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

        {step === "done" && <p className="text-sm text-emerald-400">Saved to annotations.yml.</p>}

        <DialogFooter>
          {step === "form" && (
            <Button onClick={handlePreview} disabled={busy || !author || !text}>
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

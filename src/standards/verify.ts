/**
 * `verifyStandards` — `manifest + observed hashes -> CheckResult`, the pure
 * core of `check` (SPEC 2.3's "detect that a distributed standard was edited
 * locally and stop"). Pure: no fs, no network, no clock — `apply.ts`'s
 * `checkStandards` is the only place that reads a directory or a file; this
 * module only classifies bytes it is handed.
 *
 * Three states as an ENUM, never a boolean plus a special case (design
 * decision 3): `"not-applicable" | "in-sync" | "drifted"`. A boolean invites
 * `if (!ok)`, which is exactly how "no target" becomes "failed" or "fine"
 * depending on which way the author leaned — SPEC 2.4's own criterion this
 * module exists to satisfy. The exit-code mapping for these three states
 * lives in `cli.ts`, never here (design decision 3): this module answers
 * "what is true", not "what should the process do about it".
 *
 * The manifest is the contract `sync` and `check` share (design decision 2):
 * without it, "edited locally" cannot be told apart from "a different
 * version was synced", and reporting the second as the first would be a
 * false accusation — the failure class this project has now met four times
 * (`exploration.md`, `dataset-freshness`, the crosscheck, `skills-core`'s
 * marker attribution). `currentTool` lets this module say WHICH of the two
 * happened instead of guessing: a hash mismatch under a manifest written by
 * a different tool version is reported with its own reason
 * (`"tool-version-mismatch"`), never folded into `"modified"` — the reason a
 * person reads to decide whether to blame a colleague's edit or a tool
 * upgrade.
 */

export type CheckState = "not-applicable" | "in-sync" | "drifted";

export type DriftReason = "modified" | "missing" | "unexpected" | "tool-version-mismatch";

export interface DriftedFile {
  readonly path: string;
  readonly reason: DriftReason;
}

export interface CheckResult {
  readonly state: CheckState;
  /** Always empty when `state !== "drifted"`. Never the first blocking
   * reason only — SPEC's gate-is-a-filter discipline applies here too: a
   * `check` naming one drifted file out of five is as useless as a `sync`
   * naming one blocking conflict out of six. */
  readonly drifted: readonly DriftedFile[];
  readonly message: string;
}

export interface ManifestFile {
  readonly path: string;
  readonly hash: string;
}

export interface SyncManifest {
  readonly tool: string;
  readonly payloadHash: string;
  readonly files: readonly ManifestFile[];
}

export interface ObservedFile {
  readonly path: string;
  readonly hash: string;
}

export interface VerifyStandardsInput {
  /** Whether `.claude/standards/` exists at all — the SPEC 2.4 criterion
   * this module exists to satisfy hinges entirely on this flag being
   * checked FIRST and independently of `manifest`/`observed`. */
  readonly targetExists: boolean;
  /** `null` when `.claude/standards/manifest.json` is missing or unreadable
   * — including when `targetExists` is `true` but nothing was ever synced
   * cleanly. Never used to infer `targetExists`; those are independent
   * facts the caller gathers separately. */
  readonly manifest: SyncManifest | null;
  /** Every non-manifest file actually found under `.claude/standards/`,
   * hashed over its exact bytes — no normalisation (design's "what could go
   * wrong": hashing a formatter's touch as a match is how a real edit gets
   * hidden). */
  readonly observed: readonly ObservedFile[];
  readonly currentTool: string;
}

function fileList(files: readonly DriftedFile[]): string {
  return files.map((f) => f.path).join(", ");
}

/**
 * Classifies one target's state from the bytes `apply.ts` gathered.
 *
 * Order of checks matters and is deliberate: `targetExists` is decided
 * BEFORE anything about `manifest` or `observed` is even considered — an
 * absent target is `"not-applicable"` no matter what garbage a caller might
 * pass alongside `targetExists: false` (task 2.2). A present target with no
 * readable manifest is `"drifted"`, never `"not-applicable"` (there IS
 * something there) and never `"in-sync"` (nothing proves it matches
 * anything) — SPEC 2.4's "partially-synced is drifted, not not-applicable"
 * generalises to "unverifiable is drifted, not assumed fine" (task 2.3).
 */
export function verifyStandards(input: VerifyStandardsInput): CheckResult {
  if (!input.targetExists) {
    return {
      state: "not-applicable",
      drifted: [],
      message: "no .claude/standards/ present — nothing to check",
    };
  }

  if (input.manifest === null) {
    const drifted: DriftedFile[] = input.observed.map((f) => ({ path: f.path, reason: "unexpected" as const }));
    return {
      state: "drifted",
      drifted,
      message:
        ".claude/standards/ is present but carries no readable manifest.json — its provenance cannot be verified",
    };
  }

  const toolMismatch = input.manifest.tool !== input.currentTool;
  const observedByPath = new Map(input.observed.map((f) => [f.path, f.hash] as const));
  const manifestPaths = new Set(input.manifest.files.map((f) => f.path));

  const drifted: DriftedFile[] = [];

  for (const file of input.manifest.files) {
    const observedHash = observedByPath.get(file.path);
    if (observedHash === undefined) {
      drifted.push({ path: file.path, reason: "missing" });
    } else if (observedHash !== file.hash) {
      drifted.push({ path: file.path, reason: toolMismatch ? "tool-version-mismatch" : "modified" });
    }
  }

  for (const file of input.observed) {
    if (!manifestPaths.has(file.path)) {
      drifted.push({ path: file.path, reason: "unexpected" });
    }
  }

  if (drifted.length === 0) {
    return { state: "in-sync", drifted: [], message: ".claude/standards/ matches the manifest" };
  }

  const names = fileList(drifted);
  const message = toolMismatch
    ? `.claude/standards/ differs from the manifest, which was written by a different tool version ` +
      `(${input.manifest.tool} vs ${input.currentTool}): ${names}`
    : `.claude/standards/ has drifted from the manifest: ${names}`;

  return { state: "drifted", drifted, message };
}

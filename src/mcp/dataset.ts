/**
 * `schema`'s dataset loader (SPEC "schema serves the published dataset
 * without network"; design "the refusal gates run in order", steps 1-2).
 *
 * This is the composition edge (design "The one structural decision"): it does
 * the filesystem read that `matrix/` is not allowed to do. `matrix/` stays
 * pure -- this module imports `verifyPayloadHash` from it, never the other way
 * around.
 *
 * The clock is injected (`Clock`), exactly as `--frozen-time` and
 * `src/fetch/types.ts`'s `FetchIo.now` already do. Nothing in here calls
 * `Date.now()` or `new Date()` directly.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { verifyPayloadHash } from "../matrix/hash.ts";
import type { IndexTemplate, MatrixJson, WcsModule } from "../matrix/types.ts";

/** ISO-8601. Injected so nothing in this module reads the real clock. */
export type Clock = () => string;

export interface DatasetAbsent {
  readonly ok: false;
  readonly reason: "absent";
  readonly path: string;
  readonly message: string;
}

export interface DatasetHashMismatch {
  readonly ok: false;
  readonly reason: "hash-mismatch";
  readonly path: string;
  readonly expected: string;
  readonly actual: string;
  readonly message: string;
}

export type DatasetRefusal = DatasetAbsent | DatasetHashMismatch;

export interface DatasetLoaded {
  readonly ok: true;
  readonly path: string;
  readonly matrix: MatrixJson;
}

export type DatasetLoadResult = DatasetLoaded | DatasetRefusal;

/** 30 days (SPEC "A dataset older than 30 days warns on every response"). */
export const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

function matrixJsonPath(outRoot: string, ref: string): string {
  return join(outRoot, ref, "matrix.json");
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as NodeJS.ErrnoException).code === "ENOENT"
  );
}

/**
 * Steps 1-2 of the startup sequence (design): load, then verify. Neither
 * refusal is thrown -- the caller (unit 5's `startup.ts`) decides how a
 * refusal becomes a process exit; this module only reports it.
 */
export async function loadDataset(outRoot: string, ref: string): Promise<DatasetLoadResult> {
  const path = matrixJsonPath(outRoot, ref);

  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if (isEnoent(err)) {
      return {
        ok: false,
        reason: "absent",
        path,
        message: `dataset not found at ${path}`,
      };
    }
    throw err;
  }

  const matrix = JSON.parse(raw) as MatrixJson;
  const verification = verifyPayloadHash(matrix);

  if (!verification.ok) {
    return {
      ok: false,
      reason: "hash-mismatch",
      path,
      expected: verification.expected,
      actual: verification.actual,
      message:
        `payloadHash mismatch for ${path}: ` +
        `expected ${verification.expected}, actual ${verification.actual}`,
    };
  }

  return { ok: true, path, matrix };
}

/**
 * Provenance every `schema` response carries (SPEC "Every `schema` response
 * carries its provenance"), plus the staleness warning (SPEC "A dataset older
 * than 30 days warns on every response") when `resolvedAt` is old enough.
 */
export interface Provenance {
  readonly ref: string;
  readonly payloadHash: string;
  readonly resolvedAt: string;
  readonly stalenessWarning?: string;
}

export function provenanceFor(matrix: MatrixJson, clock: Clock): Provenance {
  const now = clock();
  const ageMs = Date.parse(now) - Date.parse(matrix.resolvedAt);
  const base = {
    ref: matrix.ref,
    payloadHash: matrix.payloadHash,
    resolvedAt: matrix.resolvedAt,
  };

  if (ageMs > STALE_AFTER_MS) {
    const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
    return {
      ...base,
      stalenessWarning: `dataset resolved ${ageDays} days ago (resolvedAt ${matrix.resolvedAt}), older than the 30-day freshness window`,
    };
  }

  return base;
}

/** Typed reads over an already-verified dataset (design "expose typed reads"). */
export function matrixOf(loaded: DatasetLoaded): MatrixJson {
  return loaded.matrix;
}

export function indexTemplatesOf(loaded: DatasetLoaded): IndexTemplate[] {
  return loaded.matrix.indexer.templates;
}

export function wcsModulesOf(loaded: DatasetLoaded): WcsModule[] {
  return loaded.matrix.indexer.wcsModules;
}

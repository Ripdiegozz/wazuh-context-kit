/**
 * Canonical serialisation and payload hashing (SPEC 1.6.1).
 *
 * `meta.generatedAt` is the only value that changes between runs over identical
 * inputs, so `meta` is excluded from the hash. That is what makes two
 * consecutive runs diffable: if the same cache yields two different
 * payloadHash values, the generator is not deterministic and that is a bug.
 */

import { createHash } from "node:crypto";
import type { MatrixJson } from "./types.ts";

/** Deterministic JSON: keys sorted, undefined dropped, no incidental whitespace. */
export function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return "null";

  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`);
    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(value) ?? "null";
}

export type HashablePayload = Omit<MatrixJson, "meta" | "payloadHash">;

export function computePayloadHash(payload: HashablePayload): string {
  const digest = createHash("sha256").update(canonicalize(payload), "utf8").digest("hex");
  return `sha256:${digest}`;
}

/**
 * Recompute and compare. Used by `wazuh-ctx mcp` at startup (SPEC 5.3):
 * a tampered dataset must be rejected, not served.
 */
export function verifyPayloadHash(matrix: MatrixJson): {
  ok: boolean;
  expected: string;
  actual: string;
} {
  const { meta: _meta, payloadHash, ...payload } = matrix;
  const actual = computePayloadHash(payload);
  return { ok: actual === payloadHash, expected: payloadHash, actual };
}

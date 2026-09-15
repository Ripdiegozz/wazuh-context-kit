/**
 * Schemas for the human layers (SPEC 1.7).
 *
 * zod lives on the INPUT side (SPEC 1.1): these files are hand-edited, and a
 * malformed entry must produce a clear error naming the entry, not a crash
 * halfway through a build.
 */

import { z } from "zod";

/**
 * Fields a human decision is allowed to resolve.
 *
 * Deliberately closed. A decision naming anything else is rejected rather than
 * silently ignored -- a decision that does nothing is worse than none, because
 * someone believes it is in effect.
 */
export const DECIDABLE_FIELDS = [
  "pluginId",
  "world",
  "versionScheme",
  "serverApiAccess",
  "indexerAccess",
] as const;

export type DecidableField = (typeof DECIDABLE_FIELDS)[number];

export const decisionStatusSchema = z.enum(["active", "superseded", "orphaned"]);

export const decisionSchema = z.object({
  /** Matches pluginId, or pluginDir when the manifest declares no id. */
  plugin: z.string().min(1),
  field: z.enum(DECIDABLE_FIELDS),
  value: z.unknown(),
  author: z.string().min(1),
  date: z.string().min(1),
  reason: z.string().min(1),
  evidence: z.string().optional(),
  status: decisionStatusSchema.default("active"),
});

export type Decision = z.infer<typeof decisionSchema>;

export const annotationSchema = z.object({
  plugin: z.string().min(1),
  kind: z.enum(["warning", "note", "ownership"]),
  text: z.string().min(1),
  author: z.string().min(1),
  date: z.string().min(1),
});

export type Annotation = z.infer<typeof annotationSchema>;

export const decisionsFileSchema = z.array(decisionSchema);
export const annotationsFileSchema = z.array(annotationSchema);

/** Parse with a message that names the offending entry index. */
export function parseDecisions(raw: unknown, sourceLabel: string): Decision[] {
  const result = decisionsFileSchema.safeParse(raw ?? []);
  if (!result.success) {
    const first = result.error.issues[0];
    const where = first?.path.join(".") ?? "?";
    throw new Error(`${sourceLabel}: invalid entry at ${where} — ${first?.message ?? "unknown"}`);
  }
  return result.data;
}

export function parseAnnotations(raw: unknown, sourceLabel: string): Annotation[] {
  const result = annotationsFileSchema.safeParse(raw ?? []);
  if (!result.success) {
    const first = result.error.issues[0];
    const where = first?.path.join(".") ?? "?";
    throw new Error(`${sourceLabel}: invalid entry at ${where} — ${first?.message ?? "unknown"}`);
  }
  return result.data;
}

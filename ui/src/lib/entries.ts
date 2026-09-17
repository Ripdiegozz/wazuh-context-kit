import type { Annotation, Decision } from "@/api/types";

/** Mirrors src/serve/handlers.ts's private decisionKey/annotationKey exactly. */
export function decisionKey(d: Decision): string {
  return `${d.plugin}::${d.field}`;
}

export function annotationKey(a: Annotation): string {
  return `${a.plugin}::${a.kind}::${a.text}::${a.author}::${a.date}`;
}

/** Upserts `entry` into `baseline` by key, returning a new array (immutable). */
export function upsert<T>(baseline: readonly T[], entry: T, keyOf: (e: T) => string): T[] {
  const key = keyOf(entry);
  const next = baseline.filter((e) => keyOf(e) !== key);
  next.push(entry);
  return next;
}

/**
 * `diffEntries` — the diff behind SPEC 1.5.1's load-bearing rule: "El botón
 * de guardar no muta estado: produce un diff para commitear."
 *
 * Diffs two arrays of PARSED entries (already run through
 * `src/decisions/schema.ts`'s `parseDecisions`/`parseAnnotations`), keyed by
 * a caller-supplied identity function -- never a raw string/line diff of
 * YAML text. `src/serve/handlers.ts` is the only caller: it parses both the
 * on-disk YAML and the proposed body through the same schema, then hands
 * both parsed arrays here.
 *
 * Pure. No fs, no clock, no network.
 */

export interface ChangedEntry<T> {
  readonly key: string;
  readonly before: T;
  readonly after: T;
}

export interface EntriesDiff<T> {
  readonly added: readonly T[];
  readonly removed: readonly T[];
  readonly changed: readonly ChangedEntry<T>[];
  /** Retained so `formatDiffLines` can name an added/removed entry by key. */
  readonly keyOf: (entry: T) => string;
}

/**
 * Deep-equality by value, over already-parsed (so already-typed, JSON-safe)
 * entries -- `JSON.stringify` is a legitimate value comparison here because
 * both sides went through the same zod schema and can't disagree on key
 * order in a way that would produce a false "changed" for identical content
 * for these flat, schema-validated shapes.
 */
function sameValue<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function diffEntries<T>(
  existing: readonly T[],
  proposed: readonly T[],
  keyOf: (entry: T) => string,
): EntriesDiff<T> {
  const existingByKey = new Map<string, T>();
  for (const entry of existing) existingByKey.set(keyOf(entry), entry);

  const proposedByKey = new Map<string, T>();
  for (const entry of proposed) proposedByKey.set(keyOf(entry), entry);

  const added: T[] = [];
  const changed: ChangedEntry<T>[] = [];

  for (const [key, after] of proposedByKey) {
    const before = existingByKey.get(key);
    if (before === undefined) {
      added.push(after);
      continue;
    }
    if (!sameValue(before, after)) {
      changed.push({ key, before, after });
    }
  }

  const removed: T[] = [];
  for (const [key, before] of existingByKey) {
    if (!proposedByKey.has(key)) removed.push(before);
  }

  return { added, removed, changed, keyOf };
}

/** One human-readable line per entry, in `+`/`~`/`-` diff convention, named by key. */
export function formatDiffLines<T>(diff: EntriesDiff<T>): string[] {
  return [
    ...diff.added.map((entry) => `+ ${diff.keyOf(entry)}`),
    ...diff.changed.map((entry) => `~ ${entry.key}`),
    ...diff.removed.map((entry) => `- ${diff.keyOf(entry)}`),
  ];
}

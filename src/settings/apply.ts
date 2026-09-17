/**
 * `applySettings` — the inverse of `mergeSettings`, for one repository.
 * Pure: no fs, no network, no clock.
 *
 * `apply.ts` exists to PROVE `merge.ts` correct (the same argument
 * `skills/reconstruct.ts`'s docblock makes for its own package): two
 * independent transformations — partitioning into core/overrides/conflicts,
 * then replaying core plus one repo's own overrides — composing to the
 * identity is an assertion no fixture can agree with, which is why
 * `apply(merge(x)) == x` (task 2.1) is this change's load-bearing test.
 *
 * `applySettings` consults ONLY `merged.core` and `merged.overrides.get(repo)`
 * — never `merged.conflicts` (design.md's Shape section: "core + override ->
 * a repository's settings.json"). This mirrors `standards/plan.ts`'s own
 * rule that a distributable skill's content is core-plus-overrides only,
 * never a conflict op: a conflict is by definition content nobody can
 * safely reconstruct on the affected repository's behalf, so `apply` simply
 * does not carry it. The round-trip test above is therefore written over
 * corpora with no conflicts — the only shape for which "apply(merge(x)) ==
 * x" is even a claim this module makes.
 *
 * Reconstruction walks `merged.core` and, for each LIST leaf, appends this
 * repo's own override entries at that path — sorted (design decision 5), so
 * the result never depends on which repo contributed an entry or the order
 * `mergeSettings` processed repositories in. A leaf with no override for
 * this repo reconstructs as exactly the core's value, unchanged.
 */

import type { MergedSettings, SettingsTree } from "./types.ts";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep-clones a `SettingsTree` into a plain mutable object tree — `apply`
 * builds its result by mutating a clone of `core`, never the original, so
 * repeated calls for different repos never see each other's overrides. */
function cloneTree(tree: SettingsTree): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(tree)) {
    const value = tree[key];
    out[key] = isPlainObject(value) ? cloneTree(value as SettingsTree) : Array.isArray(value) ? [...value] : value;
  }
  return out;
}

function mergeOverrideEntry(tree: Record<string, unknown>, path: readonly string[], value: string): void {
  let current: Record<string, unknown> = tree;
  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i]!;
    const next = current[segment];
    if (!isPlainObject(next)) current[segment] = {};
    current = current[segment] as Record<string, unknown>;
  }

  const leafKey = path[path.length - 1]!;
  const existing = current[leafKey];
  const list = Array.isArray(existing) ? (existing as string[]) : [];
  if (!list.includes(value)) list.push(value);
  current[leafKey] = list.sort((a, b) => a.localeCompare(b));
}

/**
 * Reconstructs `repo`'s `settings.json` from `merged`: `merged.core` plus
 * every override `merged.overrides.get(repo)` carries, each applied by
 * appending its value to the list at its path and re-sorting (never by
 * inserting at an arbitrary position — there is no "position" for a JSON
 * list the way there is a line for a `SKILL.md` anchor).
 */
export function applySettings(merged: MergedSettings, repo: string): SettingsTree {
  const result = cloneTree(merged.core);
  const overrides = merged.overrides.get(repo) ?? [];

  for (const override of overrides) {
    mergeOverrideEntry(result, override.path, override.value);
  }

  return result as SettingsTree;
}

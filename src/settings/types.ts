/**
 * Domain types for `src/settings/` — the `.claude/settings.json` merge
 * (SPEC 2.4's last open criterion; see `openspec/changes/settings-merge/`).
 *
 * This module is part of the pure core (SPEC 6.1): no fs, no network, no
 * clock. Every type here is shaped to be constructible from a literal in a
 * test file, the same "no fixture-file surface" discipline `skills/types.ts`
 * states for its own domain.
 *
 * `exploration.md` measured four leaf keys across seven files, three
 * identical everywhere and one (`permissions.allow`) purely additive. The
 * types below do not hard-code that count — `design.md` decision 1 is
 * explicit that the walk must not assume it — but they DO assume every
 * diverging list leaf holds STRING entries, because that is what every real
 * leaf is and a general `JsonValue` union buys generality this project has
 * no measured need for (the same "a general key-level merge engine is not
 * needed" argument the proposal makes about the merge itself).
 */

/** A JSON scalar — anything that is not an object or an array. `null` is
 * included because JSON allows it as a real value, distinct from "absent". */
export type JsonScalar = string | number | boolean | null;

/** One leaf's raw shape as read from a `settings.json` file: either a
 * scalar (compared by equality, design decision 2) or a list of strings
 * (compared by membership). A nested object is never a leaf itself — it is
 * walked into, never compared as a unit (decision 1: "walk leaf paths, not
 * the object"). */
export type SettingsLeafValue = JsonScalar | readonly string[];

/** A `settings.json` file, parsed, as this module receives it — nested
 * objects all the way down to scalars or string-list leaves. */
export interface SettingsTree {
  readonly [key: string]: SettingsTree | SettingsLeafValue;
}

/** One repository's copy of `.claude/settings.json`, the unit `mergeSettings`
 * compares — the settings analogue of `skills/types.ts`'s `SkillVariant`. */
export interface SettingsVariant {
  readonly repo: string;
  readonly settings: SettingsTree;
}

/**
 * The three kinds a conflict can carry, shared with the skills' `conflicts/`
 * layer (design decision 4): `"unmarked-divergence"` is the skills' own
 * meaning (divergence with no marker declaring intent) and is never produced
 * by this module; `"removed-from-core"` and `"scalar-disagreement"` are
 * settings-only, because `.claude/settings.json` has no marker convention at
 * all, so "conflict" means contradiction here, not "undeclared". One type,
 * not two conflict hierarchies under one name — the compiler's one-error-
 * list shape `design.md` names.
 */
export type ConflictKind = "unmarked-divergence" | "removed-from-core" | "scalar-disagreement";

/**
 * A list entry present in all but one variant (design decision 2's `n - 1`
 * threshold, floored at three variants — task 1.6). `missingFrom` names the
 * repository lacking it; the entry is never emitted as an override for
 * anybody (SPEC "A removal is a conflict, not an override").
 */
export interface RemovedFromCoreConflict {
  readonly kind: "removed-from-core";
  readonly path: readonly string[];
  readonly value: string;
  readonly missingFrom: string;
}

/** A scalar leaf that is not the same value in every variant that carries
 * it — "no way to pick" (design decision 2), so every variant's value is
 * recorded and none is selected. */
export interface ScalarDisagreementConflict {
  readonly kind: "scalar-disagreement";
  readonly path: readonly string[];
  readonly variants: readonly { readonly repo: string; readonly value: SettingsLeafValue }[];
}

export type SettingsConflict = RemovedFromCoreConflict | ScalarDisagreementConflict;

/** A list leaf carrying the same value more than once within ONE variant —
 * reported, never silently deduplicated (task 1.8: "a duplicate is itself a
 * finding about that file"). */
export interface DuplicateEntry {
  readonly path: readonly string[];
  readonly repo: string;
  readonly value: string;
  readonly count: number;
}

/** One value a repository's `settings.json` carries beyond the shared core,
 * at a given leaf path — a list addition (design: "an addition is an
 * override for the repos that have it"). */
export interface SettingsOverride {
  readonly path: readonly string[];
  readonly value: string;
}

/**
 * `mergeSettings`'s result: `core` is `∩ variants` (decision 3), materialised
 * as a real `SettingsTree` so `applySettings` can use it directly without
 * re-deriving structure from a flat list. `overrides` holds every variant's
 * repo, even one with nothing to add — a repo with no override is a fact,
 * not an absence (mirroring `skills/extract.ts`'s `ExtractedSkill.overrides`).
 */
export interface MergedSettings {
  readonly core: SettingsTree;
  readonly overrides: ReadonlyMap<string, readonly SettingsOverride[]>;
  readonly conflicts: readonly SettingsConflict[];
  readonly duplicates: readonly DuplicateEntry[];
}

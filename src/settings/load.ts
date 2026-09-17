/**
 * `loadSettingsVariants` — the only module in `src/settings/` allowed to
 * touch the filesystem (SPEC 6.1's purity seam, mirroring `src/skills/
 * load.ts`'s role for its own package).
 *
 * `.claude/settings.json` sits beside `.claude/skills/`, not inside it —
 * `skills/load.ts`'s own docblock names this as a structural exclusion, not
 * an oversight — so it needs its own loader rather than being folded into
 * `loadSkills`.
 *
 * A missing or unreadable `.claude/settings.json` is NOT an error: it is
 * reported by name and reason, the same way `loadSkills` reports a
 * repository with no `.claude/skills/` directory rather than throwing or
 * silently excluding it from the corpus. This matters here specifically
 * because this change's first real run (caught by the coordinator, not by
 * the test suite) emitted nothing at all for `.claude/settings.json` while
 * every test stayed green — the suite proved the pure merge correct without
 * ever proving anything actually loads a real file. `missing` exists so a
 * caller can tell "seven repos, seven loaded" from "seven repos, six loaded
 * and nobody said why" without re-deriving it from a length mismatch.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SettingsTree, SettingsVariant } from "./types.ts";

/** Deliberately narrower than `skills/load.ts`'s `LoadTarget` — this loader
 * needs nothing about repo kind, only where to look. A caller's richer
 * target shape (e.g. `skills/load.ts`'s own `LoadTarget`) is still
 * accepted, structurally. */
export interface SettingsLoadTarget {
  readonly repo: string;
  readonly dir: string;
}

export interface MissingSettings {
  readonly repo: string;
  readonly reason: string;
}

export interface LoadedSettings {
  /** Sorted by repo — order-independent, matching `mergeSettings`'s own
   * "processing order does not change the result" guarantee downstream. */
  readonly variants: readonly SettingsVariant[];
  readonly missing: readonly MissingSettings[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function loadSettingsVariants(targets: readonly SettingsLoadTarget[]): Promise<LoadedSettings> {
  const variants: SettingsVariant[] = [];
  const missing: MissingSettings[] = [];

  for (const target of targets) {
    const path = join(target.dir, ".claude", "settings.json");

    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        missing.push({ repo: target.repo, reason: "no .claude/settings.json" });
        continue;
      }
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      missing.push({ repo: target.repo, reason: "unparsable .claude/settings.json" });
      continue;
    }

    if (!isPlainObject(parsed)) {
      missing.push({ repo: target.repo, reason: ".claude/settings.json is not a JSON object" });
      continue;
    }

    variants.push({ repo: target.repo, settings: parsed as SettingsTree });
  }

  return {
    variants: variants.sort((a, b) => a.repo.localeCompare(b.repo)),
    missing: missing.sort((a, b) => a.repo.localeCompare(b.repo)),
  };
}

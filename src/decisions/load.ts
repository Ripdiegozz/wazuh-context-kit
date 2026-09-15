/**
 * Loading the human layers from disk. The only I/O in src/decisions/.
 *
 * Kept separate from apply.ts so the overlay logic stays pure and testable
 * without a filesystem (SPEC 6.1).
 */

import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import {
  type Annotation,
  type Decision,
  parseAnnotations,
  parseDecisions,
} from "./schema.ts";

async function readYamlIfPresent(path: string): Promise<unknown> {
  try {
    return parseYaml(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export interface LoadedLayers {
  decisions: Decision[];
  annotations: Annotation[];
  /** Handles overridden by decisions.local.yml, for `overlay: "local"` marking. */
  localOverrides: Set<string>;
}

/**
 * decisions.local.yml is the escape hatch (SPEC 5.3). It is gitignored, and
 * every cell it touches must be served marked -- never silently.
 */
export async function loadHumanLayers(root: string): Promise<LoadedLayers> {
  const shared = parseDecisions(
    await readYamlIfPresent(`${root}/decisions.yml`),
    "decisions.yml",
  );
  const local = parseDecisions(
    await readYamlIfPresent(`${root}/decisions.local.yml`),
    "decisions.local.yml",
  );
  const annotations = parseAnnotations(
    await readYamlIfPresent(`${root}/annotations.yml`),
    "annotations.yml",
  );

  const localOverrides = new Set(local.map((d) => `${d.plugin}::${d.field}`));

  // Local entries are applied last so they win over the shared layer.
  return { decisions: [...shared, ...local], annotations, localOverrides };
}

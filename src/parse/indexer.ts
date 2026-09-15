/**
 * `parseIndexerArtifacts` — index templates and WCS modules from a fetched
 * `wazuh-indexer-plugins` checkout (SPEC 1.2).
 *
 * Emits the FINAL `IndexTemplate` / `WcsModule` shapes (D2): `build.ts`
 * passes these straight through with no classification step, so parse/ owns
 * both discovery and shape here.
 */

import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { IndexTemplate, WcsModule } from "../matrix/types.ts";
import type { ParsedRepo, ParseTarget } from "./types.ts";

const TEMPLATES_STATES_DIR = ["plugins", "setup", "src", "main", "resources", "templates", "states"];

function toPosix(path: string): string {
  return path.split("\\").join("/");
}

async function findTemplates(dir: string): Promise<IndexTemplate[]> {
  const statesDir = join(dir, ...TEMPLATES_STATES_DIR);

  let entries: string[];
  try {
    entries = await readdir(statesDir, { recursive: true });
  } catch {
    return [];
  }

  const jsonEntries = entries.filter((entry) => entry.toLowerCase().endsWith(".json"));
  const templates: IndexTemplate[] = [];

  for (const entry of jsonEntries) {
    const path = toPosix(join(...TEMPLATES_STATES_DIR, entry));
    const name = basename(entry).replace(/\.json$/i, "");

    let indexPatterns: string[] = [];
    try {
      const raw = await readFile(join(statesDir, entry), "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (Array.isArray(parsed.index_patterns)) {
        indexPatterns = parsed.index_patterns.filter((p): p is string => typeof p === "string");
      }
    } catch {
      indexPatterns = [];
    }

    templates.push({ name, path, indexPatterns });
  }

  templates.sort((a, b) => a.path.localeCompare(b.path));
  return templates;
}

async function findWcsModules(dir: string): Promise<WcsModule[]> {
  const wcsDir = join(dir, "wcs");

  let entries: string[];
  try {
    entries = await readdir(wcsDir, { recursive: true });
  } catch {
    return [];
  }

  const fieldsCsvEntries = entries.filter((entry) => toPosix(entry).endsWith("/docs/fields.csv"));
  const modules: WcsModule[] = [];

  for (const entry of fieldsCsvEntries) {
    const posixEntry = toPosix(entry);
    const moduleName = posixEntry.slice(0, -("/docs/fields.csv".length));
    const fieldsCsv = toPosix(join("wcs", entry));

    let fieldCount = 0;
    try {
      const raw = await readFile(join(wcsDir, entry), "utf8");
      const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
      fieldCount = Math.max(0, lines.length - 1); // minus header row
    } catch {
      fieldCount = 0;
    }

    modules.push({ name: moduleName, fieldsCsv, fieldCount });
  }

  modules.sort((a, b) => a.name.localeCompare(b.name));
  return modules;
}

export async function parseIndexerArtifacts(
  target: ParseTarget,
): Promise<Pick<ParsedRepo, "templates" | "wcsModules">> {
  const [templates, wcsModules] = await Promise.all([findTemplates(target.dir), findWcsModules(target.dir)]);
  return { templates, wcsModules };
}

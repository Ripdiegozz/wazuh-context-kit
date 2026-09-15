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

/**
 * The templates root, NOT `templates/states`.
 *
 * Reading only `states/` declared 20 of 40 index templates at 5.0.0 -- half the
 * declared surface. `streams/` holds 8, `content/` holds 8, and four sit
 * directly at this root. A JSON qualifies by carrying a non-empty
 * `index_patterns`, never by where it lives: a directory-name allowlist is
 * exactly the defect this replaced.
 */
const TEMPLATES_DIR = ["plugins", "setup", "src", "main", "resources", "templates"];

function toPosix(path: string): string {
  return path.split("\\").join("/");
}

async function findTemplates(dir: string): Promise<IndexTemplate[]> {
  const templatesDir = join(dir, ...TEMPLATES_DIR);

  let entries: string[];
  try {
    entries = await readdir(templatesDir, { recursive: true });
  } catch {
    return [];
  }

  const jsonEntries = entries.filter((entry) => entry.toLowerCase().endsWith(".json"));
  const templates: IndexTemplate[] = [];

  for (const entry of jsonEntries) {
    const relative = toPosix(entry);
    const path = toPosix(join(...TEMPLATES_DIR, entry));
    const name = basename(entry).replace(/\.json$/i, "");

    // "" for a file directly under templates/. Four real ones live there.
    const segments = relative.split("/");
    const group = segments.length > 1 ? segments[0]! : "";

    let indexPatterns: string[] = [];
    let readable = true;
    try {
      const raw = await readFile(join(templatesDir, entry), "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (Array.isArray(parsed.index_patterns)) {
        indexPatterns = parsed.index_patterns.filter((p): p is string => typeof p === "string");
      }
    } catch {
      indexPatterns = [];
      readable = false;
    }

    // Two different silences, kept different on purpose.
    //
    // A file that PARSED and declares no index_patterns is not a template --
    // walking templates/ instead of templates/states/ now reaches
    // mappings-only JSON that was never one, and admitting it would inflate the
    // declared surface with things that declare nothing.
    //
    // A file that did NOT parse is a template we could not read, and it stays
    // visible with an empty pattern list. Robust-empty must not become
    // invisible: dropping a broken file hides the breakage.
    if (readable && indexPatterns.length === 0) continue;

    templates.push({ name, path, group, indexPatterns });
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

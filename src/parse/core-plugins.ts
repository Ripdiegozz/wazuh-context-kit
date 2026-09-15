/**
 * `parsePlatformRepo` — OpenSearch Dashboards core plugin facts (SPEC 1.2,
 * 1.5.2; source-parse delta).
 *
 * A `platform` repository is the OSD fork. Its plugins are the destination of
 * every wazuh-native `requiredPlugins` edge, so without them the matrix's
 * dependency graph has no destination for its most common edge.
 *
 * Same contract as `manifest.ts`: facts only, no interpretation, and a
 * malformed manifest never crashes the parse.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RawCoreFacts, RawCoreRepo } from "../matrix/types.ts";
import { buildRawManifest } from "./manifest.ts";
import type { ParseTarget } from "./types.ts";

const MANIFEST_FILENAME = "opensearch_dashboards.json";

/**
 * The core plugin root.
 *
 * NOT the root-level `plugins/`. `wazuh-dashboard` has both, and the
 * root-level one is git-ignored upstream (`*` / `!.gitignore`) — a local
 * development mount point holding no repository content. Matching on
 * "plugins" instead finds that empty tree, and because it is empty the mistake
 * looks exactly like a successful parse of a repository with no plugins.
 */
const CORE_PLUGIN_ROOT = "src/plugins";

async function readFileIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

/** The repository's own version. One per repo, never per plugin. */
async function readRepoVersion(dir: string): Promise<string | null> {
  const raw = await readFileIfPresent(join(dir, "package.json"));
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

export async function parsePlatformRepo(target: ParseTarget): Promise<RawCoreRepo> {
  const version = await readRepoVersion(target.dir);

  let pluginDirs: string[];
  try {
    const entries = await readdir(join(target.dir, CORE_PLUGIN_ROOT), { withFileTypes: true });
    pluginDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    // No `src/plugins` at all. An empty core section is a fact about this
    // checkout, not an error.
    return { repo: target.repo, commit: target.commit, version, facts: [] };
  }

  const facts: RawCoreFacts[] = [];

  for (const name of pluginDirs) {
    // One level only. Core plugins nest their own fixture manifests deeper
    // (optimizer mock repos, generator templates); those are not plugins.
    const pluginDir = `${CORE_PLUGIN_ROOT}/${name}`;
    const manifestPath = `${pluginDir}/${MANIFEST_FILENAME}`;

    const raw = await readFileIfPresent(join(target.dir, pluginDir, MANIFEST_FILENAME));
    if (raw === null) continue;

    let manifest;
    try {
      manifest = buildRawManifest(JSON.parse(raw));
    } catch {
      manifest = buildRawManifest(null);
    }

    // A manifest we cannot name cannot be the destination of a dependency
    // edge, so it has no use in this section.
    if (manifest.id === undefined) continue;

    facts.push({ pluginId: manifest.id, pluginDir, manifestPath, manifest });
  }

  facts.sort((a, b) => a.pluginId.localeCompare(b.pluginId));
  return { repo: target.repo, commit: target.commit, version, facts };
}

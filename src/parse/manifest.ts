/**
 * `parseRepoManifests` — manifest + sibling package.json facts (SPEC 1.2,
 * 1.5.1, D5).
 *
 * Zero interpretation: this file emits facts, never classifications. A
 * malformed manifest never crashes; it emits `manifest: {}` so the fact still
 * flows through matrix/'s existing pure rules (D5). Uses
 * `fs.readdir(path, { recursive: true })` — Node >= 22, no new dependency
 * (D6).
 */

import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RawManifest, RawPluginFacts } from "../matrix/types.ts";
import type { ParseTarget } from "./types.ts";

const MANIFEST_FILENAME = "opensearch_dashboards.json";

/** Every emitted path is repo-relative and POSIX, regardless of host OS. */
function toPosix(path: string): string {
  return path.split("\\").join("/");
}

/**
 * Builds a `RawManifest` by omitting absent keys entirely — never assigning
 * `undefined` — because `exactOptionalPropertyTypes` makes `{ id: undefined }`
 * a type error (see fixture-driven hazard coverage in parse.test.ts).
 */
function buildRawManifest(value: unknown): RawManifest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const obj = value as Record<string, unknown>;

  const id = typeof obj.id === "string" ? obj.id : undefined;
  const requiredPlugins = Array.isArray(obj.requiredPlugins) ? (obj.requiredPlugins as string[]) : undefined;
  const optionalPlugins = Array.isArray(obj.optionalPlugins) ? (obj.optionalPlugins as string[]) : undefined;
  const configPath = Array.isArray(obj.configPath) ? (obj.configPath as string[]) : undefined;
  const opensearchDashboardsVersion =
    typeof obj.opensearchDashboardsVersion === "string" ? obj.opensearchDashboardsVersion : undefined;
  const requiredOSDataSourcePlugins = Array.isArray(obj.requiredOSDataSourcePlugins)
    ? (obj.requiredOSDataSourcePlugins as string[])
    : undefined;

  return {
    ...(id !== undefined ? { id } : {}),
    ...(requiredPlugins !== undefined ? { requiredPlugins } : {}),
    ...(optionalPlugins !== undefined ? { optionalPlugins } : {}),
    ...(configPath !== undefined ? { configPath } : {}),
    ...(opensearchDashboardsVersion !== undefined ? { opensearchDashboardsVersion } : {}),
    ...(requiredOSDataSourcePlugins !== undefined ? { requiredOSDataSourcePlugins } : {}),
  };
}

async function readFileIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

export async function parseRepoManifests(target: ParseTarget): Promise<RawPluginFacts[]> {
  let entries: string[];
  try {
    entries = await readdir(target.dir, { recursive: true });
  } catch {
    return [];
  }

  const manifestEntries = entries.filter(
    (entry) => entry.split(/[\\/]/).pop() === MANIFEST_FILENAME,
  );

  const facts: RawPluginFacts[] = [];

  for (const relativeManifest of manifestEntries) {
    const manifestPath = toPosix(relativeManifest);
    const pluginDirNative = dirname(relativeManifest);
    const pluginDir = toPosix(pluginDirNative);

    const manifestRaw = await readFileIfPresent(join(target.dir, relativeManifest));
    let manifest: RawManifest = {};
    if (manifestRaw !== null) {
      try {
        manifest = buildRawManifest(JSON.parse(manifestRaw));
      } catch {
        manifest = {};
      }
    }

    const packageJsonNative =
      pluginDirNative === "." ? "package.json" : join(pluginDirNative, "package.json");
    const packageJsonRaw = await readFileIfPresent(join(target.dir, packageJsonNative));

    let packageJsonPath: string | null = null;
    let packageVersion: string | null = null;

    if (packageJsonRaw !== null) {
      packageJsonPath = toPosix(packageJsonNative);
      try {
        const parsed = JSON.parse(packageJsonRaw) as Record<string, unknown>;
        packageVersion = typeof parsed.version === "string" ? parsed.version : null;
      } catch {
        packageVersion = null;
      }
    }

    facts.push({
      repo: target.repo,
      repoKind: target.repoKind,
      pluginDir,
      manifestPath,
      packageJsonPath,
      commit: target.commit,
      manifest,
      packageVersion,
    });
  }

  facts.sort((a, b) => a.manifestPath.localeCompare(b.manifestPath));
  return facts;
}

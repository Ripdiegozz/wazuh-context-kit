/**
 * Deterministic classification (SPEC 1.5).
 *
 * Pure functions only. Guessing is forbidden: a field that cannot be derived
 * returns "unknown" (or an empty set) and is reported in `unknowns[]`.
 */

import type {
  IndexerAccessPath,
  RawManifest,
  RawPluginFacts,
  ServerApiAccess,
  VersionScheme,
  World,
} from "./types.ts";

const WAZUH_CORE = "wazuhCore";

/**
 * SPEC 1.5.1. `manifest.id` is the only admitted source.
 *
 * Falling back to the directory name is explicitly forbidden: the directory is
 * a convention, the manifest is a contract.
 */
export function classifyPluginId(manifest: RawManifest): string {
  const id = manifest.id;
  if (typeof id === "string" && id.length > 0) return id;
  return "unknown";
}

/**
 * SPEC 1.5.1.
 *
 * Four components ("3.6.0.0") means the plugin follows OSD versioning.
 * Three components whose major matches the ref means it follows Wazuh's.
 * Anything else is unknown -- including a missing package.json, which is why
 * package.json is a required sparse-checkout path (SPEC 1.2).
 */
export function classifyVersionScheme(
  packageVersion: string | null,
  ref: string,
): VersionScheme {
  if (!packageVersion) return "unknown";

  const parts = packageVersion.split(".");
  if (parts.length === 4) return "osd";

  if (parts.length === 3) {
    const refMajor = ref.split(".")[0];
    if (refMajor !== undefined && parts[0] === refMajor) return "wazuh";
  }

  return "unknown";
}

/**
 * SPEC 1.5.2.
 *
 * `opensearchDashboardsVersion` is deliberately NOT consulted: it frequently
 * holds the literal string "opensearchDashboards" and does not discriminate
 * reliably. versionScheme, derived from package.json, is the strong signal.
 */
export function classifyWorld(
  facts: RawPluginFacts,
  versionScheme: VersionScheme,
): World {
  if (facts.repoKind === "platform") return "platform";

  const required = facts.manifest.requiredPlugins ?? [];
  if (required.includes(WAZUH_CORE)) return "wazuh-native";
  if (versionScheme === "osd") return "upstream-fork";

  return "unknown";
}

/** SPEC 1.5.3. The Wazuh Server API path. Never the indexer path. */
export function classifyServerApiAccess(manifest: RawManifest): ServerApiAccess {
  const required = manifest.requiredPlugins ?? [];
  return required.includes(WAZUH_CORE) ? "wazuh-core" : "none";
}

/**
 * SPEC 1.5.3. Returns a SET, in a stable order.
 *
 * Several paths can be true at once and that is information, not a tie to
 * break. security-analytics declares `data` (required), `dataSource`
 * (optional) and requiredOSDataSourcePlugins -- all three are emitted.
 *
 * An empty set does NOT mean "does not reach the indexer". It means the
 * manifest declares no path. Access via core.opensearch.client is a CODE fact,
 * not a manifest fact, and is therefore not derivable in this phase.
 */
export function classifyIndexerAccess(manifest: RawManifest): IndexerAccessPath[] {
  const declared = [
    ...(manifest.requiredPlugins ?? []),
    ...(manifest.optionalPlugins ?? []),
  ];

  const paths: IndexerAccessPath[] = [];
  if (declared.includes("data")) paths.push("osd-data");
  if (declared.includes("dataSource")) paths.push("osd-data-source");
  if ((manifest.requiredOSDataSourcePlugins ?? []).length > 0) {
    paths.push("os-plugin-bound");
  }

  return paths;
}

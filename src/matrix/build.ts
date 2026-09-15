/**
 * buildMatrix: RawFacts[] + human layers -> MatrixJson.
 *
 * A pure function. No fs, no network, no clock -- the clock is injected via
 * BuildInput (SPEC 6.1). That is what lets the acceptance tests in SPEC 1.9
 * run against twenty-line fixtures with nothing cloned.
 */

import { applyHumanLayers } from "../decisions/apply.ts";
import {
  classifyIndexerAccess,
  classifyPluginId,
  classifyServerApiAccess,
  classifyVersionScheme,
  classifyWorld,
} from "./classify.ts";
import { computePayloadHash } from "./hash.ts";
import type {
  BuildInput,
  CorePlugin,
  CoreRepo,
  MatrixJson,
  MatrixPlugin,
  Unknown,
  UnresolvedDependency,
} from "./types.ts";

/** Reporting handle only. NEVER the emitted pluginId (SPEC 1.5.1). */
function handleOf(plugin: MatrixPlugin): string {
  return plugin.pluginId === "unknown" ? plugin.pluginDir : plugin.pluginId;
}

/**
 * Core plugins carry identity, dependency edges, and evidence -- nothing else.
 *
 * No classification runs over them at all. They have no Wazuh Server API
 * relationship and no per-plugin version, so `world`, `serverApiAccess`, and
 * `versionScheme` would be fabricated rather than derived (design D1, D3).
 * `packageJsonPath` is null because these plugins have no sibling package.json
 * -- that is a fact about the checkout, not a question for a human.
 */
function toCoreRepos(input: BuildInput): CoreRepo[] {
  const repos: CoreRepo[] = [];

  for (const raw of input.coreRepos ?? []) {
    const plugins: CorePlugin[] = raw.facts.map((fact) => ({
      pluginId: fact.pluginId,
      pluginDir: fact.pluginDir,
      requiredPlugins: fact.manifest.requiredPlugins ?? [],
      optionalPlugins: fact.manifest.optionalPlugins ?? [],
      requiredBundles: fact.manifest.requiredBundles ?? [],
      evidence: {
        kind: "derived",
        manifestPath: fact.manifestPath,
        packageJsonPath: null,
        commit: raw.commit,
      },
    }));

    plugins.sort((a, b) => a.pluginId.localeCompare(b.pluginId));
    repos.push({ repo: raw.repo, version: raw.version, plugins });
  }

  repos.sort((a, b) => a.repo.localeCompare(b.repo));
  return repos;
}

/**
 * Every declared dependency with no destination, across both sections.
 *
 * `optionalPlugins` is deliberately excluded: an absent optional dependency is
 * the feature working as designed, and reporting it would produce noise
 * indistinguishable from the signal (design D4).
 */
function findUnresolvedDependencies(
  plugins: readonly MatrixPlugin[],
  core: readonly CoreRepo[],
): UnresolvedDependency[] {
  const known = new Set<string>();
  for (const plugin of plugins) known.add(plugin.pluginId);
  for (const repo of core) for (const plugin of repo.plugins) known.add(plugin.pluginId);

  const unresolved: UnresolvedDependency[] = [];

  const check = (
    repo: string,
    plugin: string,
    field: UnresolvedDependency["field"],
    ids: readonly string[],
  ): void => {
    for (const dependency of ids) {
      if (!known.has(dependency)) unresolved.push({ plugin, repo, dependency, field });
    }
  };

  for (const plugin of plugins) {
    check(plugin.repo, handleOf(plugin), "requiredPlugins", plugin.requiredPlugins);
    check(plugin.repo, handleOf(plugin), "requiredBundles", plugin.requiredBundles);
  }

  for (const repo of core) {
    for (const plugin of repo.plugins) {
      check(repo.repo, plugin.pluginId, "requiredPlugins", plugin.requiredPlugins);
      check(repo.repo, plugin.pluginId, "requiredBundles", plugin.requiredBundles);
    }
  }

  unresolved.sort(
    (a, b) =>
      a.repo.localeCompare(b.repo) ||
      a.plugin.localeCompare(b.plugin) ||
      a.field.localeCompare(b.field) ||
      a.dependency.localeCompare(b.dependency),
  );
  return unresolved;
}

export function buildMatrix(input: BuildInput): MatrixJson {
  const plugins: MatrixPlugin[] = [];

  for (const facts of input.facts) {
    const { manifest } = facts;
    const versionScheme = classifyVersionScheme(facts.packageVersion, input.ref);

    plugins.push({
      repo: facts.repo,
      pluginId: classifyPluginId(manifest),
      pluginDir: facts.pluginDir,
      world: classifyWorld(facts, versionScheme),
      versionScheme,
      configPath: manifest.configPath ?? [],
      serverApiAccess: classifyServerApiAccess(manifest),
      indexerAccess: classifyIndexerAccess(manifest),
      requiredOSDataSourcePlugins: manifest.requiredOSDataSourcePlugins ?? [],
      requiredPlugins: manifest.requiredPlugins ?? [],
      optionalPlugins: manifest.optionalPlugins ?? [],
      requiredBundles: manifest.requiredBundles ?? [],
      evidence: {
        kind: "derived",
        manifestPath: facts.manifestPath,
        packageJsonPath: facts.packageJsonPath,
        commit: facts.commit,
      },
      assertions: {},
      annotations: [],
    });
  }

  // Human layers are applied over derived cells, never the other way round.
  // Derived beats asserted; a decision only fills a hole (see apply.ts).
  const { reconciliation } = applyHumanLayers(
    plugins,
    input.decisions ?? [],
    input.annotations ?? [],
  );

  // Unknowns are computed AFTER the overlay, so a field a human resolved no
  // longer shows up as pending work.
  const unknowns: Unknown[] = [];
  for (const plugin of plugins) {
    const handle = handleOf(plugin);

    if (plugin.pluginId === "unknown") {
      unknowns.push({
        plugin: handle,
        field: "pluginId",
        reason: "manifest does not declare an id",
      });
    }

    if (plugin.versionScheme === "unknown") {
      unknowns.push({
        plugin: handle,
        field: "versionScheme",
        reason: plugin.evidence.kind === "derived" && plugin.evidence.packageJsonPath
          ? "package.json version matches no known scheme"
          : "package.json absent from checkout",
      });
    }

    if (plugin.world === "unknown") {
      unknowns.push({
        plugin: handle,
        field: "world",
        reason: "no wazuhCore dependency and version scheme is not osd",
      });
    }

    // Empty set does not mean "no indexer access" -- it means the manifest
    // declares none. core.opensearch.client usage is a code fact (SPEC 1.5.3).
    if (plugin.indexerAccess.length === 0) {
      unknowns.push({
        plugin: handle,
        field: "indexerAccess",
        reason: "indexer access not derivable from the manifest",
      });
    }
  }

  // Stable ordering. The payload hash is only meaningful if iteration order
  // cannot leak into the output.
  plugins.sort((a, b) =>
    a.repo === b.repo ? a.pluginDir.localeCompare(b.pluginDir) : a.repo.localeCompare(b.repo),
  );
  unknowns.sort((a, b) =>
    a.plugin === b.plugin ? a.field.localeCompare(b.field) : a.plugin.localeCompare(b.plugin),
  );

  const core = toCoreRepos(input);
  const unresolvedDependencies = findUnresolvedDependencies(plugins, core);

  const payload = {
    ref: input.ref,
    resolvedAt: input.resolvedAt,
    resolvedRefs: input.resolvedRefs,
    plugins,
    core,
    unresolvedDependencies,
    indexer: {
      templates: input.templates ?? [],
      wcsModules: input.wcsModules ?? [],
    },
    skipped: input.skipped ?? [],
    unknowns,
    reconciliation,
  };

  return {
    meta: { generatedAt: input.generatedAt, tool: input.tool },
    payloadHash: computePayloadHash(payload),
    ...payload,
  };
}

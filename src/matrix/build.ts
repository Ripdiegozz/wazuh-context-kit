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
import type { BuildInput, MatrixJson, MatrixPlugin, Unknown } from "./types.ts";

/** Reporting handle only. NEVER the emitted pluginId (SPEC 1.5.1). */
function handleOf(plugin: MatrixPlugin): string {
  return plugin.pluginId === "unknown" ? plugin.pluginDir : plugin.pluginId;
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

  const payload = {
    ref: input.ref,
    resolvedAt: input.resolvedAt,
    resolvedRefs: input.resolvedRefs,
    plugins,
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

/**
 * Applies the human layers over derived cells (SPEC 1.7, 5.4).
 *
 * Pure. Loading YAML is I/O and lives in the loader.
 *
 * Precedence rule: DERIVED BEATS ASSERTED when both exist.
 * A human decision only fills a hole. The moment a field becomes derivable,
 * the derived value wins and the decision is reported as superseded -- because
 * a stale decision silently shadowing a verifiable fact is precisely the
 * failure this project exists to prevent (SPEC 1).
 */

import type {
  Annotation,
  AssertedEvidence,
  Decision,
  MatrixPlugin,
  PluginAnnotation,
  Reconciliation,
} from "../matrix/types.ts";
import { DECIDABLE_FIELDS, type DecidableField } from "./schema.ts";

const VALID_WORLDS = ["platform", "wazuh-native", "upstream-fork", "unknown"];
const VALID_VERSION_SCHEMES = ["osd", "wazuh", "unknown"];
const VALID_SERVER_API = ["wazuh-core", "none"];
const VALID_INDEXER_PATHS = ["osd-data", "osd-data-source", "os-plugin-bound"];

/** Is the derived value a hole a decision is allowed to fill? */
function isUnresolved(field: DecidableField, value: unknown): boolean {
  switch (field) {
    case "pluginId":
    case "world":
    case "versionScheme":
      return value === "unknown";
    case "indexerAccess":
      return Array.isArray(value) && value.length === 0;
    case "serverApiAccess":
      // Always derivable from the manifest: presence or absence of wazuhCore.
      // There is no hole here, so a decision on it is always superseded.
      return false;
  }
}

/** Reject a decision whose value does not belong to the field's domain. */
function validateValue(field: DecidableField, value: unknown): string | null {
  switch (field) {
    case "pluginId":
      return typeof value === "string" && value.length > 0
        ? null
        : "expected a non-empty string";
    case "world":
      return VALID_WORLDS.includes(value as string)
        ? null
        : `expected one of ${VALID_WORLDS.join(", ")}`;
    case "versionScheme":
      return VALID_VERSION_SCHEMES.includes(value as string)
        ? null
        : `expected one of ${VALID_VERSION_SCHEMES.join(", ")}`;
    case "serverApiAccess":
      return VALID_SERVER_API.includes(value as string)
        ? null
        : `expected one of ${VALID_SERVER_API.join(", ")}`;
    case "indexerAccess":
      if (!Array.isArray(value)) return "expected an array";
      for (const entry of value) {
        if (!VALID_INDEXER_PATHS.includes(entry as string)) {
          // "wazuh-core" lands here. Server API surface is not an indexer path
          // and must not be reintroduced through the decision layer.
          return `'${String(entry)}' is not an indexer access path`;
        }
      }
      return null;
  }
}

export interface ApplyResult {
  plugins: MatrixPlugin[];
  reconciliation: Reconciliation[];
  /** (plugin handle, field) pairs a decision successfully resolved. */
  resolved: Set<string>;
}

function handleOf(plugin: MatrixPlugin): string {
  return plugin.pluginId === "unknown" ? plugin.pluginDir : plugin.pluginId;
}

export function applyHumanLayers(
  plugins: MatrixPlugin[],
  decisions: Decision[],
  annotations: Annotation[],
  /**
   * Handles (`"<plugin>::<field>"`) overridden by `decisions.local.yml`, as
   * computed by `loadHumanLayers`. Pure -- arrives as an argument like every
   * other input, never read from disk here.
   */
  localOverrides: ReadonlySet<string> = new Set(),
): ApplyResult {
  const reconciliation: Reconciliation[] = [];
  const resolved = new Set<string>();

  const byHandle = new Map<string, MatrixPlugin>();
  for (const plugin of plugins) {
    byHandle.set(handleOf(plugin), plugin);
    byHandle.set(plugin.pluginId, plugin);
    byHandle.set(plugin.pluginDir, plugin);
  }

  for (const decision of decisions) {
    const plugin = byHandle.get(decision.plugin);

    if (!plugin) {
      reconciliation.push({
        plugin: decision.plugin,
        field: decision.field,
        status: "orphaned",
        note: "plugin not present in this build; entry kept, not applied",
        decidedValue: decision.value,
      });
      continue;
    }

    if (decision.status !== "active") {
      reconciliation.push({
        plugin: decision.plugin,
        field: decision.field,
        status: decision.status,
        note: `entry marked ${decision.status} in decisions.yml; not applied`,
        decidedValue: decision.value,
      });
      continue;
    }

    const field = decision.field as DecidableField;
    const derivedValue = plugin[field];

    const invalid = validateValue(field, decision.value);
    if (invalid) {
      throw new Error(
        `decisions.yml: ${decision.plugin}.${decision.field} — ${invalid}`,
      );
    }

    if (!isUnresolved(field, derivedValue)) {
      const conflict =
        JSON.stringify(derivedValue) !== JSON.stringify(decision.value);
      reconciliation.push({
        plugin: decision.plugin,
        field: decision.field,
        status: "superseded",
        note: conflict
          ? "field is now derivable AND the derived value differs — either the rule or the decision is wrong"
          : "field is now derivable and agrees with the decision; retire this entry",
        decidedValue: decision.value,
        derivedValue,
        conflict,
      });
      continue;
    }

    const evidence: AssertedEvidence = {
      kind: "human-assertion",
      source: "decisions.yml",
      author: decision.author,
      date: decision.date,
      reason: decision.reason,
      ...(localOverrides.has(`${decision.plugin}::${decision.field}`)
        ? { overlay: "local" as const }
        : {}),
    };

    // validateValue above already checked the value against the field's
    // domain, so this is the one narrow seam where a dynamically-named field
    // is written. Object.assign keeps it to a single expression with no cast.
    Object.assign(plugin, { [field]: decision.value });
    plugin.assertions[field] = evidence;
    resolved.add(`${handleOf(plugin)}::${field}`);

    reconciliation.push({
      plugin: decision.plugin,
      field: decision.field,
      status: "active",
      note: "field is not derivable; decision applied",
      decidedValue: decision.value,
    });
  }

  for (const annotation of annotations) {
    const plugin = byHandle.get(annotation.plugin);
    if (!plugin) continue;

    const entry: PluginAnnotation = {
      kind: annotation.kind,
      text: annotation.text,
      author: annotation.author,
      date: annotation.date,
    };
    plugin.annotations.push(entry);
  }

  for (const plugin of plugins) {
    plugin.annotations.sort((a, b) => a.text.localeCompare(b.text));
  }

  reconciliation.sort((a, b) =>
    a.plugin === b.plugin ? a.field.localeCompare(b.field) : a.plugin.localeCompare(b.plugin),
  );

  return { plugins, reconciliation, resolved };
}

export { DECIDABLE_FIELDS };

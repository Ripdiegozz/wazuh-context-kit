/**
 * Domain types for the matrix.
 *
 * This module is part of the pure core (SPEC 6.1): no fs, no network, no clock.
 */

import type { Annotation, Decision } from "../decisions/schema.ts";

export type { Annotation, Decision };

export type RepoKind = "platform" | "dashboard" | "indexer";

export type World = "platform" | "wazuh-native" | "upstream-fork" | "unknown";

export type VersionScheme = "osd" | "wazuh" | "unknown";

/**
 * How a plugin reaches the Wazuh Server API.
 *
 * Deliberately separate from IndexerAccessPath. `wazuh-core` exposes Server API
 * surface only -- serverAPIClient, manageHosts, api.client -- and carries no
 * OpenSearch client. Server API and indexer are different backends (SPEC 4).
 */
export type ServerApiAccess = "wazuh-core" | "none";

/**
 * How a plugin reaches the indexer. A SET, not an enum: these paths coexist.
 *
 * "wazuh-core" is intentionally absent from this union. It is not an indexer
 * access path, and the type system is the first line of defence against
 * reintroducing that conflation.
 */
export type IndexerAccessPath = "osd-data" | "osd-data-source" | "os-plugin-bound";

export type EvidenceKind = "derived" | "human-assertion" | "annotation";

/** Raw OSD plugin manifest. Every field optional: these repos are not ours. */
export interface RawManifest {
  id?: string;
  requiredPlugins?: string[];
  optionalPlugins?: string[];
  configPath?: string[];
  opensearchDashboardsVersion?: string;
  requiredOSDataSourcePlugins?: string[];
}

/**
 * What `parse/` emits. Facts only -- no interpretation, no classification.
 */
export interface RawPluginFacts {
  repo: string;
  repoKind: RepoKind;
  pluginDir: string;
  manifestPath: string;
  packageJsonPath: string | null;
  commit: string;
  manifest: RawManifest;
  /** `version` from the sibling package.json. Null when absent from checkout. */
  packageVersion: string | null;
}

export interface DerivedEvidence {
  kind: "derived";
  manifestPath: string;
  packageJsonPath: string | null;
  commit: string;
}

export interface AssertedEvidence {
  kind: "human-assertion";
  /** Where the assertion lives: "sources.yml" or "decisions.yml". */
  source: string;
  author: string;
  date: string;
  reason: string;
}

export type Evidence = DerivedEvidence | AssertedEvidence;

export interface MatrixPlugin {
  repo: string;
  pluginId: string;
  pluginDir: string;
  world: World;
  versionScheme: VersionScheme;
  configPath: string[];
  serverApiAccess: ServerApiAccess;
  indexerAccess: IndexerAccessPath[];
  requiredOSDataSourcePlugins: string[];
  requiredPlugins: string[];
  optionalPlugins: string[];
  /** Where this plugin record came from. Always present. */
  evidence: Evidence;
  /**
   * Per-field provenance for cells resolved by a human decision (SPEC 1.7.1).
   *
   * Keyed by field name. A consumer asking "is this cell verifiable?" looks
   * the field up here: present means asserted, absent means derived. This is
   * what makes "toda celda lleva evidencia" literally true rather than
   * true-at-the-plugin-level.
   */
  assertions: Record<string, AssertedEvidence>;
  /** Layer 3. Additive only; never changes a value above (SPEC 1.7.2). */
  annotations: PluginAnnotation[];
}

export interface PluginAnnotation {
  kind: "warning" | "note" | "ownership";
  text: string;
  author: string;
  date: string;
}

/**
 * Decision lifecycle reconciliation (SPEC 5.4).
 *
 * Emitted on every build. `superseded` with `conflict: true` is the strongest
 * signal this system produces: a field became derivable AND the derived value
 * disagrees with what a human decided. Either the rule is wrong or the
 * decision was.
 */
export interface Reconciliation {
  plugin: string;
  field: string;
  status: "active" | "superseded" | "orphaned";
  note: string;
  decidedValue?: unknown;
  derivedValue?: unknown;
  conflict?: boolean;
}

export interface Unknown {
  plugin: string;
  field: string;
  reason: string;
}

export interface Skipped {
  repo: string;
  reason: string;
}

export interface IndexTemplate {
  name: string;
  path: string;
  indexPatterns: string[];
}

export interface WcsModule {
  name: string;
  fieldsCsv: string;
  fieldCount: number;
}

export interface MatrixJson {
  /** Excluded from payloadHash and from MATRIX.md. The only non-deterministic block. */
  meta: { generatedAt: string; tool: string };
  payloadHash: string;
  ref: string;
  resolvedAt: string;
  resolvedRefs: Record<string, string>;
  plugins: MatrixPlugin[];
  indexer: { templates: IndexTemplate[]; wcsModules: WcsModule[] };
  skipped: Skipped[];
  unknowns: Unknown[];
  reconciliation: Reconciliation[];
}

/** Everything buildMatrix needs. The clock is injected, never read (SPEC 6.1). */
export interface BuildInput {
  ref: string;
  facts: RawPluginFacts[];
  resolvedRefs: Record<string, string>;
  resolvedAt: string;
  generatedAt: string;
  tool: string;
  skipped?: Skipped[];
  templates?: IndexTemplate[];
  wcsModules?: WcsModule[];
  /** Layer 2, already parsed. Loading the YAML is I/O and lives outside. */
  decisions?: Decision[];
  /** Layer 3, already parsed. */
  annotations?: Annotation[];
}

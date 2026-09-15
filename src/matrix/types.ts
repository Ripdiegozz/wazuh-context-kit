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
  /**
   * Bundles a plugin loads at runtime. Present on every core manifest
   * inspected. Recorded and reported as a dependency edge; deliberately NOT
   * consulted by any classifier -- widening a rule on a field we have not
   * studied is how a rule stops describing a property.
   */
  requiredBundles?: string[];
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

/**
 * What `parse/` emits for one OpenSearch Dashboards core plugin.
 *
 * Deliberately narrower than `RawPluginFacts`: no `packageJsonPath`, no
 * `packageVersion`, no `repoKind`. Only 2 of the 64 core plugins at 5.0.0 have
 * a sibling package.json, so reusing that type would mean setting
 * `packageVersion: null` 62 times and then teaching `build.ts` to suppress the
 * `unknowns[]` entry it emits for exactly that case. Suppressing a rule for one
 * caller is how a pure function stops being one (design D3).
 */
export interface RawCoreFacts {
  pluginId: string;
  pluginDir: string;
  manifestPath: string;
  manifest: RawManifest;
}

/** Repository-level core facts. Version and commit live here, not per plugin. */
export interface RawCoreRepo {
  repo: string;
  commit: string;
  /** From the repository root package.json. Null when absent -- not an unknown. */
  version: string | null;
  facts: RawCoreFacts[];
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
  /** Runtime bundle edges. Reported by the resolver, never classified on. */
  requiredBundles: string[];
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

/**
 * A core plugin as it appears in the matrix.
 *
 * Carries identity, dependency edges, and evidence -- nothing else. It has no
 * `world`, `versionScheme`, or `serverApiAccess`: those describe a
 * Wazuh-native or fork plugin, and assigning them here would fabricate facts.
 */
export interface CorePlugin {
  pluginId: string;
  pluginDir: string;
  requiredPlugins: string[];
  optionalPlugins: string[];
  requiredBundles: string[];
  evidence: DerivedEvidence;
}

/** One platform repository's core plugins, with its single repo-level version. */
export interface CoreRepo {
  repo: string;
  version: string | null;
  plugins: CorePlugin[];
}

/**
 * A declared dependency that resolves to no plugin the matrix knows.
 *
 * This is the question the core section exists to answer. `optionalPlugins` is
 * deliberately not checked: an absent optional dependency is the feature
 * working as designed, and reporting it would be noise indistinguishable from
 * signal (design D4).
 */
export interface UnresolvedDependency {
  /** The depending plugin's id. */
  plugin: string;
  /** The depending plugin's repository. */
  repo: string;
  /** The id that resolves to nothing. */
  dependency: string;
  field: "requiredPlugins" | "requiredBundles";
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

/**
 * An index name referenced by plugin source.
 *
 * `via` says how it was recovered, because the three routes carry different
 * confidence: a catalog literal is the declaration, an import is a real
 * consumer, and a saved-object title is an asset that names an index without
 * any code reading it.
 */
export interface IndexReference {
  name: string;
  /** Repo-relative, POSIX. */
  file: string;
  line: number;
  via: "catalog-literal" | "import" | "saved-object";
  /** The constant's name, when the reference came through one. */
  identifier?: string;
}

/**
 * A site where an index name is decided by something a syntactic scan cannot
 * resolve.
 *
 * This is data, not a caveat in prose. A report claiming an index has no
 * consumer is FALSE when a consumer reaches it through one of these, so the
 * limits travel with the result.
 */
export interface UncoveredMechanism {
  kind: "regex-allowlist" | "runtime-configuration" | "computed-expression";
  file: string;
  line: number;
  note: string;
}

export interface IndexTemplate {
  name: string;
  path: string;
  /**
   * The subdirectory under `templates/` this came from -- `states`, `streams`,
   * `content`, or "" for the four that sit directly at the root.
   *
   * Recorded so a reader can tell a state index from a stream index without
   * parsing the path, and so a group appearing upstream is visible as a group
   * rather than as an unexplained new row.
   */
  group: string;
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
  /** Platform repositories' core plugins. Additive: never merged into plugins[]. */
  core: CoreRepo[];
  /** Declared dependencies with no destination, sorted deterministically. */
  unresolvedDependencies: UnresolvedDependency[];
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
  /** Optional so every existing caller and test compiles unchanged. */
  coreRepos?: RawCoreRepo[];
  templates?: IndexTemplate[];
  wcsModules?: WcsModule[];
  /** Layer 2, already parsed. Loading the YAML is I/O and lives outside. */
  decisions?: Decision[];
  /** Layer 3, already parsed. */
  annotations?: Annotation[];
}

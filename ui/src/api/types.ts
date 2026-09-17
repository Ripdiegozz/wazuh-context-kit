/**
 * Types mirroring the server's data contract exactly (src/serve/handlers.ts,
 * src/serve/crosscheck-view.ts, src/serve/unknowns.ts, src/serve/yaml-diff.ts,
 * src/matrix/types.ts). Deliberately duplicated rather than imported: `ui/`
 * has its own package.json and build, and does not depend on `src/`.
 *
 * No field here that the API does not send.
 */

export type World = "platform" | "wazuh-native" | "upstream-fork" | "unknown";
export type VersionScheme = "osd" | "wazuh" | "unknown";
export type ServerApiAccess = "wazuh-core" | "none";
export type IndexerAccessPath = "osd-data" | "osd-data-source" | "os-plugin-bound";
export type EvidenceKind = "derived" | "human-assertion" | "annotation";

export interface DerivedEvidence {
  kind: "derived";
  manifestPath: string;
  packageJsonPath: string | null;
  commit: string;
  /** Server-computed browse URL (src/github.ts's repoBrowseUrl). Absent only if the server predates this field. */
  url?: string;
}

export interface AssertedEvidence {
  kind: "human-assertion";
  source: string;
  author: string;
  date: string;
  reason: string;
  overlay?: "local";
}

export type Evidence = DerivedEvidence | AssertedEvidence;

export interface PluginAnnotation {
  kind: "warning" | "note" | "ownership";
  text: string;
  author: string;
  date: string;
}

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
  requiredBundles: string[];
  evidence: Evidence;
  assertions: Record<string, AssertedEvidence>;
  annotations: PluginAnnotation[];
}

export interface CorePlugin {
  pluginId: string;
  pluginDir: string;
  requiredPlugins: string[];
  optionalPlugins: string[];
  requiredBundles: string[];
  evidence: DerivedEvidence;
}

export interface CoreRepo {
  repo: string;
  version: string | null;
  plugins: CorePlugin[];
}

export interface UnresolvedDependency {
  plugin: string;
  repo: string;
  dependency: string;
  field: "requiredPlugins" | "requiredBundles";
}

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

export interface UnknownWithTelemetry extends Unknown {
  totalQueries: number;
  unresolvedQueries: number;
}

export interface Skipped {
  repo: string;
  reason: string;
}

export interface IndexTemplate {
  name: string;
  path: string;
  group: string;
  indexPatterns: string[];
}

export interface WcsModule {
  name: string;
  fieldsCsv: string;
  fieldCount: number;
  indexPatterns: string[];
}

export interface MatrixJson {
  meta: { generatedAt: string; tool: string };
  payloadHash: string;
  ref: string;
  resolvedAt: string;
  resolvedRefs: Record<string, string>;
  plugins: MatrixPlugin[];
  core: CoreRepo[];
  unresolvedDependencies: UnresolvedDependency[];
  indexer: { templates: IndexTemplate[]; wcsModules: WcsModule[] };
  skipped: Skipped[];
  unknowns: Unknown[];
  reconciliation: Reconciliation[];
}

export interface Provenance {
  [key: string]: unknown;
}

export interface MatrixResponseBody {
  matrix: MatrixJson;
  provenance: Provenance;
}

export interface UnknownsResponseBody {
  unknowns: UnknownWithTelemetry[];
}

/* --- Crosscheck graph --- */

export interface DeclaredIndex {
  pattern: string;
  template: string;
  group: string;
}

export interface IndexReference {
  name: string;
  file: string;
  line: number;
  via: "catalog-literal" | "import" | "saved-object" | "inline-literal";
  identifier?: string;
}

export interface CrosscheckNode {
  id: string;
  side: "declared" | "referenced";
  label: string;
  orphan: boolean;
  detail: DeclaredIndex | IndexReference;
}

export interface CrosscheckEdge {
  source: string;
  target: string;
  file: string;
  line: number;
}

export interface CrosscheckOrphans {
  declaredUnreferenced: DeclaredIndex[];
  referencedUndeclared: IndexReference[];
}

export interface CompetingCatalog {
  name: string;
  files: string[];
}

export interface UncoveredMechanism {
  kind: "regex-allowlist" | "runtime-configuration" | "computed-expression";
  file: string;
  line: number;
  note: string;
}

export interface Coverage {
  recoveredNames: number;
  scannedRepos: string[];
  uncovered: UncoveredMechanism[];
}

export interface CrosscheckView {
  meta: { generatedAt: string; tool: string };
  ref: string;
  coverage: Coverage;
  nodes: CrosscheckNode[];
  edges: CrosscheckEdge[];
  orphans: CrosscheckOrphans;
  wcsWithoutConsumer: string[];
  competingCatalogs: CompetingCatalog[];
}

/* --- Decisions / annotations --- */

export type DecisionsTarget = "decisions.yml" | "decisions.local.yml";
export const ANNOTATIONS_TARGET = "annotations.yml" as const;

export interface Decision {
  plugin: string;
  field: string;
  value: unknown;
  author: string;
  date: string;
  reason: string;
}

export interface Annotation {
  plugin: string;
  kind: "warning" | "note" | "ownership";
  text: string;
  author: string;
  date: string;
}

export interface PostDecisionsRequest {
  target: DecisionsTarget;
  confirm?: boolean;
  entries: unknown;
}

export interface PostAnnotationsRequest {
  target: typeof ANNOTATIONS_TARGET;
  confirm?: boolean;
  entries: unknown;
}

export interface SaveResponseBody<T> {
  target: string;
  committed: boolean;
  diff: {
    added: T[];
    removed: T[];
    changed: { key: string; before: T; after: T }[];
  };
  lines: string[];
}

export interface RefusedBody {
  error: string;
  message: string;
}

export interface DecisionsResponseBody {
  target: string;
  entries: Decision[];
}

export interface AnnotationsResponseBody {
  target: string;
  entries: Annotation[];
}

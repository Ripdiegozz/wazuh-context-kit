/**
 * `LiveComparison` — the shape `buildLiveComparison` (`live.ts`) returns
 * (SPEC 1.10, crosscheck-live-indexer design decision 4).
 *
 * Kept apart from `types.ts` because that module is `CrosscheckInput`, the
 * offline comparison's inputs -- this is the live comparison's OUTPUT, a
 * different question ("does this exist?" vs "does anyone use this?").
 */

export interface InstalledEntry {
  readonly name: string;
  readonly kind: "index" | "dataStream";
}

/**
 * Split so nothing is silently dropped. Once hidden indices are counted, most
 * undeclared names are platform runtime state -- security-analytics detector
 * indices, OpenDistro configuration, the OpenSearch Dashboards index -- and
 * burying the few Wazuh-namespace findings among them is as bad as discarding
 * the platform ones outright. The Wazuh group is reported in full; the
 * platform-managed group is reported under its own heading, with its count.
 */
export interface PartitionedUndeclared {
  readonly wazuh: InstalledEntry[];
  readonly platformManaged: InstalledEntry[];
}

/**
 * A declared pattern and an installed name that are the same subject but
 * fail to match -- e.g. `wazuh-threatintel-filters` declared without its
 * sibling patterns' trailing `*`, against the installed
 * `wazuh-threatintel-filters-a`.
 *
 * `covers()` still says these do not match; that is correct and untouched.
 * This is a reporting decision layered on top, so the one real problem does
 * not read as two unrelated findings in two long lists.
 */
export interface SameSubjectMismatch {
  readonly pattern: string;
  readonly template: string;
  readonly installedName: string;
  readonly installedKind: "index" | "dataStream";
}

export interface LiveComparison {
  readonly declaredNotInstalled: { pattern: string; template: string }[];
  readonly installedNotDeclared: PartitionedUndeclared;
  readonly templatesOnlyInCluster: { name: string; indexPatterns: string[] }[];
  readonly sameSubjectMismatches: SameSubjectMismatch[];
}

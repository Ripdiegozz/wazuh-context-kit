/**
 * `buildLiveComparison` — SPEC 1.10, the repository against the running
 * cluster.
 *
 * Pure: takes a plain `RawClusterState` and a plain `DeclaredIndex[]`,
 * returns a `LiveComparison`. No fs, no network, no clock (SPEC 6.1). All the
 * judgement the impure client in `src/indexer/client.ts` deliberately does
 * NOT make -- which index belongs to which stream, which names are the same
 * subject, which names are ours to worry about -- lives here, where a test
 * states it as a literal.
 */

import { covers } from "./build.ts";
import type { RawClusterState } from "../indexer/types.ts";
import type { DeclaredIndex } from "../matrix/types.ts";
import type {
  InstalledEntry,
  LiveComparison,
  SameSubjectMismatch,
} from "./live-types.ts";

function isGlob(pattern: string): boolean {
  return pattern.endsWith("*");
}

/**
 * Every name the cluster actually has, with backing indices resolved to
 * their owning stream (design decision 2).
 *
 * Ownership comes from `backingIndices`, the cluster's own report -- never
 * from a `.ds-` prefix guess. A backing index with an unconventional name
 * still resolves correctly; a plain index that happens to start with `.ds-`
 * but is claimed by no stream is not swallowed.
 */
function buildInstalledSet(state: RawClusterState): InstalledEntry[] {
  const backingIndexNames = new Set(state.dataStreams.flatMap((ds) => ds.backingIndices));

  const streams: InstalledEntry[] = state.dataStreams.map((ds) => ({
    name: ds.name,
    kind: "dataStream",
  }));

  const plainIndices: InstalledEntry[] = state.indices
    .filter((idx) => !backingIndexNames.has(idx.name))
    .map((idx) => ({ name: idx.name, kind: "index" }));

  return [...streams, ...plainIndices];
}

/** `wazuh-*` or `.wazuh-*` -- ours to worry about. Everything else is platform-managed. */
function isWazuhNamespace(name: string): boolean {
  return name.startsWith("wazuh-") || name.startsWith(".wazuh-");
}

/**
 * Same-subject join (SPEC: "A pattern and an index that are the same
 * subject are reported as one").
 *
 * `wazuh-threatintel-filters` is declared without the trailing `*` every
 * sibling pattern carries. The installed index is
 * `wazuh-threatintel-filters-a`. `covers()` correctly says these do not
 * match -- an exact declaration matches only its own exact name -- but
 * reporting them as two unrelated findings in two lists hides that they are
 * one problem. This function does NOT loosen the match: `covers()` is
 * untouched and still returns `false` for the pair. It only decides how to
 * REPORT a specific shape: an exact declared pattern that is a strict
 * prefix of exactly one otherwise-undeclared installed name.
 */
function findSameSubjectMismatches(
  declaredNotInstalled: readonly { pattern: string; template: string }[],
  installedNotDeclared: readonly InstalledEntry[],
): SameSubjectMismatch[] {
  const mismatches: SameSubjectMismatch[] = [];

  for (const d of declaredNotInstalled) {
    if (isGlob(d.pattern)) continue; // the shape this join exists for is an exact pattern

    const candidates = installedNotDeclared.filter(
      (entry) => entry.name !== d.pattern && entry.name.startsWith(d.pattern),
    );
    // More than one candidate means the extension is ambiguous -- leave the
    // entries where they are rather than guess which one is the same subject.
    if (candidates.length !== 1) continue;

    const [match] = candidates;
    if (!match) continue;
    mismatches.push({
      pattern: d.pattern,
      template: d.template,
      installedName: match.name,
      installedKind: match.kind,
    });
  }

  return mismatches.sort((a, b) => a.pattern.localeCompare(b.pattern));
}

/**
 * WCS module patterns as `DeclaredIndex` entries, for the live comparison.
 *
 * A WCS module's `fields/template-settings.json` declares an `index_patterns`
 * array exactly like an indexer template does (`buildCrosscheck`'s
 * `wcsIsConsumed` already reads it this way for the offline report). The live
 * comparison was built from `parsed.templates` alone, so a pattern declared
 * ONLY by a WCS module -- `.wazuh-internal-state*` in
 * `wcs/internal-state/fields/template-settings.json` -- was invisible to it:
 * an installed match for that pattern was reported as an undeclared surprise
 * (a false accusation about production state), and a genuinely missing one
 * never reached `declaredNotInstalled` at all.
 *
 * `template` names the module's own `template-settings.json`, from its
 * `name` (the module's directory under `wcs/`, e.g. `internal-state` or the
 * nested `content/ioc`) -- never a placeholder, so the report still says
 * where the declaration lives.
 */
export function declaredFromWcsModules(
  wcsModules: readonly { name: string; indexPatterns: readonly string[] }[],
): DeclaredIndex[] {
  return wcsModules.flatMap((module) =>
    module.indexPatterns.map((pattern) => ({
      pattern,
      template: `wcs/${module.name}/fields/template-settings.json`,
      group: "",
    })),
  );
}

export function buildLiveComparison(
  state: RawClusterState,
  declared: readonly DeclaredIndex[],
): LiveComparison {
  const installedSet = buildInstalledSet(state);

  const declaredNotInstalledRaw = declared
    .filter((d) => !installedSet.some((entry) => covers(d.pattern, entry.name)))
    .map((d) => ({ pattern: d.pattern, template: d.template }));

  const installedNotDeclaredRaw = installedSet.filter(
    (entry) => !declared.some((d) => covers(d.pattern, entry.name)),
  );

  const sameSubjectMismatches = findSameSubjectMismatches(
    declaredNotInstalledRaw,
    installedNotDeclaredRaw,
  );
  const joinedPatterns = new Set(sameSubjectMismatches.map((m) => m.pattern));
  const joinedInstalledNames = new Set(sameSubjectMismatches.map((m) => m.installedName));

  const declaredNotInstalled = declaredNotInstalledRaw
    .filter((d) => !joinedPatterns.has(d.pattern))
    .sort((a, b) => a.pattern.localeCompare(b.pattern));

  const remainingUndeclared = installedNotDeclaredRaw.filter(
    (entry) => !joinedInstalledNames.has(entry.name),
  );

  const installedNotDeclared = {
    wazuh: remainingUndeclared
      .filter((entry) => isWazuhNamespace(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name)),
    platformManaged: remainingUndeclared
      .filter((entry) => !isWazuhNamespace(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };

  const templatesOnlyInCluster = state.indexTemplates
    .filter(
      (template) =>
        !template.indexPatterns.some((pattern) =>
          declared.some((d) => covers(d.pattern, pattern)),
        ),
    )
    .map((template) => ({ name: template.name, indexPatterns: [...template.indexPatterns] }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    declaredNotInstalled,
    installedNotDeclared,
    templatesOnlyInCluster,
    sameSubjectMismatches,
  };
}

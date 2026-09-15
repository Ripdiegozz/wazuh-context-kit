# Source-Parse Specification

## Purpose

Adapter that reads bytes from a fetched checkout root and emits
`RawPluginFacts[]`, `IndexTemplate[]`, and `WcsModule[]` (SPEC 1.2, 1.6). Zero
interpretation: it never classifies, decides, or guesses (SPEC 6.1);
classification stays inside `src/matrix/`.

## Requirements

### Requirement: Manifest and package.json parsing

The system MUST read each `opensearch_dashboards.json` manifest under a
fetched checkout, together with its sibling `package.json`, and emit one
`RawPluginFacts` entry per manifest (SPEC 1.2, 1.5.1).

#### Scenario: Well-formed manifest

- GIVEN a checkout containing a valid manifest and its sibling `package.json`
- WHEN parse reads that plugin directory
- THEN the resulting `RawPluginFacts` has `manifest` populated from the
  manifest fields, `packageVersion` set to the package.json `version`, and
  `packageJsonPath` set to the sibling file's path

### Requirement: Robust-empty on malformed manifest

The system MUST NOT crash when a manifest is malformed or does not parse as an
object; it MUST emit `manifest: {}` for that plugin so the fact flows through
`matrix/`'s existing pure rules to `pluginId: "unknown"`, `world: "unknown"`,
`indexerAccess: []`, and the corresponding `unknowns[]` entries (SPEC 1.5.4,
1.9, D5).

#### Scenario: Malformed manifest yields empty manifest facts

- GIVEN a manifest file containing invalid or unparseable JSON
- WHEN parse reads that plugin directory
- THEN the resulting `RawPluginFacts.manifest` equals `{}`
- AND parse does not throw
- AND passing this fact through `buildMatrix` yields `pluginId: "unknown"`,
  `world: "unknown"`, `indexerAccess: []`

### Requirement: Malformed package.json keeps the real path

When a sibling `package.json` exists on disk but fails to parse, the system
MUST set `packageVersion` to `null` and MUST keep `packageJsonPath` at the
real on-disk path, never `null` (SPEC 1.5.4, D5).

#### Scenario: Malformed package.json

- GIVEN a plugin directory whose `package.json` exists but contains invalid
  JSON
- WHEN parse reads that plugin directory
- THEN `packageVersion` is `null`
- AND `packageJsonPath` equals the real path to that file, not `null`

Note: `src/matrix/build.ts` branches its unknown-reason text on
`packageJsonPath`'s truthiness; a `null` value here would incorrectly claim a
present file is absent. This is a recorded limitation, not remediated inside
the pure core (D1, D5).

### Requirement: WCS modules discovered from fields.csv

The system MUST enumerate `wcs/<module>/docs/fields.csv` per module and emit
one `WcsModule` per module with `fieldCount` equal to the number of data rows
in that file (SPEC 1.2).

#### Scenario: WCS module field count

- GIVEN a fetched checkout with a `wcs/<module>/docs/fields.csv` containing N
  data rows
- WHEN parse reads that module
- THEN the emitted `WcsModule.fieldCount` equals N

### Requirement: parse/ emits final indexer shapes, no classification step

The system MUST emit `IndexTemplate` and `WcsModule` in their final
`MatrixJson.indexer` shape, since `src/matrix/build.ts` passes them through
unchanged, and MUST NOT introduce a classification step for these shapes
anywhere in `src/matrix/` (SPEC 6.1, D2).

#### Scenario: Pass-through identity

- GIVEN a `BuildInput` whose `templates` and `wcsModules` were produced by
  parse
- WHEN `buildMatrix` runs
- THEN `MatrixJson.indexer.templates` and `.wcsModules` are the same values
  parse emitted, unmodified

### Requirement: Core plugin manifests parse without a sibling package.json

The system MUST parse an `opensearch_dashboards.json` manifest under a
`platform` repository's `src/plugins` even when no sibling `package.json`
exists, and MUST NOT emit an `unknowns[]` entry for the missing version
(SPEC 1.5.4).

Only 2 of the 64 core plugin manifests at `5.0.0` have a sibling
`package.json`. Emitting an unknown for each of the other 62 would grow the
unknowns list from 3 actionable entries to 65, destroying the signal the list
exists to carry.

#### Scenario: Manifest without package.json

- GIVEN a core plugin directory holding `opensearch_dashboards.json` and no `package.json`
- WHEN parse reads it
- THEN a core plugin fact is produced
- AND `unknowns[]` gains no entry for that plugin's version

### Requirement: Core plugin version comes from the repository, not the plugin

The system MUST attribute a single version to every core plugin of a `platform`
repository, read from that repository's root `package.json`, and MUST record it
once at the repository level rather than repeating it per plugin.

#### Scenario: Repository-level version

- GIVEN a `platform` repository whose root `package.json` declares a version
- WHEN parse completes
- THEN that version is recorded once for the repository
- AND no core plugin carries its own conflicting version field

### Requirement: Manifest version field is not a classification signal

The system MUST NOT derive a core/non-core classification from the manifest
`version` field.

Across the 64 core manifests at `5.0.0` that field holds `opensearchDashboards`
47 times, `8.0.0` 9 times, and `1.0.0` 8 times, so it does not discriminate.
The declared repository `kind` is the classification source. This mirrors the
existing caution recorded for `opensearchDashboardsVersion`.

#### Scenario: Mixed version fields do not change classification

- GIVEN two core plugins whose manifests declare `opensearchDashboards` and `1.0.0` respectively
- WHEN parse and classification complete
- THEN both are classified as core plugins of the same `platform` repository

### Requirement: Core plugin facts carry dependency fields and evidence only

The system MUST record, for each core plugin, its id, its directory, its
`requiredPlugins`, `optionalPlugins`, and `requiredBundles` where present, and
its evidence (manifest path and commit). The system MUST NOT assign it
`serverApiAccess`, `world`, or a per-plugin `versionScheme`.

Those three fields describe a Wazuh-native or fork plugin. A core plugin has no
Wazuh Server API relationship, and forcing one would be a fabricated fact.

#### Scenario: Narrow core plugin fact

- GIVEN a parsed core plugin
- WHEN its fact is produced
- THEN it carries id, directory, dependency fields, and evidence
- AND it carries no `serverApiAccess`, `world`, or `versionScheme`

### Requirement: Every template directory is parsed, not only `states/`

The system MUST discover index templates under **every** subdirectory of the
indexer's `templates/` path, and MUST NOT restrict discovery to
`templates/states/` (SPEC 1.2, 1.8).

At `5.0.0` the tree holds `states/` (20), `streams/` (8), `content/` (8), and
four JSON files directly under `templates/`. Reading only `states/` declares
**20 of 40**.

> This **replaced** a requirement titled "Index templates discovered under
> `templates/states`", which mandated exactly the defect: recursing
> `templates/states/*.json` and nothing else. Its acceptance scenario asked for
> "at least 18 templates", which the 20 in that one directory satisfied while
> the other 20 stayed invisible. The superseded text is preserved in
> `openspec/changes/archive/2026-09-15-close-phase-1/`.
>
> The collision was invisible by title — the new requirement is called
> something else — which is why an archive check that compares headings is not
> enough.

This matters beyond completeness: seven index patterns referenced by dashboard
code are declared in `streams/` and `content/`. A crosscheck built on the
narrower parse would report all seven as undeclared.

#### Scenario: Templates from sibling directories

- GIVEN an indexer checkout with `templates/states/`, `templates/streams/` and `templates/content/`, each holding JSON with `index_patterns`
- WHEN parse completes
- THEN templates from all three directories are present
- AND each records which directory it came from

#### Scenario: An unknown future subdirectory is included

- GIVEN a `templates/` subdirectory whose name the implementation has never seen
- WHEN parse completes
- THEN its templates with `index_patterns` are discovered
- AND no directory name is hardcoded as an allowlist

### Requirement: Index references are recovered from plugin source

The system MUST recover index names referenced by dashboard plugin source, by
resolving identifiers to their string literals within catalog modules and
following import edges, and MUST do so without a type checker.

The project pins `typescript@7.0.2`, which ships no JS-callable compiler API.
Acquiring one would mean a second copy of TypeScript or moving the project's
toolchain; neither is in scope.

#### Scenario: A literal in a catalog module

- GIVEN `export const WAZUH_VULNERABILITIES_PATTERN = 'wazuh-states-vulnerabilities*'`
- WHEN the scanner reads that module
- THEN `wazuh-states-vulnerabilities*` is recovered, attributed to that file and line

#### Scenario: A consumer importing the identifier

- GIVEN a file importing `WAZUH_VULNERABILITIES_PATTERN` from a catalog module and using it
- WHEN the scanner runs
- THEN that file is recorded as a consumer of `wazuh-states-vulnerabilities*`
- AND the index is not reported as unconsumed

#### Scenario: Saved-object index patterns

- GIVEN an `.ndjson` asset containing an object of `"type":"index-pattern"`
- WHEN the scanner reads it
- THEN the index title is recovered as a reference

### Requirement: What the scan cannot see is recorded as data

The system MUST emit, as structured output, every site where an index name is
determined by a mechanism the scanner cannot resolve, identifying the file, the
line and the mechanism.

Three mechanisms are known: a regex allowlist accepting names by shape
(`guardrails.ts:199`), a name read from runtime configuration
(`wazuh-elastic.ts:87-91`), and entries assembled by `.map()` spreads or string
concatenation.

A report claiming an index has no consumer is **false** when a consumer reaches
it through one of these. Uncoverage is therefore part of the result, not a
caveat in prose.

#### Scenario: A regex allowlist is reported

- GIVEN a module that matches index names against a regular expression instead of listing them
- WHEN the scanner runs
- THEN an uncovered-mechanism entry names that file, line and kind
- AND the entry is present in the machine-readable output, not only in rendered text

#### Scenario: Recovered count is pinned

- GIVEN the catalog modules at a known revision
- WHEN the scanner runs
- THEN the number of recovered names is asserted against a pinned expectation
- AND a silent drop to zero fails rather than passing as "nothing referenced"

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

### Requirement: Index templates discovered under templates/states

The system MUST recursively list
`plugins/setup/src/main/resources/templates/states/*.json` under a fetched
`wazuh-indexer-plugins` checkout and emit one `IndexTemplate` per file, with
`name` as the filename stem and `indexPatterns` from the JSON's
`index_patterns` field when present (SPEC 1.2, 1.9).

#### Scenario: At least 18 templates discovered

- GIVEN a fetched `wazuh-indexer-plugins` checkout matching the SPEC 1.2
  fixture layout
- WHEN parse enumerates `templates/states/`
- THEN the emitted `IndexTemplate[]` has at least 18 entries

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

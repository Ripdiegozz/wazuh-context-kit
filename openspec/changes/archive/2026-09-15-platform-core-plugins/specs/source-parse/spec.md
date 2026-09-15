# Source-Parse Specification — delta for `platform-core-plugins`

## Purpose

Extends the archived `source-parse` capability so core plugin manifests are
parsed without being forced through a fact shape they cannot satisfy.

## Requirements

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

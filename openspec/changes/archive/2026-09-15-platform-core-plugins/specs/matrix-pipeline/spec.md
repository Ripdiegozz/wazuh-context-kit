# Matrix-Pipeline Specification — delta for `platform-core-plugins`

## Purpose

Extends the archived `matrix-pipeline` capability with a core plugin section, a
dangling-dependency report, and a guard against publishing a stale dataset.

## Requirements

### Requirement: Core plugins occupy their own section

The system MUST emit core plugins in a section of `matrix.json` distinct from
`plugins[]`, and MUST NOT add them to `plugins[]` (SPEC 1.5.2).

`plugins[]` carries the 9 Wazuh-relevant plugins a reader is looking for. Adding
64 OpenSearch Dashboards core plugins to it would make the thing the tool exists
to show the minority of its own output.

The new section MUST be additive: no existing key is renamed, removed, or
changed in meaning.

#### Scenario: Sections stay separate

- GIVEN a build over a source list containing one `platform` repository
- WHEN the matrix is built
- THEN `plugins[]` contains only non-core plugins
- AND the core section contains the core plugins
- AND no plugin appears in both

#### Scenario: Existing consumers are unaffected

- GIVEN a consumer reading `plugins[]`, `unknowns[]`, `skipped[]`, and `resolvedRefs`
- WHEN the core section is added
- THEN every one of those keys keeps its previous name and meaning

### Requirement: Unresolved plugin dependencies are reported

The system MUST report every `requiredPlugins` entry, across all sections, that
does not resolve to a plugin the matrix knows, and MUST identify both the
depending plugin and the unresolved dependency id.

This is the question the change exists to answer. A reader must not have to
re-derive it by comparing two sections by eye.

#### Scenario: A dependency with no destination

- GIVEN a plugin whose `requiredPlugins` names an id present in no section
- WHEN the matrix is built
- THEN the unresolved-dependency report names that plugin and that id

#### Scenario: Core dependencies resolve once core plugins are visible

- GIVEN the four wazuh-native plugins, each requiring `navigation`
- AND a `platform` repository contributing `navigation` as a core plugin
- WHEN the matrix is built
- THEN `navigation` is reported as resolved for all four
- AND it appears in no unresolved-dependency entry

### Requirement: Unknowns stay actionable

The system MUST NOT emit an `unknowns[]` entry for a core plugin field that is
absent by design (SPEC 1.5.4).

#### Scenario: Core plugins add no unknowns

- GIVEN 64 core plugins, 62 of which have no sibling `package.json`
- WHEN the matrix is built
- THEN `unknowns[]` gains no entry from any of them

### Requirement: The committed dataset matches a real run

The system MUST provide a check that regenerates the matrix from real
repositories and compares the result against the committed `out/<ref>/`, failing
when the committed `payloadHash` does not match (SPEC 5.1).

This check MAY require network and MUST therefore be opt-in, alongside the
existing network-gated suite. The committed dataset is the product; it shipping
stale and unnoticed is the defect this requirement exists to prevent.

#### Scenario: Committed dataset is current

- GIVEN a committed `out/<ref>/matrix.json`
- WHEN the opt-in check regenerates the matrix from real repositories
- THEN the regenerated `payloadHash` equals the committed one

#### Scenario: Committed dataset is a fixtures build

- GIVEN a committed `out/<ref>/matrix.json` produced by `--fixtures`
- WHEN the opt-in check runs
- THEN it fails and names the mismatching hashes

### Requirement: Rendered output stays readable at scale

The system MUST render the core plugin section of `MATRIX.md` as a summary
rather than one row per plugin, and MUST keep the existing sections' rendering
unchanged (SPEC 1.7).

#### Scenario: Core section renders compactly

- GIVEN 64 core plugins
- WHEN `MATRIX.md` is rendered
- THEN the core section does not emit 64 plugin rows
- AND the existing plugin table is byte-identical to what the same input
  produced before this change

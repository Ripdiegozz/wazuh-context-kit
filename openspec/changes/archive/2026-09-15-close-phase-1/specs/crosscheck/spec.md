# Crosscheck Specification — new capability for `close-phase-1`

## Purpose

SPEC 1.8: which indices the indexer declares, against which indices the
dashboard actually references. No single repository can answer it, which SPEC
calls "el valor diferencial de la fase".

## Requirements

### Requirement: The crosscheck reports three populations

The system MUST emit, for a given ref: index templates declared by the indexer
that no dashboard plugin references; index names referenced by dashboard source
that no template declares; and WCS modules with no known consumer (SPEC 1.8).

#### Scenario: A declared index nobody references

- GIVEN a template declaring an index pattern
- AND no recovered reference matching it
- WHEN the crosscheck runs
- THEN that template appears as declared-unreferenced, with its file and pattern

#### Scenario: A referenced index nobody declares

- GIVEN a recovered reference to `wazuh-agent-stats*`
- AND no template declaring it
- WHEN the crosscheck runs
- THEN it appears as referenced-undeclared, naming the referencing file and line

#### Scenario: Patterns match by shape, not by string equality

- GIVEN a template declaring `wazuh-states-vulnerabilities*`
- AND a reference to `wazuh-states-vulnerabilities*`
- WHEN the crosscheck runs
- THEN they are matched
- AND a reference to `wazuh-metrics-comms-v4*` is NOT matched to a declaration of `wazuh-metrics-comms*`

### Requirement: Coverage limits travel with the result

The system MUST include, in the crosscheck output itself, the mechanisms whose
index names could not be recovered, and MUST NOT present the report as complete.

Rendered output MUST state the limitation before the findings, not after.

A reader who takes "no consumer found" as "no consumer exists" will delete a
live index. The report must make that misreading hard.

#### Scenario: Uncovered mechanisms are in the machine-readable output

- GIVEN a codebase using a regex allowlist and a runtime-configuration lookup
- WHEN the crosscheck runs
- THEN both appear in the output as structured entries with file, line and kind

#### Scenario: Rendered output leads with its limits

- GIVEN a crosscheck with at least one uncovered mechanism
- WHEN `CROSSCHECK.md` is rendered
- THEN the coverage statement appears before the findings sections

### Requirement: The crosscheck is its own artifact

The system MUST write the crosscheck to `out/<ref>/crosscheck.json` and
`out/<ref>/CROSSCHECK.md`, and MUST NOT change `matrix.json`'s `payloadHash`.

It is a different graph from `unresolvedDependencies` — index to plugin, not
plugin to plugin — and it carries a coverage caveat the matrix does not. Keeping
it separate means improving the scanner does not churn the dataset.

#### Scenario: The dataset hash is unmoved

- GIVEN a repository where the crosscheck runs
- WHEN `matrix.json` is regenerated
- THEN its `payloadHash` is unchanged by the presence of the crosscheck

#### Scenario: Deterministic output

- GIVEN identical inputs
- WHEN the crosscheck runs twice
- THEN both outputs are byte-identical, with every list deterministically ordered

### Requirement: Competing catalogs are reported

The system MUST report when two or more modules each declare the same index name
as authoritative.

`plugins/main/common/constants.ts` and
`wazuh-ai-assistant/server/tools/state-families.ts` both claim the same 18
`wazuh-states-*` names. SPEC 1.8 does not ask for this, but drift between two
catalogs inside one repository is exactly what this project exists to watch.

This is a reported finding, never a fatal error.

#### Scenario: Two catalogs, one name

- GIVEN two modules both defining a literal for `wazuh-states-vulnerabilities*`
- WHEN the crosscheck runs
- THEN a competing-catalog finding names both files
- AND the crosscheck exits successfully

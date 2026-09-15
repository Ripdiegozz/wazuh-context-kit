# Matrix-Pipeline Specification

## Purpose

Loads `sources.yml`, wires `fetch/ → parse/ → buildMatrix`, and replaces the
CLI's synthetic `resolvedRefs`/`skipped` literals with real ones, without
touching the pure core (SPEC 6.1, D1).

## Requirements

### Requirement: sources.yml is the explicit repo list

The system MUST load the repo list and refs from `sources.yml` at the project
root and MUST NOT infer repo names by convention (SPEC 1.3).

#### Scenario: Loader reads sources.yml

- GIVEN a `sources.yml` listing repos with `name`, `kind`, and a top-level
  `refs`
- WHEN the loader parses the file
- THEN it returns one entry per repo with its `name` and `kind`, and the
  configured `refs`

#### Scenario: Malformed sources.yml is a fatal error

- GIVEN a `sources.yml` that fails schema validation
- WHEN the loader parses the file
- THEN loading fails with an error naming the offending field, and the CLI
  does not proceed to fetch

### Requirement: CLI wires fetch → parse → buildMatrix for real data

`wazuh-ctx matrix --ref <ref>` without `--fixtures` MUST call the sources
loader, then `fetch/`, then `parse/`, then `buildMatrix`, and MUST NOT contain
a hardcoded `resolvedRefs` or `skipped` literal (SPEC 1.6, 1.9, D4).

#### Scenario: Real run without --fixtures

- GIVEN `sources.yml` and a reachable or cached checkout for each listed repo
- WHEN `wazuh-ctx matrix --ref 5.0.0` runs without `--fixtures`
- THEN `out/5.0.0/matrix.json` and `MATRIX.md` are written
- AND `resolvedRefs` and `skipped` in the output come from `fetch/`'s
  `FetchOutcome`, not from a literal in `src/cli.ts`

#### Scenario: --fixtures path is unaffected

- GIVEN `--fixtures` is passed
- WHEN `wazuh-ctx matrix --ref 5.0.0 --fixtures` runs
- THEN it still builds from `fixtures/facts.ts` as before, unaffected by the
  fetch/parse wiring

### Requirement: The purity seam holds

`src/matrix/*` and `src/decisions/apply.ts` MUST NOT be modified by this
change and MUST NOT acquire any fs, network, or clock access (SPEC 6.1, D1).

#### Scenario: No new I/O in the pure core

- GIVEN the complete diff for this change
- WHEN it is inspected for changes under `src/matrix/` and
  `src/decisions/apply.ts`
- THEN no lines are added or modified in those paths, and neither imports
  `node:fs`, `node:child_process`, `node:net`, `node:http`, `node:https`, nor
  calls `Date.now()` or `new Date()`

### Requirement: Determinism survives real data

Two runs of `wazuh-ctx matrix --ref <ref>` over the same cache MUST produce an
identical `payloadHash` and a byte-identical `MATRIX.md`, and
`meta.generatedAt` MUST never influence either (SPEC 1.6.1, 1.9).

#### Scenario: Repeat run over one cache

- GIVEN a populated `.cache/` for a ref
- WHEN `wazuh-ctx matrix --ref <ref>` runs twice in succession without
  `--refresh`
- THEN both runs report the same `payloadHash`
- AND the two `MATRIX.md` files are byte-identical
- AND the two `meta.generatedAt` values may differ without affecting the
  comparisons above

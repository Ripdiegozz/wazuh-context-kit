# Repo-Fetch Specification — delta for `close-phase-1`

## Purpose

The dashboard path set covers one repository shape and silently misses the
other. The crosscheck needs source from both.

## Requirements

### Requirement: Dashboard checkouts cover both repository shapes

The system MUST check out plugin source for dashboard repositories laid out as a
single plugin, in addition to those laid out as a monorepo (SPEC 1.2, 1.8).

`sparsePathsFor("dashboard")` returns `["plugins"]`. For
`wazuh-dashboard-plugins`, a monorepo, that is the whole source tree — 2,642
files. The other five dashboard repositories **are each a single plugin**: their
code sits in `server/`, `public/` and `common/`, and they have no `plugins/`
directory, so a cone-mode checkout leaves them root files only — around 20 files
and no source.

The path set therefore works by accident for one shape and contributes nothing
for the other. A declared path that matches nothing must not be mistaken for a
repository that contains nothing.

#### Scenario: Monorepo-shaped dashboard repository

- GIVEN a dashboard repository whose plugins live under `plugins/<name>/`
- WHEN fetch clones it
- THEN the plugin source trees are present on disk

#### Scenario: Single-plugin-shaped dashboard repository

- GIVEN a dashboard repository that is itself one plugin, with `server/` and `public/` at the root and no `plugins/` directory
- WHEN fetch clones it
- THEN `server/` and `public/` are present on disk
- AND the checkout is not limited to root files

#### Scenario: A declared path that matches nothing is not silent

- GIVEN a declared sparse path that exists in no repository of that kind
- WHEN the checkout completes
- THEN the outcome is distinguishable from a repository that genuinely has no source

### Requirement: The cost of widening is measured, not estimated

The system's documentation MUST record the observed cold-clone time and cache
size before and after this change.

The previous cycle established the habit for a reason: an estimated forecast
cost a maintainer round-trip twice. Cold clone was 32 s and `.cache/` 245 MB
entering this change.

#### Scenario: Recorded measurements

- GIVEN the widened path set
- WHEN a cold regeneration runs
- THEN the observed elapsed time and resulting cache size are recorded as real numbers

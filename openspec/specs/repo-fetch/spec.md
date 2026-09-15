# Repo-Fetch Specification

## Purpose

Adapter that resolves a ref against `wazuh/*` repos on GitHub, maintains a local
sparse-checkout cache under `.cache/<repo>@<ref>/`, and reports which repos could
not be resolved. Only this module touches network and git subprocesses (SPEC 6.1).

## Requirements

### Requirement: Ref resolution by discovery

The system MUST resolve a repo's ref to a commit SHA by invoking
`git ls-remote --heads <url> <ref>` and MUST NOT hardcode which repos succeed or
fail (SPEC 1.4, 1.9).

#### Scenario: Ref exists

- GIVEN a repo whose remote has a branch matching `ref`
- WHEN fetch resolves that repo
- THEN the result includes the repo in `fetched` with the SHA reported by `ls-remote`

#### Scenario: Ref does not exist — skip by discovery

- GIVEN `wazuh-dashboard-ml-commons` configured with `ref: "5.0.0"`, and its
  remote reports no matching branch
- WHEN fetch runs the full repo list
- THEN `wazuh-dashboard-ml-commons` appears in `skipped[]` with a reason
  describing the missing ref
- AND fetch does not crash and continues resolving the remaining repos
- AND no literal naming this repo or its skip reason exists in `src/cli.ts`

### Requirement: Cache-hit second run performs zero network-touching subprocesses

When a repo's cache directory already contains a `.git` folder and no
`--refresh` flag was given, the system MUST NOT invoke `ls-remote`, `clone`, or
`fetch` for that repo, and MUST read the commit via a local `git rev-parse HEAD`
instead (SPEC 1.4, 1.9, D3).

#### Scenario: Cache hit is offline

- GIVEN a repo previously cloned into `.cache/<repo>@<ref>/` with a valid `.git`
  directory, and an injected command runner that records every invocation
- AND no `--refresh` flag
- WHEN fetch resolves that repo again
- THEN the command runner recorded zero network-touching invocations
  (`ls-remote`, `clone`, `fetch`) for that repo
- AND the reported commit equals the local `HEAD` SHA

#### Scenario: Cache miss still resolves

- GIVEN no cache directory exists for a repo
- WHEN fetch resolves that repo
- THEN fetch performs `ls-remote`, then a blobless sparse clone, and reports
  the resulting commit

### Requirement: Every fetched repo yields exactly one resolved SHA

The system MUST report exactly one commit SHA per repo present in `fetched[]`,
and MUST NOT emit a SHA for a repo present in `skipped[]` (SPEC 1.6, 1.9).

#### Scenario: resolvedRefs population

- GIVEN a source list where all repos except one resolve successfully
- WHEN fetch completes
- THEN `fetched` contains one entry per resolved repo, each with a non-empty
  `commit`
- AND `skipped` contains the unresolved repo with no corresponding commit
  anywhere in the output

### Requirement: Platform repositories check out their core plugin tree

The system MUST include `src/plugins` in the sparse-checkout path set for
`kind: platform`, so that the OpenSearch Dashboards core plugin manifests are
present on disk and available to the parser (SPEC 1.2, 1.5.2).

The system MUST NOT treat the root-level `plugins/` directory of
`wazuh-dashboard` as a manifest source. That directory is git-ignored in the
upstream repository and holds no repository content; it is a local development
mount point.

#### Scenario: Platform checkout contains core manifests

- GIVEN a repository declared with `kind: platform`
- WHEN fetch clones it
- THEN `src/plugins` is present on disk
- AND at least one `src/plugins/<name>/opensearch_dashboards.json` exists

#### Scenario: The git-ignored plugins directory is not a source

- GIVEN a `platform` checkout
- WHEN the parser looks for manifests
- THEN no manifest is read from a root-level `plugins/` directory

### Requirement: Sparse checkout limited to declared paths, plus cone-mode root files

The system MUST restrict the sparse-checkout of each cloned repo to the paths
declared for its kind (SPEC 1.2).

Cone mode additionally materialises the repository's top-level files. A checkout
is therefore compliant when it contains the declared subtrees and root files,
and no other subtree.

> This requirement replaced an earlier one that read "only the SPEC 1.2 paths
> are present on disk". That wording was narrower than git's actual behaviour,
> and the narrowness was only discovered by walking a real checkout rather than
> asserting on argv. The superseded text is preserved in
> `openspec/changes/archive/2026-09-15-phase-1-real-data/specs/repo-fetch/spec.md`.

#### Scenario: No undeclared subtree is present

- GIVEN a repo cloned by fetch
- WHEN the checkout completes
- THEN every path on disk is either a top-level file or lies inside a declared path
- AND no undeclared subtree exists on disk

### Requirement: A repository contributing no facts is still reported

The system MUST report a resolved SHA in `resolvedRefs` for a repository that
resolves successfully but yields no parsed facts, and MUST NOT place it in
`skipped[]` (SPEC 1.6).

`skipped[]` means "could not be resolved". A repository that resolved and simply
carries nothing the declared path set matches is a different outcome and must
remain distinguishable from a failure.

#### Scenario: Resolved but factless repository

- GIVEN `wazuh-indexer-security-analytics`, which has a `5.0.0` branch but none
  of the declared `indexer` paths
- WHEN fetch and parse complete
- THEN its SHA appears in `resolvedRefs`
- AND it does not appear in `skipped[]`
- AND it contributes no entry to any plugin section

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

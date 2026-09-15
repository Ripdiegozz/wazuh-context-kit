# Repo-Fetch Specification — delta for `platform-core-plugins`

## Purpose

Extends the archived `repo-fetch` capability so a `platform` repository
contributes real content, and corrects one requirement whose literal wording is
narrower than observed git behaviour.

## Requirements

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
and no other subtree. This supersedes the archived wording "only the SPEC 1.2
paths are present on disk", which read more narrowly than git behaves.

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

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

### Requirement: Sparse checkout limited to SPEC 1.2 paths

The system MUST restrict the sparse-checkout of each cloned repo to the
manifest, `package.json`, and indexer/WCS paths named in SPEC 1.2, and MUST
NOT check out full plugin source trees.

#### Scenario: Checked-out tree is sparse

- GIVEN a repo cloned by fetch
- WHEN the checkout completes
- THEN only the SPEC 1.2 paths are present on disk for that repo

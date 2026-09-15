# Proposal — `crosscheck-live-indexer`

## Why

Phase 1 has exactly one unticked acceptance criterion left (SPEC 1.10):

> The crosscheck compares two repositories against each other, not against the
> running system.

That gap is not theoretical. The previous cycle shipped six defects through a
fully green test suite; four of them were caught only when a real indexer was
consulted, and two by human review. Zero were caught by tests. The lesson is
recorded and it is the whole reason this change exists: **a fixture that encodes
the same assumption as the code proves the assumption, not the behaviour.**

The repository is not the territory. Measured against the running stack today:
the repositories declare 40 index patterns; the cluster has 53 index templates
installed and 52 concrete indices. `wazuh-cve*` is declared and not installed.
`wazuh-ai-assistant-sessions` holds data that no dashboard code references. No
amount of cross-repository comparison surfaces either fact.

## What changes

`wazuh-ctx crosscheck` gains an **optional** `--indexer <url>` mode. When given,
the tool additionally queries a running indexer read-only and reports where the
repositories and the cluster disagree.

Three read-only endpoints, nothing else: `_cat/indices`, `_data_stream`,
`_index_template`. The tool never writes to the cluster.

### Decided: credentials never touch `sources.yml`

`sources.yml` is committed. Credentials are read from the environment:

- `WAZUH_CTX_INDEXER_USERNAME`
- `WAZUH_CTX_INDEXER_PASSWORD`

The `_USERNAME` spelling follows the `<PRODUCT>_URL` / `<PRODUCT>_USERNAME` /
`<PRODUCT>_PASSWORD` shape used by both the OpenSearch config helper and
Elastic's Python client (research claims 1.2, 1.3). The `WAZUH_CTX_` prefix is
deliberately ours: `WAZUH_INDEXER_*` would collide with the real Wazuh stack's
own environment on exactly the machines where this runs.

The URL stays an explicit `--indexer <url>` argument rather than an env var, so
a run never silently acquires a target from ambient environment.

### Decided: TLS verification is on, and disabling it is loud

The dev stack's certificate is self-signed and genuinely does not validate
(`curl` exits 60; Bun's `fetch` throws `UNABLE_TO_VERIFY_LEAF_SIGNATURE`).

Verification stays **on by default**. `--indexer-skip-tls-verify` disables it
per invocation. The name is self-describing rather than a terse `--insecure`,
following `escli` and Curator (research claim 1.5) and mirroring `kubectl`'s
well-known `--insecure-skip-tls-verify`.

Two properties that matter more than the name:

1. The override is scoped to the request via Bun's per-request
   `tls: { rejectUnauthorized: false }`. It does **not** set
   `NODE_TLS_REJECT_UNAUTHORIZED=0`, which is process-global and would silently
   weaken every other TLS call.
2. Without the flag, the failure is loud and names the flag. The `code` is
   distinguishable, so the message can say what happened rather than surfacing a
   generic network error.

Authentication failure is `401` for both missing and wrong credentials. The
error message must not claim to know which.

### Decided: the live comparison is printed, never committed

This is the question the maintainer deferred to standard practice, so the answer
is grounded in what the research actually found — including what it did not.

There is **no single settled convention**. What the research established:

- `clig.dev`'s stdout/stderr split is the strongest directly-applicable
  authority, and it supports printing the comparison rather than persisting it.
- Twelve-factor's "the app does not persist its own stream" reinforces the same
  choice and argues against inventing a second output file.
- A gitignored side file is defensible by inference from the reproducibility
  literature, but was **not observed as a named pattern in any tool**.
- Every source agrees on one negative: machine-specific data must never enter
  `out/<ref>/matrix.json` or `out/<ref>/crosscheck.json`.

So: the live comparison goes to **stdout**, with `--format json` for machines.
The tool writes no new file. A developer who wants a saved copy redirects the
stream — that is their choice, not ours.

The load-bearing consequence, and it is testable: running `crosscheck` with
`--indexer` produces `out/<ref>/` **byte-identical** to running it without.
Determinism is not a claim in a document; it is an assertion in a test.

### Decided: disagreement is not failure

`terraform plan -detailed-exitcode` is real precedent for "disagreement is
information," but it carries documented scars — teams have been burned wiring
its exit code 2 into automatic gates (research claim 2.3).

Drift therefore exits **0**. Non-zero is reserved for the tool actually failing:
unreachable indexer, authentication rejected, TLS refused. Copying Terraform
uncritically would hand CI a tripwire nobody asked for.

## What this does not change

- The default `crosscheck` path is untouched and stays offline and
  deterministic.
- CI has no stack. `--indexer` is never used there, and the freshness guard
  never sees runtime data.
- Nothing is written to the cluster.

## Risks

- **The comparison is only as honest as the name resolution.** 22 of 52
  concrete indices are `.ds-<stream>-NNNNNN` data-stream backing indices.
  Treating `_cat/indices` as the installed set would invent 22 phantom names and
  lose the 22 stream names the repositories actually declare. `_data_stream`
  supplies that mapping as declared data, not as a regex guess.
- **Tests cannot prove this one.** That is the defect class this change exists
  to answer. Verification must include a run against the real stack, recorded
  with real numbers, and the acceptance criteria must say so.

# MCP Server Specification

## Purpose

SPEC Phase 3: `wazuh-ctx mcp`, three resources in one binary — `docs` on demand,
`schema` offline from the published dataset, `runtime` optional and degrading.
Closes the eleven open criteria of §3.6, plus one added by this change.

The thread running through every requirement below is the same: **a confident
answer from a stale source is worse than no answer.** Each resource has to be
able to say what it is answering *as of*, and refuse when it cannot.

## ADDED Requirements

### Requirement: The version mapping is explicit configuration, never derived

The system MUST read the code-ref → documentation-path mapping from
`sources.yml`, and MUST NOT compute it from repository tags, releases, branches,
or from `llms.txt` itself.

This was tested, not assumed. Deriving it from `wazuh-dashboard-plugins` release
tags fails on measured evidence: the six 5.0 prerelease tags
(`v5.0.0-alpha0`, `v5.0.0-beta1`…`beta5`) collapse into the single published path
`/5.0-beta/`, which drops the `v`, the patch component and the prerelease number;
`/current/` is a byte-identical alias for `/4.14/` that no tag encodes; `/3.13/`
and `/4.2/` serve while unlisted; and `/5.0/` 404s although branch `5.0.0` exists
and is actively built.

Tags describe the code. The documentation site publishes on its own cadence with
its own naming. The join is a human convention, and the system MUST NOT pretend
otherwise.

The mapping MUST carry an owner and a last-reviewed date in the file itself.

#### Scenario: A mapped version resolves

- GIVEN `sources.yml` maps a code ref to a documentation path
- WHEN `docs` is asked for a page at that ref
- THEN the request is built against the mapped path

#### Scenario: An unmapped version fails clearly

- GIVEN a code ref with no entry in the mapping
- WHEN `docs` is asked for a page at that ref
- THEN the failure names the ref and says the mapping is missing
- AND the message is distinct from a fetch miss on a mapped path

### Requirement: The version mapping is validated against reality, not trusted

The system MUST provide a check that compares every mapping entry against two
independent sources: that the mapped documentation path answers with
`content-type: text/markdown`, and that the release state of
`wazuh-dashboard-plugins` still matches what the entry assumes. A disagreement
MUST fail loudly, naming the entry and its `lastReviewed` date.

This exists because the hand-maintained file goes stale silently. Measured on
2026-09-17: `sources.yml` mapped `"5.0.0": "5.0"`, every URL under `/5.0/`
returned 404, and `lastReviewed` was three days old. Nothing detected it, because
no code read the block at all.

The check is an alarm, not an inference. It never rewrites the mapping.

#### Scenario: A dead mapped path is caught

- GIVEN a mapping entry whose documentation path returns 404
- WHEN the check runs
- THEN it fails naming the entry, the path, and the entry's `lastReviewed`

#### Scenario: A changed release state is caught

- GIVEN an entry mapped to a prerelease documentation path
- AND a GA release tag has since appeared for that ref
- WHEN the check runs
- THEN it reports that the entry's assumption no longer holds
- AND it does not change the mapping

### Requirement: `docs` returns Markdown and cites the canonical HTML

The system MUST obtain documentation by replacing `.html` with `.md` on the
canonical path, and MUST cite the `.html` URL in what it returns.

The system MUST NOT default to `/current/` when a ref is pinned. `/current/` is
an alias for the latest stable line — measured byte-identical to `/4.14/` — so
defaulting to it would answer a 5.0 question with 4.14 documentation and give no
signal that the version drifted.

#### Scenario: A page is retrieved and cited

- GIVEN a mapped ref and an existing documentation page
- WHEN `docs` retrieves it
- THEN the content returned is Markdown
- AND the citation is the `.html` URL at the same path

### Requirement: A broken 1-to-1 guarantee fails loudly, and `docs` reports unavailable

The system MUST carry a canary test asserting the published availability
guarantee, and when the guarantee does not hold the system MUST report `docs`
unavailable rather than return silence or raw HTML.

The canary MUST assert status `200` **and** `content-type: text/markdown` **and**
that the body does not begin with `<!DOCTYPE`. A status check alone is
insufficient: the failure mode named in §3.1 is the site serving the HTML page
under the `.md` path with a 200, which only a content assertion catches.

Measured: a real hit is `200` + `text/markdown`; a miss is `404` + `text/html`.
There is no soft-404, so both signals agree and either failing is real evidence.

The canary reaches the real network and MUST therefore use the established gate,
`process.env.WAZUH_CTX_NETWORK === "1"`, so it never runs in a default
`bun test`.

#### Scenario: The guarantee holds

- GIVEN network tests are enabled
- WHEN the canary fetches a known page's `.md` twin
- THEN status is 200, content-type is `text/markdown`, and the body is not HTML

#### Scenario: The guarantee breaks

- GIVEN a `.md` path that returns HTML or a non-200
- WHEN `docs` requests it
- THEN `docs` reports unavailable naming the path and what it received
- AND it does not return the HTML body as if it were documentation

### Requirement: `schema` serves the published dataset without network

The system MUST answer `schema` queries from `out/<ref>/` alone — `matrix.json`,
WCS fields and index templates — with no cluster and no network access.

#### Scenario: Offline answer

- GIVEN a committed dataset at `out/<ref>/`
- AND no network available
- WHEN `schema` is queried
- THEN it answers from the dataset

### Requirement: `schema` refuses to start on a dataset whose hash does not validate

The system MUST recompute `payloadHash` at startup and MUST NOT serve when the
recomputed value differs from the stored one.

`verifyPayloadHash` already implements the comparison; this requirement is about
having a caller that refuses, not about the algorithm.

#### Scenario: A tampered dataset is rejected

- GIVEN a `matrix.json` with one byte altered
- WHEN the server starts
- THEN it refuses to start, naming the expected and actual hashes
- AND it serves nothing

### Requirement: Every `schema` response carries its provenance

The system MUST include `ref`, `payloadHash` and `resolvedAt` in every `schema`
response.

A pinned dataset answers with total confidence to someone standing somewhere
else, and nothing in the answer gives it away. That is worse than not answering,
so the answer MUST carry what it is an answer *as of*.

#### Scenario: Provenance accompanies the answer

- GIVEN a served dataset
- WHEN any `schema` query is answered
- THEN the response includes `ref`, `payloadHash` and `resolvedAt`

### Requirement: A ref mismatch is refused by default and overridable explicitly

The system MUST compare the dataset's `ref` against the consumer working tree's
branch at startup, MUST refuse by default when they differ with a message naming
both refs, and MUST serve when `--allow-ref-mismatch` is passed explicitly.

#### Scenario: Mismatch refuses

- GIVEN a dataset at ref A and a working tree on branch B
- WHEN the server starts without `--allow-ref-mismatch`
- THEN it refuses, naming both A and B

#### Scenario: Mismatch is overridable

- GIVEN the same mismatch
- WHEN the server starts with `--allow-ref-mismatch`
- THEN it serves

#### Scenario: No branch to compare

- GIVEN a working tree with no branch — detached HEAD
- WHEN the server starts
- THEN the message says the branch could not be determined
- AND it is distinct from the message for a mismatch between two known refs

### Requirement: A cell overridden by `decisions.local.yml` is marked `overlay: "local"`

The system MUST mark every cell whose value came from `decisions.local.yml`, and
MUST apply the mark in the domain layer so that every consumer of the matrix
carries it — not only the `schema` response.

`decisions.local.yml` is the gitignored escape hatch. `loadHumanLayers` already
computes `localOverrides` as a `Set` keyed `"<plugin>::<field>"` and its own
comment states the rule — *"every cell it touches must be served marked, never
silently"* — but the set is unused downstream, so the rule is declared and not
enforced. Today `runMatrix` merges the local layer into the matrix it writes to
`out/<ref>/matrix.json`, which means a local override can reach a committed
artifact leaving no trace.

Marking in the domain layer costs nothing measurable: `canonicalize` drops
`undefined` keys, so an absent marker leaves `payloadHash` byte-identical and the
committed dataset needs no regeneration.

#### Scenario: A local override arrives marked

- GIVEN a `decisions.local.yml` overriding a field
- WHEN that cell is served or written
- THEN it carries `overlay: "local"`

#### Scenario: No local file leaves the hash unchanged

- GIVEN no `decisions.local.yml`
- WHEN the matrix is built
- THEN no cell carries an `overlay` key
- AND `payloadHash` is identical to the value produced before this change

### Requirement: A dataset older than 30 days warns on every response

The system MUST emit a staleness warning with each response when `resolvedAt` is
more than 30 days old.

#### Scenario: An old dataset warns

- GIVEN a dataset whose `resolvedAt` is 40 days old
- WHEN any query is answered
- THEN the response carries a staleness warning naming the age

### Requirement: The server announces the world before the first query

The system MUST resolve the consumer working tree's repository from `cwd` at
startup, determine its world from the dataset, and emit that context before
answering anything.

It adapts what is shown, never what is true.

#### Scenario: A fork announces itself

- GIVEN `cwd` inside an upstream-fork repository
- WHEN the server starts
- THEN it announces the repository and its world before the first query is
  answered

#### Scenario: An unrecognised working tree

- GIVEN `cwd` in a repository absent from `sources.yml`
- WHEN the server starts
- THEN it says the world is unknown rather than guessing one

### Requirement: `runtime` absent never blocks `docs` or `schema`

The system MUST report `runtime` unavailable when no instance is configured or
reachable, and the other two resources MUST continue to serve.

There is no protocol-level way to mark a single resource unavailable, so
`runtime` is simply not registered when its backend is absent.

#### Scenario: No instance configured

- GIVEN no runtime instance configured
- WHEN the server starts
- THEN `runtime` is reported unavailable
- AND `docs` and `schema` answer normally

#### Scenario: Instance unreachable at startup

- GIVEN a configured instance that does not respond
- WHEN the server starts
- THEN startup succeeds
- AND `docs` and `schema` answer normally

### Requirement: Telemetry is local, contentless, and opt-out

The system MUST record only `(plugin, field, resolved)` per query, MUST NOT
record query content, MUST NOT transmit anything off the machine without explicit
action, and MUST disable recording entirely under `--no-telemetry`.

#### Scenario: A query is recorded without its content

- GIVEN telemetry enabled
- WHEN a query resolves or fails to resolve
- THEN a `(plugin, field, resolved)` record is written locally
- AND no query text is written

#### Scenario: Opt-out writes nothing

- GIVEN `--no-telemetry`
- WHEN queries are answered
- THEN no telemetry record is written

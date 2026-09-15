# Design — `crosscheck-live-indexer`

## The constraint that shapes everything

SPEC 6.1 draws a purity seam: `src/matrix/` and `src/decisions/apply.ts` contain
no fs, no network, no clock. `src/crosscheck/build.ts` already sits on the pure
side, and the existing crosscheck is a clean example of the shape — `src/cli.ts`
does the impure work and hands plain values to a pure builder.

Adding a network call must not smear that seam. The design therefore splits into
three pieces along the axis of what touches the world.

```
src/indexer/client.ts      IMPURE  — HTTP, TLS, credentials. The only new
                                     module that touches the network.
src/crosscheck/live.ts     PURE    — takes a plain RawClusterState value,
                                     returns a LiveComparison. No I/O.
src/crosscheck/render-live.ts PURE — LiveComparison -> text, and -> JSON.
src/cli.ts                 WIRING  — flags, env, error taxonomy, exit codes.
```

The pure middle is the point. Data-stream resolution, name matching, and the
three-way comparison are all decisions about values, and every one of them is
testable with a literal — no cluster, no mock server, no fixture directory.

## Decision 1 — the client returns raw shapes, not conclusions

`fetchClusterState()` performs three GETs and returns exactly what the cluster
said, normalised only in structure:

```ts
interface RawClusterState {
  readonly indices: { readonly name: string }[];          // _cat/indices
  readonly dataStreams: {                                  // _data_stream
    readonly name: string;
    readonly template: string;
    readonly backingIndices: string[];
  }[];
  readonly indexTemplates: {                               // _index_template
    readonly name: string;
    readonly indexPatterns: string[];
  }[];
}
```

**Why raw**: the moment the client starts deciding what a name means, that
decision becomes untestable without a cluster. Keeping it dumb pushes every
judgement into `live.ts`, where a test can state the input as a literal.

The client takes its transport by injection — the same discipline
`src/fetch/clone.ts` already uses for its command runner, and the reason the
cache-hit-is-offline test can assert "zero network invocations" at all.

## Decision 2 — resolution happens in the pure layer, from declared data

`_cat/indices` reports 52 concrete names on the reference stack. 22 are
`.ds-<stream>-NNNNNN` backing indices. The installed set is **not** that list.

`live.ts` builds the installed set as:

1. every data stream name from `_data_stream`, plus
2. every concrete index from `_cat/indices` that is **not** claimed as a backing
   index by any data stream.

Note what step 2 is not: it is not `!name.startsWith(".ds-")`. Ownership comes
from the cluster's own `backingIndices` report. A backing index with an
unconventional name still resolves correctly, and a plain index that happens to
start with `.ds-` is not silently swallowed. The prefix is a convention; the
report is data.

The seven `wazuh-threatintel-*-a` indices keep their `-a` suffix. It is an alias
generation, and `covers()` — which already handles exact-vs-glob in both
directions — matches `wazuh-threatintel-decoders-a` against the declared
`wazuh-threatintel-decoders*` without special-casing.

## Decision 3 — reuse `covers()`, do not write a second matcher

`build.ts` already owns glob semantics, and getting them right took a review
cycle: a first fix overshot and broke glob-vs-glob. Two matchers would drift,
and the drift would be invisible because each would have its own tests.

`live.ts` imports `covers()`. If the semantics are wrong, they are wrong in one
place and one test suite proves it.

## Decision 4 — the comparison is three populations, mirroring the offline one

```ts
interface LiveComparison {
  readonly declaredNotInstalled: { pattern: string; template: string }[];
  readonly installedNotDeclared: { name: string; kind: "index" | "dataStream" }[];
  readonly templatesOnlyInCluster: { name: string; indexPatterns: string[] }[];
}
```

The shape deliberately echoes `declaredUnreferenced` / `referencedUndeclared`.
A reader who understands the offline report understands this one, and the two
answer genuinely different questions: the offline one asks "does anyone use
this?", the live one asks "does this exist?".

Known findings this must reproduce, both already confirmed against the stack:
`wazuh-cve*` is declared and not installed; `wazuh-ai-assistant-sessions` is
installed and referenced by no dashboard code. If a run does not surface both,
the implementation is wrong regardless of what the tests say.

## Decision 5 — credentials and TLS

Credentials are read once in `src/cli.ts`, never inside the client's call sites,
and never logged. The client receives them as parameters, so a test constructs
one without touching `process.env`.

TLS override is per-request:

```ts
fetch(url, { headers, tls: { rejectUnauthorized: false } })
```

Probed and confirmed on Bun: default throws `TypeError` with
`code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE"`; with the override, HTTP 200. The
process-global `NODE_TLS_REJECT_UNAUTHORIZED=0` is never set — it would weaken
every other TLS call in the process to solve a one-request problem.

## Decision 6 — an explicit error taxonomy, because exit codes are the contract

| Condition | Detected by | Exit | Message names |
| --- | --- | --- | --- |
| Certificate rejected | `code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE"` and its siblings | 2 | `--indexer-skip-tls-verify` |
| `401` | HTTP status | 2 | both env vars; does **not** guess missing vs wrong |
| Unreachable / timeout | `ECONNREFUSED`, `ENOTFOUND`, abort | 2 | the URL as given |
| Any disagreement | — | **0** | the three populations |

Drift exiting `0` is deliberate, not an oversight. `terraform plan
-detailed-exitcode` is the precedent for encoding drift in an exit code, and the
research found documented cases of teams wiring its `2` into gates and getting
burned. A diagnostic that fails CI by doing its job is a tripwire.

A timeout is required. A hung TCP connect against an unreachable host would
otherwise stall the command indefinitely, and "the tool hangs" is the one
failure mode with no message at all.

## Decision 7 — output is a stream, and `out/` is proven untouched

The live comparison prints to stdout after the existing summary. `--format json`
emits the `LiveComparison` alone, so it can be piped.

The determinism guarantee is enforced by construction: the `--indexer` path runs
strictly **after** `writeFile` for both artifacts, and shares no state with the
values that produced them. Nothing in the live path can reach the payload hash,
because by the time it runs the payload is already on disk.

That construction is the argument; the test is the proof. `cli.test.ts` gets a
case that runs both ways and asserts byte-identical files.

## What could still go wrong, and how it gets caught

The previous cycle shipped six defects through a green suite. Four fell out of
consulting the real indexer. So the risk here is not "the tests fail" — it is
"the tests pass and the answer is wrong", exactly as before.

Two guards:

1. `live.ts` is pure, so its tests state inputs as literals rather than as a
   fixture file that was itself written from the same misunderstanding as the
   code. The `.ndjson` scanner defect survived because impl and fixture agreed
   with each other.
2. Verification requires a recorded run against the real stack with observed
   numbers, and must confirm the two known findings by name. A green suite alone
   does not close this change.

---

## Decision 8 — `_cat/indices` must ask for hidden indices, and `_data_stream` must not

Added after measuring the real cluster, before any code existed. Both halves
were wrong in the first draft of this design.

`_cat/indices` **excludes hidden indices by default**: 52 visible, 103 actual.
Every hidden index the repositories declare — `.wazuh-settings`,
`.wazuh-setup-status`, `.wazuh-internal-state`, `.opendistro-ism-config`,
`.wazuh-threatintel-vulnerabilities` — was invisible. Comparing against the
default listing reported six patterns as "declared but not installed" when all
six were installed and running.

That is a false accusation about production state, produced by a tool whose
entire purpose is to be trusted about production state. It is also precisely the
defect class of the previous cycle: plausible output, confidently wrong, and a
green test suite would not have noticed because a fixture would have been
written from the same wrong assumption.

`_cat/indices` therefore requests `expand_wildcards=all`.

`_data_stream` **rejects** `expand_wildcards` — the request errors. It also does
not need it: it already reports `wazuh-ai-assistant-sessions`, whose backing
index is hidden. The parameter is added to one endpoint and only one.

## Decision 9 — undeclared installed names are partitioned, not filtered

With hidden indices included, `installedNotDeclared` grows to 50, and 46 of them
are platform internals: `.opensearch-sap-*` (security-analytics detector and
alert indices, several carrying UUIDs), `.opendistro-*`, `.kibana_1`. They are
managed by plugins at runtime and are not supposed to appear in a Wazuh
template. Reporting them as findings would bury the signal under noise.

Dropping them silently is the worse error. A tool that decides on your behalf
which unexpected things are not worth mentioning is a tool that will eventually
hide the one that mattered.

So the population is **partitioned and both halves are reported**:

- names in the Wazuh namespace (`wazuh-*` or `.wazuh-*`), reported in full;
- everything else, reported under a separate heading as platform-managed, with
  its count, so the reader can see what was set aside and why.

Measured today, that yields four Wazuh-namespace findings rather than fifty:
`.wazuh-content-manager-jobs`, `.wazuh-content-manager-resource-locks`,
`.wazuh-cti-consumers`, and `wazuh-threatintel-filters-a`.

## Decision 10 — the first real finding, and why it validates the partition

`wazuh-threatintel-filters` is declared **without** a trailing `*`, in both
`templates/content/filters.json` and `wcs/content/filters/`. Every sibling —
decoders, enrichments, integrations, kvdbs, policies, rules — declares a glob.
The installed index is `wazuh-threatintel-filters-a`, following the same alias
generation as its siblings.

The exact-vs-glob mismatch means the declaration matches nothing, so the same
thing appears on **both** sides at once: `wazuh-threatintel-filters` as declared
and not installed, `wazuh-threatintel-filters-a` as installed and not declared.

This is a genuine inconsistency in the indexer repository, found by comparing
against the running system and findable no other way. It is the case for this
change, stated concretely. It is also a useful shape for the report to surface
explicitly, because a reader scanning two long lists will not spot that the two
entries are the same subject.

# Comparing against a running indexer

`wazuh-ctx crosscheck` normally compares repositories against each other. With
`--indexer <url>` it additionally compares what the repositories **declare**
against what a cluster **actually has**.

The repository is not the territory. At `5.0.0` the repositories declare 42
index patterns; the reference stack has 103 indices and data streams. Some
declared patterns are installed nowhere. Some installed indices are declared by
nobody. Neither fact is reachable by reading repositories.

## Running it

```sh
export WAZUH_CTX_INDEXER_USERNAME=admin
export WAZUH_CTX_INDEXER_PASSWORD=admin

wazuh-ctx crosscheck --ref 5.0.0 \
  --indexer https://localhost:9200 \
  --indexer-skip-tls-verify
```

Add `--format json` to get the comparison as a machine-readable stream.

## Credentials

Credentials are read from the environment and from nowhere else:

| Variable | |
| --- | --- |
| `WAZUH_CTX_INDEXER_USERNAME` | |
| `WAZUH_CTX_INDEXER_PASSWORD` | |

They are **not** fields in `sources.yml`, and the schema rejects them there.
`sources.yml` is committed; a credential field in it is a credential in git.

The URL stays an explicit argument rather than an environment variable, so a run
never silently acquires a target from ambient environment.

A rejected credential produces a `401`, which does not distinguish "missing"
from "wrong". The error message says so rather than guessing.

## TLS

Certificate verification is **on by default**. The dev stack's certificate is
self-signed and does not validate, so a run against it fails until you say
otherwise:

```
wazuh-ctx crosscheck: certificate verification failed for https://localhost:9200.
Pass --indexer-skip-tls-verify to accept it for this run.
```

`--indexer-skip-tls-verify` accepts it, for that invocation only. The override is
scoped to the request. It does **not** set `NODE_TLS_REJECT_UNAUTHORIZED`, which
is process-global and would weaken every other TLS call to solve a one-request
problem.

## Exit codes

| Condition | Exit |
| --- | --- |
| The repositories and the cluster disagree | **0** |
| Indexer unreachable | 2 |
| Credentials rejected | 2 |
| Certificate verification failed, no flag given | 2 |

**Disagreement exits `0`, deliberately.** `terraform plan -detailed-exitcode` is
the precedent for encoding drift in an exit code, and teams have been burned
wiring its exit `2` into automatic gates. Drift here is the expected output of a
diagnostic, not an error. A tool that fails your pipeline by doing its job
becomes a tripwire nobody asked for, and then it becomes a tool nobody runs.

If you want a gate, read the JSON and decide for yourself which populations
matter to you. That decision is yours, not the tool's.

## What it does not do

**It never writes to the cluster.** Three read endpoints, and that is all:
`_cat/indices`, `_data_stream`, `_index_template`.

**It never writes runtime data into the committed artifacts.** `out/<ref>/` is
byte-identical whether or not `--indexer` was given — verified against a real
cluster, not only in a test. The comparison goes to stdout. If you want a saved
copy, redirect the stream; the tool does not decide that for you.

**It never runs in CI.** CI has no stack. The committed artifacts must stay
reproducible from repositories alone, and a machine-specific comparison inside
them would make that claim false and fail the freshness guard.

## Two things worth knowing about the queries

`_cat/indices` is asked for `expand_wildcards=all`. Without it, hidden indices
are excluded — 52 of 103 on the reference stack — and six patterns that are
installed and running (`.wazuh-settings`, `.wazuh-setup-status`,
`.wazuh-internal-state` among them) get reported as missing. A tool whose job is
to be trusted about production state must not accuse production of absences
caused by a defaulted query parameter.

`_data_stream` **rejects** that parameter and does not need it. It is sent to one
endpoint and one only.

Backing indices named `.ds-<stream>-NNNNNN` are resolved to their data stream
using the cluster's own report of which stream owns which backing index — not by
matching the `.ds-` prefix. 22 of 52 visible indices are backing indices;
comparing them directly would invent 22 names nobody declares and lose the 22
stream names that are declared.

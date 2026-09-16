# Exploration — `crosscheck-live-indexer`

> Phase: `sdd-explore` · 2026-09-15 · run inline

## The one thing left in Phase 1

Every section of FASE 1 is built and 32 of 33 acceptance criteria are ticked
against observed commands. One is not, and it was written deliberately unticked
by the change that closed the rest:

> El cruce compara dos repositorios, no el sistema corriendo. Un índice puede
> estar declarado, tener datos y ser consultado, y aun así aparecer sin
> consumidor si el código lo nombra de un modo que el scanner no reconoce.

That is not a hypothetical. It happened six times in the previous change, and
the maintainer caught it by knowing the product rather than by reading the
report.

## Finding 1 — the repository is not the territory, measured

Queried against the dashboard team's dev stack:

| | repository | running indexer |
|---|---|---|
| index patterns declared | 40 | 53 |
| in runtime and not in the repo | — | 18 |
| in the repo and not in runtime | 5 | — |

The 18 are the `wazuh-events-v5-*` and `wazuh-findings-v5-*` per-category
templates, expanded at startup from the two generic patterns the repository
declares, plus `wazuh-threatintel-filters*` and an OpenSearch SAP pattern.

The 5 include **`wazuh-cve*`, declared in the repository and not installed at
all**.

So a repo-versus-repo crosscheck can be perfectly implemented and still be
wrong about the world. It compares two maps; neither is the ground.

## Finding 2 — the oracle is standard equipment, not a lucky accident

`os-dev-360` is the **dashboard team's development environment**, not a one-off
the maintainer happened to have running. Every developer on that team has:

```
indexer   https://localhost:9200   (admin:admin, self-signed)
manager   http://localhost:55000
OSD       http://localhost:5601
```

The three endpoints that settle the question are read-only:
`_cat/indices`, `_data_stream`, `_index_template`.

That changes what the design may assume. This is not "validate by hand when you
happen to have a stack up"; it is a source the tool can ask for.

## Finding 3 — runtime data is not deterministic, and `out/` must stay so

A crosscheck enriched with runtime facts answers a different question than the
committed dataset does, and it answers it **about one machine at one moment**.
Indices come and go; a developer with sample data loaded sees indices a
colleague does not.

`out/` is the product (SPEC 5.1). It is regenerated in CI, where no stack
exists, and the freshness guard asserts it matches a real run. Writing
machine-dependent facts into it would make that guard fail for everyone except
the machine that last generated it.

**So the runtime comparison must not enter the committed artifact.** Where it
goes instead is the first real design question.

## Finding 4 — concrete names and declared patterns are different shapes

Running indices carry suffixes the templates do not:

```
wazuh-threatintel-decoders-a      <- concrete index
wazuh-threatintel-decoders*       <- declared pattern
.ds-wazuh-findings-v5-security-000001  <- data stream backing index
wazuh-findings-v5-security             <- the data stream
```

Comparing them needs the same glob-aware matching the crosscheck already has,
plus data-stream awareness: a `.ds-<name>-NNNNNN` backing index means the stream
`<name>` exists, and the stream is what a dashboard queries.

## Finding 5 — credentials and TLS are the uncomfortable part

The stack uses HTTPS with a self-signed certificate and basic auth. A tool that
hardcodes `admin:admin`, or silently disables certificate verification, is a
tool that teaches a bad habit and may be pointed at something that is not a dev
stack.

Both have to be explicit and both have to fail loudly when missing. Neither
belongs in `sources.yml`, which is committed.

## Open questions for `sdd-propose`

1. **Where does the runtime comparison go?** Not into `out/<ref>/crosscheck.json`
   — see finding 3. A separate uncommitted file, stdout, or a gitignored path.
2. **How are credentials supplied?** Environment variables are the only option
   that does not put a secret in a committed file, but the flag shape and the
   failure message matter.
3. **What does it do about TLS?** A self-signed certificate is normal for this
   stack and must be opt-in per invocation, never a default and never silent.
4. **What does it add to the report?** A third state per index — declared /
   referenced / exists — or a separate section listing only the disagreements.
5. **Does `--indexer` change any exit code?** A disagreement between repository
   and runtime is information, not necessarily a failure.

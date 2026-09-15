# Exploration — `close-phase-1`

> Phase: `sdd-explore` · 2026-09-15 · run inline (this runtime refuses SDD child dispatch)

## Why this change exists

`HANDOFF.md` says "Phase 1 is complete and closed". That is wrong, and the
error is mine. **SPEC 1.8 — the crosscheck — sits inside FASE 1**, between 1.7
and 1.9, and was never built. `wazuh-ctx crosscheck` still returns
`notImplemented`.

SPEC 1.8 calls that report "el valor diferencial de la fase". So what shipped is
the matrix generator; the thing the phase exists for is missing.

This change closes Phase 1 for real: the crosscheck, the defect that blocks it,
and an honest pass over all 25 acceptance criteria in SPEC 1.9.

## Finding 1 — the dataset declares 20 of 36 index templates

`parseIndexerArtifacts` reads `templates/states/` only. The real tree has three
sibling directories with `index_patterns`:

```
templates/states/     20 templates    ← the only ones we parse
templates/streams/     8 templates    ← invisible
templates/content/     8 templates    ← invisible
templates/*.json       4 templates    ← invisible (at the root of templates/)
```

**The product declares 20 of 40. Half the declared surface is missing.**

The four at the root were found while implementing, after this exploration
first reported 36. They declare `wazuh-cve*`, `.opendistro-ism-config`,
`.wazuh-settings*` and `.wazuh-setup-status*` — real indices, including two
dot-prefixed system indices the scanner will also have to recognise as
references.

The acceptance criterion that was supposed to catch this encodes the bug
instead: *"Se listan ≥ 18 templates bajo `templates/states/`"*. Twenty is ≥ 18,
so the criterion passes while sixteen templates stay invisible. A criterion that
names a directory cannot notice a sibling directory.

This is the same failure shape as the `platform` gap and the cone-mode wording:
a path scoped narrowly in prose, and the narrowness only visible by listing the
real tree.

**It is a prerequisite, not an extra.** Seven dashboard constants
(`wazuh-events-v5*`, `wazuh-findings-v5*`, `wazuh-metrics-agents*`,
`wazuh-active-responses*`, `wazuh-metrics-normalization*`,
`wazuh-threatintel-enrichments*`, `wazuh-events-raw-v5*`) are declared under
`streams/` and `content/`. A crosscheck built on today's parser would report all
seven as "referenced but not declared" — seven false positives in the first
report the tool ever produces.

## Finding 2 — the sparse checkout covers one dashboard repo of six

`sparsePathsFor("dashboard")` returns `["plugins"]`. Measured against the real
cache:

| repo | files | size |
|---|---|---|
| `wazuh-dashboard-plugins` | 2,642 | 38 MB |
| `wazuh-dashboard-alerting` | 19 | 712 KB |
| `wazuh-dashboard-notifications` | 16 | 460 KB |
| `wazuh-dashboard-reporting` | 20 | 588 KB |
| `wazuh-dashboard-security-analytics` | 21 | 780 KB |
| `wazuh-security-dashboards-plugin` | 22 | 640 KB |

`wazuh-dashboard-plugins` is a **monorepo**: its code lives under
`plugins/<name>/`, so `["plugins"]` brings the whole source tree — 1,126 `.ts`,
623 `.tsx`, 451 `.js`. The other five **are each a single plugin**: their code
lives in `server/`, `public/`, `common/`, and they have no `plugins/` directory
at all. Cone mode therefore gives them root files only — around 20 files each,
not one line of code.

So the path set works by accident for one repository shape and contributes
nothing for the other. SPEC 1.8 anticipated needing to widen the checkout; it is
right, but for a different reason than it states — the monorepo's code is
already free.

## Finding 3 — four mechanisms name an index, and two are unrecoverable

This is the honest core of the design problem.

**(a) Literal constants in catalog modules — the dominant, recoverable case.**
`plugins/main/common/constants.ts` is a de facto index registry: 46 real
`*_PATTERN` literals. Consumers import the named constant rather than retyping
the string, so resolving an import back to its literal recovers most of `main`'s
surface from one file.

**(b) A second, independent catalog.**
`plugins/wazuh-ai-assistant/server/tools/state-families.ts` (417 lines) declares
itself "single source of truth" for the 18 `wazuh-states-*` indices, with a
`pattern:` per entry. **Two modules both claim authority over the same 18
names.** That is drift waiting to happen, and it is exactly what this tool
should be watching.

**(c) A regex allowlist — unrecoverable by construction.**
`plugins/wazuh-ai-assistant/server/tools/guardrails.ts:199`:

```
const INDEX_ALLOWLIST_RE =
  /^wazuh-(events-v5|findings-v5|states|threatintel-(rules|decoders|...))[A-Za-z0-9._*-]*$|.../
```

No index name is written here as a string. The name that reaches OpenSearch is a
caller-supplied parameter checked against a *shape*. A scanner will never find
these, because they do not exist as literals anywhere.

**(d) Runtime configuration — also unrecoverable.**
`plugins/main/server/controllers/wazuh-elastic.ts:87-91` builds the name from
`await context.wazuh_core.configuration.get(item.settingIndexPattern)`. The
index is whatever the deployed instance's settings store returns.

**(e) Saved-object assets — recoverable, with real parsing.** 78 `.ndjson` files
under `plugins/main` carry `"type":"index-pattern"` ids; 18 distinct
`wazuh-states-*` ids match the declared templates exactly. Needs a JSON-per-line
parse, not a grep.

**Recoverable total: roughly 50 distinct names.** Unrecoverable: open-ended by
construction, because (c) accepts by shape. Any report this tool emits must say
so, or "no consumer found" will be read as "no consumer exists".

## Finding 4 — three real discrepancies, found before any code was written

The crosscheck already produced findings during exploration:

| Referenced by dashboard | Declared by indexer |
|---|---|
| `wazuh-metrics-comms-v4*` (`constants.ts:43`) | `wazuh-metrics-comms*` — **no `-v4` anywhere** |
| `wazuh-agent-stats*` (`constants.ts:122`) | **nothing** |
| `wazuh-agent-config*` (`constants.ts:151`) | **nothing** |

None is dead code. `wazuh-agent-stats*` is imported by
`agent-stats-data-source-repository.ts` and `server/plugin.ts`;
`wazuh-agent-config*` by `agent-config-service.ts`.

A tool that finds three real cross-repository mismatches while still being
explored is worth building.

## Scope

| In | Out |
|---|---|
| Parse all `templates/*` subdirectories, not just `states/` | The Phase 1.5 inspector |
| Widen `dashboard` sparse paths to cover single-plugin repos | Phase 2, Phase 3 |
| `wazuh-ctx crosscheck` per SPEC 1.8 | Fixing the upstream `-v4` mismatch (that is Wazuh's to fix; we report it) |
| Declare explicitly what the scan cannot see | Reconciling the two competing catalogs upstream |
| Tick SPEC 1.9's 25 criteria honestly, or say why not | |

## Open questions for `sdd-propose`

1. **Does the crosscheck live in `matrix.json` or in its own output?** It is a
   different graph from `unresolvedDependencies` (index ↔ plugin, not
   plugin ↔ plugin) and it has a coverage caveat the matrix does not.
2. **How far does constant resolution go?** Literal-only is cheap and misses
   imports. Resolving one import hop recovers most of `constants.ts`. Full
   constant folding (`.map()` spreads at `constants.ts:254-292`) is a small
   interpreter, and that is a bad place for this project to go.
3. **How is "unrecoverable" represented in the output?** A count, a list of
   mechanism sites, or a per-report caveat. It must not be silent.
4. **Do the five single-plugin repos get scanned in this change, or is the
   widening deferred?** They contribute the reverse direction; the monorepo
   alone already yields findings.
5. **What does the acceptance criterion for templates become?** The current one
   names `templates/states/` and is unfalsifiable against this defect.

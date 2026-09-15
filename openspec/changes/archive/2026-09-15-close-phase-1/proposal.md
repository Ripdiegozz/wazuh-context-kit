# Proposal — `close-phase-1`

> Phase: `sdd-propose` · 2026-09-15 · run inline (this runtime refuses SDD child dispatch)
> Reads: [`exploration.md`](exploration.md), [`research.md`](research.md).
> Product decisions arrived confirmed; this proposal does not re-open them.

## Intent

`HANDOFF.md` claims Phase 1 is complete. It is not, and the claim is mine.
**SPEC 1.8 — the crosscheck — sits inside FASE 1** and was never built, while
SPEC 1.8 itself calls that report "el valor diferencial de la fase". What
shipped is the matrix generator. The reason the phase exists is missing.

Two things must land before it can exist, and one of them is a live defect.

## Scope

| In | Out |
|---|---|
| Parse every `templates/*` subdirectory, not just `states/` | The Phase 1.5 inspector |
| Widen `dashboard` sparse paths to cover single-plugin repos | Phase 2, Phase 3 |
| `wazuh-ctx crosscheck` → `out/<ref>/crosscheck.json` + `CROSSCHECK.md` | Fixing upstream's `-v4` mismatch — we report it, Wazuh owns it |
| An explicit, machine-readable statement of what the scan cannot see | Reconciling the two competing upstream catalogs |
| Walk all 25 SPEC 1.9 criteria and tick them honestly, or say why not | Any new runtime dependency on a second TypeScript |

## Approach

### 1. The template undercount is a prerequisite, not a bonus

`parseIndexerArtifacts` reads `templates/states/` only. The tree also has
`templates/streams/` (8), `templates/content/` (8), and four more JSON files at
the root of `templates/`. **The product declares 20 of 40 index templates —
half the declared surface is invisible.**

The root four surfaced while implementing, after this proposal was first written
against a count of 36. They declare `wazuh-cve*`, `.opendistro-ism-config`,
`.wazuh-settings*` and `.wazuh-setup-status*`. Two are dot-prefixed system
indices, which the reference scanner must also accept as index-shaped.

This blocks the crosscheck rather than merely accompanying it: seven dashboard
constants — `wazuh-events-v5*`, `wazuh-findings-v5*`, `wazuh-metrics-agents*`,
`wazuh-active-responses*`, `wazuh-metrics-normalization*`,
`wazuh-threatintel-enrichments*`, `wazuh-events-raw-v5*` — are declared in those
two directories. Built on today's parser, the first report the tool ever emits
would contain seven false positives.

The acceptance criterion that should have caught it encodes the bug instead:
*"Se listan ≥ 18 templates bajo `templates/states/`"*. Twenty is ≥ 18. **A
criterion that names a directory cannot notice a sibling directory**, and this
change replaces it with one that can.

### 2. The sparse path set covers one dashboard repo of six

`sparsePathsFor("dashboard")` returns `["plugins"]`. That happens to be the
whole source tree for `wazuh-dashboard-plugins`, a monorepo — 2,642 files. The
other five repositories **are each a single plugin**: their code is in `server/`,
`public/`, `common/`, and they have no `plugins/` directory, so cone mode leaves
them ~20 root files and no code at all.

So the path set works by accident for one repository shape and contributes
nothing for the other. SPEC 1.8 predicted needing to widen the checkout and was
right, for a different reason than it gives: the monorepo's source is already
free, the forks' source is entirely absent.

### 3. No type checker, and no second TypeScript

The maintainer first chose full constant folding, on the shared assumption that
the TypeScript compiler API would supply it. Research established otherwise:

- **TypeScript 7.0 GA ships no public JS-callable compiler API.** The team's own
  guidance is to keep `typescript` pinned to the classic 6.x line for anything
  needing programmatic access.
- `ts-morph` and `typescript-eslint` are named in that coverage as broken under
  `tsgo` for exactly this reason.
- Verified locally against this repo, not just read: `typescript@7.0.2` declares
  no `main` and no `types`; its `lib/` holds `getExePath.js`, a 609-byte
  `tsc.js` shim and `version.cjs`. `import ts from "typescript"` yields
  `ts.createProgram === undefined`.

The checker-backed route therefore requires a second copy of TypeScript as an
analysis-only dependency. The maintainer rejected that outright, and the
rejection is right: two versions of one package is permanent, load-bearing
confusion bought for a marginal subset of names.

**So the scanner uses no type checker.** It resolves identifiers to literals
within the catalog modules and follows import edges syntactically. The project's
shape makes that far cheaper than the general problem implies: ~46 patterns live
in one file, `plugins/main/common/constants.ts`, and a second catalog in
`wazuh-ai-assistant/server/tools/state-families.ts`. Knowing which identifier
means which string needs those two files. Knowing who consumes them needs import
edges — syntax, not types.

**What that genuinely costs us**, stated rather than buried: the entries
assembled by `.map()` spreads at `constants.ts:254-292` and by
`.replace('*','') + '-sample'` are not recovered. They join the two mechanisms
nothing could recover anyway.

### 4. Uncoverage is a first-class output, not a footnote

Two mechanisms are unrecoverable by construction:

- `guardrails.ts:199` accepts indices against `INDEX_ALLOWLIST_RE`, a **shape**.
  No name exists as a string anywhere in that file.
- `wazuh-elastic.ts:87-91` builds the name from
  `context.wazuh_core.configuration.get(...)` — whatever the deployed instance's
  settings return.

A report saying "this index has no consumer" is **false** if a consumer reaches
it through either path. So `crosscheck.json` carries the uncovered mechanisms as
data — file, line, kind — not as a sentence in a README nobody reads. Research
found this is what mature tools do: resolve what you can, allowlist what you
cannot, never approximate silently.

### 5. Its own file, not a section of the matrix

`out/<ref>/crosscheck.json` and `CROSSCHECK.md`. It is a different graph from
`unresolvedDependencies` (index ↔ plugin, not plugin ↔ plugin); it carries a
coverage caveat the matrix does not; and keeping it out means the dataset's
`payloadHash` does not move every time the scanner improves.

## What this will find on day one

Exploration already produced three, before any code existed:

| Referenced by dashboard | Declared by indexer |
|---|---|
| `wazuh-metrics-comms-v4*` (`constants.ts:43`) | `wazuh-metrics-comms*` — no `-v4` anywhere |
| `wazuh-agent-stats*` (`constants.ts:122`) | nothing |
| `wazuh-agent-config*` (`constants.ts:151`) | nothing |

All three are live imported constants, not dead code.

There is a fourth finding the tool should surface but SPEC 1.8 does not ask for:
`plugins/main/common/constants.ts` and
`wazuh-ai-assistant/server/tools/state-families.ts` **both declare themselves
authoritative over the same 18 `wazuh-states-*` names**. That is drift waiting
to happen between two files in one repository, and it is squarely the class of
problem this project exists to watch. Proposed as a reported finding, not a
blocking error.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Widening five checkouts slows the cold run and grows `.cache/` | Medium | Measure before/after and record real numbers, as the platform change did. Cold was 32s, cache 245 MB. |
| A regex-shaped literal extractor is brittle against catalog refactors | Medium | Assert the recovered count against a pinned number; a silent drop to zero must fail, not pass quietly. |
| The report is read as complete | **High** | Uncoverage is structured data, and `CROSSCHECK.md` leads with it rather than closing with it. |
| Scanning 2,600+ files on every run is slow | Low | Measure. Only the catalogs need parsing; usage detection is a bounded scan. |
| Ticking SPEC 1.9 turns into rubber-stamping | Medium | Each criterion cites a test or a command with observed output, or is explicitly left unticked. |

## Rollback

Revert the commit range. `crosscheck.json` disappears; the template count
returns to 20; the dashboard path set narrows again. `matrix.json`'s shape and
hash are untouched by this change, so nothing downstream of the dataset breaks
going back.

## An honest note on how the parser is fed

With no type checker and no new TypeScript, something still has to read the
catalog files. `Bun.Transpiler` is single-file and returns text, not an AST, so
it can supply import edges but not literal extraction. The realistic options are
a tested regex extractor over two very regular files, or one new syntax parser
dependency such as `oxc-parser` — which is a *new* package, not a second copy of
an existing one, and therefore outside what the maintainer rejected.

This proposal does not settle it. `sdd-design` picks it, with measurements, and
records why.

## Next

`sdd-spec` and `sdd-design` — independent of each other, both reading this.

# Exploration — `phase-1-real-data`

> Complete Phase 1 by implementing the two missing layers: `src/parse/` and `src/fetch/`.
>
> Phase: `sdd-explore` · Artifact store: `openspec` · Status: complete
> Persisted by the orchestrator: the `sdd-explore` agent has no write tool and
> returned this content inline.

## Current state

- `src/matrix/` (`types.ts`, `classify.ts`, `build.ts`, `hash.ts`, `render.ts`) is pure
  and complete. `buildMatrix(BuildInput): MatrixJson` is the entry point, and
  `BuildInput.facts: RawPluginFacts[]` is the exact contract `parse/` must fill.
- **Key finding.** `build.ts` passes `input.templates` and `input.wcsModules` straight
  through into `MatrixJson.indexer` with **no classification step**. `matrix/` never
  processes templates or WCS today, so their final shapes (`IndexTemplate`, `WcsModule`)
  must be produced entirely by `parse/`. This is a real scope fact, not an assumption.
- `src/decisions/load.ts` is the only existing fs-I/O precedent (reads YAML, ENOENT → `[]`)
  and has **zero dedicated tests**: `decisions.test.ts` only exercises `buildMatrix` with
  in-memory data. There is no established pattern in this repo for testing code that
  touches the filesystem or spawns subprocesses.
- `src/cli.ts` `runMatrix` refuses without `--fixtures`, and hardcodes both `resolvedRefs`
  (derived from fixture commits) and `skipped: [{ repo: "wazuh-dashboard-ml-commons", ... }]`.
  Both hardcodes must be deleted when fetch/parse land.
- `fixtures/facts.ts` hand-transcribes five `RawPluginFacts` with synthetic commit SHAs,
  never validated against a real checkout.
- `sources.yml` has no loader today. `cli.ts` ignores it entirely.

## Affected areas

| Area | Change |
|---|---|
| `src/fetch/` | new — clone (blobless+sparse), cache, `git ls-remote` precheck |
| `src/parse/` | new — manifest + package.json, index templates, WCS modules |
| `src/cli.ts` | drop both hardcodes; wire `fetch → parse → buildMatrix` |
| `src/sources.ts` | new small loader for `sources.yml` |
| `fixtures/checkout/**` | new on-disk fixture tree so `parse/` is testable without network |
| `src/matrix/*`, `src/decisions/apply.ts` | **no change** — both stay pure |

## Findings

### 1. The `fetch/` ↔ `parse/` boundary

`fetch/` exports:

```ts
FetchedRepo  { repo: string; dir: string; commit: string }
FetchOutcome { fetched: FetchedRepo[]; skipped: Skipped[] }
```

reusing `Skipped` from `matrix/types.ts`. `parse/` consumes `FetchedRepo[]` plus each
repo's `RepoKind` from `sources.yml`, and returns `RawPluginFacts[]` together with
`{ templates, wcsModules }`. `parse/` may type-import from `matrix/types.ts` — the same
pattern `matrix/types.ts` already uses when importing `Decision`/`Annotation` from
`decisions/schema.ts`.

### 2. Cache layout, and making "offline" structurally true

`.cache/<repo>@<ref>/` is the sparse git working tree itself.

Today the SPEC 1.9 criterion *"second run works offline"* passes **vacuously**: nothing
calls the network at all. To make it structurally true, on a cache hit (`.git` present, no
`--refresh`) `fetch/` must skip `ls-remote` and `fetch` entirely and read the commit via a
local `git rev-parse HEAD` — zero network-touching subprocesses invoked, rather than
"the network call happened to succeed twice".

This requires an **injectable command runner** so a unit test can assert that *no*
network-touching command ran on a cache hit. That assertion is the difference between a
real green and a fake one.

### 3. `git ls-remote` placement

One exported function in `fetch/`:

```ts
resolveRemoteRef(url, ref): Promise<{ found: true; sha: string } | { found: false }>
```

Used now for the skip/clone decision. Its shape is deliberately clean and reusable because
the (out-of-scope) regeneration workflow of SPEC 5.4 will later diff its result against
`resolvedRefs`.

### 4. `skipped[]` by discovery, not by hardcode

`resolveRemoteRef` returns `{ found: false }` → `fetch/` pushes
`{ repo, reason: "no <ref> branch" }` into `FetchOutcome.skipped` → `parse/` is never
invoked for that repo → `runMatrix` forwards `fetchOutcome.skipped`. The literal in
`cli.ts` is deleted. `wazuh-dashboard-ml-commons` then lands in `skipped[]` because it was
discovered to have no matching branch, which is what the criterion was always meant to test.

### 5. Index templates and WCS — a scope gap worth naming

Because `build.ts` has no classification step for these, `parse/` must emit the final
`IndexTemplate` / `WcsModule` shapes directly. This is trivial field extraction with no
decision rules, so it does not violate "zero interpretation" in spirit — but it is a real
scope fact that belongs in the proposal rather than being discovered mid-apply.

Minimum to satisfy *"≥ 18 templates under `templates/states/`"*: recursively list
`plugins/setup/src/main/resources/templates/states/*.json` using Node's
`fs.readdir(path, { recursive: true })` (Node ≥ 22, no new dependency); `name` is the
filename stem; `indexPatterns` comes from the JSON's `index_patterns` field when present.
WCS: enumerate `wcs/<module>/docs/fields.csv` per module for `fieldCount`, which is flat
and easy to parse per SPEC 1.2's own note.

### 6. Sparse-checkout for plugin source trees — defer

SPEC 1.8 already provides the escape valve: report the indexer → dashboard direction only
and declare the reverse uncovered. `crosscheck` is a stub and out of scope here.

**Recommendation: do not expand sparse-checkout to full plugin source trees in this change.**
Defer that cost to whichever later change implements `crosscheck` for real.

### 7. Size forecast — exceeds the delivery budget

| Area | Est. lines |
|---|---|
| `src/fetch/types.ts` | 40 |
| `src/fetch/git-runner.ts` | 60 |
| `src/fetch/clone.ts` | 120 |
| `src/fetch/ls-remote.ts` | 40 |
| `src/fetch/index.ts` | 80 |
| `src/fetch/fetch.test.ts` | 200 |
| `src/parse/types.ts` | 20 |
| `src/parse/manifest.ts` | 130 |
| `src/parse/indexer.ts` | 120 |
| `src/parse/parse.test.ts` | 220 |
| `fixtures/checkout/**` | 150 |
| `src/sources.ts` + test | 100 |
| `src/cli.ts` rewiring | 70 |
| **Total** | **~1350** |

Roughly **3.4× the fixed 400-line budget**, in direct conflict with the `single-pr`
delivery strategy. This must be resolved before `sdd-apply` starts.

## Approaches

### A. Two flat modules with injectable I/O boundaries — recommended

`src/fetch/{types,git-runner,ls-remote,clone,index}.ts` and
`src/parse/{types,manifest,indexer}.ts`; all git calls go through an injectable runner so
no real network is touched in tests; `parse/` tests read small on-disk fixture directories.

- **Pros:** keeps the SPEC 6.1 seam real and enforceable; testable without network;
  extends the `decisions/load.ts` precedent correctly.
- **Cons:** more files and tests; establishes a new test pattern from zero.
- **Effort:** medium-high, driven by TDD test volume rather than logic complexity.

### B. Single combined fetch+parse module, clone-then-read inline

- **Pros:** fewer files, smaller diff.
- **Cons:** violates the explicit module boundary of SPEC 6.1; `parse/` cannot be unit
  tested in isolation; buries `resolveRemoteRef` where the future regeneration workflow
  cannot cleanly reuse it.
- **Effort:** medium, but it pays down as debt against the single constraint the spec
  names as most important. Not recommended.

## Recommendation

**Approach A.** It is the only one that makes both the 6.1 seam and the offline-second-run
criterion structurally true rather than accidentally true.

Blocking prerequisite: resolve the `single-pr` vs ~1350-line conflict before `sdd-propose`.

## Risks

1. **Size / delivery conflict (BLOCKING).** Needs an explicit decision: `size:exception`,
   chained PRs, or a smaller change scope.
2. **Fixture-vs-reality gap.** `fixtures/facts.ts` has never been validated against a real
   checkout. Sibling real checkouts exist on this machine but are outside the approved
   scope for this session; validating against them is a recommendation, not an action taken.
3. **No existing test pattern** for fs/subprocess code in this repo. `fetch/` and `parse/`
   establish it from scratch, which is part of the size estimate.
4. **Malformed manifest / package.json parse failure** handling is not covered by SPEC.
   Needs an explicit decision in propose/design — most likely robust-empty → `unknown`,
   never a crash, consistent with the `wazuh-dashboard-ml-commons` criterion.
5. **Templates/WCS scope gap** (finding 5) must be stated in the proposal so it is not
   discovered as scope creep during apply.

## Ready for proposal

Yes — conditional on the size/delivery decision in risk 1.

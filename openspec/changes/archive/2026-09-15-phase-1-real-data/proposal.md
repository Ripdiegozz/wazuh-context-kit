# Proposal: Complete Phase 1 — real data through `fetch/` and `parse/`

## Intent

`src/matrix/` is pure and done, but `wazuh-ctx matrix` runs only with `--fixtures` over five
hand-transcribed facts never validated against a real checkout. The two input adapters of SPEC 7 step 3
do not exist, so several SPEC 1.9 criteria pass vacuously.

## Scope

### In Scope

| Deliverable | SPEC |
|---|---|
| `src/fetch/` — `ls-remote` precheck, blobless+sparse clone, `.cache/<repo>@<ref>/` reuse | 1.4 |
| `src/parse/` — `RawPluginFacts[]` + final `IndexTemplate[]` / `WcsModule[]` | 1.2 |
| `src/sources.ts` — `sources.yml` loader | 1.3 |
| `src/cli.ts` — wire `fetch → parse → buildMatrix`, delete both hardcodes | 1.6 |
| `fixtures/checkout/**` — on-disk tree so `parse/` is testable offline | — |

### Out of Scope

Phase 1.5 `ui/`; Phase 2 `src/skills/`; Phase 3 `src/mcp/`; the SPEC 5.4 regeneration workflow;
expanding sparse-checkout to full plugin source trees for the reverse crosscheck direction — SPEC 1.8
sanctions reporting indexer → dashboard only and declaring the inverse uncovered.

## Capabilities

### New Capabilities
- `repo-fetch`: ref resolution, cached sparse clone, `skipped[]` by discovery.
- `source-parse`: filesystem → raw facts, templates, WCS modules.
- `matrix-pipeline`: `sources.yml` loading and CLI composition over real data.

### Modified Capabilities
- None. `openspec/specs/` is empty; this change seeds it.

## Approach

Exploration **Approach A** — two flat modules behind injectable I/O boundaries: `fetch/` routes every git
call through an injected command runner, `parse/` reads an injected root. **Approach B** (one combined
clone-then-read module) rejected: smaller diff, but it collapses the SPEC 6.1 seam, makes `parse/`
untestable in isolation, and buries `resolveRemoteRef` where SPEC 5.4 cannot reuse it.

Strict TDD: a failing `bun test` case precedes every unit of implementation.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | `src/matrix/*` and `src/decisions/apply.ts` are **not modified**. | SPEC 6.1. A design that makes them read files or the clock is wrong by construction. |
| D2 | `parse/` emits the **final** `IndexTemplate` / `WcsModule` shapes. | `build.ts` passes `templates`/`wcsModules` straight through — no classification step exists. Named here so it is not scope creep at apply. |
| D3 | On a cache hit (`.git` present, no `--refresh`), `fetch/` invokes **zero** network-touching subprocesses and reads the commit via local `git rev-parse HEAD`. | Makes SPEC 1.9's offline run structurally true. The deliverable is a test asserting *absence* of network calls, not one that passes twice. |
| D4 | Both `cli.ts` hardcodes die; `wazuh-dashboard-ml-commons` reaches `skipped[]` because `ls-remote` finds no `5.0.0` branch. | Discovery is what the criterion was always meant to test. |
| D5 | Malformed manifest → `manifest: {}`; malformed `package.json` → `packageVersion: null`, `packageJsonPath` kept at the real path. Never a crash. | SPEC 1.5.4 house style, and the only option preserving D1: `BuildInput` has no `unknowns` channel, so `parse/` cannot inject them. An empty manifest already flows through existing pure rules to `unknown` ids/world, `indexerAccess: []` and four `unknowns[]` entries with zero `matrix/` change. Keeping the real path avoids claiming a present file is absent; the resulting reason text is imprecise for the malformed case — logged as a limitation, not patched in the pure core. |
| D6 | No new production dependency. | Node ≥ 22 `fs.readdir(path, { recursive: true })` covers recursive listing; deps stay `yaml@2.9.1` + `zod@4.6.5`. |

## Affected Areas

| Area | Impact |
|---|---|
| `src/fetch/{types,git-runner,ls-remote,clone,index}.ts` | New |
| `src/parse/{types,manifest,indexer}.ts` | New |
| `src/sources.ts` | New |
| `src/cli.ts` | Modified — remove `resolvedRefs` + `skipped` literals, wire pipeline |
| `fixtures/checkout/**` | New |
| `src/matrix/*`, `src/decisions/apply.ts` | **Unchanged** (D1) |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| ~1350 lines vs 400-line budget | Certain | `size:exception` accepted 2026-09-14; `delivery_strategy: exception-ok`. Settled. |
| Real manifests differ from `fixtures/facts.ts` | Medium | New `unknowns[]` is a correct SPEC 1.5.4 outcome, not a regression. |
| No repo pattern for fs/subprocess tests | High | Injected runner + injected root establish it; cost is inside the forecast. |
| Network flakiness | Medium | Unit tests never hit the network; only an opt-in cold-cache run does. |

## Rollback Plan

Additive by construction. Revert `src/cli.ts` to the `--fixtures` path and delete `src/fetch/`,
`src/parse/`, `src/sources.ts`, `fixtures/checkout/`. `src/matrix/` and `src/decisions/` are untouched
(D1), so the 34 existing tests stay the safety net. Delete `.cache/` to reset fetch state.

## Dependencies

`git` on PATH; github.com reachable for the cold-cache path. No new production dependency (D6).

## Success Criteria

SPEC 1.9 criteria this change owns:

- [ ] `wazuh-ctx matrix --ref 5.0.0` writes `out/5.0.0/matrix.json` + `MATRIX.md` **without** `--fixtures`.
- [ ] The 4 `wazuh-dashboard-plugins` ids (`wazuh`, `wazuhCore`, `wazuhCheckUpdates`, `wazuhAiAssistant`)
      come from a real checkout.
- [ ] ≥ 18 templates listed under `templates/states/`.
- [ ] `wazuh-dashboard-ml-commons` in `skipped[]` with a reason, by discovery, no crash (D4).
- [ ] `resolvedRefs` carries one real SHA per non-skipped repo.
- [ ] Second run performs zero network-touching subprocesses, asserted in a test (D3).
- [ ] Two runs over one cache give identical `payloadHash` and byte-identical `MATRIX.md`.
- [ ] `bun test` green, `bun run typecheck` clean, `bun run build` yields a runnable `dist/cli.js`.

Classification, evidence, decisions/annotations and `--strict` criteria are already green in the pure
core; this change only **re-proves** them against real data.

# Apply Progress: Complete Phase 1 — real data through `fetch/` and `parse/`

## Status: DONE — verified and committed by the orchestrator

> The `sdd-apply` agent reported PARTIAL for the right reason: it had no shell,
> so it could not observe a single command. The orchestrator ran the
> verification afterwards. The original caveat is preserved below unaltered, as
> the record of what that session could and could not establish.

### Verification actually observed (orchestrator, 2026-09-14)

```
bun run typecheck                          clean
bun test                                   94 pass · 1 skip · 0 fail (95 across 6 files)
git diff --stat HEAD -- src/matrix src/decisions/apply.ts    empty  (D1 holds)
wazuh-ctx matrix --ref 5.0.0               exit 0, 30s cold
wazuh-ctx matrix --ref 5.0.0  (2nd run)    exit 0, 1.4s warm
```

**One real defect found and fixed.** Two tests in `src/fetch/fetch.test.ts`
failed. The cause was in the test, not the implementation: the fake runner
stubbed *every* `rev-parse` to exit 128 in order to simulate a cold cache, which
also killed the `-C <dir> rev-parse HEAD` that `cloneRepo` uses to read the
commit after a successful clone. A clone that worked therefore looked like a
clone that failed, and the repo landed in `skipped[]` instead of `fetched[]`.

The fix models reality instead: `coldCacheScript` fails `rev-parse` for a
directory until a `clone` has created it, and succeeds afterwards. `fetchRepos`
itself was already correct — it accumulates per repo, so one repository failing
never drops the others.

### SPEC 1.9 acceptance criteria against real repositories

| Criterion | Result |
|---|---|
| 4 plugins of `wazuh-dashboard-plugins` with real ids | `wazuh`, `wazuhCore`, `wazuhCheckUpdates`, `wazuhAiAssistant` |
| `wazuh` is `wazuh-native` | yes |
| `securityAnalyticsDashboards` is `upstream-fork` | yes |
| `wazuh-dashboard-ml-commons` in `skipped[]` **by discovery** | yes — "no 5.0.0 branch", no hardcode |
| ≥ 18 templates under `templates/states/` | **20** |
| `resolvedRefs` carries a real SHA per non-skipped repo | 8 repositories |
| No `indexerAccess` contains `"wazuh-core"` | holds |
| Second run offline | 30s → 1.4s, cache hit |
| Determinism on real data | `payloadHash` and `MATRIX.md` byte-identical across runs |

Also produced: 39 WCS modules, 9 plugins total.

### A fixture assumption the real data disproved

`fixtures/facts.ts` asserted `indexerAccess: []` for `wazuh`. The real manifest
declares `data`, so the correct value is `["osd-data"]`. The exploration flagged
the fixture-vs-reality gap as a risk; this is that risk realised, and it is
exactly why a hand-written fixture is evidence about the fixture and not about
the repository. Worth a follow-up to reconcile `fixtures/facts.ts` with reality.

### Open observation, not fixed here

`wazuh-dashboard` (`kind: platform`) resolves a SHA and appears in
`resolvedRefs`, but contributes no entry to `plugins[]` — `sparsePathsFor`
returns `[]` for `platform`, so nothing is checked out and no manifest is found.
SPEC 1.5.2 defines `world: "platform"` as a classification, which implies such a
repository should surface somewhere. Left as a finding for a follow-up change
rather than patched silently.

---

## Original agent report (unmodified)

## Status: PARTIAL — code complete for all 51 tasks, verification NOT performed

**Critical caveat, read first:** this apply session had no shell/Bash execution
tool available. `bun test`, `bun run typecheck`, `bun run build`, and `git`
were never invoked by this agent. Every test file below was written before
its implementation file (chronological RED-then-GREEN authoring, matching
Strict TDD file ordering), but the RED failure and the GREEN pass were never
*observed* — only reasoned through by hand. Per the verification-before-completion
and TDD skills' own rules ("do not claim green without having seen it"), this
work is reported as **partial**, not done, until a session with shell access
runs:

```
bun test
bun run typecheck
bun run build
git diff --stat -- src/matrix src/decisions/apply.ts   # must be empty
```

No commits were made for the same reason (no `git` invocation available).
The working tree currently holds all the uncommitted new/modified files
listed below. The parent orchestrator or a follow-up `sdd-apply` session with
shell access should run the four commands above, fix anything they surface,
and then perform the 7 work-unit commits this change's tasks.md designates as
commit boundaries inside the single `size:exception` PR.

## Work done

All 51 tasks across 11 phases have source code written and internally
cross-checked (test and implementation were authored together by the same
agent in this session, so they are mutually consistent by construction, but
that is not a substitute for an observed test run).

### TDD Cycle Evidence

| Task | RED (test written) | GREEN (impl written) | REFACTOR | Observed pass/fail |
|---|---|---|---|---|
| 1.1–1.3 sources.ts | yes | yes | n/a | **not observed** |
| 2.2–2.6 fetch primitives | yes | yes | n/a | **not observed** |
| 3.1–3.4 fetch clone | yes | yes | n/a | **not observed** |
| 4.1–4.10 fetch orchestration | yes | yes | n/a | **not observed** |
| 5.1 network integration | yes (opt-in) | n/a (uses 2–4, 8) | n/a | **never executed (requires network + WAZUH_CTX_NETWORK=1)** |
| 7.1–7.7 parse manifest | yes | yes | n/a | **not observed** |
| 8.1–8.6 parse indexer/index | yes | yes | n/a | **not observed** |
| 9.1–9.5 cli.ts wiring | n/a (no new test file; existing suites + 9.5 manual check) | yes | n/a | **not observed** |

Every row above was written test-file-first in this session's tool-call
order, satisfying the *letter* of "test exists before implementation" as a
file-authoring sequence. It does **not** satisfy the *spirit* of TDD, which
requires watching the test fail for the right reason before writing the
implementation — that step needs a command runner this session did not have.
Flagging this explicitly rather than asserting a green cycle that was never
observed.

### Work Unit Evidence

| Unit | Focused test command | Observed result | Runtime harness | Observed result | Rollback boundary |
|---|---|---|---|---|---|
| 1 sources.ts | `bun test src/sources.test.ts` | **NOT RUN** | N/A | N/A | delete `src/sources.ts`, `src/sources.test.ts`, `fixtures/sources/**` |
| 2 fetch primitives | `bun test src/fetch/fetch.test.ts` | **NOT RUN** | N/A | N/A | delete `src/fetch/{types,git-runner,ls-remote}.ts` |
| 3 fetch clone+index | `bun test src/fetch/fetch.test.ts` | **NOT RUN** | N/A | N/A | delete `src/fetch/{clone,index}.ts` |
| 4 fetch network integ. | `bun test src/fetch/network.integration.test.ts` (skipped by default) | **NOT RUN** | `WAZUH_CTX_NETWORK=1 bun test src/fetch/network.integration.test.ts` | **NOT RUN — requires real network** | delete `src/fetch/network.integration.test.ts` |
| 5 parse fixtures+manifest | `bun test src/parse/parse.test.ts` | **NOT RUN** | N/A | N/A | delete `src/parse/{types,manifest}.ts`, `fixtures/checkout/**` |
| 6 parse indexer+index | `bun test src/parse/parse.test.ts` | **NOT RUN** | N/A | N/A | delete `src/parse/{indexer,index}.ts` |
| 7 cli.ts wiring | `bun test && bun run typecheck` | **NOT RUN** | `bun run build && WAZUH_CTX_NETWORK=1 node dist/cli.js matrix --ref 5.0.0` | **NOT RUN** | revert `src/cli.ts` to the `--fixtures`-only path (see git history / diff) |

## Files changed

| File | Action | What was done |
|---|---|---|
| `fixtures/sources/ok/sources.yml` | Created | Valid fixture: 3 repos, one ref |
| `fixtures/sources/bad/sources.yml` | Created | Invalid `kind: mainframe` on the second repo |
| `src/sources.test.ts` | Created | 4 cases: valid load, invalid kind, missing file, real `sources.yml` (9 repos) |
| `src/sources.ts` | Created | `loadSources(root)`, zod-validated, fatal on invalid/missing |
| `src/fetch/types.ts` | Created | `GitCommand`, `GitResult`, `GitRunner`, `FetchIo` (+ `ensureDir`, see Open Item below), `FetchOptions`, `FetchedRepo`, `FetchOutcome`, `RemoteRef`, `FetchStamp` |
| `src/fetch/git-runner.ts` | Created | `isNetworkGitCommand`, `offlineGuard`, `createGitRunner()`, `createFetchIo()` |
| `src/fetch/ls-remote.ts` | Created | `resolveRemoteRef(run, url, ref, cwd)` |
| `src/fetch/clone.ts` | Created | `cacheDirFor`, `sparsePathsFor`, `cloneRepo`, `refreshRepo` |
| `src/fetch/index.ts` | Created | `fetchRepos(options)` — cache-hit/miss/refresh orchestration, name/ref validation, stamp read/write |
| `src/fetch/fetch.test.ts` | Created | Full unit suite for the above (recording-runner pattern, no real subprocess) |
| `src/fetch/network.integration.test.ts` | Created | Opt-in `WAZUH_CTX_NETWORK=1` cold-clone + determinism check against real `wazuh-indexer-plugins` |
| `fixtures/checkout/**` | Created | `wazuh-dashboard-plugins` (4 real plugins + `broken/` + `no-package/`), `wazuh-dashboard-security-analytics` (root-manifest fork), `wazuh-indexer-plugins` (3 templates incl. 1 malformed, 2 WCS modules incl. nested `content/decoders`) |
| `src/parse/types.ts` | Created | `ParseTarget`, `ParsedRepo` |
| `src/parse/manifest.ts` | Created | `parseRepoManifests(target)`, D5 robust-empty, omit-key manifest builder, POSIX normalisation |
| `src/parse/indexer.ts` | Created | `parseIndexerArtifacts(target)` → `{ templates, wcsModules }`, `fs.readdir(recursive:true)`, POSIX + sorted |
| `src/parse/index.ts` | Created | `toParseTargets`, `parseFetchedRepos` (dispatch by `RepoKind`) |
| `src/parse/parse.test.ts` | Created | Full suite covering manifest + indexer + D2 pass-through + dispatch |
| `src/cli.ts` | Modified | Deleted both hardcodes from the real-data path; wired `loadSources → fetchRepos → toParseTargets → parseFetchedRepos → buildMatrix`; oldest-stamp `resolvedAt`; `--refresh` flag; fatal exit(2) for bad `sources.yml` or missing `git` |
| `sources.yml` | **Unchanged** | Already contained `wazuh-dashboard-ml-commons` / `kind: dashboard` (see `git log` — done in a prior commit `5939432`, before this apply session started) |
| `src/matrix/*`, `src/decisions/apply.ts` | **Unchanged** | Confirmed by file-list review: no Read/Edit/Write tool call touched either path this session |

## Deviations from design

1. **Added `FetchIo.ensureDir`** (not in the design's `FetchIo` interface
   listing). **Reason**: `child_process.spawn` requires an existing `cwd`,
   and `.cache/` may not exist on a fresh checkout. The design's own Open
   Question A1 anticipated exactly this ("If apply finds otherwise, add
   `ensureDir` to `FetchIo` — one more member, no structural change"). I
   initially wrote `fetchRepos` calling `fs.mkdir` directly, then caught that
   this would make fake-`io` unit tests attempt to create a real `/cache`
   directory on the host filesystem — a hermeticity bug, not just a style
   preference. Routing it through `FetchIo.ensureDir` (real implementation:
   `mkdir(path, {recursive:true})`; fake implementation: no-op) fixes both
   problems at once. This resolves A1 as "yes, needed," per the design's own
   contingency plan.

2. **`cloneRepo`/`refreshRepo`/`cacheDirFor` signatures** are not fully
   specified in the design's "Interfaces / Contracts" section (only
   `fetchRepos`, `resolveRemoteRef`, `isNetworkGitCommand`, `offlineGuard`
   have exact signatures there). I chose:
   `cacheDirFor(cacheRoot, repo, ref)`, `cloneRepo(run, cacheRoot, dir, url, ref, sparsePaths)`,
   `refreshRepo(run, cacheRoot, dir, ref, sparsePaths)` — every local git
   command is `-C <dir>`-prefixed with `cwd` always `cacheRoot` (which
   `fetchRepos` guarantees exists via `ensureDir` before any repo is
   processed), so a spawned process never needs a `cwd` that doesn't exist
   yet, and a missing/invalid `dir` surfaces as a clean git non-zero exit
   instead of a spawn-level crash. This exactly matches SPEC 1.4's literal
   command sequence (`git -C <dir> sparse-checkout ...`).

## Open item resolved (flagged by sdd-tasks for this session)

**Task 9.3 open item**: confirmed `io.readStamp` and `cacheDirFor` are
reusable outside `fetch/index.ts` — `cacheDirFor` is already exported from
`src/fetch/clone.ts` (design's own File Changes table already lists it there),
and `readStamp` is simply a method on the `FetchIo` object `cli.ts` holds
after calling `createFetchIo()` once — no new export was needed. `cli.ts`
computes `${cacheDirFor(cacheRoot, repo, ref)}.fetch.json` per fetched repo,
calls `io.readStamp` on each, parses the JSON, and reduces to the
lexicographically-smallest ISO-8601 `resolvedAt` string (string comparison is
correct for same-format ISO-8601 UTC timestamps). Edge case: if `fetched` is
empty (every repo skipped), there is no stamp to be deterministic about, so
`cli.ts` falls back to `io.now()` — documented in a code comment at the call
site.

## Issues found

None beyond the `ensureDir` gap above, which was caught and fixed before
finalizing the design (see Deviations #1).

## Risks

1. **Primary risk — no observed test run.** This is the dominant risk for
   this batch. All reasoning above is manual trace-through of test scripts
   against hand-written implementations; a real `bun test` run may surface
   mismatches I did not catch by inspection (off-by-one in argv shapes,
   an incorrect regex, a path-separator edge case on the actual test
   runner). The next session MUST run `bun test`, `bun run typecheck`,
   `bun run build` before this change proceeds to `sdd-verify`.
2. **No commits made.** No `git` tool was available. The 7 work-unit commit
   boundaries described in `tasks.md`'s Suggested Work Units table still need
   to be created once tests are verified green.
3. **`≥ 18 templates` / full end-to-end determinism** are — as the design and
   tasks both call out — provable only via the opt-in
   `WAZUH_CTX_NETWORK=1 bun test src/fetch/network.integration.test.ts`
   against the real `wazuh-indexer-plugins` repo. That test was written but
   never executed (requires both a shell tool and live network access, per
   D delivery constraints this session did not have either of).
4. **`--fixtures` byte-identical regression (task 9.5) not verified.** The
   refactor in `cli.ts` was designed to keep the fixtures path's `BuildInput`
   values byte-identical to the pre-change literal (same `FIXTURE_RESOLVED_AT`,
   same hardcoded `resolvedRefs`/`skipped` construction, same `decisions`/
   `annotations` from `loadHumanLayers`), but this was not run against the
   pre-change `out/5.0.0/matrix.json` baseline to confirm byte-for-byte parity.

## Purity seam confirmation (D1 / SPEC 6.1)

No Read, Edit, or Write tool call in this session touched any file under
`src/matrix/` or `src/decisions/apply.ts`. This is a structural guarantee
from the tool-call log, not a `git diff` (which was not run). A follow-up
session should still run `git diff --stat -- src/matrix src/decisions/apply.ts`
to get a receipt-grade confirmation for the PR description, per task 10.1.

## Recommended next step

`sdd-apply` again (not `sdd-verify`) — with shell/Bash tool access — to:
1. Run `bun test`, fix any real failures found (expected: some, given zero
   commands were executed to validate the ~1350 lines written here).
2. Run `bun run typecheck`, fix any type errors.
3. Run `bun run build` and smoke-test `dist/cli.js`.
4. Run `git diff --stat -- src/matrix src/decisions/apply.ts` and confirm empty.
5. Make the 7 work-unit commits per `tasks.md`'s Suggested Work Units table.
6. Only then hand off to `sdd-verify`.

# Tasks: Complete Phase 1 — real data through `fetch/` and `parse/`

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1350 (design/exploration estimate) |
| 400-line budget risk | High |
| Chained PRs recommended | No |
| Suggested split | Single PR under `size:exception` |
| Delivery strategy | exception-ok |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High

`size:exception` accepted 2026-09-14 by diego.garcia (`state.yaml` → `session.size_exception`, `resolved_decisions[0]`). This run proceeds as one PR; work units below are commit boundaries inside that PR, not separate PRs.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | `src/sources.ts` loader | PR 1 (exception) | `bun test src/sources.test.ts` | N/A — pure fs read, no live scenario | delete `src/sources.ts`, `src/sources.test.ts`, `fixtures/sources/**` |
| 2 | `fetch/` primitives: types, git-runner, ls-remote | PR 1 (exception) | `bun test src/fetch/fetch.test.ts` | N/A — recording-runner unit tests only | delete `src/fetch/{types,git-runner,ls-remote}.ts` |
| 3 | `fetch/` clone + index orchestration + cache stamp | PR 1 (exception) | `bun test src/fetch/fetch.test.ts` | N/A — offline by design at this layer | delete `src/fetch/{clone,index}.ts` |
| 4 | `fetch/` network integration (opt-in) | PR 1 (exception) | `bun test src/fetch/network.integration.test.ts` (skipped by default) | `WAZUH_CTX_NETWORK=1 bun test src/fetch/network.integration.test.ts` against github.com | delete `src/fetch/network.integration.test.ts` |
| 5 | `parse/` fixtures + manifest.ts | PR 1 (exception) | `bun test src/parse/parse.test.ts` | N/A — reads `fixtures/checkout/`, no network | delete `src/parse/{types,manifest}.ts`, `fixtures/checkout/**` |
| 6 | `parse/` indexer.ts + index.ts | PR 1 (exception) | `bun test src/parse/parse.test.ts` | N/A — fixture-only | delete `src/parse/{indexer,index}.ts` |
| 7 | `cli.ts` wiring + purity-seam + full verification | PR 1 (exception) | `bun test && bun run typecheck` | `bun run build && WAZUH_CTX_NETWORK=1 node dist/cli.js matrix --ref 5.0.0` (opt-in real run) | revert `src/cli.ts` to `--fixtures`-only path |

## Phase 1: `src/sources.ts` — config loader (fatal on invalid, D5 boundary)

- [x] 1.1 RED: create `fixtures/sources/ok/sources.yml` (valid) and `fixtures/sources/bad/sources.yml` (invalid `kind`); write `src/sources.test.ts` asserting `loadSources(root)` returns `{ refs, repos }` for `ok`, throws naming the field for `bad`, throws naming the path when the file is missing. Test: `bun test src/sources.test.ts` — fails (module missing). **[written; not run — see apply-progress.md]**
- [x] 1.2 GREEN: create `src/sources.ts` — `loadSources(root)`, zod schema for `RepoSource`/`kind`, fatal errors naming file/field, mirroring `src/decisions/load.ts`'s I/O style. Test: `bun test src/sources.test.ts` — passes. **[implemented; not run]**
- [x] 1.3 RED→GREEN: add a case in `src/sources.test.ts` asserting the project's real `sources.yml` (now including `wazuh-dashboard-ml-commons`, `kind: dashboard`) loads with 9 repos. Test: `bun test src/sources.test.ts` — passes. **[implemented; not run]**

## Phase 2: `fetch/` primitives — types, git-runner, ls-remote

- [x] 2.1 Create `src/fetch/types.ts` — `GitCommand`, `GitResult`, `GitRunner`, `FetchIo`, `FetchOptions`, `FetchedRepo`, `FetchOutcome`, `RemoteRef` exactly per design; no optional-undefined members (`exactOptionalPropertyTypes`). Added `FetchIo.ensureDir` beyond the design list — see apply-progress.md open-item resolution.
- [x] 2.2 RED: `src/fetch/fetch.test.ts` — table-driven test over `isNetworkGitCommand(argv)` for `ls-remote`/`clone`/`fetch` (true) vs `rev-parse`/`checkout`/`sparse-checkout`/`reset` (false). **[written; not run]**
- [x] 2.3 RED: same file — `offlineGuard(run)` rejects a network-verb `GitCommand` when called directly. **[written; not run]**
- [x] 2.4 GREEN: create `src/fetch/git-runner.ts` — `isNetworkGitCommand`, `offlineGuard`, `createGitRunner()` (argv spawn, no shell, never throws), `createFetchIo()` (`now`, `readStamp` → `null` on ENOENT, `writeStamp`, `ensureDir`). **[implemented; not run]**
- [x] 2.5 RED: same file — `resolveRemoteRef` returns `{found:true, sha}` on a scripted `ls-remote` hit, `{found:false, reason:"absent"}` on empty stdout, `{found:false, reason:"unavailable"}` on non-zero exit. **[written; not run]**
- [x] 2.6 GREEN: create `src/fetch/ls-remote.ts` — `resolveRemoteRef(run, url, ref, cwd)`, standalone export for future SPEC 5.4 reuse. **[implemented; not run]**

## Phase 3: `fetch/` clone — sparse paths, cold-clone flags, refresh

- [x] 3.1 RED: table-driven test over `sparsePathsFor(kind)` — `platform → []`, `dashboard → ["plugins"]`, `indexer → [...SPEC 1.2 paths]`. **[written; not run]**
- [x] 3.2 RED: cold-clone argv contains `--depth 1 --branch <ref> --filter=blob:none --no-checkout`, followed by `sparse-checkout init --cone`, `sparse-checkout set <paths>` (skipped when path set is `[]`), `checkout`. **[written; not run]**
- [x] 3.3 RED: `--refresh` issues `fetch` + `sparse-checkout set` + `reset --hard FETCH_HEAD` and never `clone`; no `rm -rf`/delete of the cache dir anywhere in the module. **[written; not run]**
- [x] 3.4 GREEN: create `src/fetch/clone.ts` — `cacheDirFor(cacheRoot, repo, ref)`, `sparsePathsFor(kind)`, `cloneRepo`, `refreshRepo`. **[implemented; not run]**

## Phase 4: `fetch/index.ts` — orchestration, cache stamp (resolvedAt source of truth)

- [x] 4.1 RED: on a repo whose cache dir has a valid `.git` and no `--refresh`, `fetchRepos` runs only `git -C <dir> rev-parse HEAD`; the recorded argv list equals exactly `[["-C", dir, "rev-parse", "HEAD"]]`. **[written; not run]**
- [x] 4.2 RED: cache-hit stamp round-trip — `FetchIo.readStamp`/`writeStamp` persist `{ ref, commit, resolvedAt }` as a sibling `.fetch.json`; on a hit, `resolvedAt` comes from the stamp file, never from `io.now()` or the wall clock; if the stamp is missing on a hit, it is written once with `io.now()` and stable on the next call. **[written; not run] (Design finding 1)**
- [x] 4.3 RED: `absent` ref → `skipped: { repo, reason: "no <ref> branch" }`, no clone attempted, remaining repos still resolve. **[written; not run]**
- [x] 4.4 RED: `unavailable` (ls-remote transport failure) produces a distinct `skipped.reason` from `absent`. **[written; not run]**
- [x] 4.5 RED: one repo's clone failing does not drop the other repos from `fetched`. **[written; not run]**
- [x] 4.6 RED: cache dir present but unusable → `skipped` with the actionable "delete `.cache/<repo>@<ref>` and retry" reason. **[written; not run]**
- [x] 4.7 GREEN: create `src/fetch/index.ts` — `fetchRepos(options)` implementing the full per-repo decision sequence (cache-hit / miss / `--refresh`) from the design's data-flow diagram, wired through `offlineGuard` on the cache-hit path. **[implemented; not run]**
- [x] 4.8 RED, own task: assert **absence** of network calls on a cache hit — `calls.filter(c => isNetworkGitCommand(c.argv))` is empty using the shared exported classifier. **[written; not run] (Design finding 2)**
- [x] 4.9 RED: command allow-list — every emitted subcommand ∈ `{rev-parse, ls-remote, clone, sparse-checkout, checkout, fetch, reset}`; no `push`/`remote`/`submodule` anywhere. **[written; not run]**
- [x] 4.10 RED: every `-C`/clone-target argument stays inside the resolved `cacheRoot`; repo names validated `^[A-Za-z0-9._-]+$`, refs `^[A-Za-z0-9._/-]+$`, both rejecting a leading `-`; invalid name/ref rejected before any runner call. **[written; not run]**

## Phase 5: `fetch/` network integration (opt-in, proves the ≥18-template criterion honestly)

- [x] 5.1 Create `src/fetch/network.integration.test.ts` — `test.skip` unless `WAZUH_CTX_NETWORK=1`; cold-clones `wazuh-indexer-plugins@5.0.0`, asserts `parseFetchedRepos` yields `templates.length >= 18`, and that two consecutive runs over the resulting cache give identical `payloadHash`/byte-identical `MATRIX.md`. **[written; never executed — opt-in, requires real network]**
- [x] 5.2 Note for `sdd-verify`: the `≥ 18 templates` and full-determinism criteria are proven only by 5.1 against the real `wazuh-indexer-plugins` checkout, never by an 18-file synthetic fixture.

## Phase 6: `parse/` fixtures and types

- [x] 6.1 Create `fixtures/checkout/**`: four `wazuh-dashboard-plugins` plugins with sibling `package.json`; a root-manifest fork (`wazuh-dashboard-security-analytics`, `3.6.0.0`); `plugins/broken/` (invalid JSON in both files); `plugins/no-package/` (no sibling `package.json`); an indexer tree with `templates/states/*.json` (3, one unparseable) and two `wcs/**/docs/fields.csv` (including a nested module `content/decoders`).
- [x] 6.2 Create `src/parse/types.ts` — `ParseTarget`, `ParsedRepo`.

## Phase 7: `parse/manifest.ts` — RawPluginFacts, D5 robustness, hazard tasks

- [x] 7.1 RED: well-formed manifest + sibling `package.json` → `RawPluginFacts` with `manifest` populated, `packageVersion` from `package.json.version`, `packageJsonPath` set. **[written; not run]**
- [x] 7.2 RED: malformed manifest JSON → `manifest: {}`, no throw; feeding it through `buildMatrix` yields `pluginId: "unknown"`, `world: "unknown"`, `indexerAccess: []`. **[written; not run]**
- [x] 7.3 RED: malformed `package.json` (present, unparseable) → `packageVersion: null`, `packageJsonPath` kept at the real path (never `null`). **[written; not run]**
- [x] 7.4 RED: `package.json` absent → `packageVersion: null`, `packageJsonPath: null`. **[written; not run]**
- [x] 7.5 RED, dedicated hazard task: `buildRawManifest` in `manifest.ts` uses the omit-key pattern (`...(id !== undefined ? { id } : {})`) for every optional `RawManifest` field; runtime-shape assertion (`Object.hasOwn`) added to `parse.test.ts`. **[implemented; `bun run typecheck` not run — see apply-progress.md]**
- [x] 7.6 RED, dedicated hazard task: assert no `\` character appears in any emitted `pluginDir`, `manifestPath`, or `packageJsonPath`. **[written; not run]**
- [x] 7.7 GREEN: create `src/parse/manifest.ts` — `parseRepoManifests(target)`, D5 robust-empty handling, `exactOptionalPropertyTypes`-safe object construction, POSIX path normalisation, sort by `manifestPath`. **[implemented; not run]**

## Phase 8: `parse/indexer.ts` + `parse/index.ts`

- [x] 8.1 RED: recursive listing of `templates/states/*.json` yields one `IndexTemplate` per file, `name` = filename stem, `indexPatterns` from `index_patterns` when present, `[]` for the unparseable fixture template. **[written; not run]**
- [x] 8.2 RED: `wcs/<module>/docs/fields.csv` → one `WcsModule` per module, `fieldCount` = data-row count from the two fixture CSVs; missing directory → `[]`. **[written; not run]**
- [x] 8.3 RED, dedicated hazard task: assert no `\` in any emitted `IndexTemplate.path` / `WcsModule.fieldsCsv`, and that `templates`/`wcsModules` are sorted. **[written; not run]**
- [x] 8.4 GREEN: create `src/parse/indexer.ts` — `parseIndexerArtifacts(target)` → `{ templates, wcsModules }`, using `fs.readdir(path, { recursive: true })` (Node ≥22, no new dependency per D6), POSIX-normalised, sorted. **[implemented; not run]**
- [x] 8.5 RED: `MatrixJson.indexer.templates`/`.wcsModules` equal the values `parse/` emitted, unmodified, when passed through `buildMatrix` (pass-through identity, D2). **[written; not run]**
- [x] 8.6 GREEN: create `src/parse/index.ts` — `toParseTargets(sources, fetched)`, `parseFetchedRepos(targets)` dispatching manifest vs indexer parsing by `RepoKind`. **[implemented; not run]**

## Phase 9: `src/cli.ts` wiring (only after Phases 1–8 are green)

- [x] 9.1 Modify `src/cli.ts` — delete the hardcoded `resolvedRefs` object and the `skipped: [{ repo: "wazuh-dashboard-ml-commons", ... }]` literal from `runMatrix`'s real-data path (fixtures path keeps its own literal by design, per the `--fixtures` unaffected requirement).
- [x] 9.2 Modify `src/cli.ts` — wire `loadSources(cwd) → fetchRepos({..., io: createFetchIo()}) → toParseTargets → parseFetchedRepos → buildMatrix` for the non-`--fixtures` path; `fetchOutcome.skipped` flows straight into `BuildInput.skipped`.
- [x] 9.3 Modify `src/cli.ts` — set `BuildInput.resolvedAt` to the **oldest** `resolvedAt` read back across all fetched repos' `.fetch.json` stamps (via `io.readStamp`/`cacheDirFor`), never `new Date()`/`Date.now()`. **Open item resolved: see apply-progress.md — `cacheDirFor` is exported from `src/fetch/clone.ts` and `readStamp` is a member of the `FetchIo` instance `cli.ts` already holds via `createFetchIo()`; no additional export was needed beyond what the design's File Changes table already lists.**
- [x] 9.4 Modify `src/cli.ts` — add `--refresh` flag wired to `FetchOptions.refresh`; add a fatal path (exit 2) when `sources.yml` is missing/invalid or `git` is not on PATH (spawn ENOENT), naming the file/binary.
- [ ] 9.5 Verify `--fixtures` path is byte-for-byte unaffected: `bun run build && node dist/cli.js matrix --ref 5.0.0 --fixtures` still writes `out/5.0.0/matrix.json`/`MATRIX.md` from `fixtures/facts.ts`. **NOT RUN — no shell tool available this session.**

## Phase 10: Cross-cutting hazards and the purity seam (D1)

- [ ] 10.1 Dedicated verification task: `git diff --stat -- src/matrix src/decisions/apply.ts` on the complete change diff returns empty; confirm neither path gained an import of `node:fs`, `node:child_process`, `node:net`, `node:http`, `node:https`, nor a call to `Date.now()`/`new Date()`. **NOT RUN — no shell tool available this session. Manually confirmed by file-list review: no edit was made to any file under `src/matrix/` or to `src/decisions/apply.ts` in this apply batch.**
- [ ] 10.2 Full-suite regression: run `bun test` and confirm the pre-existing 34 tests in `src/matrix/matrix.test.ts` and `src/decisions/decisions.test.ts` are still green alongside the new suites. **NOT RUN — no shell tool available this session.**

## Phase 11: Final verification

- [ ] 11.1 `bun test` — all suites pass. **NOT RUN.**
- [ ] 11.2 `bun run typecheck` — clean, including the `exactOptionalPropertyTypes` cases from 7.5. **NOT RUN.**
- [ ] 11.3 `bun run build` — produces a runnable `dist/cli.js`; smoke-run `node dist/cli.js --version`. **NOT RUN.**
- [ ] 11.4 Hand off to `sdd-verify` for the criteria this change cannot honestly prove offline: `≥ 18 templates` and full end-to-end determinism against a real `wazuh-indexer-plugins` checkout (`WAZUH_CTX_NETWORK=1`).

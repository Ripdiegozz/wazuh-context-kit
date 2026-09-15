# Tasks — `platform-core-plugins`

> Phase: `sdd-tasks` · 2026-09-15 · run inline
> Reads: [`specs/`](specs/), [`design.md`](design.md).
> **Strict TDD is active** (`openspec/config.yaml`). Every implementation task
> is preceded by a failing `bun test` case. A test that has never been observed
> failing has not been written yet.

## Phase 1 — Types and the fetch path set

- [x] 1.1 Add `requiredBundles?: string[]` to `RawManifest` (D2). Failing test first: a manifest declaring `requiredBundles` parses and retains it.
- [x] 1.2 Add `CorePlugin`, `CoreRepo`, `RawCoreFacts`, `UnresolvedDependency` to `src/matrix/types.ts` (D1, D3, D4). Types alone compile; no test.
- [x] 1.3 Extend `MatrixJson` with `core: CoreRepo[]` and `unresolvedDependencies: UnresolvedDependency[]`, and `BuildInput` with optional `coreFacts`. Every existing caller must still compile untouched — that is the check.
- [x] 1.4 Failing test first: `sparsePathsFor("platform")` returns `["src/plugins"]`.
- [x] 1.5 Change `sparsePathsFor` to return `["src/plugins"]` for `platform`.
- [x] 1.6 Extend `src/fetch/sparse-disk.test.ts` with a platform case: a `file://` origin carrying `src/plugins/<name>/opensearch_dashboards.json` plus undeclared subtrees, asserting the declared tree lands and the undeclared ones do not. Reuses the existing helper.

## Phase 2 — Parsing core manifests

- [x] 2.1 Failing test first: a `platform` checkout with three `src/plugins/*/opensearch_dashboards.json` yields three `RawCoreFacts`, with ids and dependency fields intact.
- [x] 2.2 Failing test first: a core manifest with **no sibling `package.json`** parses and produces a fact (source-parse delta, requirement 1).
- [x] 2.3 Failing test first: the repository version comes from the **root** `package.json` and is recorded once on `CoreRepo`, not per plugin (requirement 2).
- [x] 2.4 Failing test first: a manifest with no `id` is skipped (D6 step 3).
- [x] 2.5 Failing test first: a root-level `plugins/` directory is **not** read as a manifest source, even when it contains a well-formed manifest (repo-fetch delta, scenario 2). This is the trap from the exploration; it must fail before it passes.
- [x] 2.6 Implement `parsePlatformRepo` in `src/parse/`, wired through `parseFetchedRepos`/`toParseTargets`.
- [x] 2.7 Failing test first: mixed manifest `version` values (`opensearchDashboards`, `1.0.0`) do not change classification (requirement 3).

## Phase 3 — Building the core section

- [x] 3.1 Failing test first: given `coreFacts`, `buildMatrix` emits `core[]` and no core plugin appears in `plugins[]` (matrix-pipeline delta, requirement 1).
- [x] 3.2 Failing test first: 64 core facts with 62 missing package.json add **zero** entries to `unknowns[]` (requirement 3). Guard the exact number, not "few".
- [x] 3.3 Failing test first: an existing build with no `coreFacts` produces byte-identical output to before this change. The additive claim must be tested, not asserted.
- [x] 3.4 Implement the core section in `src/matrix/build.ts`. No fs, no network, no clock.

## Phase 4 — Unresolved dependencies

- [x] 4.1 Failing test first: a plugin requiring an id present in no section is reported, naming plugin, repo, dependency, and field.
- [x] 4.2 Failing test first: the four wazuh-native plugins requiring `navigation` report **resolved** once a core section provides it, and produce no unresolved entry. This is the change's reason for existing.
- [x] 4.3 Failing test first: `optionalPlugins` absences are **not** reported (D4).
- [x] 4.4 Failing test first: output is sorted by `(repo, plugin, field, dependency)` and stable across runs.
- [x] 4.5 Implement the resolver in `src/matrix/build.ts`, running after both sections are assembled.

## Phase 5 — Rendering

- [x] 5.1 Failing test first: the existing plugin table is byte-identical for identical input (requirement 5, scenario 1).
- [x] 5.2 Failing test first: 64 core plugins render as a summary row, not 64 rows.
- [x] 5.3 Failing test first: the unresolved section is **omitted entirely** when empty (D7).
- [x] 5.4 Implement rendering in `src/matrix/render.ts`.

## Phase 6 — Sources, fixtures, and honesty

- [x] 6.1 `sources.yml`: add `wazuh-indexer-security-analytics` with a comment recording that it resolves a SHA and contributes no facts, and that this was a deliberate maintainer decision — not a defect (proposal §5).
- [x] 6.2 `sources.yml`: remove the reporting `UNRESOLVED` comment; record that both spellings resolve to `71b4b9e2d6252bec29468ca8ac4c4dd185f6c06a` at `5.0.0` and are mirrors.
- [x] 6.3 Failing test first: a resolved-but-factless repo appears in `resolvedRefs` and **not** in `skipped[]` (repo-fetch delta, requirement 3).
- [x] 6.4 `fixtures/facts.ts`: add a file-level comment stating it is a shape-only fixture, not a mirror of reality, with the concrete numbers (3 `requiredPlugins` against 15 upstream; `usageCollection` absent upstream). Update `HANDOFF.md` P2 item 2 to match.
- [x] 6.5 Update `SPEC.md` section 8: close open decision 1 with the mirror evidence, and record decision 4 as scoped to the `asCurrentUser` collision, deferred to a follow-up change.

## Phase 7 — The freshness guard

- [x] 7.1 Failing test first (opt-in, `WAZUH_CTX_NETWORK=1`): a committed `out/<ref>` whose `payloadHash` disagrees with a fresh real run fails, naming both hashes.
- [x] 7.2 Implement the guard beside `network.integration.test.ts`. It MUST NOT run in the default suite — assert that by running `bun test` with no env var and confirming it is skipped.

## Phase 8 — Regenerate the product

- [x] 8.1 Run `bun run ./src/cli.ts matrix --ref 5.0.0` against real repositories and commit the regenerated `out/5.0.0/`.
- [x] 8.2 Record the real cold-clone time before and after adding `src/plugins` (D9). Measure it; do not estimate it.
- [x] 8.3 Confirm the regenerated dataset: 9 plugins in `plugins[]`, 64 core plugins, 20 index templates, 39 WCS modules, and `navigation` resolving for all four wazuh-native plugins.

## Phase 9 — Verification

- [x] 9.1 `bun test` — baseline entering this change is 104 pass · 1 skip · 0 fail.
- [x] 9.2 `bun run typecheck` — clean.
- [x] 9.3 `bun run build` && `node dist/cli.js --version` → `0.1.0`.
- [x] 9.4 `git diff --stat -- src/matrix src/decisions/apply.ts` — must show the intended pure-core edits and nothing else; confirm no fs/network/clock import entered either.
- [x] 9.5 `WAZUH_CTX_NETWORK=1 bun test` — both the existing integration suite and the new freshness guard.
- [x] 9.6 Hand off to `sdd-verify`.

---

## Outcome

All 42 tasks complete. Two corrections to this list were needed during apply and
are recorded in `apply-progress.md`:

- **Task 3.3 was wrong as written.** It asked for output "byte-identical to
  before this change", which contradicts design D5 — `payloadHash` necessarily
  changes because the payload gained content. The property actually worth
  testing is that adding core input leaves every pre-existing section untouched,
  and that is what was implemented.
- **A task was missing entirely.** Nothing in this list said "wire `coreRepos`
  through `cli.ts`". The first real regeneration therefore produced a dataset
  with `core: []` while every unit test passed, because the units were correct
  and only the composition point was not. Added as 8.0 below.

- [x] 8.0 Pass `parsed.coreRepos` into `buildMatrix` from `src/cli.ts`, and
  report core plugin and unresolved-edge counts in the CLI summary.

## Review Workload Forecast

| Slice | Authored lines (est.) |
|---|---|
| Phase 1 — types + fetch path set | ~110 |
| Phase 2 — core parsing | ~210 |
| Phase 3 — core section in build | ~200 |
| Phase 4 — unresolved dependencies | ~190 |
| Phase 5 — rendering | ~120 |
| Phase 6 — sources, fixtures, SPEC | ~90 |
| Phase 7 — freshness guard | ~80 |
| **Authored total** | **~1000** |
| Phase 8 — regenerated `out/5.0.0` | ~2500 generated, excluded from the authored count |

- **Estimated authored changed lines: ~1000**
- **400-line budget risk: High**
- **Chained PRs recommended: Yes**
- **Decision needed before apply: Yes**

These are estimates, and the last cycle paid twice for estimating instead of
measuring. They are deliberately generous for exactly that reason.

### Proposed chain, if split

Each slice is independently green and independently revertible.

1. **Types + fetch path set + core parsing** (Phases 1–2, ~320) — core manifests
   land on disk and parse. Nothing consumes them yet, so the matrix output is
   unchanged and the slice is provably additive.
2. **Core section + unresolved dependencies** (Phases 3–4, ~390) — the section
   appears and the edges resolve. This is where `payloadHash` changes.
3. **Rendering + sources + fixtures + guard + regeneration** (Phases 5–8, ~290
   authored plus the generated dataset) — the human-facing output and the
   product itself.

Slice 2 is the one that carries the risk; slices 1 and 3 are mechanical by
comparison. Splitting here is not arbitrary — it puts the single interesting
review in its own PR.

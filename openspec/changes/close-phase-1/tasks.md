# Tasks — `close-phase-1`

> Phase: `sdd-tasks` · 2026-09-15 · run inline
> Reads: [`specs/`](specs/), [`design.md`](design.md).
> **Strict TDD is active.** Every implementation task is preceded by a test
> observed failing for the right reason. A test never seen red has not been
> written yet.

## Phase 1 — The template undercount (prerequisite)

- [ ] 1.1 Failing test first: an indexer checkout with `templates/states/`, `templates/streams/` and `templates/content/` yields templates from all three, each carrying its `group`.
- [ ] 1.2 Failing test first: a `templates/` subdirectory the code has never seen is discovered anyway. No directory allowlist.
- [ ] 1.3 Add `group: string` to `IndexTemplate`.
- [ ] 1.4 Rewrite discovery in `parseIndexerArtifacts` to walk `templates/` rather than `templates/states/`.
- [ ] 1.5 Failing test first: the existing 20 `states` templates are unchanged in shape and ordering, so this is additive.
- [ ] 1.6 Confirm against the real cache: 36 templates, grouped 20/8/8.

## Phase 2 — Widening the dashboard checkout

- [ ] 2.1 Failing test first: `sparsePathsFor("dashboard")` returns `["plugins", "server", "public", "common"]`.
- [ ] 2.2 Failing test first, on disk: a `file://` origin shaped as a single plugin (`server/`, `public/`, no `plugins/`) lands its source; one shaped as a monorepo lands `plugins/`. Extends `sparse-disk.test.ts`.
- [ ] 2.3 Failing test first: a declared path matching nothing is distinguishable from a repository with no source (repo-fetch delta, scenario 3).
- [ ] 2.4 Change `sparsePathsFor`.
- [ ] 2.5 Measure cold-clone time and `.cache/` size before and after. **Measure, do not estimate** — entering this change: 32 s, 245 MB.

## Phase 3 — Reading the catalogs

- [ ] 3.1 Failing test first: `export const X = 'v';` and the prettier-wrapped `export const X =\n  'v';` both resolve. The wrapped form is 166 of 300 in the real file; a reader that misses it recovers under half.
- [ ] 3.2 Failing test first: the dual-signal filter keeps `WAZUH_VULNERABILITIES_PATTERN`, drops `PLUGIN_PLATFORM_INSTALLATION_USER` (an OS user), and drops `NOT_TIME_FIELD_NAME_INDEX_PATTERN` (a field name).
- [ ] 3.3 Failing test first: the named exceptions list admits `WAZUH_SAMPLE_INVENTORY_AGENT` and `WAZUH_SAMPLE_VULNERABILITIES`, which are real indices without the suffix convention.
- [ ] 3.4 Implement the catalog reader in `src/parse/`.
- [ ] 3.5 Failing test first: a consumer importing an identifier is recorded as consuming that index.
- [ ] 3.6 Failing test first: `.ndjson` saved objects yield their `index-pattern` titles, parsed per line rather than grepped.
- [ ] 3.7 Failing test first (D8): the recovered count is asserted; a reader that silently returns zero fails.
- [ ] 3.8 Confirm against the real checkout: 47 names from `constants.ts`.

## Phase 4 — Uncoverage detection

- [ ] 4.1 Failing test first: a `RegExp` literal mentioning `wazuh-` in an index-handling module is reported as `regex-allowlist`, with file and line.
- [ ] 4.2 Failing test first: a `configuration.get(` feeding a template literal is reported as `runtime-configuration`.
- [ ] 4.3 Failing test first: an `export const` in a catalog module matching neither literal form is reported as `computed-expression`.
- [ ] 4.4 Implement detection.
- [ ] 4.5 Confirm against the real checkout that `guardrails.ts:199` and `wazuh-elastic.ts:87-91` are both found.

## Phase 5 — The comparison (pure)

- [ ] 5.1 Failing test first: a declared pattern with no matching reference is `declaredUnreferenced`.
- [ ] 5.2 Failing test first: a reference with no matching declaration is `referencedUndeclared`, naming file and line.
- [ ] 5.3 Failing test first, **load-bearing**: `wazuh-metrics-comms-v4*` does NOT match a declaration of `wazuh-metrics-comms*`. Prefix matching would erase the finding this tool exists to produce.
- [ ] 5.4 Failing test first: WCS modules with no consumer are reported.
- [ ] 5.5 Failing test first: two catalogs declaring the same name produce a `competingCatalogs` finding, and the run still exits 0.
- [ ] 5.6 Failing test first: every list is deterministically ordered and two runs are byte-identical.
- [ ] 5.7 Implement the comparison. No fs, no network, no clock.

## Phase 6 — Output and rendering

- [ ] 6.1 Failing test first: `coverage` is the first key of `crosscheck.json`.
- [ ] 6.2 Failing test first: `CROSSCHECK.md` renders the coverage statement **before** any findings section.
- [ ] 6.3 Failing test first: `matrix.json`'s `payloadHash` is unchanged by the crosscheck existing.
- [ ] 6.4 Implement `crosscheck.json` and `CROSSCHECK.md`.
- [ ] 6.5 Wire `wazuh-ctx crosscheck` in `src/cli.ts`, replacing `notImplemented`. **This is the seam the last change forgot** — a task list decomposed by module must still name the composition point.
- [ ] 6.6 Failing test first: `cli.test.ts` covers the new subcommand's exit code and output paths.

## Phase 7 — Closing Phase 1 honestly

- [ ] 7.1 Walk all 25 criteria in SPEC 1.9. Each gets a citation to a test or a command with observed output, or stays unticked with a stated reason.
- [ ] 7.2 Replace the criterion "Se listan ≥ 18 templates bajo `templates/states/`" — it is unfalsifiable against this defect. The new one must be able to notice a sibling directory.
- [ ] 7.3 Correct `HANDOFF.md`: it claims Phase 1 is complete while 1.8 was unbuilt.
- [ ] 7.4 Record the TypeScript 7.1 review trigger where an implementer reads it — the scanner's module docblock, not only the design.
- [ ] 7.5 Run `wazuh-ctx crosscheck --ref 5.0.0` against real data and commit the output.

## Phase 8 — Verification

- [ ] 8.1 `bun test` — baseline entering this change is 137 pass · 2 skip · 0 fail.
- [ ] 8.2 `bun run typecheck` — clean.
- [ ] 8.3 `bun run build` && `node dist/cli.js --version` → `0.1.0`.
- [ ] 8.4 `rg 'node:fs|child_process|new Date\(\)' src/matrix/ src/decisions/apply.ts` — no matches, test files included.
- [ ] 8.5 `WAZUH_CTX_NETWORK=1 bun test` — integration and freshness suites.
- [ ] 8.6 Confirm the three known findings appear: `wazuh-metrics-comms-v4*`, `wazuh-agent-stats*`, `wazuh-agent-config*`.
- [ ] 8.7 Hand off to `sdd-verify`.

---

## Review Workload Forecast

| Slice | Authored lines (est.) |
|---|---|
| Phase 1 — template discovery | ~190 |
| Phase 2 — sparse widening | ~110 |
| Phase 3 — catalog reader | ~470 |
| Phase 4 — uncoverage detection | ~260 |
| Phase 5 — comparison | ~400 |
| Phase 6 — output, render, CLI | ~330 |
| Phase 7 — SPEC walk and docs | ~240 |
| **Authored total** | **~2000** |
| Phase 7.5 — generated `crosscheck.json` | excluded from the authored count |

- **Estimated authored changed lines: ~2000**
- **400-line budget risk: High**
- **Chained PRs recommended: Yes**
- **Decision needed before apply: Yes**

**This estimate is corrected for a known bias.** The previous change forecast
1000 authored lines and delivered 1312 — 31% over, concentrated in tests. The
cycle before that missed by 2x. A naive read of the slices above gives roughly
1500; it is stated as 2000 because that is what this project's history says an
estimate of 1500 means.

### Proposed chain, if split

1. **Template undercount + sparse widening** (Phases 1–2, ~300) — two defects,
   no new feature. Independently valuable: it fixes the dataset declaring 20 of
   36 templates whether or not the crosscheck ever lands.
2. **Scanner + uncoverage** (Phases 3–4, ~730) — reading, no comparing. Nothing
   consumes it yet, so the output is unchanged and the slice is provably additive.
3. **Comparison + output + Phase 1 close** (Phases 5–7, ~970) — where the
   findings appear.

Slice 1 is the one worth landing first regardless: it is a live defect in the
published product, and it is a prerequisite for slice 3 not emitting seven false
positives.

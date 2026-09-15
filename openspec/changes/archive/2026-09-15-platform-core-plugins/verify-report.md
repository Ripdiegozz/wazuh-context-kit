```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:625aa1721df5c48c2275cd1a9f63d032fd0eb5bc9e4c335d141c7767c7e98b95
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 12/12
scenarios: 16/16
test_command: bun test
test_exit_code: 0
test_output_hash: sha256:8962b1e123a7a694ffd1cba64874cb323c6bfde73702e9af42dbef9c24d1a1f2
build_command: bun run build
build_exit_code: 0
build_output_hash: sha256:7e4117f7f930393af22b397be183587633ba05fcab520e7e06ddb2d1ed73a7b4
```

# Verify Report — `platform-core-plugins`

> Phase: `sdd-verify` · 2026-09-15 · run inline.
> This runtime refuses SDD child dispatch, so this is a full-context
> re-verification rather than a blind one. Stated up front because it is the
> single biggest limitation of this report: the same context that wrote the
> implementation checked it.

**Verdict: PASS WITH WARNINGS.** All 12 requirements and 16 scenarios carry
runtime evidence. Three warnings, none blocking.

## Evidence

| Command | Exit | Observed |
|---|---|---|
| `bun test` | 0 | 137 pass · 2 skip · 0 fail · 366 assertions · 12 files |
| `bun run typecheck` | 0 | clean |
| `bun run build` | 0 | `dist/cli.js` 0.96 MB |
| `node dist/cli.js --version` | 0 | `0.1.0` |
| `WAZUH_CTX_NETWORK=1 bun test` | 0 | 139 pass · 0 fail · 30.6 s |
| `rg 'node:fs\|child_process\|new Date()' src/matrix/ src/decisions/apply.ts` | — | no matches |

## Requirement coverage

### `repo-fetch` — 3 requirements, 4 scenarios

| Requirement | Covering test |
|---|---|
| Platform repos check out their core plugin tree | `sparse-disk.test.ts` — real git over `file://`, asserts `src/plugins/*/opensearch_dashboards.json` lands and `src/core/` does not |
| Sparse checkout limited to declared paths plus cone root files | `sparse-disk.test.ts` — both the indexer and platform cases assert no undeclared subtree |
| A repository contributing no facts is still reported | `core-section.test.ts` — `wazuh-indexer-security-analytics` in `resolvedRefs`, absent from `skipped[]`, while a genuine failure stays in `skipped[]` |

The git-ignored `plugins/` scenario is covered from the parse side, by
`core-plugins.test.ts` — a decoy manifest at `plugins/decoy/` is not read.

### `source-parse` — 4 requirements, 4 scenarios

| Requirement | Covering test |
|---|---|
| Parses without a sibling `package.json` | `core-plugins.test.ts` |
| Version from the repository root, recorded once | `core-plugins.test.ts` — also asserts no per-plugin `version` key |
| Manifest `version` is not a classification signal | `core-plugins.test.ts` — mixed `opensearchDashboards` / `1.0.0` inputs |
| Core facts carry dependency fields and evidence only | `core-section.test.ts` — asserts absence of `world`, `versionScheme`, `serverApiAccess` |

### `matrix-pipeline` — 5 requirements, 8 scenarios

| Requirement | Covering test |
|---|---|
| Core plugins occupy their own section | `core-section.test.ts` — separation, plus every pre-existing key unchanged |
| Unresolved plugin dependencies are reported | `core-section.test.ts` — 4 tests including the `navigation` case |
| Unknowns stay actionable | `core-section.test.ts` — 64 core plugins add exactly zero unknowns |
| The committed dataset matches a real run | `dataset-freshness.integration.test.ts`, opt-in |
| Rendered output stays readable at scale | `render-core.test.ts` — summary row, filtered `depended on`, omitted-when-empty |

## The change did what it exists to do

Regenerated from real repositories:

```
plugins       9        (was 5)
core plugins  64       (was 0)
unresolved    0        (was 46)
templates     20       (was 0)
wcs modules   39       (was 0)
resolvedRefs  9        (was 2)
```

`navigation`, required by all four wazuh-native plugins, resolves. Before this
change every dependency edge into the OpenSearch Dashboards core pointed at
nothing.

## Warnings

**1. One scenario is satisfied in substance but not in letter.** The
`matrix-pipeline` scenario "Committed dataset is a fixtures build" says the
check "fails and names the mismatching hashes". The guard does fail — it was
observed failing against the stale dataset with `Expected: 9, Received: 5` —
but it fails on shape parity before reaching the hash comparison, so the
message names counts rather than hashes. The scenario's intent (loud, specific
failure) is met; its wording is not. Either the guard should report both, or the
spec sentence should say "names the mismatch". Not worth blocking on; worth not
forgetting.

**2. The freshness guard is opt-in, so it guarantees nothing on its own.** It
only fails once somebody runs it with `WAZUH_CTX_NETWORK=1`. It makes a stale
dataset *detectable*, not *impossible*. Closing that loop means wiring it into
the SPEC 5.4 regeneration workflow, which is still unwritten
(`.github/workflows/` is empty). This is recorded in the guard's own module
docblock so the limitation travels with the code.

**3. This verification is not independent.** The runtime refuses SDD child
dispatch, so the context that implemented the change also verified it. Round 1
of the previous cycle showed what genuine independence catches — two uncovered
scenarios that the implementing context had believed were covered. A fresh
session re-reading these specs against this diff would be worth its cost.

## Process failures found during apply, already recorded

Both are in `apply-progress.md`. Repeated here because a verify report is where
someone looks for them.

1. **`tasks.md` omitted the `cli.ts` wiring.** Every unit passed while the real
   regeneration produced `core: []`. The breakdown decomposed by module and
   forgot the seam between modules.
2. **Task 3.3 contradicted design D5** by demanding byte-identical output from a
   change that necessarily alters `payloadHash`.

Neither reached the product. Both are decomposition defects worth carrying into
the next `sdd-tasks`.

## Task ledger

43 of 43 complete, including the 8.0 added during apply.

## Result contract

- **status:** `done`
- **next_recommended:** `sdd-archive`
- **risks:** the spec merge is destructive (the cone-mode requirement supersedes
  archived wording) and needs the `config.yaml` warning honoured; verification
  was not independent; the freshness guard is opt-in
- **skill_resolution:** `paths-injected`

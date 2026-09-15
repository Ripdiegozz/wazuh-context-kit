# Archive Report — `phase-1-real-data`

> Phase: `sdd-archive` · 2026-09-15
> Run inline by the orchestrator: this runtime refuses SDD child dispatch
> (Claude Code exposes no authenticated caller provenance, so a
> parent-confirmed preflight cannot be transported to a sub-agent).

## Final state at close

This report records the state at close, which is later than both
`apply-progress.md` and `verify-report.md` round 1.

| Dimension | State |
|---|---|
| Tasks | 53 / 53 complete |
| Requirements | 14 / 14, all with runtime evidence |
| Scenarios | 18 / 18, all with runtime evidence |
| Verify verdict | `pass_with_warnings`, 0 blockers, 0 critical findings |
| Native status before archive | `nextRecommended: archive`, `blockedReasons: []` |

### Observed verification at close

| Command | Exit | Observed |
|---|---|---|
| `bun test` | 0 | 104 pass · 1 skip · 0 fail · 281 assertions |
| `bun run typecheck` | 0 | clean |
| `bun run build` | 0 | `dist/cli.js` 0.95 MB, 184 modules |
| `node dist/cli.js --version` | 0 | `0.1.0` |
| `git diff --stat -- src/matrix src/decisions/apply.ts` | 0 | empty |
| `WAZUH_CTX_NETWORK=1 bun test src/fetch/network.integration.test.ts` | 0 | 1 pass · 5 assertions |

## What changed after `verify-report.md` round 1

Round 1 (2026-09-14) closed with two uncovered scenarios and a `CRITICAL` on
each of `repo-fetch` and `matrix-pipeline`. Batch 2 of `sdd-apply` (2026-09-15)
closed both, with no production code change:

- **`src/fetch/sparse-disk.test.ts`** (184 lines, task 12.1) — drives the
  production `cloneRepo()` with the real `createGitRunner()` against a
  throwaway `file://` origin, then walks the working tree. Closes
  `repo-fetch` → "Checked-out tree is sparse", which until then was compliant
  by inspection rather than by execution.
- **`src/cli.test.ts`** (216 lines, task 12.2) — spawns the CLI as a real
  process and covers `--fixtures` parity against a pinned `payloadHash`, the
  fatal exit-2 paths, and argument handling. Closes the last `matrix-pipeline`
  warning.

## Spec merge

`openspec/specs/` was empty before this archive, so the merge is purely
additive — no destructive delta, and `config.yaml`'s "warn before merging
destructive deltas" rule has nothing to warn about.

| Delta spec | Merged to |
|---|---|
| `specs/matrix-pipeline/spec.md` | `openspec/specs/matrix-pipeline/spec.md` |
| `specs/repo-fetch/spec.md` | `openspec/specs/repo-fetch/spec.md` |
| `specs/source-parse/spec.md` | `openspec/specs/source-parse/spec.md` |

These are now the source-of-truth domain specs for the project.

### One spec note carried forward

`repo-fetch` → "Sparse checkout limited to SPEC 1.2 paths" reads literally as
"only the SPEC 1.2 paths are present on disk". The on-disk test established
that `sparse-checkout init --cone` also materialises the repository's
top-level files, always. The requirement is satisfied in substance — no full
plugin source tree is ever checked out — but the merged spec text does not yet
say so. Worth a wording pass in a later change.

## Runtime attempt ledger at close

| Attempt | Work unit | Declared budget | Outcome |
|---|---|---|---|
| 1 | close outstanding coverage tasks 12.1 and 12.2 | 900 | `passed` → `complete` |
| 2 | final verification against specs | 600 | `passed` → `complete` |

Both settled cleanly. The budgets were declared from measurement rather than
estimate, which is the lesson `HANDOFF.md` recorded after the earlier cycle's
two budget blocks; neither attempt needed a maintainer reset.

The pre-existing "pending reset" that `HANDOFF.md` documented for the previous
cycle turned out to be moot on this machine: `gentle-ai sdd-attempt status`
reported an empty ledger (`attempts: []`, `lifetime_attempts: 0`,
`next_action: begin`). The ledger lives in the Git common directory, which is
machine-local and does not travel with a clone. The maintainer action recorded
in `HANDOFF.md` was never needed here.

## Carried forward — open human decisions, none blocking

These were warnings at verify and remain open. They are product decisions, not
defects, and none of them violates a merged spec.

1. **Does a `platform` repository belong in `plugins[]`?** `wazuh-dashboard`
   resolves a SHA but contributes no entry. The on-disk test now explains
   exactly why: an empty declared path set means only root files are checked
   out. `SPEC.md` 1.5.2 still needs a recorded ruling.
2. **`fixtures/facts.ts` disagrees with reality** on `wazuh`'s
   `indexerAccess` (`[]` in the fixture, `["osd-data"]` in the real manifest).
   Fix the fixture, or state in the file that it is shape-only.
3. **`wazuh-dashboard-reporting` vs `wazuh-dashboards-reporting`** — both have
   a `5.0.0` branch; `sources.yml` names the singular and flags it UNRESOLVED.
4. **Is `wazuh-indexer` worth adding?** (`SPEC.md` section 8, item 3.)
5. **The `asScoped` / `asInternalUser` page** — blocked on deciding which of
   the two identically-named APIs it governs.

## Next

Per `SPEC.md` section 7, the next build step is the Phase 1.5 inspector
(`wazuh-ctx serve`). Phase 3's MCP `schema` resource is what makes the dataset
consumable by an agent. `src/skills/`, `src/mcp/`, `ui/`, and
`.github/workflows/` are all still empty.

## Result contract

- **status:** `done`
- **next_recommended:** none — the SDD cycle for `phase-1-real-data` is closed
- **risks:** five open human decisions carried into `HANDOFF.md`; one merged
  spec sentence whose literal reading is narrower than observed git behaviour
- **skill_resolution:** `paths-injected`

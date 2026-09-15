# Archive Report — `platform-core-plugins`

> Phase: `sdd-archive` · 2026-09-15 · run inline (this runtime refuses SDD child dispatch)

## Final state at close

| Dimension | State |
|---|---|
| Tasks | 43 / 43 complete |
| Requirements | 12 / 12 with runtime evidence |
| Scenarios | 16 / 16 with runtime evidence |
| Verify verdict | `pass_with_warnings`, 0 blockers, 0 critical findings |
| Native status before archive | `nextRecommended: archive`, `blockedReasons: []` |

| Command | Exit | Observed |
|---|---|---|
| `bun test` | 0 | 137 pass · 2 skip · 0 fail · 366 assertions |
| `bun run typecheck` | 0 | clean |
| `bun run build` | 0 | `dist/cli.js` 0.96 MB, `--version` → `0.1.0` |
| `WAZUH_CTX_NETWORK=1 bun test` | 0 | 139 pass · 0 fail · 30.6 s |
| purity seam grep over `src/matrix/` | — | no I/O, test files included |

## What shipped

```
                      before       after
plugins                  5            9
core plugins             0           64   (1 platform repo)
unresolved edges        46            0
index templates          0           20
WCS modules              0           39
resolved SHAs            2            9
payloadHash        1f9274f5…    5ef7718c…
```

The committed `out/5.0.0` had been the `--fixtures` build. It is now a real run.
Every wazuh-native dependency edge into the OpenSearch Dashboards core resolves;
`navigation`, required by all four, exists in the dataset for the first time.

## Spec merge — ONE DESTRUCTIVE DELTA, warned per `config.yaml`

The archive rule in `openspec/config.yaml` says "Warn before merging destructive
deltas". This merge contained exactly one, and it was surfaced to the maintainer
before merging.

**Superseded:** `repo-fetch` → "Sparse checkout limited to SPEC 1.2 paths" was
**replaced** by "Sparse checkout limited to declared paths, plus cone-mode root
files". The old wording claimed only the declared paths are present on disk,
which is narrower than git's actual behaviour — cone mode always materialises
top-level files. The narrowness was only ever discoverable by walking a real
checkout, which is why it survived a full cycle. The superseded text remains in
`openspec/changes/archive/2026-09-15-phase-1-real-data/specs/repo-fetch/spec.md`,
and the replacement carries a note pointing there.

Everything else was additive.

| Capability | Before | Added | Superseded | After |
|---|---|---|---|---|
| `repo-fetch` | 4 | 3 | 1 | 6 |
| `source-parse` | 6 | 4 | 0 | 10 |
| `matrix-pipeline` | 4 | 5 | 0 | 9 |
| **Total** | **14** | **12** | **1** | **25 requirements, 33 scenarios** |

## Runtime attempt ledger at close

| Attempt | Work unit | Declared budget | Real | Outcome |
|---|---|---|---|---|
| 1 | implement core plugin surfacing and dataset repair | 5000 | 1312 authored + 2001 generated | `passed` → `complete` |
| 2 | final verification | 800 | — | `passed` → `complete` |

Both settled without a maintainer reset. Declaring generously worked; the
previous cycle's lesson held.

## Carried forward

**Warnings from verify, none blocking:**

1. A `matrix-pipeline` scenario says the freshness check "names the mismatching
   hashes". It fails on shape parity first, so it names counts. Intent met,
   wording not. Fix one or the other.
2. The freshness guard is opt-in, so it makes a stale dataset *detectable*, not
   *impossible*. Closing the loop needs the SPEC 5.4 regeneration workflow,
   still unwritten — `.github/workflows/` is empty.
3. Verification was not independent: this runtime refuses SDD child dispatch, so
   the context that implemented the change also verified it.

**Process failures worth carrying into the next `sdd-tasks`:**

1. The task breakdown omitted "wire `coreRepos` through `cli.ts`". Every unit
   test passed while the first real regeneration produced `core: []`. Decomposing
   by module and forgetting the seam between modules is a repeatable failure,
   not a one-off slip.
2. Task 3.3 demanded output "byte-identical to before" from a change that design
   D5 said would necessarily move `payloadHash`. The task list contradicted the
   design it was written from.
3. The apply came in at 1312 authored lines against a 1000 forecast — 31% over,
   concentrated in tests. Better than the previous cycle's 2x, still short.

**Open decisions still with a human:**

- SPEC section 8 item 2 — `wazuh/wazuh` in Phase 1.
- SPEC section 8 item 5 — regeneration cadence and who besides Diego can merge
  the regeneration PR. Bus factor of one.
- The `asCurrentUser` collision page. Scope is now decided (both pairs, organised
  around the shared downstream name, with `executor.ts` as the witness case) and
  recorded in SPEC section 8 item 4. It needs a human author and an owner, and
  ships as its own change.

Closed by this cycle: SPEC section 8 items 1 and 3, and the former HANDOFF P2
items 1, 2, and 3.

## Next

`.github/workflows/` (SPEC 5.4 regeneration), then the Phase 1.5 inspector
(`wazuh-ctx serve`) per SPEC section 7. `src/skills/`, `src/mcp/`, and `ui/`
remain empty.

## Result contract

- **status:** `done`
- **next_recommended:** none — the cycle for `platform-core-plugins` is closed
- **risks:** one superseded spec requirement (warned and recorded); an opt-in
  freshness guard that no workflow runs yet; a non-independent verification
- **skill_resolution:** `paths-injected`

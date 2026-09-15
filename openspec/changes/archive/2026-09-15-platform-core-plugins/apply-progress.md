# Apply Progress — `platform-core-plugins`

> Phase: `sdd-apply` · 2026-09-15 · run inline (this runtime refuses SDD child dispatch)
> Strict TDD active. Every implementation task was preceded by a test observed
> failing for the right reason.

All 42 tasks complete, plus one that was missing from the list (8.0, below).

## Observed verification

| Command | Observed result |
|---|---|
| `bun test` | 137 pass · 2 skip · 0 fail · 366 assertions · 12 files |
| `bun run typecheck` | clean |
| `bun run build` | `dist/cli.js` 0.96 MB |
| `node dist/cli.js --version` | `0.1.0` |
| `rg node:fs\|child_process\|new Date() src/matrix/ src/decisions/apply.ts` | no matches — seam holds, test files included |
| `WAZUH_CTX_NETWORK=1 bun test` | 139 pass · 0 fail · 376 assertions · 30.6 s |
| cold regeneration | 32 s (was 30 s before `src/plugins`) |
| warm regeneration | 1 s |
| `.cache/` size | 245 MB |

Baseline entering this change was 104 pass · 1 skip · 0 fail.

## The regenerated dataset

```
plugins       9
core plugins  64 from 1 platform repo(s)
unresolved    0 dependency edge(s)
unknowns      3
skipped       1   (wazuh-dashboard-ml-commons, no 5.0.0 branch, by discovery)
templates     20
wcs modules   39
resolvedRefs  9
payloadHash   sha256:5ef7718c…
```

Before this change the same command produced 5 plugins, 0 templates, 0 WCS
modules and 2 resolved SHAs, because the committed dataset was the `--fixtures`
build. **46 dependency edges pointed at nothing; now 0 do.**

17 of the 64 core plugins are actually depended on, and those are the ones
`MATRIX.md` lists — `navigation`, `data`, `dashboard`, `discover`,
`opensearchDashboardsUtils`, and twelve more.

## Two corrections to `tasks.md`

**Task 3.3 was wrong as written.** It asked for output "byte-identical to before
this change". That contradicts design D5, which says plainly that `payloadHash`
changes because the payload gained content. Byte-identical was never achievable
and the task should never have said so. What was implemented and tested is the
property that actually matters: adding core input leaves `plugins[]`,
`unknowns[]`, `skipped[]`, `resolvedRefs`, `reconciliation`, and `indexer`
untouched.

**A task was missing entirely — 8.0.** Nothing in the list said "wire
`coreRepos` through `cli.ts`". Every unit test passed, and the first real
regeneration still produced `core: []`, because every unit was correct and only
the composition point was not. The task list decomposed the work by module and
forgot the seam between them. Recorded because that is a decomposition failure
mode, not a typo.

## Design deviations, recorded deliberately

**`MatrixPlugin` gained `requiredBundles`.** D4 originally checked
`requiredBundles` only on core plugins, because `MatrixPlugin` did not carry the
field. That left a wazuh-native bundle edge silently unchecked — exactly the
class of hole this change exists to close. The field was added and the resolver
now checks both sections symmetrically.

**The freshness guard lives at `src/`, not `src/matrix/`.** It spans fetch,
parse, and matrix, and it imports `node:fs`. `src/matrix/` is the pure core, and
the value of that rule is being able to grep the directory for I/O and get
nothing — test files included. Moving it keeps that property literally true.

## Findings worth carrying

1. **The `--fixtures` hash pin did its job.** Adding `core` and
   `unresolvedDependencies` to the payload moved the fixtures hash, the pinned
   test failed, and the pin was updated deliberately in the same change. The old
   value is kept in a comment so a reviewer can see exactly what moved it. That
   is the behaviour the pin was introduced for last cycle.

2. **The freshness guard caught the real defect before it was fixed.** Run
   against the stale committed dataset it failed with `Expected: 9, Received: 5`
   — the defect reported by the maintainer, reproduced by a command. It would
   also have caught the missing `cli.ts` wiring, because it builds its expected
   value directly rather than through the CLI.

3. **That guard nearly shipped lying.** Its first version compared
   `resolvedRefs` by `JSON.stringify` on both sides. Key insertion order differs
   between the committed file and a fresh build, so the comparison was false
   even when the commits were identical, and the strongest assertion — hash
   parity — was skipped on every run while the test still reported success. The
   tell was a log line reading `upstream moved for ` with an empty list. A guard
   that always takes its weak path is worse than no guard, because it also
   creates confidence.

4. **Cone mode brought `src/plugins` for 2 seconds.** Cold clone went from 30 s
   to 32 s and `.cache/` to 245 MB. The 9,191-file checkout that cone
   granularity forces is real but cheap, and this number is measured rather than
   forecast.

5. **Tests outnumber production code 2.4 to 1 here.** 805 authored test lines
   against 334 production lines. That is what strict TDD costs on a change whose
   entire value is a data-shape claim, and it is the right ratio for one.

## Size, measured

| Category | Lines |
|---|---|
| Code, tests, config — the apply itself | +1282 −30 = **1312** |
| SDD planning artifacts, written before apply | +994 |
| Regenerated `out/5.0.0` (generated, excluded from review budget) | +1962 −39 = 2001 |

The forecast for the apply was ~1000 authored lines; the real figure is 1312,
31% over. Better than the previous cycle's 2x miss, still not good enough. The
under-estimate is concentrated in the test files, which is where it always is.

`size:exception` was accepted by the maintainer on 2026-09-15, against a
recommendation to split into three chained PRs.

## Status

Ready for `sdd-verify`.

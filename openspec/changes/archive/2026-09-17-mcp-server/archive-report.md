# Archive report — `mcp-server`

Closed 2026-09-17. Merged as PR #25 (`5308f60`). **The SPEC is complete: 61 of
61 criteria, all seven subcommands, no stubs.**

The change was scoped as Phase 3 and grew to include Phase 1.5 at the
maintainer's request mid-flight, so it closed the last two open phases at once.

## What closed

| Phase | Criteria | Was |
| --- | --- | --- |
| Phase 3 — MCP server | 12 | 11 open, plus one added by this change |
| Phase 1.5 — inspector | 5 | 5 open |

Phase 3's twelfth criterion did not exist when the change started. It was added
because the research found the version map pointing at a 404 and nobody noticing
for three days, so "validate the map against reality" became a contract term
rather than a good intention.

## Four defects found in existing code

None of these were the assignment. All four were found by building on top of the
code and noticing it did not hold.

1. **`sources.yml` mapped `"5.0.0": "5.0"`, which 404s.** Latent only because
   `sourcesFileSchema` tolerated and ignored the block. This change is what
   would have activated it.
2. **`buildCrosscheck` discarded the graph it computed** — it ran the join and
   persisted only the leftovers, so a graph drawn from `crosscheck.json` had
   zero edges. Nothing had consumed the crosscheck as a graph before, so nothing
   could have noticed.
3. **A local override could reach a committed dataset untraced.**
   `loadHumanLayers` computed `localOverrides` and dropped it while `runMatrix`
   merged the local layer into the file it writes. The loader's own comment
   stated the rule it did not enforce.
4. **The inspector read through its write endpoint**, which could persist a
   short array and delete rows it never displayed.

## Two things deliberately not derived

The documentation version map and the repository URL. Both looked derivable and
neither is: the first because the docs site publishes on its own cadence with its
own naming, the second because an org prefix is a convention nobody versioned.
Both are now explicit, and the first is validated rather than trusted.

## Verification at close

```
bun test              529 pass, 4 skip, 0 fail   (58 files)
bun run typecheck     clean
bun run build         succeeds
ui: tsc / build       clean, succeeds
WAZUH_CTX_NETWORK=1   canary passes against the live docs site
wazuh-ctx serve       boots; /api/crosscheck → 571 nodes, 818 edges
```

Phase 3 was checked by an independent reviewer that did not write the code,
verifying each criterion had a test that would actually fail on regression. One
soft spot it accepted on structural grounds was fixed anyway: the
announce-ordering test simulated its own "first query" and now issues a real
protocol round-trip.

## What is honestly not covered

`ui/` has no test runner. Criterion 1.5.3's rendering half is **manual**
verification, and SPEC 1.5.3 says so beside the tick rather than letting a
checked box imply otherwise. Closing that properly means Vitest + Testing Library
in `ui/`, and it is the clearest next piece of work.

## Follow-ups recorded, not done

- Wire `--validate-docs-map` into `regenerate.yml`. The alarm exists; nothing
  runs it on a schedule, and an alarm nobody listens to is decoration.
- `"5.0.0": "5.0-beta"` moves when 5.0 goes GA. The validator is what catches
  that day.
- Test coverage for `ui/`.

## Read-only rule

Held. Production code invokes `ls-remote`, `rev-parse`, `symbolic-ref`, `config`,
`clone`, `fetch` — reads only. No issue, PR, or commit was created in any
`wazuh/*` repository. `CLAUDE.md` now records that the boundary is what git is
pointed at, not which verb is used.

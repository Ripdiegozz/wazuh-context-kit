# Handoff — what is done, what is left

> Written 2026-09-15, replacing the 2026-09-14 version.
> Updated later the same day, after `platform-core-plugins` closed.
> Updated 2026-09-17, after Phase 2 and Phase 3 both closed.
> The authoritative contract is [`SPEC.md`](SPEC.md). This file only says where
> the work stopped.

## Where it stands

**Phases 1, 2 and 3 are complete and closed. Only the Phase 1.5 inspector is
left.** As of 2026-09-17: **56 of 61 acceptance criteria** are met, and six of
the seven subcommands work — `matrix`, `crosscheck`, `skills-diff`, `sync`,
`check` and `mcp`. `serve` is the only surviving `notImplemented`, and it
survives by the deliberate ordering decision in SPEC section 7, not by neglect.

The five open criteria are all Phase 1.5.

**Phase 1 is complete and closed.** As of 2026-09-15 that is finally true: the
crosscheck of SPEC 1.8 exists, and `wazuh-ctx crosscheck` no longer returns
`notImplemented`.

> An earlier version of this file claimed Phase 1 was complete while 1.8 — a
> Phase 1 section, and the one SPEC calls "el valor diferencial de la fase" —
> had never been built. The claim was mine and it was wrong for weeks.

The OpenSearch Dashboards core is visible to the matrix, and the crosscheck
answers the question no single repository can.

```
wazuh-ctx matrix --ref 5.0.0

9 plugins · 64 core plugins · 0 unresolved edges
40 index templates · 39 WCS modules · 1 repository skipped · 9 resolved SHAs

wazuh-ctx crosscheck --ref 5.0.0

61 index names recovered across 6 repos
5 declared and never referenced · 3 referenced and never declared
5 WCS modules with no consumer · 2 competing catalogs
87 mechanisms the scan cannot see
cold run 32s (clones) → warm run 1s (cache, no network)
payloadHash and MATRIX.md byte-identical across runs
```

Until 2026-09-15 the committed `out/5.0.0` was the `--fixtures` build — 5
plugins, 0 templates, 0 WCS modules — while its commit message described the
real one. Nothing caught it, because no test compared the committed product
against a real run. There is now an opt-in guard that does
(`src/dataset-freshness.integration.test.ts`).

| Layer | State |
|---|---|
| `src/matrix/` | pure core — classification, hashing, render. Done. |
| `src/decisions/` | layers 2 and 3, precedence and reconciliation. Done. |
| `src/fetch/` | blobless sparse clone, cache, `ls-remote` precheck. Done. |
| `src/parse/` | manifests, `package.json`, index templates, WCS. Done. |
| `src/sources.ts` | `sources.yml` loader. Done. |
| `src/cli.ts` | real pipeline wired; both hardcodes gone. Done. |
| core plugin surfacing | `src/parse/core-plugins.ts` + the `core` section. Done. |
| `src/skills/` | Phase 2 — three-band diff, extract, core. Done. |
| `src/settings/`, `src/standards/` | Phase 2 — settings merge, `sync` / `check`. Done. |
| `src/mcp/` | Phase 3 — `docs`, `schema`, `runtime`, world detection, telemetry. Done. |
| `ui/` | Phase 1.5 inspector — **empty**, and the only thing left |
| `src/crosscheck/` | SPEC 1.8, the index crosscheck. Done. |
| `.github/workflows/` | `ci.yml` + `regenerate.yml` (SPEC 5.4). Done, see below. |

## Getting running on a new machine

```bash
git clone https://github.com/Ripdiegozz/wazuh-context-kit.git
cd wazuh-context-kit
bun install                               # required — nothing runs without it
bun test                                  # expect 137 pass · 2 skip · 0 fail
bun run ./src/cli.ts matrix --ref 5.0.0   # first run clones, ~30s
```

Needs **Bun 1.4.0+**, git on PATH, and network access to github.com. The shipped
CLI targets Node ≥ 22 (`bun run build` → `dist/cli.js`); Bun is a development
requirement only, never a consumer one.

`.cache/` and `decisions.local.yml` are gitignored. `out/` is **not** — the
dataset is the product and is committed (SPEC 5.1).

## Verified on 2026-09-15 (after `platform-core-plugins`)

```
bun test                                  137 pass · 2 skip · 0 fail · 366 assertions
bun run typecheck                         clean
bun run build && node dist/cli.js -v      0.1.0
WAZUH_CTX_NETWORK=1 bun test              139 pass · 0 fail · 30.6 s
rg 'node:fs|new Date()' src/matrix/       no matches  (purity seam holds)
```

All nine SPEC 1.9 acceptance criteria pass against real data, including
`wazuh-dashboard-ml-commons` reaching `skipped[]` **by discovery** rather than by
a hardcode.

## Test coverage map

| Suite | What it proves |
|---|---|
| `src/matrix/matrix.test.ts` | pure core: classification, hashing, render |
| `src/decisions/decisions.test.ts` | layers 2 and 3, precedence, reconciliation |
| `src/parse/parse.test.ts` | manifests, `package.json`, templates, WCS |
| `src/sources.test.ts` | `sources.yml` loading and schema failures |
| `src/fetch/fetch.test.ts` | fetch orchestration and git **argv intent**, via a fake runner |
| `src/fetch/sparse-disk.test.ts` | what the sparse checkout actually puts **on disk**, via real git over `file://` |
| `src/parse/core-plugins.test.ts` | OSD core manifest parsing, incl. the git-ignored `plugins/` decoy |
| `src/matrix/core-section.test.ts` | the `core` section and the unresolved-dependency resolver |
| `src/matrix/render-core.test.ts` | core summary rendering and omitted-when-empty sections |
| `src/dataset-freshness.integration.test.ts` | committed `out/` vs a real run — **opt-in only** |
| `src/cli.test.ts` | CLI contract: `--fixtures` parity, fatal exit codes, argument handling |
| `src/fetch/network.integration.test.ts` | real github.com — **opt-in only**, `WAZUH_CTX_NETWORK=1` |

Only the last two touch the network. The default `bun test` run is hermetic.

---

# What is left

## No P0 and no P1

Both former gaps are closed. The sparse-checkout scenario has runtime evidence
(`src/fetch/sparse-disk.test.ts`), and CLI-level regression coverage exists
(`src/cli.test.ts`). The SDD change `phase-1-real-data` is archived at
`openspec/changes/archive/2026-09-15-phase-1-real-data/`, and its three delta
specs are merged into `openspec/specs/` as the source of truth.

## P2 — closed

All five are now decided. Three closed earlier on 2026-09-15 with
`platform-core-plugins`; the remaining two closed with `close-p2`.

1. ~~Does a `platform` repository belong in `plugins[]`?~~ — No. Own `core`
   section. 64 core plugins surface, 0 unresolved edges.
2. ~~`fixtures/facts.ts` drift~~ — Never drift. Shape-only by construction, and
   the file says so.
3. ~~`wazuh-dashboard-reporting` vs `wazuh-dashboards-reporting`~~ — Mirrors,
   identical SHA at `5.0.0`.
4. ~~`wazuh-indexer`~~ — No `5.0.0` branch, only `main`.
5. ~~`wazuh/wazuh` in Phase 1~~ — **Stays out, now on evidence rather than
   theory.** At `origin/5.0.0` it has zero `templates/states` paths, zero
   `fields.csv`, zero `wcs/`. Its only `index_patterns` JSON are 12 QA test
   fixtures, and the one with real content duplicates a template
   `wazuh-indexer-plugins` already provides at higher fidelity. Cost would be
   6,804 files / ~160 MB against 1,078 / ~13 MB — six times the files for
   nothing new.

   Worth not losing: it *does* hold declarative surface nothing else has —
   `api/api/spec/spec.yaml` (Server API OpenAPI, ~9,700 lines) and the default
   RBAC YAML under `framework/wazuh/rbac/default/`. Neither is index nor WCS, so
   the Phase 1 answer is unchanged, but if this repo ever enters it enters
   through those, not through templates.
6. ~~Regeneration cadence and the bus factor~~ — Daily cron with `ls-remote`
   precheck, and auto-merge **gated on reconciliation conflicts**. See below.
7. **The `asCurrentUser` page** — drafted at [`docs/as-current-user.md`](docs/as-current-user.md).
   Scope settled (both pairs, organised around the shared downstream name, with
   `wazuh-ai-assistant/server/tools/executor.ts` as the witness). Every file:line
   reference in it was verified against the real checkouts.

   **It still has no owner, and that is the one thing left open.** It also needs
   a review of its "legitimate `asInternalUser`" list, which was derived from
   reading call sites rather than from a policy anyone agreed to — some current
   uses may be wrong and the page currently treats them as precedent.

## The regeneration loop, and where it stops

`.github/workflows/` is no longer empty.

- `ci.yml` — hermetic. Tests, typecheck, build, and a `dist/cli.js --version`
  smoke check on every PR and push to `master`. Job name `CI`, which is what a
  branch protection rule references.
- `regenerate.yml` — SPEC 5.4. Daily `ls-remote` precheck across all 10 repos
  with no clone; stops there on the usual day when nothing moved. If something
  moved: regenerate, and only if `out/` actually changed, run
  `WAZUH_CTX_NETWORK=1 bun test` against the regenerated tree before proposing
  anything.

**Auto-merge is gated on reconciliation conflicts, not on CI alone.** Zero
conflicts and the PR merges itself. One or more and it waits, labelled
`needs-human-review`. SPEC 5.4 calls that cross-check the most valuable signal
the system emits and requires explicit human review for it — and no test fails
on one, so gating on green CI would have merged it unread. SPEC 5.4's "Dueño"
paragraph is amended to record this.

### Two things a person still has to do in the GitHub UI

No YAML can set these, and without them the loop is not closed:

1. **Settings → General → Allow auto-merge.** Without it the merge call errors
   and the PR simply sits there.
2. **Branch protection on `master` requiring the `CI` check.** This is the
   actual gate. Without a *required* check, `--auto` merges immediately and the
   gate is decorative.

Create a `needs-human-review` label too, or the labelling step logs a warning
and the PR is left unmerged — still the right outcome, just quieter.

## What the running indexer taught us, and what it costs

The dashboard team's dev stack (`os-dev-360`) has a real indexer on 9200. Every
number below was checked against it, and checking changed the tool four times.

**The repository is not the territory.** It declares `wazuh-findings-v5*`; the
running indexer holds sixteen per-category templates expanded from it. It
declares `wazuh-cve*`, which is not installed at all. A crosscheck comparing two
repositories can be perfectly implemented and still say false things, because it
compares two maps and neither is the ground.

**A string's shape proves nothing.** This organisation prefixes everything with
`wazuh-`: packages, hosts, repositories, environments, test fixtures. Accepting
every `wazuh-` literal produced 77 distinct names of which **zero existed**. The
second signal has to be context — an `index:` key, a comparison against
`.index`, an enclosing map named `*_INDEX` — not the value.

**A test fixture is not a consumer.** Three of six surviving findings came only
from tests; one was called `wazuh-does-not-matter*`.

**And the first scanner was blind to half the code.** It only recognised
`export const X_PATTERN = '...'`, a convention that holds in one file of one
plugin. The threat-intel indices live in an object map and in inline
comparisons, so six live indices — with data, under security analytics — were
reported as having no consumer.

### The obvious next step

`wazuh-ctx crosscheck --indexer <url>`, optional. The dataset must stay
generatable without it (CI has no stack, and `out/` must be deterministic), but
a developer with the stack up gets a third column: **declared / referenced /
actually exists**. Then "declared and never referenced" becomes verifiable
rather than inferred. Scoped as its own change, with today's evidence in it.

## Known limits of what shipped

- **The freshness guard runs, but only inside the regeneration job.** It is
  still opt-in for a human (`WAZUH_CTX_NETWORK=1`), and `ci.yml` is hermetic on
  purpose, so a hand-written commit that staled `out/` would not be caught by
  CI on its own PR. It would be caught by the next daily regeneration run. That
  is better than nothing running it, and short of a closed loop.
- **One spec scenario and its implementation disagree slightly.** The
  `matrix-pipeline` scenario says the guard "names the mismatching hashes"; it
  fails on shape parity first, so it names counts. Fix the guard or the sentence.
- **The last verification was not independent.** This runtime refuses SDD child
  dispatch, so the context that implemented `platform-core-plugins` also
  verified it. A fresh session re-reading `openspec/specs/` against the diff
  would be worth its cost.

## Then: what comes after Phase 3

The **Phase 1.5 inspector** (`wazuh-ctx serve`), and nothing else — a read-only
viewer over `matrix.json` plus an editor for `decisions.yml` and
`annotations.yml`. The crosscheck view is where it earns its keep: that data is a
bipartite graph and markdown renders it badly.

It was deferred from step 2 to last on 2026-09-16, on the argument that an
inspector built then would show 9 plugins and 3 unknowns while one built after
Phases 2 and 3 would also show the standards package, the three-band diff's
conflicts, and the MCP surface. That bet is now settled and it paid: the deferral
risk was that hand-editing `decisions.yml` would become unbearable before the
inspector existed, measured by the unknown count. It did not move — still **3
unknowns and 0 conflicts**.

So the inspector now gets designed once, against the complete domain, instead of
against a third of it.

---

# Notes for the next session

## The runtime attempt ledger is machine-local

The previous handoff recorded a pending maintainer reset for attempt 2 of the
earlier cycle. On a fresh machine that turned out to be moot:
`gentle-ai sdd-attempt status` reported an empty ledger (`attempts: []`,
`lifetime_attempts: 0`, `next_action: begin`). **The ledger lives in the Git
common directory, which does not travel with a clone.** Attempt history is
per-machine, so a "pending maintainer action" recorded in a doc may simply not
exist where you are reading it. Check `status` before acting on one.

Both attempts in the 2026-09-15 cycle settled cleanly, because their budgets
were declared from measurement rather than estimate. That is the lesson the
previous cycle paid for twice: **declare generously; the budget is a promise,
and a broken one costs a maintainer round-trip every time.**

## Two findings from writing the tests

1. **Cone mode always checks out root files.** See P3 above. An argv-level test
   could never have shown this — it took walking a real directory.

2. **`PATH=""` does not hide a binary.** An empty or unset `PATH` makes libc
   fall back to a built-in default (`/bin:/usr/bin`), where git usually lives.
   The first draft of the "git missing from PATH" test therefore found git,
   exited 0 instead of 2, and spent 11 seconds on the network inside what was
   meant to be an offline unit test. Pointing `PATH` at a real, empty directory
   is what actually makes the lookup fail with ENOENT; the suite then runs in
   449 ms. **The 24x runtime drop was the signal that the test had been lying.**
   A passing assertion is not the same as a correct one.

## Tooling

- **SDD child dispatch is refused in Claude Code.** Launching an `sdd-apply` or
  `sdd-verify` sub-agent fails with "Claude Code hooks do not expose
  authenticated caller provenance". The phases run inline in the orchestrator
  thread instead. That is a runtime limitation, not a project problem, but it
  does mean a "fresh eyes" verify has to come from a separate session.
- **Engram now resolves this repo correctly** as `wazuh-context-kit` via its git
  remote. The earlier scratch-project problem is gone. The `openspec/` files are
  still authoritative; treat Engram as an index over them.

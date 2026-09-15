# Handoff — what is done, what is left

> Written 2026-09-15, replacing the 2026-09-14 version.
> The authoritative contract is [`SPEC.md`](SPEC.md). This file only says where
> the work stopped.

## Where it stands

**Phase 1 is complete and closed.** It runs against the real Wazuh
repositories, not fixtures, and every requirement now carries runtime evidence.

```
wazuh-ctx matrix --ref 5.0.0

9 plugins · 20 index templates · 39 WCS modules · 1 repository skipped · 8 resolved SHAs
cold run 30s (clones) → warm run 1.4s (cache, no network)
payloadHash and MATRIX.md byte-identical across runs
```

| Layer | State |
|---|---|
| `src/matrix/` | pure core — classification, hashing, render. Done. |
| `src/decisions/` | layers 2 and 3, precedence and reconciliation. Done. |
| `src/fetch/` | blobless sparse clone, cache, `ls-remote` precheck. Done. |
| `src/parse/` | manifests, `package.json`, index templates, WCS. Done. |
| `src/sources.ts` | `sources.yml` loader. Done. |
| `src/cli.ts` | real pipeline wired; both hardcodes gone. Done. |
| `src/skills/` | Phase 2 — **empty** |
| `src/mcp/` | Phase 3 — **empty** |
| `ui/` | Phase 1.5 inspector — **empty** |
| `.github/workflows/` | regeneration workflow (SPEC 5.4) — **empty** |

## Getting running on a new machine

```bash
git clone https://github.com/Ripdiegozz/wazuh-context-kit.git
cd wazuh-context-kit
bun install                               # required — nothing runs without it
bun test                                  # expect 104 pass · 1 skip · 0 fail
bun run ./src/cli.ts matrix --ref 5.0.0   # first run clones, ~30s
```

Needs **Bun 1.4.0+**, git on PATH, and network access to github.com. The shipped
CLI targets Node ≥ 22 (`bun run build` → `dist/cli.js`); Bun is a development
requirement only, never a consumer one.

`.cache/` and `decisions.local.yml` are gitignored. `out/` is **not** — the
dataset is the product and is committed (SPEC 5.1).

## Verified on 2026-09-15

```
bun test                                  104 pass · 1 skip · 0 fail · 281 assertions
bun run typecheck                         clean
bun run build && node dist/cli.js -v      0.1.0
WAZUH_CTX_NETWORK=1 bun test …integration  1 pass · 5 assertions
git diff -- src/matrix src/decisions/apply.ts    empty   (purity seam holds)
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
| `src/cli.test.ts` | CLI contract: `--fixtures` parity, fatal exit codes, argument handling |
| `src/fetch/network.integration.test.ts` | real github.com — **opt-in only**, `WAZUH_CTX_NETWORK=1` |

Only the last one touches the network. The default `bun test` run is hermetic.

---

# What is left

## No P0 and no P1

Both former gaps are closed. The sparse-checkout scenario has runtime evidence
(`src/fetch/sparse-disk.test.ts`), and CLI-level regression coverage exists
(`src/cli.test.ts`). The SDD change `phase-1-real-data` is archived at
`openspec/changes/archive/2026-09-15-phase-1-real-data/`, and its three delta
specs are merged into `openspec/specs/` as the source of truth.

## P2 — decisions that need a human, not code

These block nothing, but every one of them is a silent wrong answer waiting to
happen.

1. **Does a `platform` repository belong in `plugins[]`?**
   `wazuh-dashboard` resolves a SHA and appears in `resolvedRefs`, but
   contributes no entry. The on-disk test now explains exactly why:
   `sparsePathsFor("platform")` returns `[]`, and with an empty declared path
   set a cone-mode checkout lands **root files only** — nothing below the root
   ever appears, so there is no manifest to parse. `SPEC.md` 1.5.2 defines
   `world: "platform"` as a classification, which implies it should surface
   somewhere. Decide, then record it.

2. **Reconcile `fixtures/facts.ts` with reality.**
   It asserts `indexerAccess: []` for `wazuh`; the real manifest declares
   `data`, so the truth is `["osd-data"]`. No test hardcodes the wrong value, so
   nothing is broken — but a fixture that disagrees with reality is evidence
   about the fixture. Either fix it or state in the file that it is shape-only.

3. **`wazuh-dashboard-reporting` vs `wazuh-dashboards-reporting`.**
   Both have a `5.0.0` branch. `sources.yml` currently names the singular form
   and flags it UNRESOLVED. Open since the first draft (SPEC section 8, item 1).

4. **Is `wazuh-indexer` worth adding?** SPEC section 8, item 3.

5. **The `asScoped` / `asInternalUser` page.** SPEC section 8, item 4 — the
   highest-return prose in the project, still unwritten. It cannot be written
   until someone decides *which* of the two identically-named APIs it governs:
   OSD's `core.opensearch.client` (indexer RBAC) or `wazuh-core`'s `api.client`
   (Server API RBAC).

## P3 — a spec wording pass

`openspec/specs/repo-fetch/spec.md` says the checked-out tree contains "only
the SPEC 1.2 paths". Read literally that is narrower than what git does:
`sparse-checkout init --cone` **always** materialises the repository's
top-level files in addition to the directories passed to `sparse-checkout set`.
The requirement is satisfied in substance — no full plugin source tree is ever
checked out — and the test encodes the real boundary. The spec sentence should
be widened to match in a later change.

## Then: what comes after Phase 1

Per SPEC section 7, the next build step is the **Phase 1.5 inspector**
(`wazuh-ctx serve`) — a read-only viewer over `matrix.json` plus an editor for
`decisions.yml` and `annotations.yml`. The crosscheck view is where it earns its
keep: that data is a bipartite graph and markdown renders it badly.

Phase 3's MCP `schema` resource is what actually makes the dataset consumable by
an agent. Phase 2 (skills) and the rest of Phase 3 (`docs`, `runtime`) are not on
the critical path for a usable v1.

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

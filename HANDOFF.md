# Handoff — what is done, what is left

> Written 2026-09-14 to continue on a different machine.
> Everything here is committed and pushed to `origin/master`.
> The authoritative contract is [`SPEC.md`](SPEC.md). This file only says where
> the work stopped.

## Where it stands

**Phase 1 runs against the real Wazuh repositories.** Not fixtures.

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
bun install
bun test                                  # expect 94 pass · 1 skip · 0 fail
bun run ./src/cli.ts matrix --ref 5.0.0   # first run clones, ~30s
```

Needs **Bun 1.4.0+**, git on PATH, and network access to github.com. The shipped
CLI targets Node ≥ 22 (`bun run build` → `dist/cli.js`); Bun is a development
requirement only, never a consumer one.

`.cache/` and `decisions.local.yml` are gitignored. `out/` is **not** — the
dataset is the product and is committed (SPEC 5.1).

## Verified on 2026-09-14

```
bun test                                  94 pass · 1 skip · 0 fail
bun run typecheck                         clean
WAZUH_CTX_NETWORK=1 bun test …integration 1 pass
bun run build && node dist/cli.js -v      0.1.0
git diff -- src/matrix src/decisions/apply.ts    empty   (purity seam holds)
--fixtures output vs pre-change baseline  byte-identical
```

All nine SPEC 1.9 acceptance criteria pass against real data, including
`wazuh-dashboard-ml-commons` reaching `skipped[]` **by discovery** rather than by
a hardcode.

---

# What is left

## P0 — the one real gap

**The sparse-checkout scenario has no runtime evidence.** `repo-fetch/spec.md`
requires that a checked-out tree contains only the SPEC 1.2 paths. The tests
assert *argv intent* — that `sparse-checkout set <paths>` is issued correctly —
but nothing has ever inspected an actual directory to confirm what landed there.

Risk is low, because git honours a correct argv. But a scenario is compliant when
a covering test passes at runtime, and this one has none. This is the last thing
standing between Phase 1 and an honest "fully verified".

*What to write:* a test that runs a real sparse clone into a temp directory (or
asserts against the existing `.cache/` tree) and checks that no path outside the
declared set is present.

## P1 — missing regression coverage

**No `cli.test.ts` exists anywhere.** Two invariants of `src/cli.ts` are proven
only by manual runs and would not survive a refactor unnoticed:

- `--fixtures` output parity (verified once, by hand, against a worktree),
- the fatal exit-2 paths: malformed `sources.yml`, and `git` missing from PATH.

## P2 — decisions that need a human, not code

These block nothing today but every one of them is a silent wrong answer waiting
to happen.

1. **Does a `platform` repository belong in `plugins[]`?**
   `wazuh-dashboard` resolves a SHA and appears in `resolvedRefs`, but contributes
   no entry, because `sparsePathsFor("platform")` returns `[]` and the repo has no
   root manifest. `SPEC.md` 1.5.2 defines `world: "platform"` as a classification,
   which implies it should surface somewhere. Right now it is classified in theory
   and absent in practice. Decide, then record it.

2. **Reconcile `fixtures/facts.ts` with reality.**
   It asserts `indexerAccess: []` for `wazuh`; the real manifest declares `data`,
   so the truth is `["osd-data"]`. No test hardcodes the wrong value, so nothing is
   broken — but a fixture that disagrees with reality is evidence about the
   fixture. Either fix it or state in the file that it is shape-only.

3. **`wazuh-dashboard-reporting` vs `wazuh-dashboards-reporting`.**
   Both have a `5.0.0` branch. `sources.yml` currently names the singular form and
   flags it UNRESOLVED. Open since the first draft (SPEC section 8, item 1).

4. **Is `wazuh-indexer` worth adding?** SPEC section 8, item 3.

5. **The `asScoped` / `asInternalUser` page.** SPEC section 8, item 4 — the
   highest-return prose in the project, still unwritten. It cannot be written
   until someone decides *which* of the two identically-named APIs it governs:
   OSD's `core.opensearch.client` (indexer RBAC) or `wazuh-core`'s `api.client`
   (Server API RBAC).

## Then: what comes after Phase 1

Per SPEC section 7, the next build step is the **Phase 1.5 inspector**
(`wazuh-ctx serve`) — a read-only viewer over `matrix.json` plus an editor for
`decisions.yml` and `annotations.yml`. The crosscheck view is where it earns its
keep: that data is a bipartite graph and markdown renders it badly.

Phase 3's MCP `schema` resource is what actually makes the dataset consumable by
an agent. Phase 2 (skills) and the rest of Phase 3 (`docs`, `runtime`) are not on
the critical path for a usable v1.

## SDD state

Change `phase-1-real-data` is at `verify: done`, ready for `archive`, with the P0
above outstanding. Artifacts live in `openspec/changes/phase-1-real-data/`:
`exploration.md`, `proposal.md`, `specs/`, `design.md`, `tasks.md`,
`apply-progress.md`, `verify-report.md`, `state.yaml`.

The runtime attempt ledger was reset on 2026-09-14 (budget declared at 1500
lines, real change was 3092 including the dataset). History is preserved:
`lifetime_changed_lines: 3092`.

**Note for the next session:** Engram filed most of this work under a scratch
project name rather than `wazuh-context-kit`, because the repo has no
`.engram/config.json`. The `openspec/` files are authoritative and complete;
do not rely on Engram recall for this change.

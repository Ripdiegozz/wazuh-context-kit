# Proposal — `mcp-server`

All of Phase 3: `wazuh-ctx mcp`, three resources, one binary. Maintainer decision
on 2026-09-17 to take it as one change rather than the recommended
`schema`-first slice.

## Why

Phase 2 closed with PR #24. `mcp` and `serve` are the last two `notImplemented`
stubs (`src/cli.ts:864-866`), and SPEC §7 puts Phase 3 before `serve`. Eleven
acceptance criteria are open in §3.6.

The change is also overdue for a reason nobody planned: two pieces of Phase 3
were already half-built and left inert, and one of them is wrong.

## What the research changed

Three findings moved decisions before a line was written. Full evidence in
`research-docs-contract.md` and `research-mcp-sdk.md`.

### 1. The shipped `docsVersionMap` points at a 404

`sources.yml:38-45` maps `"5.0.0": "5.0"`. Measured 2026-09-17: every URL under
`/5.0/` returns 404. The Wazuh 5.0 documentation is published at `/5.0-beta/`.

Nothing breaks today only because `sourcesFileSchema` (`src/sources.ts:60-63`) is
deliberately non-strict and ignores the block. **This change is what activates
it**, so the correction ships here: `"5.0.0": "5.0-beta"`.

Two further corrections to what §3.1 records, both measured:

- `llms.txt` is published **only at the site root**. `/current/`, `/5.0/`,
  `/4.14/` and `/5.0-beta/` all 404. §3.1 said only `5.0-beta` did.
- `/current/` is a byte-identical alias for `/4.14/` (`sha256 7dc7cb13…`), not
  for 5.0. Defaulting `docs` to `/current/` would answer 5.0 questions with 4.14
  documentation — the silent-obsolescence failure §3.2 refuses for `schema`.

### 2. Deriving the version map from release tags was considered and rejected

The maintainer proposed deriving the mapping from tags in
`wazuh-dashboard-plugins` — no GA release means use beta, no tag at all means the
version does not exist. It was tested rather than assumed, and it does not hold:

- 828 tags; for 5.0 they are `v5.0.0-alpha0` and `v5.0.0-beta1`…`beta5`. No GA,
  no `-rc`.
- The docs site collapses **all** of them into one path. `/5.0-beta/` → 200;
  `/5.0.0-beta5/`, `/5.0-beta5/`, `/5.0-alpha/` → 404. The published name drops
  the `v`, the patch component, and the prerelease number.
- `/current/` = `/4.14/`, encoded in no tag anywhere.
- `/3.13/` and `/4.2/` serve 200 while unlisted in `llms.txt`.
- `/5.0/` 404s although branch `5.0.0` exists and is actively built.

Tags describe the code. The documentation site publishes on its own cadence with
its own path naming, and the join between them is a human convention. This is
what §3.1 already said — *"va explícito en configuración, nunca derivado"* — and
the measurement is why.

**The underlying concern is real and is addressed**: a hand-maintained mapping
goes stale silently. `lastReviewed: "2026-09-14"` was three days old and already
described a world that does not answer. So the release signal is kept — as an
**alarm, not an inference**. See §3.1 amendment below.

### 3. The obvious MCP package is the wrong one

| Package | Latest | Direct deps |
| --- | --- | --- |
| `@modelcontextprotocol/sdk` | 1.30.0 | **17** — express, hono, cors, jose, ajv, express-rate-limit |
| `@modelcontextprotocol/server` | 2.0.0 | **2** — `core` + `zod ^4.2.0` |
| `@modelcontextprotocol/core` | 2.0.0 | **1** — `zod` |

This repo has two runtime dependencies. The v1 `sdk` would pull two HTTP
frameworks and a JOSE implementation into a tool whose transport is stdio. The v2
split pulls `zod`, already pinned at a compatible `4.6.5`. `server@2.0.0` is
stable, published 2026-07-27 after five betas; `engines.node >= 20` against this
repo's `>= 22`.

Two consequences from the SDK research:

- `InMemoryTransport` is **not** in `core` (its exports map carries only `.` and
  `./internal`), and the copy in `server` covers only the legacy 2025 protocol.
  In-process protocol tests need `@modelcontextprotocol/client` as a
  **devDependency**. Handler logic is tested directly below the protocol
  boundary; the client covers the wiring.
- There is **no protocol-level way** to mark one resource unavailable. `runtime`
  degrades by **not being registered** when its backend is absent — which
  satisfies §3.3 exactly: `docs` and `schema` never see it.

## Scope

### Amendment to SPEC §3.1 (lands first)

The contract changes before the code does. In Spanish, matching the file:

- correct the published location of `llms.txt` (site root, not per version);
- record that `/current/` aliases the latest stable line, not the pinned ref, and
  that `docs` therefore never defaults to `/current/`;
- record that the version list in `llms.txt` is illustrative ("for example"), not
  an allowlist, reinforcing why the mapping stays explicit;
- add the new criterion to §3.6:

  > El mapeo de versiones se **valida**, no se deriva. Un chequeo compara cada
  > entrada contra dos fuentes: que el path mapeado responda `text/markdown`, y
  > que el estado de releases de `wazuh-dashboard-plugins` siga siendo el que el
  > mapeo asume. Un desacuerdo falla ruidoso y nombra la entrada y su
  > `lastReviewed`. Derivar el mapeo sigue prohibido.

### Code

1. `docsVersionMap` gains a zod schema and a typed accessor in `src/sources.ts`,
   following the established schema-beside-loader pattern. `"5.0.0"` corrected to
   `"5.0-beta"`, `lastReviewed` moved.
2. `src/mcp/` — new directory at the composition edge, beside `cli.ts`. It does
   I/O by definition and must never be imported by `matrix/`.
3. `docs` — fetch `<path>.md`, return the section, cite the `.html`. Injected
   transport (`FetchLike`), following `src/indexer/client.ts`. Clear failure for
   an unmapped version, distinct from a fetch miss on a mapped-but-dead path.
4. `schema` — first loader in the repo that reads `out/<ref>/matrix.json` back.
   `verifyPayloadHash` (`src/matrix/hash.ts:44-51`) already exists and refuses
   startup on mismatch. Every response carries `ref`, `payloadHash`, `resolvedAt`;
   warns past 30 days; rejects a ref mismatch unless `--allow-ref-mismatch`.
5. `overlay: "local"` in `applyHumanLayers`, **not** only in the response.
   Verified free: `canonicalize` drops `undefined` keys (`src/matrix/hash.ts:26`),
   so an absent marker leaves `payloadHash` byte-identical and `out/5.0.0/` needs
   no regeneration. It also closes a present hazard — `runMatrix` merges
   `decisions.local.yml` (`src/cli.ts:200`) into the matrix it writes at line 218,
   so today a local override can be committed with no trace. `load.ts:33-35`
   already declares the rule it does not enforce.
6. World detection by `cwd` — new code. Resolve the working tree's repo root and
   remote, map it to a `sources.yml` name, look up its world, announce before the
   first query. Feeds the §3.2 ref-mismatch check too: one piece of work, two
   criteria.
7. `runtime` — optional; not registered when absent.
8. Telemetry — local `(plugin, field, resolved)` records, no query content,
   `--no-telemetry`.
9. `--allow-ref-mismatch`, `--no-telemetry` and a resource selector added to the
   `parseArgs` options (`src/cli.ts:815-833`); `USAGE` updated; `case "mcp"`
   replaced.

### Out of scope

`serve` / the inspector (SPEC §1.5, last in §7). No change to `matrix/` purity.
No regeneration of `out/5.0.0/`.

## Testing

Strict TDD. `bun test`, `bun run typecheck`, `bun run build`.

The `llms.txt` canary follows the established real-network gate
(`src/fetch/network.integration.test.ts:22-24`):

```ts
const NETWORK_ENABLED = process.env.WAZUH_CTX_NETWORK === "1";
const maybeTest = NETWORK_ENABLED ? test : test.skip;
```

It asserts status `200` **and** `content-type: text/markdown` **and** a body not
beginning with `<!DOCTYPE` — because the failure mode §3.1 warns about is a 200
serving HTML under the `.md` path, which a status check alone would miss. Misses
are clean (404 + `text/html`), confirmed: there is no soft-404.

Hermetic git tests for world detection follow `src/fetch/sparse-disk.test.ts` —
real `git`, real temp repos, no network.

## Risks

- **Review budget.** Four resources, a new dependency, a spec amendment. The
  chosen delivery strategy is `single-pr` against a 400-line policy. The tasks
  phase must forecast this honestly; if it exceeds budget the decision returns to
  the maintainer as a split or a recorded `size:exception`.
- **`/5.0-beta/` is a beta path and will move at GA.** Accepted: that is what
  `lastReviewed` and the new validator exist to catch.
- **`@modelcontextprotocol/server@2.0.0` is young** — stable for seven weeks. Its
  own docs do not state in one sentence that v2 is the default for new servers;
  the research flags that as inference, not quoted fact. Accepted knowingly: 2
  dependencies against 17 is the deciding number.
- **Ref mismatch on a detached HEAD or a non-release branch** has no clean
  answer. Rejecting by default is specified; the message when there is no branch
  at all is a design question.

## Constraint restated

**`wazuh/*` repositories are read-only.** This change fetches published
documentation over HTTPS and runs `git ls-remote` against `wazuh/*` — both reads.
No issue, no PR, no commit there, ever. See `CLAUDE.md`.

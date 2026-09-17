# Exploration — `mcp-server`

All of Phase 3 in one change, by maintainer decision on 2026-09-17. The 11 open
acceptance criteria in `SPEC.md` §3.6 are the contract.

Everything below was measured against the checkout at `b5fbba0` and against the
live npm registry on 2026-09-17. Where something does not exist, it says so.

## What Phase 3 actually asks for

| Resource | SPEC | Criteria | Touches the world? |
| --- | --- | --- | --- |
| `docs` | 3.1 | 3 | yes — the documentation site |
| `schema` | 3.2 | 6 | no — reads `out/<ref>/` off disk |
| world detection | 3.4 | 1 | git, read-only, on `cwd` |
| `runtime` | 3.3 | 1 | optional live instance |
| telemetry | 3.5 | 0 (no criterion) | local file only |

Seven of eleven criteria are offline and provable against the dataset already
committed at `out/5.0.0/`. Three need the documentation site. One needs the other
two to survive its absence — which is testable without any instance at all.

## Finding 1 — the `mcp` command is a stub and nothing below it exists

`src/cli.ts:866` is `return notImplemented("mcp", "Phase 3").code;`. The shape to
fill is already fixed by five working siblings: every command is
`async (values) => Promise<CommandResult>` where `CommandResult` is `{ code: number }`
(`src/cli.ts:90-92`), and no command throws to the top — failures become exit
codes (`src/cli.ts:207-210`).

Flags go through `node:util`'s `parseArgs` (`src/cli.ts:815-833`), with a comment
at `src/cli.ts:5-6` explaining the choice: "Six subcommands do not justify
commander or yargs." Three new flags are needed — `--allow-ref-mismatch`,
`--no-telemetry`, and a resource selector — and they cost three lines in that
options object.

## Finding 2 — the pure-core rule holds, and MCP must not be the thing that breaks it

SPEC §6.1 says `fetch/` owns network and git, `parse/` owns the filesystem,
`matrix/` and `render/` are pure. Grepping `src/matrix/` for `node:fs`,
`node:http`, `fetch(`, and `Date.now` returns nothing. The rule is real, not
aspirational.

One directional coupling exists: `src/parse/index.ts:7` imports a *type* from
`../fetch/types.ts`. Type-only, erased at compile time, no runtime effect — worth
naming, not worth fixing here.

The consequence for this change: an MCP server is by definition an I/O process.
It reads files, opens sockets, and shells out to git. It must sit at the
composition edge — beside `cli.ts` — and call into the pure core, never the
reverse. `matrix/` must not learn that MCP exists.

## Finding 3 — `schema` reuses more than expected, except the one thing it needs most

Reusable today:

- `computePayloadHash` (`src/matrix/hash.ts:34-37`) hashes canonicalized JSON —
  sorted keys, `undefined` dropped (`src/matrix/hash.ts:14-31`) — of everything
  in `MatrixJson` except `meta` and `payloadHash` itself. `verifyPayloadHash`
  (`src/matrix/hash.ts:44-51`) already recomputes and compares. The §3.6
  criterion "does not start if `payloadHash` does not validate" needs a *caller*,
  not an algorithm.
- Per-field provenance exists as `MatrixPlugin.assertions`
  (`src/matrix/types.ts:137`), recording `{ kind, source, author, date, reason }`
  per asserted field (`src/matrix/types.ts:102-109`).

Missing, and this is the real work:

- **Nothing reads `out/<ref>/matrix.json` back.** It is written at
  `src/cli.ts:218` and never loaded anywhere in the repo. The loader is new code.
- **`overlay: "local"` does not exist.** A repo-wide grep for `overlay` finds
  nothing related. The input for it does exist: `loadHumanLayers` returns
  `localOverrides: Set<string>` keyed `"<plugin>::<field>"`
  (`src/decisions/load.ts:46`) — and that set is currently **unused downstream**.
  `applyHumanLayers` merges `[...shared, ...local]` so local wins by list order
  (`src/decisions/load.ts:38-50`), but the served cell carries no trace of which
  file it came from. Threading that set into the response is the criterion.

## Finding 4 — the network-client pattern is settled, and it throws on purpose

`src/indexer/client.ts` is the precedent and it is a good one:

- transport injected as `FetchLike` (`src/indexer/types.ts:78`) — never the global
  `fetch` inside testable logic, so tests need no socket;
- a closed error taxonomy, `IndexerErrorCode = "certificate" | "auth" | "unreachable" | "timeout" | "insecure"`
  (`src/indexer/types.ts:62-71`), with `classifyTransportError`
  (`src/indexer/client.ts:60-96`) reading both `err.code` and `err.cause?.code`,
  because Node's `fetch` nests the real socket error one level down;
- `AbortSignal.timeout` with a 10s default (`src/indexer/client.ts:23-24`);
- TLS relaxation is per-request, never the process-global
  `NODE_TLS_REJECT_UNAUTHORIZED` (`src/indexer/client.ts:113-119`), and `https:`
  is enforced regardless (`src/indexer/client.ts:157-176`).

The client throws; the *caller* decides that a failure means "not available"
rather than a crash. That split is exactly what §3.3 needs: `runtime` degrades at
the composition edge, and `docs`/`schema` never see it.

## Finding 5 — `docs` already has its config block, and no code has ever read it

`sources.yml:38-43` carries a hand-maintained `docsVersionMap`:

```yaml
docsVersionMap:
  owner: diego.garcia
  lastReviewed: "2026-09-14"
  map:
    "5.0.0": "5.0"
    "4.14.0": "4.14"
```

Owner and last-reviewed date, in the file itself, exactly as §3.1 demands. But
`sourcesFileSchema` (`src/sources.ts:60-63`) validates only `{ refs, repos }` and
is deliberately not `.strict()` at the top level so this block is tolerated and
ignored — `src/sources.ts:37-42` says so outright: "a hand-maintained
`docsVersionMap` block (SPEC 3.1) this loader does not read."

So the version map is not a decision to make. It is a schema and an accessor to
write, following the established pattern: zod schema beside the loader, `readFile`
→ `yaml.parse` → `safeParse`, and a thrown `Error` naming the file and the
offending path (`src/sources.ts:104-106`).

## Finding 6 — world detection by `cwd` has no foundation to build on

Nothing resolves the working tree's own repository identity or branch. Searched
for `rev-parse --abbrev-ref`, `currentBranch`, `resolveWorkingTree` — nothing.
`process.cwd()` appears once in `src/cli.ts`, only to locate `sources.yml` and
`.cache`.

And `sources.yml`'s `repos[]` carries only `{ name, kind }` (`src/sources.ts:16-19`),
matched by **name string** (`src/parse/index.ts:14-27`), never by directory. So
§3.4 needs three new pieces: resolve a `cwd` to a repo root and remote, map that
remote to a `sources.yml` name, and look up its world in the dataset.

This same detection feeds the §3.2 ref-mismatch check, so it is one piece of work
serving two criteria — an argument for building it early rather than last.

## Finding 7 — real-network tests have a precedent, and the canary fits it exactly

41 `*.test.ts` files, colocated with their modules, `bun:test` throughout.

Two tests hit the real network, both gated identically
(`src/fetch/network.integration.test.ts:22-24`, `src/dataset-freshness.integration.test.ts:32-34`):

```ts
const NETWORK_ENABLED = process.env.WAZUH_CTX_NETWORK === "1";
const maybeTest = NETWORK_ENABLED ? test : test.skip;
```

An env-var gate, not a bun-test tag — the `.integration.test.ts` suffix is for
humans; `bun test` does not special-case it. The §3.1 canary ("fails loudly if
the 1-to-1 guarantee breaks") is precisely this shape, and the precedent means it
does not need inventing.

For hermetic git tests, `src/fetch/sparse-disk.test.ts:1-70` builds a throwaway
origin under `mkdtemp`, runs the real `git` binary against a `file://` remote, and
asserts on the real working tree. World detection can be tested the same way, for
real, with no network.

## Finding 8 — the MCP dependency question has a clear answer, and it is not the obvious package

The repo has exactly two runtime dependencies: `yaml` and `zod@4.6.5`. Measured
against the npm registry on 2026-09-17:

| Package | Latest | Direct dependencies |
| --- | --- | --- |
| `@modelcontextprotocol/sdk` | 1.30.0 | **17**, including `express`, `hono`, `cors`, `jose`, `ajv`, `express-rate-limit` |
| `@modelcontextprotocol/server` | 2.0.0 | **2** — `@modelcontextprotocol/core@2.0.0` and `zod ^4.2.0` |
| `@modelcontextprotocol/core` | 2.0.0 | **1** — `zod ^4.2.0` |

The familiar `sdk` package pulls two HTTP frameworks and a JOSE implementation
into a tool whose Phase 3 transport is stdio. The v2 split packages pull `zod`,
which this repo already pins at a compatible `4.6.5`.

`@modelcontextprotocol/server@2.0.0` is stable, not a prerelease: published
2026-07-27, following five betas. `engines.node >= 20`; this repo requires `>= 22`.

Testing without a live client is a solved problem in that SDK:
`InMemoryTransport.createLinkedPair()` connects a client and server in-process,
no stdio and no child process. One caveat to resolve in design: that helper is
documented as an export of `@modelcontextprotocol/client`, which carries `jose`,
`cross-spawn`, `eventsource`, and `pkce-challenge`. As a **devDependency** that is
tolerable, but whether the same helper is reachable from `core` — a single
`zod`-only package — is worth one check before committing to it.

The third option, hand-rolling stdio JSON-RPC, is not free: it means owning
protocol version negotiation and capability handshakes forever, for a protocol
that is still moving. Two dependencies is the cheaper honest answer.

## Open questions for design

1. Is `InMemoryTransport` reachable without adding `@modelcontextprotocol/client`
   as a devDependency? Decides four transitive dev packages.
2. Does `overlay: "local"` belong in `applyHumanLayers` (so every consumer of the
   matrix gets it, including `matrix.json` on disk) or only in the `schema`
   response? The first changes the committed dataset and its `payloadHash`; the
   second keeps the blast radius inside Phase 3.
3. Ref mismatch compares "the dataset's `ref`" against "the working tree's
   branch". A detached HEAD, or a branch that is not a release ref, has no clean
   answer. Rejecting by default is specified; what the message says when there is
   no branch at all is not.
4. Where does telemetry write, and does it need a rotation or size bound? §3.5
   says local, opt-out, never leaves the machine — it does not say unbounded.

## Constraints restated

- **`wazuh/*` repositories are read-only.** No issues, no PRs, no commits there.
  Read-only git and `gh` only. `docs` fetches published documentation over HTTPS;
  that is a read. See `CLAUDE.md`.
- `SPEC.md` is Spanish and stays Spanish. Artifacts in this change are English.
- Strict TDD is on. `bun test`, `bun run typecheck`, `bun run build`.
- Delivery: single PR, by maintainer decision. The 400-line review budget is at
  real risk across four resources — the tasks phase must forecast it honestly.

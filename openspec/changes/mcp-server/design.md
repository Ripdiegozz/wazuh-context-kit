# Design — `mcp-server`

## The one structural decision

An MCP server is I/O by definition: it reads files, opens sockets, shells out to
git. SPEC §6.1 says `matrix/` and `render/` are pure and that nothing inside
calls outward. So `src/mcp/` sits **at the composition edge, beside `cli.ts`**,
and the dependency arrow only ever points inward:

```
cli.ts ──► mcp/ ──► { sources.ts, decisions/, matrix/ (pure) }
                └─► fetch-like transport (injected)
                └─► git runner (injected)
```

`matrix/` must not learn that MCP exists. If a future reader can tell from
`src/matrix/` that there is an MCP server, the layering broke.

## Module layout

```
src/mcp/
  server.ts        wiring: capability registration, stdio transport, startup gates
  startup.ts       the refusal gates — hash, ref mismatch, world announcement
  world.ts         cwd → repo → world  (uses injected GitRunner)
  dataset.ts       load out/<ref>/matrix.json, verify, expose typed reads
  docs.ts          path transformation, fetch, citation  (uses injected FetchLike)
  docs-validate.ts the mapping validator (alarm, not inference)
  runtime.ts       optional resource; conditional registration
  telemetry.ts     local (plugin, field, resolved) sink
```

Every file that touches the world takes its dependency **injected**, following
`src/indexer/client.ts` and `src/fetch/types.ts`. That is not ceremony — it is
what lets the tests run with no socket and no cluster.

## SDK choice and its consequences

`@modelcontextprotocol/server@2.0.0` + `@modelcontextprotocol/core@2.0.0`, two
packages whose only other dependency is `zod`, already pinned here at `4.6.5`.
The v1 `@modelcontextprotocol/sdk` would add 17 direct dependencies including
express, hono, cors and jose — two HTTP frameworks for a stdio transport.

Registration is `registerResource(name, uri | ResourceTemplate, config, handler)`
and the handler returns `{ contents: [...] }`. stdio comes from
`@modelcontextprotocol/server/stdio`.

**Unavailability is registration, not a flag.** There is no protocol-level way to
mark one resource unavailable. So `runtime` is registered only when its backend
resolves; when it does not, the server simply exposes two resources. §3.3's "does
not block the other two" then holds by construction rather than by a code path
that could regress.

**Testing splits in two.** `InMemoryTransport` is absent from `core` (exports map
carries only `.` and `./internal`), and `server`'s copy covers only the legacy
2025 protocol. So:

- handler logic is tested **directly, below the protocol boundary** — these are
  plain functions over injected dependencies, and they carry the requirements;
- protocol wiring gets **one thin end-to-end test** using a real `Client` from
  `@modelcontextprotocol/client`, added as a **devDependency**.

The split is deliberate. Testing every requirement through the protocol would
make each assertion pay for transport setup while proving nothing extra about the
requirement.

## `schema`: the refusal gates run in order

Startup is a sequence of refusals, and the order matters because each one makes
the next meaningful:

1. **Load** `out/<ref>/matrix.json`. Absent → refuse, naming the path.
2. **Verify** via `verifyPayloadHash`. Mismatch → refuse, naming expected and
   actual. Serving a dataset you cannot vouch for is the one thing worse than not
   serving.
3. **Resolve the world** from `cwd`. Needed by step 4 and by §3.4.
4. **Compare refs**. Dataset `ref` vs working-tree branch. Differ → refuse naming
   both, unless `--allow-ref-mismatch`.
5. **Announce** the world.
6. **Register** resources; `runtime` only if its backend resolves.

Three distinct "cannot compare" cases fall out of step 4 and get three distinct
messages, because collapsing them is how "no answer" silently becomes "fine":

| Situation | Behaviour |
| --- | --- |
| branch ≠ dataset ref | refuse, name both |
| detached HEAD, no branch | refuse, say the branch is undeterminable |
| `cwd` outside any known repo | serve, world reported unknown |

The third serves because the ref check is about the *consumer's* position, and a
consumer outside the corpus has no position to contradict — but it must not be
told a world it does not have.

Staleness is separate from all of this: past 30 days every response carries a
warning. A warning, not a refusal — the data is still true as of its date, and
saying so is the whole point.

`resolvedAt` and the 30-day comparison need the clock. The clock is **injected**,
never read inside anything pure, exactly as `--frozen-time` already does for
`matrix`.

## `overlay: "local"` goes in the domain layer

`applyHumanLayers` gains the `localOverrides` set — which `loadHumanLayers`
already computes and currently drops — and marks each cell it wrote from the
local layer.

Two reasons it belongs there rather than in the `schema` response:

1. **It is free.** `canonicalize` filters `record[key] !== undefined`, so an
   optional `overlay` left unset is dropped from the hash. No local file means no
   marker means byte-identical `payloadHash`, and `out/5.0.0/` is untouched.
2. **It closes a present hole.** `runMatrix` calls `loadHumanLayers(process.cwd())`
   and writes the result to `out/<ref>/matrix.json`. Today a maintainer with a
   local escape-hatch file can regenerate and commit local overrides with zero
   trace. Marking in the presentation layer would leave that hole open.

`applyHumanLayers` stays pure — the set arrives as an argument, as everything
else does.

## `docs`: mapping, fetch, citation

`sources.ts` gains `docsVersionMapSchema` beside the existing schemas and exposes
the block it currently tolerates and ignores. Load errors name the file and the
offending path, as `sources.ts:104-106` already does.

Two failure modes that must not collapse into one message:

- **unmapped ref** — no entry exists. A configuration gap.
- **mapped but dead** — the entry exists and the path 404s. A staleness bug, and
  the thing that is true today for `"5.0.0": "5.0"`.

The fetch asserts `200` + `content-type: text/markdown` + body not starting with
`<!DOCTYPE`. Anything else → `docs` unavailable, naming what it received. Cite the
`.html` twin.

**No crawler.** One page per request, on demand — which is also why `robots.txt`
compliance is trivially satisfied (it disallows only `/resources/`).

### The validator

`docs-validate.ts` implements the requirement added to §3.1. For each mapping
entry: probe the mapped path, and read `wazuh-dashboard-plugins` release tags
read-only via `git ls-remote`. Disagreement fails, naming the entry and its
`lastReviewed`.

It never edits the mapping. The whole argument for keeping the mapping explicit
is that the join between code tags and documentation paths is a human convention;
a validator that "fixed" the file would be deriving it through the back door.

## World detection

New code, no foundation to reuse. Using the injected `GitRunner`:

1. `git rev-parse --show-toplevel` from `cwd` → repository root;
2. `git config --get remote.origin.url` → remote, normalised (strip `.git`, scheme,
   host) → repository name;
3. name → `sources.yml` entry → world from the dataset.

Matching on the **remote**, not the directory name, because a checkout can live
in a directory called anything. Any step failing means world unknown — stated,
not guessed.

Tested hermetically with real `git` against real temp repositories, following
`src/fetch/sparse-disk.test.ts`. No network.

## Telemetry

A local append-only record of `(plugin, field, resolved)`. No query content, ever.
`--no-telemetry` disables the sink at construction — an absent sink rather than a
flag checked at each call site, so there is no path where a check is forgotten.

§3.5 says local and opt-out; it does not say unbounded. The file gets a size
bound with oldest-first drop, because a log that grows forever on a developer
machine is a defect nobody reports.

## CLI surface

Three additions to the `parseArgs` options (`src/cli.ts:815-833`):
`--allow-ref-mismatch` (boolean), `--no-telemetry` (boolean), and a resource
selector. `USAGE` updated; `case "mcp"` calls `runMcp`. `runMcp` returns
`CommandResult` and never throws to the top, like its five siblings.

## What this design refuses to do

- No regeneration of `out/5.0.0/`. Verified unnecessary.
- No change to `matrix/` purity, and no import from `matrix/` into `mcp/`.
- No derivation of the version mapping. Validation only.
- No `serve` / inspector work. That is §1.5, last in §7.

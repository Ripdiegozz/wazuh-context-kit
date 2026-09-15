# Design: Complete Phase 1 — real data through `fetch/` and `parse/`

## Technical Approach

Two new input adapters behind **one injected seam each**, per proposal Approach A and SPEC 6.1.

| Module | Allowed I/O | Seam |
|---|---|---|
| `src/fetch/` | git subprocesses + network | every git call goes through an injected `GitRunner`; cache metadata through an injected `FetchIo` |
| `src/parse/` | filesystem reads of repo content only | every function takes a `dir` root; tests point it at `fixtures/checkout/` |
| `src/sources.ts` | reads `./sources.yml` | `loadSources(root)`, same shape as `decisions/load.ts` |
| `src/matrix/`, `src/decisions/apply.ts` | none | **unchanged** (D1) |

`fetch/` materialises `.cache/`; it never reads repository content. `parse/` reads repository
content; it never spawns a process. That split is what makes SPEC 6.1's rule checkable rather
than aspirational.

## Architecture Decisions

### Decision: one injected `GitRunner` carries *every* git call, including cache probing

**Choice**: a single `GitRunner = (cmd: GitCommand) => Promise<GitResult>` taking an **argv array**
(never a shell string) and never throwing on a non-zero exit. Cache-hit detection uses
`git -C <dir> rev-parse HEAD` — a *local* git command — so it flows through the same seam.

**Alternatives considered**: (a) a separate injected `fs.exists` probe for `.git/`; (b) real
subprocesses in tests with a network guard at the socket level.

**Rationale**: (a) creates a second seam that a test must fake separately, and a future cache probe
could drift onto the unfaked one. (b) makes `bun test` depend on github.com, which the proposal's
risk table rules out. One seam, one double, one place to observe.

### Decision: "no network on a cache hit" is enforced in production, not only asserted in tests

**Choice**: `isNetworkGitCommand(argv)` is production code in `git-runner.ts`, and the cache-hit
path wraps the injected runner in `offlineGuard(run)`, which rejects any network verb.

**Alternatives considered**: assert the recorded command list in the test only.

**Rationale**: D3 asks for a structural property. A test-only assertion says "today's code does
not"; the guard says "this path cannot". The test then asserts *observed behaviour* against the
same exported classifier, so test and implementation share one definition of "network-touching"
instead of two that can drift.

### Decision: `resolvedAt` comes from a cache stamp, never from the clock

**Choice**: on clone/refresh, `fetch/` writes `.cache/<repo>@<ref>.fetch.json`
(`{ ref, commit, resolvedAt }`) as a **sibling** of the working tree. On a cache hit it reads the
stamp back. `cli.ts` sets `BuildInput.resolvedAt` to the **oldest** stamp across fetched repos.

**Alternatives considered**: (a) `resolvedAt = new Date()`; (b) HEAD committer date (`%cI`).

**Rationale**: `resolvedAt` is inside the hashed payload (`build.ts`). With (a), two runs over one
cache produce two `payloadHash` values and a listed success criterion fails by construction — the
`--fixtures` path already sidesteps this with a constant. (b) is stable but means "when upstream
committed", which would make the SPEC 5.4 staleness warning lie about a branch that simply has not
moved. Oldest-wins because staleness must be conservative: one 60-day-old repo makes the dataset
60 days old.

### Decision: `--refresh` updates in place with git; it never deletes a directory

**Choice**: `fetch --depth 1 --filter=blob:none origin <ref>` → `sparse-checkout set …` →
`reset --hard FETCH_HEAD`, then rewrite the stamp.

**Alternatives considered**: `rm -rf` the cache dir and re-clone.

**Rationale**: keeps `fetch/` free of recursive deletes (a destructive operation whose blast radius
depends on a computed path), re-applies a changed path set idempotently, and stays inside the one
injected seam.

### Decision: `parse/` gains an `index.ts` beyond the exploration's file list

**Choice**: add `src/parse/index.ts` with `toParseTargets()` and `parseFetchedRepos()`.

**Alternatives considered**: put the `RepoKind` dispatch inline in `cli.ts`.

**Rationale**: symmetry with `fetch/index.ts`, and it keeps `cli.ts` a composition root rather than
a place where parsing rules live. Recorded here because it is a deliberate deviation from the
exploration's `{types,manifest,indexer}` list, not an oversight.

### Decision: foreign data is robust-empty; our own config is fatal

**Choice**: D5's never-crash rule covers `wazuh/*` repository content. A missing or schema-invalid
`sources.yml`, and a missing `git` binary, are **fatal** with a message naming the file/binary.

**Rationale**: SPEC 1.1's note puts zod on the input boundary for repos we do not control. A broken
`sources.yml` would otherwise skip every repo and silently write an empty, well-formed matrix —
the exact "can't tell a decision from an oversight" failure this project exists to prevent.

## Data Flow

```
sources.yml ──loadSources(root)──▶ RepoSource[] ──┐
                                                  ▼
                                   fetchRepos({repos, ref, refresh, io})
                                       ONLY network + git
                              ┌────────────────┴────────────────┐
                        FetchedRepo[]                        Skipped[]
                              │                                  │
                  toParseTargets(sources, fetched)               │
                              ▼                                  │
                     parseFetchedRepos(targets)                  │
                       ONLY repo-content fs reads                │
              ┌───────────────┼───────────────┐                  │
        RawPluginFacts[]  IndexTemplate[]  WcsModule[]            │
              └───────────────┼───────────────┘                  │
   loadHumanLayers(cwd) ──▶ BuildInput ◀────────────────────────┘
                              ▼
                     buildMatrix  (PURE, untouched)
                              ▼
                 renderMatrixMarkdown  (PURE, untouched)
                              ▼
               out/<ref>/matrix.json + MATRIX.md
```

Per-repo sequence inside `fetchRepos`:

```
git -C <dir> rev-parse HEAD ─── exit 0 + 40-hex + !refresh ──▶ CACHE HIT
        │                                                      read stamp; done.
        │                                                      (offlineGuard armed:
        │                                                       0 network subprocesses)
        └── miss / --refresh
              ▼
        resolveRemoteRef(url, ref)          git ls-remote --heads <url> <ref>
              ├── {found:false, "absent"}     ──▶ skipped "no <ref> branch"   (no clone)
              ├── {found:false,"unavailable"} ──▶ skipped "ref lookup failed: …"
              └── {found:true, sha}
                      ▼
        clone --depth 1 --branch <ref> --filter=blob:none --no-checkout   (SPEC 1.4 verbatim)
        sparse-checkout init --cone
        sparse-checkout set <paths for RepoKind>      (skipped when the set is empty)
        checkout
        rev-parse HEAD ──▶ commit ; write stamp
```

## File Changes

| File | Action | Description |
|---|---|---|
| `src/fetch/types.ts` | Create | `GitCommand`, `GitResult`, `GitRunner`, `FetchIo`, `FetchOptions`, `FetchedRepo`, `FetchOutcome`, `RemoteRef` |
| `src/fetch/git-runner.ts` | Create | real `createGitRunner()` (argv spawn, no shell, never throws), `isNetworkGitCommand`, `offlineGuard`, `createFetchIo()` |
| `src/fetch/ls-remote.ts` | Create | `resolveRemoteRef` — nothing else, so SPEC 5.4 can import it alone |
| `src/fetch/clone.ts` | Create | `sparsePathsFor(kind)`, `cloneRepo`, `refreshRepo`, `cacheDirFor` |
| `src/fetch/index.ts` | Create | `fetchRepos` — per-repo skip/hit/clone decision, stamp read/write |
| `src/fetch/fetch.test.ts` | Create | recording-runner unit tests (see Testing Strategy) |
| `src/fetch/network.integration.test.ts` | Create | opt-in, `WAZUH_CTX_NETWORK=1`, otherwise `test.skip` |
| `src/parse/types.ts` | Create | `ParseTarget`, `ParsedRepo` |
| `src/parse/manifest.ts` | Create | `parseRepoManifests(target)` → `RawPluginFacts[]` |
| `src/parse/indexer.ts` | Create | `parseIndexerArtifacts(target)` → `{ templates, wcsModules }` |
| `src/parse/index.ts` | Create | `toParseTargets`, `parseFetchedRepos` |
| `src/parse/parse.test.ts` | Create | reads `fixtures/checkout/`; no network, no subprocess |
| `src/sources.ts` + `src/sources.test.ts` | Create | `loadSources(root)`, zod-validated, fatal on invalid |
| `src/cli.ts` | Modify | wire the pipeline; delete both hardcodes; add `--refresh` |
| `sources.yml` | Modify | **add `wazuh-dashboard-ml-commons`** (see Open Questions) |
| `fixtures/checkout/**` | Create | on-disk tree for `parse/` tests |
| `src/matrix/*`, `src/decisions/*` | **Unchanged** | D1 |

## Interfaces / Contracts

```ts
// src/fetch/types.ts — argv, never a shell string; cwd always explicit
// (exactOptionalPropertyTypes: no optional-undefined members anywhere here).
export interface GitCommand { readonly argv: readonly string[]; readonly cwd: string }
export interface GitResult  { readonly code: number; readonly stdout: string; readonly stderr: string }
export type GitRunner = (command: GitCommand) => Promise<GitResult>;

/** The whole I/O surface of fetch/. One object, one fake. */
export interface FetchIo {
  readonly run: GitRunner;
  readonly now: () => string;                                  // ISO-8601
  readonly readStamp: (path: string) => Promise<string | null>; // null on ENOENT
  readonly writeStamp: (path: string, body: string) => Promise<void>;
}

export interface FetchedRepo { readonly repo: string; readonly dir: string; readonly commit: string }
export interface FetchOutcome { readonly fetched: FetchedRepo[]; readonly skipped: Skipped[] }

export type RemoteRef =
  | { readonly found: true;  readonly sha: string }
  | { readonly found: false; readonly reason: "absent" | "unavailable"; readonly detail: string };

export interface FetchOptions {
  readonly repos: readonly RepoSource[];
  readonly ref: string;
  readonly cacheRoot: string;   // absolute, resolved once
  readonly refresh: boolean;
  readonly io: FetchIo;
}
export function fetchRepos(options: FetchOptions): Promise<FetchOutcome>;

// src/fetch/ls-remote.ts — standalone on purpose: SPEC 5.4 imports this and nothing else.
export function resolveRemoteRef(run: GitRunner, url: string, ref: string, cwd: string): Promise<RemoteRef>;

// src/fetch/git-runner.ts
export function isNetworkGitCommand(argv: readonly string[]): boolean;  // one definition, shared with tests
export function offlineGuard(run: GitRunner): GitRunner;                // rejects network verbs

// src/parse/*
export interface ParseTarget { readonly repo: string; readonly repoKind: RepoKind; readonly dir: string; readonly commit: string }
export interface ParsedRepo { facts: RawPluginFacts[]; templates: IndexTemplate[]; wcsModules: WcsModule[] }
export function parseRepoManifests(target: ParseTarget): Promise<RawPluginFacts[]>;
export function parseIndexerArtifacts(target: ParseTarget): Promise<Pick<ParsedRepo, "templates" | "wcsModules">>;
export function parseFetchedRepos(targets: readonly ParseTarget[]): Promise<ParsedRepo>;

// src/sources.ts
export interface RepoSource { readonly name: string; readonly kind: RepoKind }
export function loadSources(root: string): Promise<{ refs: string[]; repos: RepoSource[] }>;
```

**`exactOptionalPropertyTypes` gotcha.** `RawManifest` fields are `id?: string`, so `{ id: undefined }`
does not assign. `parse/` MUST build manifests by omitting absent keys
(`...(id !== undefined ? { id } : {})`), never by assigning `undefined`.

**Path normalisation (Windows).** Every emitted path (`pluginDir`, `manifestPath`,
`packageJsonPath`, `IndexTemplate.path`, `WcsModule.fieldsCsv`) is repo-relative and POSIX
(`/`). Dev runs on win32; `\` would leak into `payloadHash` and make the artifact
machine-dependent.

**Determinism.** `parse/` sorts `facts` by `manifestPath`, `templates` by `path`, `wcsModules` by
`name` before returning. `build.ts` sorts plugins but passes `templates`/`wcsModules` straight
through (D2), so ordering is `parse/`'s responsibility.

### Cache layout

```
.cache/                              (already gitignored)
  wazuh-dashboard-plugins@5.0.0/          ← the sparse working tree
  wazuh-dashboard-plugins@5.0.0.fetch.json ← {ref, commit, resolvedAt}; sibling, outside the tree
```

| Situation | Behaviour |
|---|---|
| `rev-parse HEAD` exit 0, 40-hex, no `--refresh` | **cache hit** — zero network subprocesses; commit from stdout, `resolvedAt` from stamp |
| stamp missing on a hit | re-stamp with `io.now()` once; subsequent runs are then stable |
| `rev-parse` non-zero | cache miss → remote path |
| `--refresh` | remote path via `fetch` + `sparse-checkout set` + `reset --hard FETCH_HEAD` (no re-clone, no delete) |
| dir exists but unusable (clone refuses a non-empty target) | `skipped` with `"cache directory unusable; delete .cache/<repo>@<ref> and retry"` |

### Sparse-checkout path sets (SPEC 1.2)

Cone mode **always includes root-level files**, which is what makes single-plugin forks
(`opensearch_dashboards.json` + `package.json` at the repo root) work with no path entry at all.

| `RepoKind` | `sparsePathsFor` | Why |
|---|---|---|
| `platform` | `[]` — `init --cone` only, `set` skipped | `world` for this repo is a human assertion from `sources.yml`; nothing under it is derived today. Root files still arrive. |
| `dashboard` | `["plugins"]` | `plugins/*/opensearch_dashboards.json` **and its sibling `package.json`** (mandatory — without it `versionScheme` and `world` collapse to `unknown`, SPEC 1.2). Root files cover the single-plugin forks. |
| `indexer` | `["plugins/setup/src/main/resources/templates", "plugins/content-manager/src/main/resources/mappings", "wcs"]` | SPEC 1.2's verified indexer paths. |

Cone mode cannot select `plugins/*/opensearch_dashboards.json` alone, so `dashboard` pulls the whole
`plugins/` subtree. Non-cone patterns would be more precise; **rejected** because SPEC 1.4
prescribes `--cone`, `--filter=blob:none` still avoids full history, and the cost is a one-time
cache fill. Side effect: the plugin source trees SPEC 1.8 says a real `crosscheck` would need are
already present, so that later change needs no fetch change.

`content-manager/mappings` is fetched (SPEC 1.2 lists it) but **not emitted** in `templates[]` this
change: mappings are not index templates and have no `index_patterns`. Recorded deferral.

## Testing Strategy

Strict TDD: every item below is a RED test before its implementation. Tests live beside the module
(`src/<module>/<module>.test.ts`), matching `matrix.test.ts` and `decisions.test.ts`.

| Layer | What to test | Approach |
|---|---|---|
| Unit — `fetch/` | cache hit performs **zero** network subprocesses (D3) | recording `GitRunner` defined **inside the test file**; assert the exact argv list equals `[["-C", dir, "rev-parse", "HEAD"]]` **and** `calls.filter(c => isNetworkGitCommand(c.argv))` is empty |
| Unit — `fetch/` | command allow-list | every emitted argv[0] ∈ `{rev-parse, ls-remote, clone, sparse-checkout, checkout, fetch, reset}` — makes "never pushes" assertable |
| Unit — `fetch/` | cold clone uses SPEC 1.4 flags | assert `--depth 1 --branch <ref> --filter=blob:none --no-checkout` present in the clone argv |
| Unit — `fetch/` | `absent` → `skipped`, and **no clone attempted** | scripted `ls-remote` with exit 0 + empty stdout |
| Unit — `fetch/` | `unavailable` ≠ `absent` | scripted non-zero exit; distinct `skipped.reason` |
| Unit — `fetch/` | `--refresh` refreshes in place | asserts `fetch`/`reset` issued, `clone` never |
| Unit — `fetch/` | sparse path set per `RepoKind` | table-driven over the three kinds |
| Unit — `fetch/` | one repo failing does not lose the others | scripted clone failure; other repos still in `fetched` |
| Unit — `fetch/` | `offlineGuard` rejects a network verb | direct unit call — real production function, no contrivance |
| Unit — `parse/` | ids, root manifests, D5 robustness, POSIX paths, sort stability | reads `fixtures/checkout/<repo>`, path built from `import.meta.dir` so it is cwd-independent |
| Unit — `parse/` | templates: recursion, name = filename stem, `index_patterns`, unparseable → `indexPatterns: []` | small fixture tree |
| Unit — `parse/` | WCS: nested module name (`content/decoders`), `fieldCount` = data lines | 2 fixture CSVs |
| Unit — `sources.ts` | valid load; invalid `kind` throws; missing file throws naming the path; **the repo's real `sources.yml` loads** | fixture roots under `fixtures/sources/{ok,bad}/` |
| Integration (opt-in) | cold clone against github.com; `templates ≥ 18` from the real checkout | `src/fetch/network.integration.test.ts`, skipped unless `WAZUH_CTX_NETWORK=1` |

**How a test observes absence of a network call**: the recording runner is the *only* way `fetch/`
can reach git, so an empty network-verb slice in the recorded list is proof, not inference. The
test uses the exported `isNetworkGitCommand` rather than restating the verb list, so the assertion
cannot drift from the implementation.

**Fixture honesty.** `fixtures/checkout/` proves *parsing behaviour* offline (recursion, naming,
ordering, D5 fallbacks). It deliberately does **not** carry 18 synthetic state templates: an
offline `≥ 18` assertion would test the fixture, not the indexer repo. That criterion belongs to
the opt-in integration run and to `sdd-verify`.

`fixtures/checkout/` contents: the four `wazuh-dashboard-plugins` plugins with sibling
`package.json`; a root-manifest fork (`3.6.0.0`); `plugins/broken/` with invalid JSON in both files;
`plugins/no-package/` with no sibling; an indexer tree with `templates/states/*.json` (3), one
unparseable template, and two `wcs/**/docs/fields.csv`.

## Error Handling (D5)

| Failure | Result | Fatal? |
|---|---|---|
| `sources.yml` missing / schema-invalid | message naming path + reason | **Yes** (exit 2) |
| `git` not on PATH (spawn ENOENT) | message naming the binary | **Yes** (exit 2) — otherwise every repo skips and an empty matrix is written silently |
| branch absent | `skipped: "no <ref> branch"` | No |
| ref lookup transport failure | `skipped: "ref lookup failed: <stderr line 1>"` | No |
| clone / sparse / checkout non-zero | `skipped: "clone failed: <stderr line 1>"` | No |
| cache dir present but unusable | `skipped` with the actionable delete-and-retry reason | No |
| manifest unreadable or schema-invalid | `manifest: {}`, `manifestPath` kept | No |
| `package.json` unparseable | `packageVersion: null`, **`packageJsonPath` kept at the real path** (D5) | No |
| `package.json` absent | `packageVersion: null`, `packageJsonPath: null` | No |
| template JSON unparseable | listed with `indexPatterns: []` | No |
| `fields.csv` unreadable / directory absent | `fieldCount: 0` / `[]` | No |

### Recorded limitation — not fixed here

`build.ts` derives the `versionScheme` unknown-reason from `packageJsonPath` truthiness. With D5
keeping the real path for an unparseable-but-present `package.json`, that reason text reads
`"package.json version matches no known scheme"` for a file that could not be parsed at all —
imprecise, but it never falsely claims the file is absent. **Not patched**: any fix lives inside
`src/matrix/`, which D1 forbids.

**Future recommendation (not this change).** Add a discriminator to `RawPluginFacts`
(e.g. `packageJsonParsed: boolean`) and branch on it in `build.ts`. **Cost**: a change to the pure
core's input contract, all six entries in `fixtures/facts.ts`, and the tests that construct facts —
for one clause of one reason string. Not worth it until a second consumer needs the distinction.

## Threat Matrix

| Boundary | Applicability | Design response | Planned RED tests |
|---|---|---|---|
| Documentation-like paths | **N/A** — no file is classified as executable or executed; all reads are JSON/YAML/CSV parsed in-process | — | — |
| Git repository selection | **Applicable** — every local command is `git -C <cacheRoot>/<repo>@<ref>`; `cacheRoot` resolved to an absolute path once; repo names validated `^[A-Za-z0-9._-]+$` and refs `^[A-Za-z0-9._/-]+$`, both rejecting a leading `-`; argv arrays only, never a shell string | invalid name/ref rejected **before** any runner call; `-C` target is always the computed cache dir, never `process.cwd()` |
| Commit state | **Applicable** — `reset --hard` exists on the `--refresh` path | assert every `reset`/`checkout` command's `-C` argument is inside `cacheRoot`; assert the project worktree is never a `-C` target |
| Push state | **N/A by enforcement** — no remote write is ever issued | the command allow-list test (no `push`, `remote`, `submodule`) |
| PR commands | **N/A** — this change shells no `gh` and opens no PR | — |

## Migration / Rollout

No migration. Additive: `--fixtures` keeps working unchanged (SPEC 1.5.3 needs it), the real path is
new behaviour behind its absence. Rollback per the proposal: revert `cli.ts`, delete the new
directories, delete `.cache/`.

## Open Questions

- [ ] **`sources.yml` must gain `wazuh-dashboard-ml-commons` (`kind: dashboard`)** — a one-line data
      change the proposal's Affected Areas does not list. D4 requires that repo to reach `skipped[]`
      *by discovery*; `fetch/` can only discover a repo `sources.yml` names. Without it the criterion
      is unprovable and the deleted hardcode has no replacement. SPEC 1.3's example list also omits
      it, so a follow-up should reconcile the two.
- [ ] **A1 (apply must confirm with a test):** `git clone` creates leading directories, so `fetch/`
      needs no `mkdir`. If apply finds otherwise, add `ensureDir` to `FetchIo` — one more member on
      an already-injected object, no structural change.
- [ ] Open SPEC decision 1 (`wazuh-dashboard-reporting` vs `wazuh-dashboards-reporting`) stays
      unresolved. Either way the repo resolves or lands in `skipped[]`; no design change depends on it.

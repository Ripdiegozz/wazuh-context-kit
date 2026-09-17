# Verification report — `mcp-server` (Phase 3)

Independent verification, adversarial, from evidence. No code was modified.
No commit, PR, or write against `wazuh/*` was made or attempted.

## 1. Criteria table (SPEC.md §3.6, 12 items)

| # | Criterion | Status | Test (file:line) | Doubt |
|---|-----------|--------|-------------------|-------|
| 1 | `docs` retrieves a page and cites it as `.html` | Covered | `src/mcp/docs.test.ts:38-65` (fake transport); `src/mcp/docs.integration.test.ts:25-49` (real network canary) | None. Both the unit test (asserts `citationUrl` ends in `.html`) and the live canary (asserts against the real site) exist. |
| 2 | `docs` fails clearly on an unmapped ref, distinct from a mapped-but-dead path | Covered | `src/mcp/docs.test.ts:67-95` — asserts `unmapped.reason === "unmapped-ref"`, `deadMapped.reason === "unavailable"`, and `unmapped.message !== deadMapped.message` | None. This is a real differential assertion, not just two independent checks that happen to pass. |
| 3 | Canary asserts 200 **and** `content-type: text/markdown` **and** body does not start with `<!DOCTYPE`, gated by `WAZUH_CTX_NETWORK=1` | Covered | `src/mcp/docs.ts:140-143` (`isMarkdownHit` combines all three signals); `src/mcp/docs.integration.test.ts:21-22,41-47` (gate + all three assertions against the real site) | None. Ran live (`WAZUH_CTX_NETWORK=1 bun test src/mcp`) below — it hit the real site and passed. |
| 4 | Version mapping is validated (not derived), against two independent sources, never rewrites the mapping | Covered | `src/mcp/docs-validate.test.ts:28-48` (dead path), `:50-83` (release-state drift, and explicitly asserts `docsVersionMap` is unchanged via `snapshotBefore` deep-equality at line 82) | None. The "never rewrites" half is asserted directly, not just implied by the function never being given a write handle. |
| 5 | `schema` responds without network from the published dataset | Covered | `src/mcp/dataset.test.ts:30-37` (`4.1`, reads `out/5.0.0/` with no transport injected at all) | None. |
| 6 | `schema` refuses to start when `payloadHash` doesn't validate, tested with a byte flip | Covered | `src/mcp/dataset.test.ts:39-75` (`4.2`) — copies the **real** committed dataset, flips one character inside a `pluginId` string value, and asserts `reason === "hash-mismatch"` with both hashes present and different | None. This is exactly the kind of test the project has been burned by NOT having before: it mutates a real artifact rather than asserting against a hand-built fixture that shares the implementation's assumptions. |
| 7 | Every `schema` response carries `ref`, `payloadHash`, `resolvedAt` | Covered | `src/mcp/schema.test.ts:27-41` (`4.4/4.6`, checked across all three handlers: `matrix()`, `indexTemplates()`, `wcsModules()`) | None. |
| 8 | Ref mismatch refused by default, served with `--allow-ref-mismatch`, **and** detached HEAD produces a distinct message (three-way split) | Covered | `src/mcp/startup.test.ts:65-94` (mismatch refuses, names both refs), `:96-118` (`--allow-ref-mismatch` serves the same mismatch), `:120-153` (detached HEAD refuses with `reason: "branch-undeterminable"`, and explicitly asserts the message differs from the mismatch message and does not contain the ref), `:155-189` (unrecognised `cwd` serves with `world: "unknown"`) | None — all three (plus the fourth "unrecognised cwd serves" case) are distinct tests with distinct assertions on distinct `reason` values (`"ref-mismatch"` / `"branch-undeterminable"` / no refusal at all). This is the strongest-covered criterion in the set: it is exactly the collapse the module's own docblock (`startup.ts:9-23`) warns against, and the four outcomes map 1:1 onto four separate tests. |
| 9 | A cell overridden by `decisions.local.yml` is marked `overlay: "local"` | Covered | `src/decisions/decisions.test.ts:178-195` (marked when local), `:197-204` (NOT marked when the same field is resolved from non-local `decisions.yml` — a genuine negative control), `:216-236` (no local file → no `overlay` key anywhere, **and** `payloadHash` equals a pinned pre-change hash literal, `sha256:4009de2a...`) | None. Line 233's assertion against a literal, previously-captured hash is real regression coverage, not a tautology — it would catch the marker leaking into the canonical payload even if every other assertion in the file were deleted. |
| 10 | A dataset with `resolvedAt` 40 days old warns | Covered | `src/mcp/schema.test.ts:58-68` (40 days → warning present, across all three handlers), `:70-78` (29 days → no warning, boundary check) | None. Both sides of the 30-day boundary are tested. |
| 11 | The server announces the world before the first query | Covered | `src/mcp/startup.test.ts:203-234` (asserts event order `["announce", "first-query-answered"]`), `:236-263` (announce never called on refusal) | Minor: the "first query" side is simulated (`events.push("first-query-answered")` after `await runStartup(...)` resolves), not a real MCP client issuing a real read. That is acceptable here because the ordering guarantee is structural — `announce` runs synchronously inside `runStartup` before the promise resolves (`startup.ts:107-108`), and `cli.ts:850-864` calls `runStartup` and only builds/connects the server afterward — so no real caller can reach a query before announce fires. The property genuinely can't regress without this test catching it. |
| 12 | `runtime` absent does not block `docs`/`schema` | Covered | `src/mcp/runtime.test.ts:35-53` (both "not configured" and "unreachable" resolve to `null`, never throw); `src/mcp/protocol.test.ts:102-117` (real end-to-end: with `runtimeSnapshot: null`, `resources/list` returns only `["schema"]` and a real `docs` read still succeeds over the protocol), `:119-128` (a configured runtime adds `"runtime"` to the listing without removing `"schema"`) | None. `protocol.test.ts` is the strongest possible proof here: it drives a real `@modelcontextprotocol` `Client`/`McpServer` pair over `InMemoryTransport`, so this isn't just "the code never throws" — it's "the wire protocol actually reflects the conditional registration." |

**12/12 covered**, with two items I looked at hardest for the "fixture shares the implementation's assumptions" failure mode (bug pattern this project was burned by before): #6 (hash-mismatch) and #9 (overlay/payloadHash invariance). Both mutate or check against real, independently-captured artifacts (the actual committed dataset; a hash literal captured before the change), not hand-built fixtures that assume the same thing the code assumes. Neither is a tautology.

## 2. Specific claims checked

### 1. `payloadHash` invariance for `out/5.0.0/matrix.json`

- `git status --porcelain -- out/` → **empty**. `git diff --stat -- out/5.0.0/matrix.json` → **empty**. The committed dataset is byte-for-byte untouched.
- Recomputed the hash directly (not trusting the loader's own internal check): loaded `out/5.0.0/matrix.json`, called `verifyPayloadHash` from `src/matrix/hash.ts` on it.
  ```
  { "ok": true,
    "expected": "sha256:0d63d44813eeeeb5bbb172ad7e012c82858707c919a297b5113b245a6f4f8902",
    "actual":   "sha256:0d63d44813eeeeb5bbb172ad7e012c82858707c919a297b5113b245a6f4f8902" }
  ```
- **Verified.** The claim ("no regeneration needed because `canonicalize` drops `undefined` keys") holds against the actual committed artifact, not just in the abstract.

### 2. Three ref-gate outcomes not collapsed

Confirmed distinct in both code and tests:
- `branch !== ref` → `reason: "ref-mismatch"`, message names both (`startup.ts:94-104`, test at `startup.test.ts:65-94`).
- detached HEAD → `reason: "branch-undeterminable"`, message explicitly does **not** contain the ref and is asserted `!==` the mismatch message (`startup.ts:85-92`, test at `startup.test.ts:120-153`).
- `cwd` outside any known repo → serves, `world: "unknown"` (`startup.ts:82` guard only applies `if (world.recognised)`; unrecognised world skips the whole gate) (test at `startup.test.ts:155-189`).

All three have distinct `reason`/outcome values and distinct tests. No collapse found.

### 3. Two distinct `docs` failures

Confirmed: `"unmapped-ref"` (config gap, `docs.ts:110-119`) vs `"unavailable"` (mapped path exists but didn't answer as documentation, `docs.ts:145-157`), with a differential test at `docs.test.ts:67-95` that builds both in the same test and asserts the reasons and messages differ.

### 4. The canary

`docs.ts:140-143` combines all three signals (`status === 200`, `content-type` includes `text/markdown`, body doesn't start with `<!DOCTYPE`) into one `isMarkdownHit` boolean used for both the request-time check and (indirectly, via `docs-validate.ts`'s `probeMappedPath`) the mapping validator. The integration test (`docs.integration.test.ts`) asserts the success path against the real site and is gated by `WAZUH_CTX_NETWORK === "1"` (`docs.integration.test.ts:21-22`), confirmed to **not** run in a default `bun test` (see run log below — network tests are absent from the 477-test default run) and to run and pass when the env var is set (see run log below).

### 5. The validator never rewrites the mapping

Confirmed at the type level (`docs-validate.ts` takes `DocsVersionMap` by read-only interface reference and never assigns into it) and asserted directly in `docs-validate.test.ts:56,82` via a deep-equal `snapshotBefore` check surviving the validation call.

### 6. Telemetry: no query content, bounded, sink absent at construction

- Contentless: `telemetry.ts`'s `TelemetryEvent` type only carries `plugin`, `field`, `resolved`; `server.ts` only ever calls `.record({ plugin, field, resolved })` (`server.ts:70,91,125`) — the docs handler passes `path` as `field`, never the fetched body or the citation. Test at `telemetry.test.ts:23-48` additionally greps the written file for `"SELECT"`/`"query"` as a sanity net.
- Opt-out at construction: `createTelemetrySink` returns a fixed `noopSink` object when `enabled: false` (`telemetry.ts:94-95`), so `server.ts` calls `.record()` unconditionally with no per-call-site `if`. This matches the requirement's "absent sink at construction rather than a flag checked per call site" literally.
- Bounded: `DEFAULT_MAX_ENTRIES = 10_000`, oldest-first drop via `slice(next.length - maxEntries)` (`telemetry.ts:104`), tested at `telemetry.test.ts:69-86` with `maxEntries: 3` and 5 writes, asserting the two oldest were dropped and the three newest survive **in order**.

### 7. `runtime` absent doesn't block `docs`/`schema` "by construction"

Confirmed in `server.ts:112-131`: `docs` and `schema` are registered unconditionally (lines 60-107), and the `runtime` registration is the only one wrapped in `if (options.runtimeSnapshot !== null)`. There is no other conditional anywhere in the file gating `docs`/`schema` on `runtime`'s presence. `protocol.test.ts` proves this holds through the real wire protocol, not just in the composition function's source.

### 8. Layering (SPEC §6.1) — `src/matrix/` stays pure

- `rg -n "node:fs|fetch\(|Date\.now|new Date\(" src/matrix/*.ts` → **no matches**.
- `rg -n "from \"\.\./mcp" src/matrix/*.ts` and `rg -n "mcp/" src/matrix/*.ts` → **no matches**. `src/matrix/` does not import from `src/mcp/` in either direction.
- (`src/mcp/*.ts` does import from `src/matrix/types.ts` and `src/matrix/hash.ts` — the allowed direction, matrix as the pure core, mcp as an adapter.)

### 9. `sources.yml` maps `"5.0.0": "5.0-beta"`

Confirmed at `sources.yml:53`: `"5.0.0": "5.0-beta"`, under a `docsVersionMap` block carrying `owner: diego.garcia` and `lastReviewed: "2026-09-17"` (`sources.yml:47-49`), with an inline comment explaining the correction from the earlier (dead) `"5.0"` value.

### Wazuh read-only rule

Searched `src/mcp/*.ts` and the whole of `src/` for write-capable git subcommands and `gh` mutations:
- `rg -n "push|commit|remote add|gh issue|gh pr|gh api" src/mcp/*.ts` (excluding test files) → only false-positive matches on `.push(...)` (Array.push) in `docs-validate.ts`, not git.
- The only `commit`/`remote add`/`push` occurrences anywhere under `src/` are inside test files (`startup.test.ts`, `world.test.ts`, `cli-sync-check.test.ts`, `cli-skills-diff.test.ts`, `fetch/sparse-disk.test.ts`) and every one of them operates on a disposable local temp repo created by the test itself (`mkdtemp` + `git init`), never against a `wazuh/*` remote. `fetch/fetch.test.ts:531` additionally asserts explicitly that `push` is never among the git verbs the fetcher issues.
- **No violation found.**

## 3. Verification commands — observed output

```
$ bun test
 473 pass
 4 skip
 0 fail
 1366 expect() calls
Ran 477 tests across 51 files. [7.65s]

$ bun run typecheck
$ tsc --noEmit
(no output — clean)

$ bun run build
$ bun build ./src/cli.ts --target node --outdir dist
Bundled 227 modules in 23ms
  cli.js  1.63 MB  (entry point)

$ WAZUH_CTX_NETWORK=1 bun test src/mcp
 39 pass
 0 fail
 119 expect() calls
Ran 39 tests across 10 files. [1.55s]
```

The 4 skips in the default `bun test` run are the network-gated tests (the `docs` canary among them) correctly not running without `WAZUH_CTX_NETWORK=1` — confirmed by the second run, scoped to `src/mcp`, showing 39/39 passing once the gate is opened, i.e. the canary actually reached `documentation.wazuh.com` and got a real 200 + `text/markdown` + non-HTML body back.

`git status --porcelain` after all of this shows no new or modified files beyond what was already present at task start (my one scratch file, `verify_hash_tmp.ts`, was created and removed within this session).

## 4. Findings

No blocking defects found. Two observations, neither blocking:

1. **Minor — criterion 11's "first query" side is simulated, not driven through a real MCP client** (see doubt column above). This is low-risk because the ordering guarantee is enforced structurally (synchronous callback inside an awaited function, called from `cli.ts` before the server is even constructed), not by a race that a test could plausibly miss. A stronger version of this test would drive `protocol.test.ts`'s real `Client`/`McpServer` pair and assert a `console.error` spy fired before the first `readResource` resolves — worth doing if this codebase ever refactors `runStartup`'s calling convention, not urgent now.

2. **Design note, not a defect**: `runtime.ts`'s `resolveRuntimeBackend` collapses "not configured" and "unreachable" into the same `null` outcome by design (per its own docblock, because there's no protocol-level way to report *why* runtime is absent). This is explicitly the SPEC's intent ("simply not registered") and is tested as such — flagging only so a future reader doesn't mistake it for missing error-mode coverage.

## 5. Verdict

**This closes Phase 3.** All 12 acceptance criteria in SPEC.md §3.6 have real, non-tautological test coverage that would fail if the described behaviour regressed — including the two criteria (hash-mismatch, overlay/payloadHash invariance) I specifically stress-tested for the "fixture shares the implementation's assumptions" failure mode this project has been burned by before, and both hold up under a byte-flip test against the real committed artifact and a pinned pre-change hash literal, respectively. `bun test`, `bun run typecheck`, and `bun run build` are all green; the real-network canary passes when explicitly enabled and is confirmed absent from the default run. The committed `out/5.0.0/matrix.json` is untouched and its `payloadHash` independently re-verifies. `src/matrix/` remains free of `node:fs`, network calls, `Date.now()`/`new Date()`, and any import from `src/mcp/`. No write-capable git or `gh` operation exists anywhere in the new code against a real remote.

What is left, if anything: only the non-blocking test-strength note in Finding 1 above, which is a "nice to have" hardening, not a gap in the contract.

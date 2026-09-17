# Tasks — `mcp-server`

Strict TDD. Every task writes its failing test first. Verification commands:
`bun test`, `bun run typecheck`, `bun run build`.

Tasks are grouped into six work units. The grouping is not decoration: each unit
is independently reviewable and leaves the tree green, so it is also the split if
the review budget forces one.

## Unit 1 — the contract moves first

- [x] 1.1 Amend `SPEC.md` §3.1: `llms.txt` is published at the site root, not per
      version; `/current/` aliases the latest stable line and `docs` never
      defaults to it under a pinned ref; the version list in `llms.txt` is
      illustrative, not an allowlist.
- [x] 1.2 Add the twelfth criterion to `SPEC.md` §3.6 — the mapping is validated,
      not derived. Written in Spanish, matching the file.
- [x] 1.3 Correct `sources.yml`: `"5.0.0": "5.0-beta"`, move `lastReviewed`.

## Unit 2 — `sources.yml` gains a typed `docsVersionMap`

- [x] 2.1 Test: a well-formed `docsVersionMap` parses, exposing owner,
      `lastReviewed` and the map.
- [x] 2.2 Test: a malformed block throws naming the file and the offending path.
- [x] 2.3 Test: an absent block is tolerated — the loader must not become fatal
      for a file that predates this change.
- [x] 2.4 Implement `docsVersionMapSchema` and extend `loadSources`.

## Unit 3 — `overlay: "local"` in the domain layer

- [x] 3.1 Test: a cell written from `decisions.local.yml` carries
      `overlay: "local"`.
- [x] 3.2 Test: with no local file, no cell carries an `overlay` key **and**
      `payloadHash` is byte-identical to the pre-change value. This is the test
      that proves `out/5.0.0/` needs no regeneration — assert the literal hash.
- [x] 3.3 Thread `localOverrides` into `applyHumanLayers`; keep it pure.
- [x] 3.4 Extend the matrix types with the optional `overlay` field.

## Unit 4 — `schema` and its refusal gates

- [x] 4.1 Test: a dataset loads from `out/<ref>/` with no network.
- [x] 4.2 Test: a `matrix.json` with one byte altered refuses startup, naming
      expected and actual hashes.
- [x] 4.3 Test: an absent dataset refuses, naming the path.
- [x] 4.4 Test: every response carries `ref`, `payloadHash`, `resolvedAt`.
- [x] 4.5 Test: `resolvedAt` 40 days old warns on every response; 29 days does
      not. Clock injected.
- [x] 4.6 Implement `mcp/dataset.ts` and the `schema` handlers.

## Unit 5 — world detection and the ref gate

- [ ] 5.1 Test (hermetic, real git, temp repos): `cwd` resolves to a repository
      name via its remote, not its directory name.
- [ ] 5.2 Test: a repository absent from `sources.yml` yields world unknown, not
      a guess.
- [ ] 5.3 Test: branch ≠ dataset ref refuses, naming both.
- [ ] 5.4 Test: `--allow-ref-mismatch` serves the same mismatch.
- [ ] 5.5 Test: detached HEAD refuses with a message distinct from 5.3.
- [ ] 5.6 Test: the world is announced before the first query is answered.
- [ ] 5.7 Implement `mcp/world.ts` and `mcp/startup.ts`.

## Unit 6 — `docs`, the canary, the validator, `runtime`, telemetry, CLI

- [ ] 6.1 Test: a mapped ref builds the `.md` URL and cites the `.html` twin.
- [ ] 6.2 Test: an unmapped ref fails with a message distinct from a fetch miss.
- [ ] 6.3 Test: a 200 carrying `text/html` under a `.md` path reports `docs`
      unavailable — it must not be returned as documentation.
- [ ] 6.4 Canary (network-gated, `WAZUH_CTX_NETWORK=1`): a known page's `.md`
      twin returns 200 + `text/markdown` + a body not starting with `<!DOCTYPE`.
- [ ] 6.5 Test: the validator fails on a mapping entry whose path 404s, naming
      the entry and its `lastReviewed`.
- [ ] 6.6 Test: the validator reports a changed release state and does **not**
      rewrite the mapping.
- [x] 6.7 Test: `runtime` absent leaves `docs` and `schema` serving.
- [x] 6.8 Test: telemetry records `(plugin, field, resolved)` with no query
      content; `--no-telemetry` writes nothing; the sink is bounded.
- [x] 6.9 Implement `mcp/docs.ts`, `mcp/docs-validate.ts`, `mcp/runtime.ts`,
      `mcp/telemetry.ts`.
- [x] 6.10 Wire `mcp/server.ts`: capability registration, stdio transport,
      conditional `runtime` registration.
- [x] 6.11 One end-to-end protocol test with a real `Client` over
      `InMemoryTransport` from `@modelcontextprotocol/client` (devDependency).
- [x] 6.12 CLI: add `--allow-ref-mismatch`, `--no-telemetry` and the resource
      selector to `parseArgs`; update `USAGE`; replace `case "mcp"` with
      `runMcp`.
- [x] 6.13 `package.json`: add `@modelcontextprotocol/server` and
      `@modelcontextprotocol/core` as dependencies, `@modelcontextprotocol/client`
      as a devDependency.

## Review Workload Forecast

Estimated, by unit, source plus tests:

| Unit | Source | Tests | Total |
| --- | --- | --- | --- |
| 1 — spec amendment + config fix | ~45 | 0 | **~45** |
| 2 — `docsVersionMap` schema | ~50 | ~70 | **~120** |
| 3 — `overlay` in domain layer | ~35 | ~60 | **~95** |
| 4 — `schema` + refusal gates | ~180 | ~200 | **~380** |
| 5 — world detection + ref gate | ~190 | ~230 | **~420** |
| 6 — `docs`, canary, validator, runtime, telemetry, CLI | ~420 | ~380 | **~800** |
| | | | **~1,860** |

- **Estimated changed lines: ~1,860**
- **400-line budget risk: High**
- **Chained PRs recommended: Yes**
- **Decision needed before apply: Yes**

The forecast is roughly **4.6× the 400-line policy**, and unit 6 alone exceeds it
twice over. This is the direct and predicted consequence of taking all of Phase 3
as one change rather than slicing it — it was flagged before exploration began and
the measurement now confirms the size rather than revising it.

The six units above are already a viable chain: each is independently reviewable,
each leaves the tree green, and units 1–3 are small and touch existing files while
4–6 are additive. Unit 6 would itself want splitting — plausibly `docs` + canary +
validator, then `runtime` + telemetry + CLI wiring.

The delivery strategy on record is `single-pr`, which does not permit ~1,860 lines
without an explicitly recorded `size:exception`. **This decision belongs to the
maintainer and apply does not start until it is made.**

## Delivery decision

**`size:exception` recorded — maintainer decision, 2026-09-17.**

The forecast above (~1,860 lines, 4.6× the 400-line policy) was presented with a
six-PR chain as the recommended alternative. The maintainer chose one PR with an
explicit exception. The review cost was stated before the choice and is accepted
knowingly: the subtle parts of this change — the three distinct ref-gate
messages, and the `payloadHash` byte-invariance that makes the `overlay` marker
free — are the parts a skimmed review of a large PR misses. Task 3.2 asserts the
literal hash precisely so that one cannot pass unnoticed.

`delivery_strategy: single-pr` + `size:exception`.

## Unit 7 — closing the blockers

Added after independent verification, 2026-09-17.

- [x] 7.1 Harden the announce-ordering proof. The original test simulated the
      "first query" by pushing a string after `runStartup` resolved. A test that
      simulates the thing it claims to observe proves nothing about ordering, so
      it now issues a real `resources/read` through a real `Client` over
      `InMemoryTransport` and asserts the announce landed first. Passed on the
      first run; no production code changed to make it pass. The original
      simulated test is kept — it still covers the refusal case.
- [x] 7.2 Tick SPEC §3.6 with the evidence, and mark Phase 3 done in §7's build
      order. 56 of 61 criteria now met.
- [x] 7.3 Amend `CLAUDE.md`: the read-only boundary is what git is pointed at,
      not which verb is used. World detection reads the consumer's own checkout
      with `config --get` and `symbolic-ref`, neither of which appeared in the
      seven-subcommand list. Saying which rule they fall under is honest;
      widening the remote-facing list quietly would not have been.
- [x] 7.4 Update `HANDOFF.md`, which still described `src/mcp/` as empty.
- [x] 7.5 `.codegraph/` added to `.gitignore` — a per-checkout index was about to
      land in the PR.

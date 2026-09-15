```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:a3f2906410998024d7f1e5452a270c8faaa0ec5c9a0dac4f49d89fa2e35d1ff1
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 14/14
scenarios: 18/18
test_command: bun test
test_exit_code: 0
test_output_hash: sha256:8e55c70d8d7c50dc8f1066fbb6c119db8039a7d16cdd13f79b7f230424eb9a08
build_command: bun run build
build_exit_code: 0
build_output_hash: sha256:0af53b345b15d0d3529566376c72ceea73207794944681fe6cc635635aab76dc
```

# Verify Report — `phase-1-real-data`

> Phase: `sdd-verify`
> Round 1: 2026-09-14, by an independent `sdd-verify` agent with no memory of
> the conversation that produced the specs. Verdict then: PASS WITH WARNINGS,
> two scenarios uncovered.
> Round 2: 2026-09-15, after the batch-2 apply closed those two scenarios.
> Round 2 ran in the orchestrator thread, because this runtime refuses SDD
> child dispatch (Claude Code exposes no authenticated caller provenance, so a
> parent-confirmed preflight cannot be transported to a sub-agent). Round 2 is
> therefore a re-verification with full context, not a blind one — round 1's
> independence is what backs the findings it produced, and nothing in round 1
> was revised, only closed.

**Verdict: PASS WITH WARNINGS.** All 14 requirements and all 18 scenarios now
carry runtime evidence. The two remaining warnings are open human decisions,
not spec violations.

## Round 2 evidence (2026-09-15)

| Command | Exit | Observed |
|---|---|---|
| `bun test` | 0 | 104 pass · 1 skip · 0 fail · 281 assertions · 105 tests · 8 files |
| `bun run build` | 0 | 184 modules, `dist/cli.js` 0.95 MB |
| `node dist/cli.js --version` | 0 | `0.1.0` |
| `bun run typecheck` | 0 | clean |
| `git diff --stat -- src/matrix src/decisions/apply.ts` | 0 | empty — purity seam (SPEC 6.1, D1) holds |
| `WAZUH_CTX_NETWORK=1 bun test src/fetch/network.integration.test.ts` | 0 | 1 pass · 5 assertions · 2.67 s |

Round 1's baseline was 94 pass · 1 skip · 0 fail. The ten new tests in
`src/fetch/sparse-disk.test.ts` (2) and `src/cli.test.ts` (8) are the delta.

## Per-capability result

### `repo-fetch` — 4 requirements, 6 scenarios

All satisfied.

**Round 1 CRITICAL — "checked-out tree is sparse" had no runtime evidence.**
The tests asserted argv intent only: a fake runner confirmed
`sparse-checkout set <paths>` was issued with the right path set. Nothing had
ever inspected an on-disk checkout.

**Closed in round 2.** `src/fetch/sparse-disk.test.ts` drives the production
`cloneRepo()` with the real `createGitRunner()` against a throwaway `file://`
origin, then walks the working tree. The assertion has teeth in both
directions, proven by injected regression: removing the `sparse-checkout set`
call leaves only root files and fails the test; widening the indexer path set
to `["plugins", "wcs"]` materialises `plugins/unrelated/` and
`plugins/setup/src/main/java/` and also fails it.

**Refinement to the requirement's meaning.** `sparse-checkout init --cone`
always materialises the repository's top-level files, in addition to the
directories passed to `sparse-checkout set`. "Only the SPEC 1.2 paths are
present on disk" therefore means "the declared subtrees, plus root files". The
test encodes that boundary explicitly rather than pretending it away. The spec
text is still satisfied in substance — no full plugin source tree is checked
out — but anyone reading the requirement literally should read this note too.

### `source-parse` — 6 requirements, 6 scenarios

All satisfied. Round 1's "≥ 18 templates rested on a manual run" warning was
closed by executing `WAZUH_CTX_NETWORK=1` (20 templates found against real
data); round 2 re-executed it: 1 pass, 5 assertions, 2.67 s.

### `matrix-pipeline` — 4 requirements, 6 scenarios

All satisfied.

**Round 1 CRITICAL — "`--fixtures` path is unaffected" was never proven.**
Closed during round 1 itself by a detached worktree at `e4e4b28` producing
byte-identical `--fixtures` output.

**Round 1 WARNING — no CLI-level test existed at all.** Closed in round 2.
`src/cli.test.ts` spawns the CLI as a real process — exit codes and stderr are
the contract, and an in-process call cannot observe `process.exit` — and covers
`--fixtures` parity against a pinned `payloadHash` plus byte-identical
`matrix.json`/`MATRIX.md` across two runs, the fatal exit-2 paths
(schema-invalid `sources.yml`, missing `sources.yml`, git unresolvable), and
argument handling (`--version` → 0, unknown command → 64, unimplemented
command → 2).

The manual `--fixtures` parity check is now mechanised: the pinned hash
`sha256:1f9274f5…` is a pure function of the bundled fixtures plus the
committed human layers, so a deliberate edit to `decisions.yml` updates the
literal in the same commit and an accidental one fails review.

## Open items — warnings, not blockers

1. **Fixture drift.** `fixtures/facts.ts` `wazuhMain` omits `"data"` from
   `requiredPlugins`, so its `indexerAccess` computes to `[]` where reality is
   `["osd-data"]`. No test hardcodes the wrong value as an expectation, so this
   is fixture-accuracy debt rather than a spec violation. Needs a human ruling:
   fix the fixture, or state in the file that it is shape-only.

2. **Platform-kind gap.** `sparsePathsFor("platform")` returns `[]` and
   `wazuh-dashboard` carries no root-level manifest, so `parseRepoManifests`
   legitimately yields zero facts. `design.md` records this as deliberate, so it
   violates none of the three specs. Round 2 adds the on-disk explanation: a
   `platform` clone checks out root files only, verified by test. Still a live
   ambiguity in `SPEC.md` 1.5.2 needing a recorded human decision.

Both are tracked in `HANDOFF.md` under P2 and neither blocks archive.

## Findings from round 2 worth carrying

1. **Cone mode always checks out top-level files.** See the `repo-fetch`
   refinement above. No argv-level test could have surfaced it.

2. **`PATH=""` does not hide a binary.** An empty or unset `PATH` makes libc
   fall back to a built-in default (`/bin:/usr/bin`), where git usually lives.
   The first draft of the git-missing test therefore found git, exited 0 instead
   of 2, and spent 11 s on the network inside what was meant to be an offline
   unit test. Pointing `PATH` at a real, empty directory makes the lookup fail
   with ENOENT; the suite then runs in 449 ms. The 24x runtime drop was the
   signal that the test had been lying — a passing assertion is not the same as
   a correct one.

## Task ledger

All 53 tasks are complete. Round 2 ticked 12.1 and 12.2 on the evidence above.

## Result contract

- **status:** `done`
- **next_recommended:** `sdd-archive`
- **risks:** two open human decisions (fixture drift, platform-kind
  classification), neither a spec violation; round 2 was a full-context
  re-verification rather than a blind one, because this runtime refuses SDD
  child dispatch.
- **skill_resolution:** `paths-injected`

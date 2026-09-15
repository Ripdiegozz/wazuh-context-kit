# Verify Report — `phase-1-real-data`

> Phase: `sdd-verify` · 2026-09-14
> Persisted by the orchestrator: the `sdd-verify` agent has no write tool and
> returned its report inline.

**Verdict: PASS WITH WARNINGS.**

The verifier read the three capability specs with no memory of the conversation
that produced them, which is the whole point of the phase: the orchestrator had
verified against the spec it remembered writing. Two scenarios turned out to be
untested — both were assumed covered and neither was.

## Method

No shell tool was available to the verifier, so every finding below comes from
reading source, tests and artifacts, cross-referenced against command evidence
the orchestrator had already observed. Findings marked **closed since** were
executed by the orchestrator after the report and are no longer open.

## Per-spec verdict

### `repo-fetch` — 4 requirements, 6 scenarios

Satisfied, except one.

**CRITICAL — "checked-out tree is sparse" has no runtime evidence.** The tests
assert argv intent: the fake runner confirms `sparse-checkout set <paths>` is
issued with the right path set. No test, automated or manual, has ever inspected
an on-disk checkout to confirm that only the SPEC 1.2 paths landed there.
Real-world risk is low — git honours a correct argv — but a scenario is only
compliant when a covering test passed at runtime, and this one has none.

**Still open.** Needs a test that asserts against actual directory contents.

### `source-parse` — 6 requirements, 6 scenarios

All satisfied.

**WARNING — "≥ 18 templates" rested on a manual run.** The dedicated
`network.integration.test.ts` was written to prove it and had never once been
executed.

**Closed since:** run with `WAZUH_CTX_NETWORK=1` — 1 pass, 5 assertions, 3.72s.

### `matrix-pipeline` — 4 requirements, 6 scenarios

Satisfied, except one.

**CRITICAL — "`--fixtures` path is unaffected" was never proven.** Task 9.5 sat
unchecked. The orchestrator had compared two *post-change* runs against each
other, which proves determinism but says nothing about parity with the output
the code produced *before* the change.

**Closed since:** a detached worktree at `e4e4b28` (the commit preceding the
implementation) produced `--fixtures` output byte-identical to the current tree —
same `MATRIX.md` digest, same `payloadHash` (`sha256:1f9274f5…`). Task 9.5 can be
ticked honestly.

**WARNING — no CLI-level test exists at all.** `cli.ts`'s two invariants
(`--fixtures` parity, fatal exit-2 paths for a malformed `sources.yml` and a
missing `git`) are structurally true by code order and proven only by manual
runs. Nothing would catch a regression.

## Open items — confirmed and root-caused

1. **Fixture drift — confirmed, downgraded to WARNING.** `fixtures/facts.ts`
   `wazuhMain` omits `"data"` from `requiredPlugins`, so its `indexerAccess`
   computes to `[]` where reality is `["osd-data"]`. No existing test hardcodes
   the wrong value as an expectation, so this is fixture-accuracy debt rather
   than a spec violation.

2. **Platform-kind gap — confirmed and root-caused.** `sparsePathsFor("platform")`
   returns `[]` and `wazuh-dashboard` carries no root-level manifest, so
   `parseRepoManifests` legitimately yields zero facts. `design.md` records this
   as deliberate, so it violates none of the three specs. It is a live ambiguity
   in `SPEC.md` 1.5.2 needing a recorded human decision, not an apply defect.

## New findings

3. No `cli.test.ts` exists anywhere in the repository.
4. Task 9.4's fatal exit-2 paths have zero test coverage.

## Task ledger

Ticked on this evidence: 9.5, 10.1, 10.2, 11.1, 11.2, 11.3, 11.4.

Still open: the sparse-checkout disk assertion, which is new test code rather
than an execution.

## Result contract

- **status:** `done`
- **next_recommended:** a short `sdd-apply` work unit for the remaining P0
  (sparse-checkout disk assertion), then `sdd-archive`.
- **risks:** no CLI-level regression coverage; the sparse-checkout scenario
  remains compliant by inspection rather than by execution.
- **skill_resolution:** `paths-injected`.

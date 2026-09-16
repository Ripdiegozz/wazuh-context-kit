```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
verdict: pass
blockers: 0
critical_findings: 0
requirements: 6/6
scenarios: 10/10
test_command: bun test
test_exit_code: 0
test_output_hash: sha256:f4900beb72015f592ac2ebce0868c28f10d0cc1d4fa8e798cfdf2911c8d62cfe
build_command: bun run build
build_exit_code: 0
build_output_hash: sha256:f475390265a188ccef5f2e89cf1ac68e06a07757805093c063d756129f26c261
```

# Verification — `sync-check`

Run 2026-09-16.

## Automated checks

| Command | Observed |
| --- | --- |
| `bun test` | 394 tests, 391 pass, 3 skip, 0 fail |
| `bunx tsc --noEmit` | clean |
| purity grep over `src/standards/{plan,verify}.ts` | 0 matches |
| `git status --porcelain .cache out` | empty |

## Slice 7 — confirmed against reality

| # | Check | Observed |
| --- | --- | --- |
| 7.1 | `sync` against the real extraction | **`0 of 6 distributed`**, exit `0`, **0 files written**, every skill's blocking conflicts named |
| 7.2 | `check` against a real cached clone | **`not-applicable`**, exit `0`, message `no .claude/standards/ present — nothing to check` |
| 7.3 | `.cache/` and `out/` untouched | clean |
| 7.4 | Three-step fixture demonstration | 1 test, 7 assertions, passing |
| — | Missing `--repo` | exits `64` |
| — | Workflow proposed, not installed | `proposals/check-standards.yml` present; nothing under `.github/workflows/` |

## The result, stated plainly

**The mechanism ships inert.** No repository under `wazuh/*` has
`.claude/standards/`, so `check` has no real target, and all six skills are
blocked by unresolved conflicts, so `sync` distributes nothing.

That is not a shortfall — it is SPEC 2.3's own framing, and it is what the tool
correctly reports about the repositories as they are today. What Phase 2
delivers is the mechanism and its demonstration. The demonstration is the fixture
test: `sync` materialises, `check` passes, a local edit is introduced, `check`
fails naming the file. Three steps, one test, against a real directory rather
than a mocked filesystem.

## One defect found by running it

The blocked output was unreadable. Each skill dumped every conflict onto a single
semicolon-separated line; `create-pr` alone was roughly 1,200 characters.

That is not cosmetic here. The spec's reasoning for `sync` exiting `0` is that
**the mitigation for "exit 0 reads as success" is the message**, and a message
nobody can read is not a mitigation. Fixed by rendering the skill name, its
conflict count, and the deduplicated heading paths, truncated with a pointer to
the `conflicts/<skill>.yml` that already holds the bodies:

```
blocked   create-pr  40 conflicts
            Prepare a Wazuh Dashboard pull request > Golden rules (do not skip) (4)
            Prepare a Wazuh Dashboard pull request > Issue source: public vs internal (10)
            Prepare a Wazuh Dashboard pull request > Workflow
            ... 4 more — see conflicts/create-pr.yml
```

The rendering moved into a pure `src/standards/render.ts`, testable with
literals like every other renderer here.

## Two deliberate decisions worth re-reading in six months

**`sync` with everything blocked exits `0`.** It looked at six skills, found
undeclared divergence in all six, and refused to publish. Treating a correct,
informative state as a command failure would make `sync` born always-failing,
and a command that always fails is one somebody removes from the pipeline —
after which it gates nothing. Same argument that decided the core floor.

**`check` exits non-zero on drift, while the crosscheck exits `0` on drift.**
Deliberate, not an inconsistency. The crosscheck is a diagnostic; a diagnostic
that fails a pipeline by doing its job becomes a tool nobody runs. `check` is a
gate whose only purpose is to stop on local edits, and a gate that does not stop
is not a gate. Copying the earlier decision here would have produced a command
incapable of the one thing it exists for.

## Limits

- **No real target exists.** Everything about `check` in production is untested by
  construction, because there is nothing to test it against until a `wazuh/*`
  repository gains `.claude/standards/` — which needs a PR this project does not
  open.
- **The ambiguous-anchor scenario is constructed.** After `skills-core` added
  heading scoping and ordinals, the real corpus produces zero ambiguous anchors,
  so that path is exercised by a hand-built `ExtractedSkill` rather than by the
  42 files. Saying so rather than implying coverage.
- Nothing is published to a registry. That is somebody's decision, not this
  change's.

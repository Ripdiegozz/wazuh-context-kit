# Archive report — `sync-check`

Closed 2026-09-16. Verdict `pass`, 0 blockers.

## What this closed

Three SPEC 2.4 criteria. **Phase 2 stands at 10 closed, 1 open** — the
`settings.json` one, held open deliberately since `skills-diff` because a
positional patch anchored to a heading has no JSON equivalent and handling it
here would mean two override engines under one name.

## What ships

The mechanism, inert. No `wazuh/*` repository has `.claude/standards/`, so
`check` has no real target; all six skills are blocked by unresolved conflicts,
so `sync` distributes nothing. Both are the tool correctly reporting the
repositories as they are, and both are SPEC 2.3's own framing.

What makes "delivered" a word with content is the demonstration: one test, three
steps, against a real directory — `sync` materialises, `check` passes, an edit is
introduced, `check` fails naming the file.

## Two decisions worth re-reading later

**`sync` with everything blocked exits `0`.** Treating a correct, informative
state as a command failure would make it born always-failing, and a command that
always fails gets removed from the pipeline, after which it gates nothing. The
mitigation for "exit 0 reads as success" is the message — which is why the
unreadable first version of that message was treated as a real defect rather
than as polish.

**`check` exits non-zero on drift while the crosscheck exits `0` on drift.**
Deliberate. The crosscheck is a diagnostic and a diagnostic that fails a pipeline
by doing its job becomes a tool nobody runs. `check` is a gate whose only purpose
is to stop on local edits. Copying the earlier decision out of a wish for
consistency would have produced a command incapable of its one job.

## Honest limits

- `check` in production is untested by construction — there is nothing to test it
  against until a `wazuh/*` repo gains `.claude/standards/`, which needs a PR
  this project does not open.
- The ambiguous-anchor scenario is constructed. After `skills-core` the real
  corpus produces zero ambiguous anchors, so that path is exercised by a
  hand-built value rather than by the 42 files.

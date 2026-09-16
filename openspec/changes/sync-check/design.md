# Design — `sync-check`

## The shape: `sync` writes, `check` hashes

```
src/standards/plan.ts      PURE  — extraction + target -> SyncPlan
src/standards/verify.ts    PURE  — manifest + observed hashes -> CheckResult
src/standards/apply.ts     IMPURE— writes the plan, reads the target
src/cli.ts                 WIRING
```

The pure halves matter for the same reason they did in every prior slice: every
decision here is a decision about values — which skills are distributable, which
files drifted — and each is testable with a literal rather than a filesystem.

## Decision 1 — `sync` plans before it writes

`planSync(extraction, target)` returns what *would* be written and what is
blocked, with no I/O. `applySync(plan, target)` performs it.

Two reasons beyond testability:

- The "0 of 6 distributed" report is the plan, printed. Building the report from
  the same value that drives the write makes them structurally unable to
  disagree — the failure where a summary says one thing and the disk holds
  another cannot occur.
- A dry run is then free, which SPEC 2.3 asks for: `check` runs dry against the
  cache clones because there is nothing real to write to.

## Decision 2 — the manifest is the contract between `sync` and `check`

`sync` writes `.claude/standards/manifest.json` alongside the materialised files,
carrying the content hash of each.

`check` compares observed hashes against it. Without a manifest `check` cannot
tell "edited locally" from "a different version was synced" — and reporting the
second as drift would be a false accusation, the failure class this project has
now met four times.

The manifest also carries the tool version and the extraction's payload hash, so
a mismatch can say *which* of the two happened.

## Decision 3 — three states, one enum, no booleans

```ts
type CheckState = "not-applicable" | "in-sync" | "drifted";
```

Not a boolean plus a special case. A boolean invites `if (!ok)` and that is
exactly how "no target" becomes "failed" or "fine" depending on which way the
author leaned.

Exit mapping lives in `cli.ts`, never in the pure layer: `not-applicable` → 0,
`in-sync` → 0, `drifted` → non-zero.

## Decision 4 — the per-skill gate is a filter, not a guard clause

`planSync` partitions skills into `distributable` and `blocked`, each blocked one
carrying its reasons. It never throws, never short-circuits, and never stops at
the first blocked skill.

A guard clause that returns early on the first conflict would produce today's
real behaviour — everything blocked — while reporting only the first reason,
which is useless to somebody trying to unblock six skills.

## Decision 5 — the fixture is a real directory, not a mock

`fixtures/standards-target/` is an actual directory that `sync` writes into
during the test and that the test cleans up. Not an in-memory filesystem and not
a mock.

The reason is specific to this project's history: the one thing that has caught
defects here, repeatedly, is exercising real I/O and real data. A mocked
filesystem would agree with whatever the code does, which is precisely the class
of test that let five defects through.

The test asserts the three-step round SPEC 2.3 names: materialise, pass, edit,
fail.

## Decision 6 — nothing touches the cached clones

Tests that need a target build their own. The suite must be able to assert that
no file under `.cache/` changed, and that assertion is worth making explicitly
rather than trusting.

## What could go wrong

- **`check` on a partially-synced target.** Some files present, some absent. That
  is neither clean drift nor "not applicable". It must be reported as drift with
  the missing files named, not as "not applicable" because something is missing.
- **Hash of what.** A manifest hashing the file including a trailing newline
  difference will report drift on a formatter's touch. Hash the exact bytes
  written and compare exact bytes read — no normalisation, because normalising
  is how a real edit gets hidden.
- **Exit `0` reading as success when nothing shipped.** Mitigated by output, not
  by the code. Worth a test that asserts the phrase `0 of` appears, because the
  mitigation is the message and an untested message rots.

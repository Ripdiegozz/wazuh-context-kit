# Archive Report — `close-phase-1`

> Phase: `sdd-archive` · 2026-09-15 · run inline

## Final state

| Dimension | State |
|---|---|
| Tasks | 49 / 49 (one **inverted**, see below) |
| Requirements | 9 / 9 with runtime evidence |
| Scenarios | 19 / 19 |
| Verify verdict | `pass_with_warnings`, 0 blockers |
| Delivery | three chained PRs: #10, #11, #12 |

`wazuh-ctx crosscheck` exists. SPEC 1.8 is built. **Phase 1 is closed for real**,
after `HANDOFF.md` claimed it was for weeks while 1.8 had never been written.

## Spec merge — ONE DESTRUCTIVE DELTA, and it was invisible by title

`openspec/config.yaml` says to warn before merging destructive deltas. The
archive check that compares requirement *headings* found nothing: every delta
title was new.

It was wrong. `source-parse` held **"Index templates discovered under
`templates/states`"**, which mandated recursing `templates/states/*.json` and
nothing else — the exact defect this change fixed. Its acceptance scenario asked
for "at least 18 templates", which the 20 in that one directory satisfied while
the other 20 stayed invisible.

Left in place, the source-of-truth spec would have contradicted itself: one
requirement ordering a narrow read, the next ordering a complete one. Superseded
explicitly, with the replacement carrying a note saying what it replaced and why
a heading comparison could not see it.

| Capability | Before | Added | Superseded | After |
|---|---|---|---|---|
| `repo-fetch` | 6 | 2 | 0 | 8 |
| `source-parse` | 10 | 3 | 1 | 12 |
| `matrix-pipeline` | 9 | 0 | 0 | 9 |
| `crosscheck` | — | 4 | — | 4 (new capability) |
| **Total** | | | | **33 requirements** |

## What this change actually cost, and what paid for it

Six defects shipped through a green test suite and were caught by something
other than tests.

**Four by a running indexer**, offered by the maintainer mid-change:

1. Three findings carried since exploration — `wazuh-metrics-comms-v4*`,
   `wazuh-agent-stats*`, `wazuh-agent-config*` — were false. All declared. They
   had been repeated in a proposal, two pull requests, and a task that
   *asserted they must appear*.
2. Equality matching was the wrong model: the repository declares
   `wazuh-findings-v5*` and the indexer expands it into sixteen installed
   templates.
3. The scanner recognised one file's convention, so six live indices under
   security analytics were reported as having no consumer. **The maintainer
   found that from product knowledge, not from the tool.**
4. But a `wazuh-` prefix proves nothing: 77 distinct names recovered, zero
   existing.

**Two by review.** Exact index names were prefix-matched against each other, so
two distinct indices cancelled and both findings vanished. A one-line index map
never closed, swallowing every later literal in the file.

The pattern is identical each time: **a fixture that encodes the same assumption
as the code proves the assumption, not the behaviour.** The `.ndjson` structure,
the catalog convention, the WCS linkage, the matching rule — four fixtures, four
assumptions, four green suites.

## Carried forward

**One acceptance criterion is deliberately unticked** (SPEC 1.10, last item).
The crosscheck compares two repositories, not the running system. An index can
be declared, hold data, be queried, and still be reported unconsumed. That
happened six times here.

The fix is `wazuh-ctx crosscheck --indexer <url>`: the dataset stays generatable
without it, since CI has no stack and `out/` must be deterministic, but a
developer gets a third column — **declared / referenced / actually exists**. The
dashboard team's dev environment (`os-dev-360`) ships that indexer as standard,
so this is a source the design can assume, not a lucky accident.

**Recovery from source has a ceiling**, and the report states it before its
findings: ten mechanisms remain unrecoverable — a regex allowlist accepting by
shape, six runtime-configuration lookups, three computed expressions. When
TypeScript 7.1 publishes a public compiler API, the third group becomes
recoverable without a new package; the scanner's docblock carries that trigger.

**This verification was not independent.** Given six defects passed a green
suite here, a fresh session re-reading these specs against the diff would be
worth its cost.

**Two findings deserve a person.** `wazuh-cve*` is declared in the repository and
not installed in the running indexer. `wazuh-ai-assistant-sessions` exists and
holds data while no dashboard code references it.

## Task ledger

49 of 49. Task 8.6 was **inverted rather than ticked**: it asked to confirm three
findings appear, and all three are false. A task that asserts a finding must
appear can only be satisfied by a bug — and one nearly was, since a matching
rule had been designed around preserving one of them.

## Result contract

- **status:** `done`
- **next_recommended:** none — the cycle is closed
- **risks:** a repo-versus-repo blind spot with a named fix; a static-recovery
  ceiling stated in the artifact; a non-independent verification
- **skill_resolution:** `paths-injected`

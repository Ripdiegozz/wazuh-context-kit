# Archive report — `crosscheck-live-indexer`

Closed 2026-09-15. Verdict `pass`, 10/10 requirements, 18/18 scenarios,
0 blockers.

## What this closed

The last unticked acceptance criterion in Phase 1 (SPEC 1.10): the crosscheck
compared two repositories against each other, never against the running system.
It now does both. Phase 1 has no open criteria.

## Delta merged

Ten requirements merged into `openspec/specs/crosscheck/spec.md`, which now
carries 14.

## The part worth remembering

The expected answer was computed by an independent oracle **before** the
implementation existed, and the implementation was checked against that oracle
rather than against itself. Three defects surfaced that a green suite did not
catch:

1. `_cat/indices` excludes hidden indices by default — 52 of 103. Six declared
   patterns were installed and invisible. Found with no code written.
2. `wazuh-threatintel-filters` is declared without a trailing `*`. A real bug in
   the indexer repository, found with no code written.
3. The declared set excluded WCS module patterns, falsely accusing
   `.wazuh-internal-state` of being undeclared. Found by the live run, after a
   231-test suite passed.

One reported defect turned out not to be real — a missing section was an
artifact of the verifier's own grep filter. Recorded rather than deleted.

This is the second consecutive cycle in which the running system corrected the
test suite. The practice that worked, both times, was refusing to let the code
be its own witness.

## Follow-ups that belong to other people

Four product findings are recorded in `verify-report.md` for the indexer team,
including the `wazuh-threatintel-filters` declaration and `wazuh-cve*` being
declared but not installed. None are defects in this tool.

`docs/as-current-user.md` still has no owner. It is the one Phase 8 item a
document cannot close, and it remains open.

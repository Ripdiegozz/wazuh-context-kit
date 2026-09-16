# Archive report — `skills-core`

Closed 2026-09-16. Verdict `pass`, 5/5 requirements, 12/12 scenarios, 0 blockers.

## What this closed

Four more SPEC 2.4 criteria. Phase 2 stands at 7 closed, 4 open — `sync`,
`check`, the fixture-repo demonstration, and the `settings.json` criterion held
open on purpose since `skills-diff`.

## The result

42 of 42 files reconstruct byte-identically. Core 59.0 % of the partitionable
content against a 50 % floor. Conflicts 28.2 %, reported and not gating.

## The part worth remembering

Predictions were recorded in `exploration.md` before a line was written, and the
two closest to the measurement were the extremes of the range: 96 % predicted
against 95.2 % measured for `analyze-dashboard-vuln`, 34 % against 34.7 % for
`check-standards`. The prediction of 42 of 42 was also right — and reaching it
took three genuine defects out of the implementation, none of which a unit suite
caught. Suites of 339, 343, 348 and 351 tests each passed while the real corpus
failed.

Two of the three were found by randomised stress testing over tens of thousands
of reconstructions, after hand-written literals demonstrably could not reach
them. When the input space is combinatorial, the cases you think of do not cover
the shape of the data.

One defect exposed a design error: `design.md` decision 1 specified the anchor as
`(headingPath, line, occurrence)` and then declared `occurrence` unnecessary for
today's corpus. It was necessary — a code-fence line appears twice in one
section. The earlier reasoning checked anchor uniqueness file-wide instead of
within-heading.

A weaker lesson that cost a round: the blanket guard was first written as
"reconstruction preserves line count". The heading-order defect preserved line
counts exactly while moving a 13-line block, and the guard passed on it.
Necessary is not sufficient; the guard is byte equality now.

## The floor decision

Conflicts were excluded from the floor's denominator on the principle that a
gate must measure what the implementation controls. Extraction decides how to
split; it does not decide whether a divergence carries a marker, which is a
property of the input. A gate failing for reasons nobody can act on is one that
gets turned off.

The degenerate extraction the floor exists to catch still fails at 0 %, and a
scenario pins that. The conflicts share is reported separately because 28.2 % of
this corpus being undeclared divergence is a finding about the repositories.

## Follow-up for the dashboard team

All six skills are undistributable today — including `analyze-dashboard-vuln`,
which carries only 2.4 % conflicts but carries some. `develop-issue` is 50 %
conflicts and `create-pr` 43 %. `sync` will ship nothing until a person resolves
them, which is the tool reporting the repositories' state rather than a defect.

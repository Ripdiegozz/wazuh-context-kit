# Archive report — `skills-diff`

Closed 2026-09-16. Verdict `pass`, 9/9 requirements, 17/17 scenarios, 0 blockers.

## What this closed

Three of the nine SPEC 2.4 criteria. The `settings.json` one stays open
deliberately and that is written into SPEC 2.4 itself, not left implicit.

## The part worth remembering

The expected answer was computed by an independent oracle in Python and the
implementation checked against it rather than against itself. Two independent
implementations of the same spec converged on 7 repos, 6 skills, 61 sections,
21 common — and, more tellingly, on the identical 127 conflicting lines in
`create-pr`. Comparing counts alone would not have shown that: "we chunk
differently" and "you are missing findings" look the same in a totals table.

Three defects the oracle found, none of which the suite caught:

1. Section granularity was too coarse — a 2-line divergence reported like a
   policy disagreement.
2. `wazuh-indexer-plugins` merged into the dashboard family, against SPEC 2.2.
   Fixed with a discovered rule (a skill is diffed when it appears in ≥ 2 repos)
   rather than a hardcoded exclusion, which would have frozen out any skill the
   indexer team later adopts.
3. A named attribution silently downgraded to "belongs to no repo".

All three are the same bug at different depths: **collapsing a set to one
label**. Section to block, block to group. And the oracle made the mirror-image
error once — one finding per group, 236 conflicts over 61 sections — which is
the same information loss pointing the other way. Finer is not better; there is
a correct unit.

## What the measurement says about the rest of Phase 2

The divergence profile is the number Phase 2 needed before building
reconstruction: 21 common sections against 70 divergence findings, with five of
six skills at 2–5 common versus 8–17 divergent.

SPEC 2.4's ≥ 35 of 42 bar was the pre-measurement ratio carried over. It should
be revisited with these numbers rather than discovered by a later change failing
it. `analyze-dashboard-vuln` — 7 common against 3 divergent — is the one skill
that plainly has a core.

## Follow-up for the dashboard team

50 of the 70 divergences carry no marker at all. Some are obviously deliberate,
like a per-repo example path, which suggests the marker convention is incomplete
in the source files rather than that there are fifty disagreements. That is a
conversation, not a defect in this tool.

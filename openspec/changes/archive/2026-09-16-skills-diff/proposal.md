# Proposal — `skills-diff`

## Why

Six skills are maintained by hand in seven repositories: 42 `SKILL.md` files,
every one a distinct byte sequence. The override pattern is already there — 97
`> **repo-specific`markers — but it lives *inside* duplicated files, so a change
to the shared part means editing seven copies and hoping.

This is the duplication problem SPEC section 1 opens with, in its most literal
form. And unlike the matrix, it is not a dataset problem: it is a problem people
have today, every time one of those files changes.

`skills-diff` is the analysis half. It classifies every divergent block and
reports the conflicts. It does not fix anything, and deliberately: SPEC 2.1.1 is
explicit that conflicts are reported and never auto-merged, because
"typecheck yes / typecheck no" can be a decision or an oversight and the
generator cannot tell which.

## What changes

A new `wazuh-ctx skills-diff` command. It reads the 42 files, computes a diff
across all seven variants of each skill, classifies every divergent block, and
emits a deterministic JSON artifact plus a rendered markdown report.

### Decided: widen the sparse checkout, do not add a second read path

`.claude/` is in no repository's sparse-checkout, so `find`, `fd` and `ls`
return nothing while every clone's tree has the files. A scanner built on
filesystem walking — which is what every other parser here does — would find
zero skills and report that these repos have none. A confident, plausible zero
is the exact defect this project has shipped before.

`sparsePathsFor()` gains `.claude`. The alternative, reading through
`git show HEAD:<path>`, costs no bandwidth and works on today's cache, but it
gives the project a *second* way to read repository content — one that shares no
tests, no error handling and no assumptions with the first.

In a project whose recurring defect has been "the code and the fixture agreed
with each other", a duplicated read path is precisely where the next silent
divergence hides. The cost of the chosen route is bandwidth and disk, which are
measurable and recoverable. The cost of the other is a class of bug we keep
paying for.

The cost will be recorded as an observed number, as the previous cycle
established: `.cache/` is 264 MB entering this change.

### Decided: the repo set comes from having the skills, not from `kind`

Seven repositories carry the six skills. One of them, `wazuh-dashboard`, is
declared `kind: platform` rather than `dashboard` — and it is the very repo SPEC
quotes its override example from.

So the set cannot be derived from `sources.yml`'s `kind` field. It is derived
from whether `.claude/skills/` exists. Deriving it any other way reproduces the
original "3 repos" error with a different justification.

### Decided: JSON artifact plus rendered text, like the crosscheck

`skills-diff.json` and `SKILLS-DIFF.md`, the shape already used for the matrix
and the crosscheck.

The inspector is now last in the build order, which makes this decision cheaper
rather than more speculative: by the time it is built, this format will have
been exercised by `sync` and `check`. And the crosscheck's bipartite graph and
this diff are the same shape of problem — two sides, orphans on both, conflicts
in between — so one component eventually draws both.

### Decided: `.claude/settings.json` is NOT in this change

It is named in SPEC 2.4's known-conflicts criterion, it sits beside the skills
tree, and it is measured at 5 distinct variants across the 7 repos.

It is also JSON, not markdown with frontmatter, and the override model here is a
positional patch anchored to text: `insert-after "## Version bases"`. JSON has no
meaningful text anchors; it needs key-level merging, which is a different
mechanism. Handling it here means **two override engines under one name**, and
on the day one of them misbehaves the user cannot tell which they are looking at.

**The debt this leaves is stated rather than implied:** one SPEC 2.4 criterion —
the one naming `settings.json` divergence — does not close with this change. It
closes with its own, designed once the markdown mechanism has taught us
something. That is a smaller debt than a second engine, and unlike a second
engine it is visible.

### Deferred on purpose: whether the five divergent skills have a core at all

Divergence is bimodal. `analyze-dashboard-vuln` differs by 2–6 lines of 130.
`check-standards` differs by 57–71 of 101. "Common core plus small intentional
overrides" describes the first well and the other five badly: at 50% divergence
there is no core with patches, there are six related files.

This change does not decide that. It **measures** it and reports it, and the
decision is made with the diff in hand.

The reason for deferring is specific, not caution: inventing a core for files
that do not have one would still pass a reconstruction test. Reconstruction
proves the patches invert the split; it says nothing about whether the split
means anything. So a premature answer here is one that verification cannot
catch — which is the worst kind this project has.

### Decided: unnamed markers are not attributed to a repo

15 of the 97 markers read `> **repo-specific:**` with no repo in parentheses,
typically about something true of several repos at once.

A marker naming no repo belongs to no `overrides/<repo>/`. Filing it under one
invents an attribution its author did not make — and `sync` would then
distribute that invention as though a person had decided it. These are reported
as their own category.

## What this does not change

- No repository under `wazuh/*` is modified. Reads only.
- Nothing is auto-merged. No conflict is resolved by the tool.
- `sync` and `check` are not built here.

## Risks

- **The bar may be unreachable.** SPEC 2.4 now asks for ≥ 35 of 42 byte-identical
  reconstructions, a ratio carried over from the pre-measurement draft and
  explicitly not validated against the divergence above. If the diff shows 35 is
  out of reach, the threshold is lowered with the measured number written beside
  it — never by relaxing what "byte-identical" means.
- **Widening the checkout touches every repo.** The cost is a re-clone. It is
  measurable and must be measured, not estimated.

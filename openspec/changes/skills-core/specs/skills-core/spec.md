# Skills-Core Specification

## Purpose

SPEC 2.1: extract the shared core of six skills maintained by hand across seven
repositories into `core/` plus `overrides/<repo>/`, and prove the split lost
nothing by reconstructing every original byte for byte.

## ADDED Requirements

### Requirement: Every override anchor is scoped to its containing heading

The system MUST resolve each override operation's anchor **within the heading
section that contains it**, and MUST NOT resolve an anchor against the whole
file.

Measured over the 42 real files, 409 patch blocks: 380 anchors are unique either
way; 29 are ambiguous against the whole file and every one of them resolves when
scoped to its heading. With file-wide anchors, 21 of 42 files reconstruct; with
heading-scoped anchors, 42 of 42.

This is a hard requirement rather than an implementation detail because the
naive reading fails **quietly**: 21 files still reconstruct, so a file-wide
implementation looks half-working instead of wrong.

#### Scenario: An anchor ambiguous file-wide resolves inside its heading

- GIVEN a line that occurs several times in a file but once inside the heading
  section holding the divergent block
- WHEN the override is applied
- THEN the anchor resolves to exactly one position

#### Scenario: An anchor ambiguous within its heading is fatal

- GIVEN an anchor that occurs twice inside its own heading section
- WHEN `sync` applies the override
- THEN the run fails
- AND the message names the skill, the repo, the anchor, and how many positions
  it matched

#### Scenario: An anchor matching nothing is fatal

- GIVEN an anchor that resolves to zero positions
- WHEN the override is applied
- THEN the run fails rather than skipping the operation

### Requirement: Reconstruction is byte-identical, and lossy cases are enumerated

The system MUST reconstruct at least 35 of the 42 original `SKILL.md` files byte
for byte from `core/` plus `overrides/<repo>/`, and MUST list every file it
could not reconstruct in `lossy[]` with the exact diff.

`reconstructed + lossy` MUST equal the total number of input files, always.

#### Scenario: Reconstruction reproduces the original exactly

- GIVEN a repository's core and overrides
- WHEN they are applied
- THEN the result is byte-identical to that repository's original file

#### Scenario: The arithmetic always closes

- GIVEN any input corpus
- WHEN extraction completes
- THEN `reconstructed + lossy` equals the number of input files
- AND no file is absent from both

### Requirement: The core carries at least half the content

The system MUST report the share of total content living in `core/`, and that
share MUST be at least 50 %. The run MUST exit non-zero when it is not,
independently of whether reconstruction succeeded.

Without this floor the reconstruction requirement above is trivially satisfiable:
an empty core plus each file whole as its own override reconstructs 42 of 42
having extracted nothing. Reconstruction proves the patches invert the split; it
says nothing about whether the split means anything.

A threshold met by relaxing its own definition is worse than no threshold,
because it looks like it measures something.

**At each divergent position, "the core" MUST be the MAJORITY group's
content — the group with the most repos — never the intersection of every
variant.** This is a correction, not the original text: an earlier version of
this requirement said "the lines common to every variant," and the first
real-corpus run measured exactly what that produces at seven variants — 34 %
overall against a 60 %-predicted, 50 %-floor target, because almost every
position has SOME repo differing from the rest, so "shared by literally all
seven" collapses toward empty as variant count grows. The majority rule is
the standard posture of every layered-configuration system (Kustomize bases
plus patches, Helm values plus overlays, this project's own `decisions.yml`
over parsed facts): the base carries the common case, the overlay carries the
exception, never the reverse.

When no group holds a strict majority at a position (a genuine N-way tie),
the system MUST resolve it deterministically — the tied group whose
alphabetically-first repo name sorts earliest — and MUST record that the
position had no majority, so the pick is visible as a tie-break rather than
indistinguishable from an ordinary majority.

Measured before building (original, uncorrected reading): 60 % overall, from
96 % in `analyze-dashboard-vuln` to 34 % in `check-standards`. Measured
against the real corpus with the STRICT "every variant" reading: 34 %
overall, 12 % down to 91 % per skill — the gap that revealed the majority
rule was the one this requirement always meant. The corrected majority rule
is expected to recover the original 60 %/96 %/34 % prediction; slice 7 (the
real-corpus run) confirms or refutes this and is not decided here.

#### Scenario: An empty core fails even when reconstruction succeeds

- GIVEN an extraction that puts every file whole into its own override
- WHEN the result is checked
- THEN reconstruction reports every file reproduced
- AND the run still fails, because the core carries no content
- AND the process exits non-zero, naming the measured share and the floor

#### Scenario: A majority position keeps the majority's content in the core

- GIVEN a divergent position where most repos share one content and a
  minority differs
- WHEN extraction runs
- THEN the majority's content is part of `core/`
- AND only the minority carries an override

#### Scenario: An N-way tie is resolved deterministically and recorded

- GIVEN a divergent position where every group is the same size and none is
  a majority
- WHEN extraction runs
- THEN the group whose alphabetically-first repo name sorts earliest is
  chosen for the core
- AND the position is recorded as having had no majority

#### Scenario: The share is reported per skill

- GIVEN a completed extraction
- WHEN the report is produced
- THEN each skill's core share is stated as a number

### Requirement: Conflicts live in their own layer and block distribution

The system MUST emit unresolved conflicts into a layer distinct from `core/` and
from `overrides/<repo>/`, and MUST mark the affected skill as undistributable.

A conflict is by definition a divergence nobody declared. It belongs neither in
the core, because it is not shared, nor in an override, because nobody said it
was deliberate.

The handling follows the best-known precedent for this exact situation. Git
merge materialises the conflict, **blocks the operation that would publish it**,
and requires a person; it does not pick a side and does not silently drop. That
is fail-closed, the standard posture when a tool does not know.

The system MUST NOT emit a conflict as an ordinary override. Doing so also
reconstructs every file, and converts undeclared accidents into policy that
`sync` then distributes to seven repositories as the official standard without
anyone having looked.

#### Scenario: A conflict is not laundered into an override

- GIVEN a divergent block with no marker
- WHEN extraction runs
- THEN it appears in the conflicts layer
- AND it does not appear in any `overrides/<repo>/` file

#### Scenario: A skill with conflicts is marked undistributable

- GIVEN a skill carrying at least one unresolved conflict
- WHEN extraction completes
- THEN that skill is reported as not distributable
- AND the reason names the conflicts blocking it

#### Scenario: A skill without conflicts is distributable

- GIVEN a skill whose every divergence carries a marker
- WHEN extraction completes
- THEN it is reported as distributable

### Requirement: Extraction is deterministic

Two runs over unchanged inputs MUST produce byte-identical `core/`,
`overrides/`, conflicts layer and report.

#### Scenario: Determinism

- GIVEN the same inputs and a frozen clock
- WHEN extraction runs twice
- THEN every produced file is byte-identical between runs

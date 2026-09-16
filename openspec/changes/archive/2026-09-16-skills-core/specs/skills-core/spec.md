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

### Requirement: The core carries at least half of the partitionable content

The system MUST report the share of content living in `core/` **as a fraction of
core plus overrides**, and that share MUST be at least 50 %.

The system MUST report the conflicts share as a separate number, and MUST NOT
fold it into the floor.

#### Why conflicts are excluded from the gate

Without any floor the reconstruction requirement is trivially satisfiable: an
empty core plus each file whole as its own override reconstructs 42 of 42 having
extracted nothing. The floor exists to catch exactly that.

But a gate must measure what the implementation controls. Extraction decides how
to split shared content from deviating content. It does **not** decide whether a
divergence carries a `repo-specific` marker — that is a property of the input
files. Counting conflicts in the denominator makes the gate fail for a reason the
tool cannot fix, and a gate that fails for reasons nobody can act on is a gate
that gets turned off, after which it gates nothing.

This is the same reason coverage thresholds exclude generated code and linters
separate first-party findings from vendored ones. It is not a loophole: the
degenerate extraction the floor was built to catch still fails hard, at 0 %.

Measured on the real corpus: core 44.1 %, overrides 28.4 %, conflicts 27.5 % of
total content — so **60.8 %** of the partitionable content is core, against a
floor of 50 %. The conflicts share is reported alongside, because 27.5 % of this
corpus being undeclared divergence is a finding about the repositories worth
seeing, not a number to hide inside a ratio.

#### Scenario: An empty core fails even when reconstruction succeeds

- GIVEN an extraction that puts every file whole into its own override
- WHEN the result is checked
- THEN reconstruction reports every file reproduced
- AND the run still fails, because the core carries none of the partitionable
  content

#### Scenario: Conflicts do not decide the gate

- GIVEN two corpora with identical core-to-override ratios and different conflict
  volumes
- WHEN both are checked
- THEN both report the same core share
- AND the conflicts share differs between them and is reported

#### Scenario: Both numbers reach the reader

- GIVEN a completed extraction
- WHEN the report is produced
- THEN the core share and the conflicts share are both stated, per skill and
  overall

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

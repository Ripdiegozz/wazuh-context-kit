# Sync-Check Specification

## Purpose

SPEC 2.3: distribute the extracted standards into a repository's
`.claude/standards/`, and detect when a distributed standard is edited locally.
Local editing is the drift that produced six hand-maintained copies.

## ADDED Requirements

### Requirement: `sync` never distributes a skill carrying conflicts

The system MUST refuse to materialise any skill with at least one unresolved
conflict, and MUST distribute skills independently of one another.

A skill blocked by its own conflicts MUST NOT block a clean one. Conflicts are
tracked per skill and the gate is per skill; an all-or-nothing unit would let one
messy skill hold the rest hostage.

#### Scenario: A blocked skill is not written

- GIVEN a skill carrying at least one unresolved conflict
- WHEN `sync` runs
- THEN nothing for that skill is written to the target
- AND the reason names the conflicts blocking it

#### Scenario: A clean skill ships while another is blocked

- GIVEN one skill with conflicts and one without
- WHEN `sync` runs
- THEN the clean skill is materialised
- AND the blocked one is not

### Requirement: `sync` with everything blocked is reported, not failed

When every skill is blocked, the system MUST exit `0`, write nothing, and state
how many of how many were distributed along with what blocks each.

Every one of the six skills is undistributable today. That is the tool working:
it found undeclared divergence in all six and refused to publish. Treating a
correct, informative state as a command failure would make `sync` born
always-failing, and a command that always fails is one somebody removes from the
pipeline — after which it gates nothing.

Exit `0` can read as success, so the output MUST be explicit. Silence is the
danger; a loud zero is not.

#### Scenario: Nothing distributable

- GIVEN every skill carries conflicts
- WHEN `sync` runs
- THEN the exit code is `0`
- AND nothing is written
- AND the output states `0 of <n> distributed` and names what blocks each skill

### Requirement: `sync` fails fatally on an unresolvable anchor

An override anchor resolving to zero positions, or to more than the requested
occurrence, MUST make `sync` fail. It MUST NOT be a warning and MUST NOT skip the
operation (SPEC 2.1.1).

An anchor that applies "somewhere" is exactly the silence SPEC section 1 is
about.

> After `skills-core` introduced heading scoping and ordinals, the real corpus
> produces **zero** ambiguous anchors — the invariant that every op resolves to
> exactly one position holds across all 42 files. This scenario is therefore
> exercised by a constructed case, not by the corpus.

#### Scenario: An ambiguous anchor is fatal

- GIVEN an override whose anchor resolves to more positions than its occurrence
  selects
- WHEN `sync` runs
- THEN the run fails
- AND the message names skill, repo, anchor and match count

### Requirement: `check` reports three states and never conflates two

The system MUST distinguish "not applicable", "in sync" and "drifted".

| State | Meaning | Exit |
| --- | --- | --- |
| not applicable | no `.claude/standards/` present | `0`, stated |
| in sync | present and hashes match | `0` |
| drifted | present and edited locally | non-zero |

A target that is absent MUST NOT be reported as success. Conflating "nothing to
check" with "everything is fine" is the silence this project exists to remove.

#### Scenario: No target is not a pass

- GIVEN a repository with no `.claude/standards/`
- WHEN `check` runs
- THEN it reports "not applicable"
- AND it does not report that the repository is in sync

#### Scenario: Drift fails the command

- GIVEN a materialised `.claude/standards/` with one locally edited file
- WHEN `check` runs
- THEN the exit code is non-zero
- AND the drifted files are named

#### Scenario: Matching hashes pass

- GIVEN a materialised `.claude/standards/` untouched since `sync`
- WHEN `check` runs
- THEN the exit code is `0`

> `check` exits non-zero on drift while the crosscheck exits `0` on drift. That
> is deliberate. The crosscheck is a diagnostic and a diagnostic that fails a
> pipeline by doing its job becomes a tool nobody runs; `check` is a gate whose
> only purpose is to stop on local edits. Copying the earlier decision here out
> of a wish for consistency would produce a command that cannot do the one thing
> it exists for.

### Requirement: The mechanism is demonstrated end to end on a fixture

The system MUST be exercised against a fixture repository under `fixtures/`
where `sync` materialises, `check` passes, a local edit is introduced, and
`check` fails — all three steps in one test.

No repository under `wazuh/*` has `.claude/standards/`, and creating one needs a
PR this project does not open. Phase 2 therefore delivers the mechanism and its
demonstration, not the mechanism operating. The fixture is what makes
"delivered" a word with content.

#### Scenario: The full round

- GIVEN a fixture repository with no `.claude/standards/`
- WHEN `sync` materialises into it
- THEN `check` passes
- AND after a local edit to one materialised file, `check` fails naming that file

#### Scenario: Real repositories are untouched

- GIVEN the cached `wazuh/*` clones
- WHEN the change's tests run
- THEN no file under any cached clone is modified

### Requirement: The CI workflow is proposed, never installed

The system MUST deliver the GitHub Actions workflow as a file under
`proposals/`, and MUST NOT install it into any repository.

Nothing in this phase requires permissions over the organisation.

#### Scenario: Proposed only

- GIVEN the change is complete
- WHEN the repository is inspected
- THEN the workflow exists under `proposals/`
- AND no `.github/workflows/` file was added to any cached clone

# Skills-Diff Specification

## Purpose

SPEC 2.1: six skills are maintained by hand across seven repositories, 42
`SKILL.md` files, no two byte-identical. The override pattern already exists
inside those duplicated files. This command finds it, classifies every divergent
block, and reports the conflicts — without resolving any of them.

## ADDED Requirements

### Requirement: A skill is diffed when it is shared, and the repository set follows from that

The system MUST NOT derive the diffed repository set from `sources.yml`'s
`kind` field (SPEC 2.1.0). Presence of `.claude/skills/` alone is NECESSARY but
NOT SUFFICIENT: a skill enters the cross-repository diff only when it appears
in **two or more** repositories, and a repository is counted as included only
when at least one of its skills meets that bar.

This corrects a gap in an earlier draft of this requirement, found by running
against the real data: "derived from having the skills" was true of
`wazuh-indexer-plugins` too, which pulled its three indexer-only skills
(`docs-review`, `perf-tuning`, `wcs-management`) into the same comparison as
the six dashboard-family skills. SPEC 2.2 and `exploration.md` finding 2 are
both explicit that the indexer's skills are a different family, reported as
process overlap and never merged with the dashboard's. Measured: each of the
six dashboard skills appears identically named in seven repositories; each of
the indexer's three skills appears in exactly one. The two-or-more rule
separates them without naming either family, so it keeps working if the
indexer team later adopts a shared skill — exactly the "conversation between
teams" SPEC 2.2 anticipates — where a hardcoded exclusion would silently keep
it out forever.

Seven repositories carry the six dashboard skills today. One of them,
`wazuh-dashboard`, is declared `kind: platform` rather than `dashboard` — and
it is the repository SPEC quotes its own override example from. A
`kind`-derived set would exclude it, reproducing the superseded "3 repos"
error with a fresh justification.

#### Scenario: A platform-kind repository with skills is included

- GIVEN a repository declared `kind: platform` whose tree has `.claude/skills/`
- AND at least one of its skills also appears in another repository
- WHEN `skills-diff` selects its inputs
- THEN that repository is included

#### Scenario: A repository without skills is not an input

- GIVEN a repository with no `.claude/skills/`
- WHEN `skills-diff` selects its inputs
- THEN it is absent from the comparison
- AND its absence is reported, not silent

#### Scenario: A skill present in only one repository is reported, not diffed

- GIVEN a repository whose `.claude/skills/` contains a skill that no other
  repository has
- WHEN `skills-diff` runs
- THEN that skill is NOT included in the cross-repository diff — there is
  nothing to diff it against
- AND it is listed, by name and repository, in a report of skills present in
  only one repository
- AND a repository counted as excluded for this reason is distinguished from
  one that carries no `.claude/skills/` at all

### Requirement: Every divergent block is classified, and none is left over

The unit this requirement classifies is the divergent BLOCK, not the section.
A heading path (SPEC's section) MAY contain zero, one, or several independent
divergent blocks, each anchored to its own position within that section, and
EACH is classified on its own. The system MUST classify every divergent block
as override, sharedOverride, or CONFLICT, and MUST NOT emit a block that falls
into no category (SPEC 2.4). A section with no divergent block is common; it
is not itself a block and carries no classification of its own.

The count of classified blocks MUST equal the count of divergent blocks found.
An unclassified block silently dropped is the failure mode section 1 of SPEC
describes.

This corrects a gap an earlier draft of this requirement left open: its
scenarios were loose enough to let an implementation collapse a whole section
to one label. A real `develop-issue` section, `Workflow/1. Plan`, was measured
carrying BOTH a declared `repo-specific (wazuh-dashboard)` override AND a
separate, unmarked wording disagreement a few lines apart. Collapsing that
section to one label loses information whichever way it goes: `override`
hides the undeclared divergence, `conflict` buries the declared one — and a
person who finds a marker sitting next to a reported CONFLICT reasonably
concludes the tool is wrong.

#### Scenario: Classification is total

- GIVEN a diff across the variants of one skill
- WHEN classification completes
- THEN every divergent block carries exactly one classification
- AND the sum of the override, sharedOverride and CONFLICT categories equals
  the number of divergent blocks found

#### Scenario: One section carries both a declared override and a separate conflict

- GIVEN a section where one repository's variant carries a `repo-specific`
  marker attributed to it at one position
- AND, at a DIFFERENT position in the same section, two or more repositories
  disagree with no marker anywhere near that disagreement
- WHEN classification runs
- THEN the marked position is reported as its own block, classified `override`
  and attributed to the repository that declared it
- AND the unmarked disagreement is reported as its own block, classified
  CONFLICT
- AND neither block's classification is affected by the other's marker

#### Scenario: A category never discards an attribution present in one of its own groups

- GIVEN one divergent position with a group carrying a NAMED `repo-specific`
  marker and a sibling group carrying only a BARE `repo-specific` marker, and
  no unmarked group at that position
- WHEN classification runs
- THEN the named group is reported under `override`, attributed to the
  repository that declared it
- AND the bare-marker group is reported under `sharedOverride`, attributed to
  no repository
- AND no block anywhere in the report carries a `named`-marker group under a
  category other than `override`

### Requirement: Conflicts are reported and never resolved

The system MUST report each conflict with enough context for a person to decide,
and MUST NOT merge, pick a side, or apply a heuristic preference (SPEC 2.1.1).

"typecheck yes / typecheck no" can be a decision or an oversight. The generator
cannot tell which, and a tool that guesses here produces a standards package
that encodes an accident as policy.

The run MUST exit `0` when conflicts exist. A conflict is the expected output of
an analysis, not a failure.

#### Scenario: A conflict is surfaced, not settled

- GIVEN two repositories whose variants of one block disagree
- AND no marker declaring the difference intentional
- WHEN the diff runs
- THEN the block is reported as CONFLICT with both variants and their repos
- AND neither variant is selected
- AND the exit code is `0`

#### Scenario: The known conflicts appear

- GIVEN the real seven-repository input
- WHEN the diff runs
- THEN the `typecheck` divergence in `check-standards` is reported
- AND the `no-changelog` label divergence is reported
- AND the OSD `changelogs/fragments` divergence is reported

### Requirement: Both marker sub-formats are distinguished

The system MUST recognise `> **repo-specific (<repo>):**` and
`> **repo-specific:**` as distinct, and MUST NOT attribute an unnamed marker to
any repository.

Measured: 97 markers, of which 15 name no repository — typically about something
true of several repositories at once. A marker naming no repository belongs to
no `overrides/<repo>/`. Filing it under one invents an attribution its author
did not make, and `sync` would later distribute that invention as though a
person had decided it.

#### Scenario: An unnamed marker is its own category

- GIVEN a block marked `> **repo-specific:**` with no repository in parentheses
- WHEN classification runs
- THEN it is reported under a category of its own
- AND it is not listed under any single repository's overrides

#### Scenario: A named marker is attributed

- GIVEN a block marked `> **repo-specific (wazuh-dashboard):**`
- WHEN classification runs
- THEN it is attributed to `wazuh-dashboard`

### Requirement: The divergence profile is measured and reported

The system MUST report, per skill, how much of it is common and how much
diverges, as numbers.

Divergence is bimodal and this is the change's central open question:
`analyze-dashboard-vuln` differs by 2–6 lines of 130, while `check-standards`
differs by 57–71 of 101. "Common core plus small intentional overrides"
describes the first well and the other five badly.

This command MUST NOT decide whether the heavily-divergent skills have a core.
It measures, so that decision can be made with the diff in hand. A premature
answer here would still pass a reconstruction test — reconstruction proves the
patches invert the split, not that the split means anything — so it is a class
of error verification cannot catch.

#### Scenario: Per-skill divergence is a number

- GIVEN the seven variants of a skill
- WHEN the diff runs
- THEN the report states how many blocks are common and how many diverge
- AND a reader can tell a near-identical skill from a half-divergent one without
  reading the files

### Requirement: The output is a deterministic artifact plus a rendered report

The system MUST emit a JSON artifact and a markdown report rendered from it, and
two runs over unchanged inputs MUST produce byte-identical output (SPEC 2.4).

The JSON is the contract; the markdown is a view. The inspector, now last in the
build order, consumes the JSON — and the crosscheck's bipartite graph and this
diff are the same shape of problem, two sides with orphans on both and conflicts
between, so one component eventually draws both.

#### Scenario: Determinism

- GIVEN the same inputs and a frozen clock
- WHEN the command runs twice
- THEN both artifacts are byte-identical

#### Scenario: The report is rendered from the artifact

- GIVEN a JSON artifact
- WHEN the markdown is produced
- THEN it contains no finding absent from the JSON

### Requirement: `.claude/settings.json` is out of scope, and that is recorded

The system MUST NOT treat `.claude/settings.json` as an input to this command,
and the documentation MUST record that the SPEC 2.4 criterion naming it stays
open.

It is JSON, not markdown with frontmatter, and the override model here is a
positional patch anchored to text. JSON has no meaningful text anchors; it needs
key-level merging, a different mechanism. Handling it here would mean two
override engines under one name, and on the day one misbehaves the user cannot
tell which they are looking at.

The debt is smaller than a second engine, and unlike a second engine it is
visible.

#### Scenario: It is not silently included

- GIVEN the seven repositories, each with a `.claude/settings.json`
- WHEN the diff runs
- THEN no finding concerns `settings.json`
- AND the report states that it is out of scope and which criterion stays open

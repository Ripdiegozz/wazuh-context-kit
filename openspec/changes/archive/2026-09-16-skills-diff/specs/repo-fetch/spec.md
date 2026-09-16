# Repo-Fetch Specification — delta

## ADDED Requirements

### Requirement: The skills tree is checked out

The system MUST include `.claude` in the sparse-checkout path set, so that
`.claude/skills/**/SKILL.md` is present on disk for every repository that has it
(SPEC 2.1.0).

`.claude` is in no repository's declared path set today. `find`, `fd` and `ls`
therefore return nothing while every clone's git tree holds the files. A parser
built on filesystem walking — which is what every parser in this project is —
would report that these repositories have no skills.

That is a confident, plausible, wrong zero, and it is the defect class this
project has shipped before. The alternative, reading through `git show`, avoids
the re-clone but gives the codebase a second way to read repository content that
shares no tests, no error handling and no assumptions with the first.

#### Scenario: Skills are on disk after a fetch

- GIVEN a repository whose tree contains `.claude/skills/<name>/SKILL.md`
- WHEN fetch clones it
- THEN that file is present on disk
- AND it is readable by the same filesystem walk every other parser uses

#### Scenario: A repository without the directory is not an error

- GIVEN a repository whose tree has no `.claude/`
- WHEN fetch clones it
- THEN the checkout succeeds
- AND the absence is distinguishable from a repository that was not fetched

### Requirement: The cost of widening is measured, not estimated

The system's documentation MUST record the observed cold-clone time and cache
size before and after this change.

This habit exists because an estimated forecast has cost a maintainer round-trip
twice. `.cache/` is 264 MB entering this change.

#### Scenario: Recorded measurements

- GIVEN the widened path set
- WHEN a cold regeneration runs
- THEN the observed elapsed time and resulting cache size are recorded as real
  numbers

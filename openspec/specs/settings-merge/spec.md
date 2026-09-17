# Settings-Merge Specification

## Purpose

SPEC 2.4's last criterion. `.claude/settings.json` sits beside the skills tree,
is named in the known-conflicts criterion, and is not a `SKILL.md`, so no
skills diff reaches it.

## Requirements

### Requirement: An entry present in every repository is core; an entry one repository adds is its override

The system MUST place in `core/.claude/settings.json` exactly the values present
in every repository, and MUST place each repository's additional values in its
own override.

Measured across the seven files: `permissions.allow` is the only diverging key,
with 22 entries common to all seven and 3–6 additions per repository. The other
three keys are identical everywhere.

#### Scenario: A common entry is core

- GIVEN a value present in every repository's `settings.json`
- WHEN extraction runs
- THEN it appears in the core file
- AND it appears in no repository's override

#### Scenario: An addition is an override

- GIVEN a value present in one repository and absent from the others
- WHEN extraction runs
- THEN it appears in that repository's override
- AND it does not appear in the core

#### Scenario: Reconstruction is exact

- GIVEN a repository's core plus its override
- WHEN they are merged
- THEN the result equals that repository's original `settings.json` value-for-value

### Requirement: A removal is a conflict, not an override

The system MUST treat a repository lacking a value that every other repository
has as a **conflict**, and MUST NOT emit it as an override.

The reason is structural rather than a general preference for caution. The core
is what all repositories share. If one drops an entry the core is no longer that
set — it shrinks **for every repository**, not only for the one that dropped it.
An addition affects the repo that made it; a removal changes the baseline the
others inherit.

And the ambiguity cannot be resolved from the file: a repository missing a value
may have removed it deliberately or may predate its introduction. Nothing in
JSON expresses which, so the system MUST NOT choose.

> The real corpus contains **zero** removals: every file's entry count equals the
> common set plus its own additions. This requirement is therefore exercised by
> constructed cases, and the verification must say so rather than imply coverage.

#### Scenario: A missing common value blocks

- GIVEN six repositories carrying a value and one that does not
- WHEN extraction runs
- THEN a conflict is reported naming the value and the repository lacking it
- AND that value is not emitted as an override for any repository

#### Scenario: A scalar disagreement blocks

- GIVEN a key whose value differs between repositories and is not a list
- WHEN extraction runs
- THEN a conflict is reported carrying every variant and its repositories
- AND no variant is selected

#### Scenario: Additions never conflict with each other

- GIVEN two repositories adding different values to the same list
- WHEN extraction runs
- THEN both are overrides
- AND neither is reported as a conflict

### Requirement: Conflicts share one layer and carry their kind

Conflicts from `settings.json` MUST enter the same `conflicts/` layer as skill
conflicts and MUST be gated by the same refusal to distribute.

Each conflict MUST carry its kind, and the report MUST group by it.

The operational meaning is identical — `sync` refuses until a person resolves it
— and two places to look is how somebody checks one and forgets the other. But
"conflict" does mean different things in the two models: in the skills it is
divergence with no marker declaring intent; here there is no marker convention
at all, so it is contradiction. One list with typed entries keeps both true, the
way a compiler ships one error list rather than one per category.

#### Scenario: A settings conflict blocks distribution

- GIVEN a `settings.json` conflict and no skill conflicts
- WHEN `sync` runs
- THEN nothing is distributed for the affected repository
- AND the reason names the settings conflict

#### Scenario: The kind is visible

- GIVEN conflicts of both kinds
- WHEN the report renders
- THEN each states its kind
- AND they are grouped by it

### Requirement: The merge is order-independent and deterministic

Merging MUST NOT depend on the order repositories are processed, and two runs
over unchanged inputs MUST produce byte-identical output.

List entries MUST be emitted in a stable order that does not depend on which
repository contributed them.

#### Scenario: Repository order does not matter

- GIVEN the same inputs presented in two different repository orders
- WHEN extraction runs
- THEN the core and every override are identical between the two runs

#### Scenario: Determinism

- GIVEN unchanged inputs and a frozen clock
- WHEN extraction runs twice
- THEN every emitted file is byte-identical

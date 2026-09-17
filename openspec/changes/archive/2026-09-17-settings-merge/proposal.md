# Proposal — `settings-merge`

## Why

The last open criterion in Phase 2. `.claude/settings.json` is named in SPEC
2.4's known-conflicts criterion and does not fall out of a skills diff, because
it is not a `SKILL.md`.

`skills-diff` deferred it with a reason that was sound in shape and wrong in
scale: JSON has no heading anchors, so it would need key-level merging — "two
override engines under one name". Nobody had counted. Measured:

| | `SKILL.md` | `settings.json` |
| --- | --- | --- |
| Files | 42 | 7 |
| Units | 61 sections, 409 patch blocks | **4 leaf keys** |
| Diverging | 70 findings | **1 key** |
| Conflicts | 50 undeclared | **0** |
| Shape | replace, insert, delete | **additions only** |

A general key-level merge engine is not needed. A list union for one key is.

## What changes

`skills-diff --extract` additionally emits a core `settings.json` and per-repo
additions, and `sync` materialises them. `permissions.allow` is the only key
that differs; the other three are identical across all seven repositories.

Measured: 22 entries common to all seven, each repo adding 3–6 of its own, and
**no repository removing a common entry** — checked arithmetically, since each
file's total equals 22 plus its own additions.

### Decided: a removal is a conflict, because it shrinks everyone's core

The decisive argument is not "fail closed on security-relevant state", though
that is also true. It is structural.

The core is the 22 entries present in all seven. If one repository drops one,
the core is no longer 22 — **it becomes 21 for everybody**. That is not a local
deviation the way an addition is. An addition affects only the repo that made
it; a removal changes the shared baseline the other six inherit.

There is a second reason, and it is the one that makes guessing unsafe: **you
cannot tell "deliberately removed" from "never added" by looking at the file.**
A repo missing an entry might have dropped it last week or might predate its
introduction. That ambiguity is resolved by asking, not by picking whichever
reading makes the run green.

So: additions are overrides, removals and scalar disagreements are conflicts.

### Decided: one conflicts layer, with typed entries

Conflicts from `settings.json` go into the **same** `conflicts/` layer as the
skills, and the same gate blocks distribution.

The operational meaning is identical — `sync` refuses to distribute until a
person resolves it — and two places to look is how somebody checks one and
forgets the other.

But the objection against merging them is real: "conflict" means different
things in the two models. In the skills it is *divergence with no marker
declaring intent*; here there is no marker convention at all, so it is
*contradiction*.

The standard resolution is what compilers do: one list, typed entries. Nobody
ships a separate error list for syntax and another for types; they ship one
where each entry says what kind it is. Each conflict therefore carries its kind,
and the report groups by it. One place to look, no conflation.

### Decided: build the conflict mechanism even though the corpus has none

Today nothing blocks: no removal, no scalar disagreement, no contradiction. A
merge built only for what exists would be a union and nothing else.

That would be wrong for the same reason the ambiguous-anchor check was worth
building when the corpus produced zero ambiguous anchors. The day a repository
drops a common entry, a mechanism that cannot represent the failure will
silently pick a side — and here the side it picks changes what an agent is
permitted to do in somebody's repository.

The verification must say plainly that the corpus does not exercise this path,
rather than implying coverage.

## What this does not change

- No repository under `wazuh/*` is modified. Reads only, per `CLAUDE.md`.
- The skills pipeline is untouched.
- Nothing is published.

## Risks

- **The whole mechanism is untested by real data**, because the real data is
  clean. Its tests are literals and its correctness rests on them — which is the
  situation that has produced six defects in this project. The mitigation is to
  state it rather than to pretend otherwise, and to keep the merge small enough
  that a reader can check it by eye.
- **`reporting` uses bare `yarn test` where the others use `yarn test:jest`.**
  That is an addition under this model, not a conflict, so it distributes
  cleanly. Whether it *should* be uniform is a question for the dashboard team,
  and this tool reports rather than decides.

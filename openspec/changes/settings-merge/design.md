# Design — `settings-merge`

## Shape

```
src/settings/merge.ts     PURE — variants -> core + overrides + conflicts
src/settings/apply.ts     PURE — core + override -> a repository's settings.json
src/cli.ts                WIRING (extraction and sync already have their seams)
```

Both halves pure, so `apply(merge(x)) == x` is assertable on literals — the same
round-trip that proved `skills-core` correct, and the only assertion here a
fixture cannot agree with.

No new emission module: `src/standards/apply.ts` already writes a plan, and
`src/skills/emit.ts` already writes trees. This slots into both rather than
adding a third writer.

## Decision 1 — walk leaf paths, not the object

The merge compares **leaf paths** (`permissions.allow`, `permissions.deny`, …),
not nested objects. Comparing objects makes any difference anywhere inside look
like a difference at the top, which is the section-versus-block mistake
`skills-diff` spent three rounds unlearning.

Four leaf keys exist today. The walk does not assume that.

## Decision 2 — lists merge by membership, scalars by equality

| Leaf kind | All equal | Differs |
| --- | --- | --- |
| scalar | core | **conflict** — no way to pick |
| list | core | see below |

For a list, the core is the entries present in **every** variant. An entry in
some variants and not others is:

- an **override** for the repos that have it, when every repo lacking it lacks
  it because it was never there;
- a **conflict**, when a repo lacks an entry that all the others carry.

Those two read identically in the data, which is the crux. The rule that
separates them is the count: an entry present in *all but one* repository is a
removal by that one; an entry present in *some* is an addition by those.

The threshold is therefore `n - 1`, and it is a judgement encoded in one number
rather than in scattered conditionals, so it can be argued with and changed in
one place.

## Decision 3 — the core is an intersection, computed once

`core = ∩ variants`. Overrides are `variant − core`. Conflicts are what the
intersection lost that it should not have.

Computing the core as an intersection rather than by iterating repositories is
what makes Decision 5's order-independence true by construction rather than by
care.

## Decision 4 — conflicts are typed, in the existing layer

```ts
type ConflictKind = "unmarked-divergence" | "removed-from-core" | "scalar-disagreement";
```

The first is the skills' meaning, already in use. The other two are this
change's. One layer, one gate, three kinds — the compiler's one-error-list
shape, not one list per category.

The existing `blockingConflicts` rendering groups by kind. A reader sees one
place to look and still sees that the causes differ.

## Decision 5 — stable ordering that ignores provenance

List entries are emitted sorted, so output never depends on which repository
contributed an entry or on the order repositories were processed.

Sorting is the cheap way to get order-independence; the alternative — preserving
first-seen order — makes the output depend on iteration order, which is exactly
the bug that moved a 13-line block in `skills-core`.

## What could go wrong

- **An entry that differs only by whitespace.** `Bash(yarn test)` and
  `Bash(yarn test )` are different strings and the same permission. Compare exact
  bytes and do not normalise: normalising is how a real difference gets hidden,
  and this file grants permissions.
- **A list that is not a set.** Duplicate entries within one file would make
  membership arithmetic wrong. Detect and report rather than silently
  deduplicating, because a duplicate is itself a finding about that file.
- **The `n - 1` threshold with few repositories.** At two repositories every
  addition is also "all but one". The rule needs a floor — below three
  repositories, treat asymmetry as an addition and say so — or it turns every
  two-repo difference into a conflict.

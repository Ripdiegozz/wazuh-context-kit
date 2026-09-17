# Archive report — `settings-merge`

Closed 2026-09-17. Verdict `pass`, 0 blockers. **Phase 2 is complete: 11 of 11
criteria.**

## What closed

SPEC 2.4's last criterion. The 2026-09-16 deferral said handling
`settings.json` would mean "two override engines under one name" — sound in
shape, wrong in scale, because nobody had counted. Four leaf keys, one diverging.
A list union for one key, not a general merge engine.

## Measured, and the prediction held

22 core entries, 3–6 additions per repository, 0 conflicts, **7 of 7 round-trip
exactly**. Every number matches what was measured before any code was written —
the fourth slice running where the prediction held while the implementation
needed correcting to reach it.

## Two decisions worth re-reading

**A removal is a conflict, not an override**, and the reason is structural rather
than a general preference for caution. The core is what all seven share, so one
repository dropping an entry shrinks the core **for everybody** — unlike an
addition, which affects only the repo that made it. Compounding it: nothing in
JSON distinguishes "deliberately removed" from "never added", so the system must
not choose.

**Settings conflicts share the skills' `conflicts/` layer, typed.** The
operational meaning is identical — `sync` refuses until a person resolves it —
and two places to look is how somebody checks one and forgets the other. But
"conflict" genuinely means different things in the two models, so each entry
carries its kind and the report groups by it: the compiler's one-error-list
shape, not one list per category.

## The recurring defect, sixth occurrence

Slices 1–4 were reported complete with tasks 4.1 and 4.2 ticked, and running the
command emitted zero files. The pure modules existed and nothing in `cli.ts` ever
called them. **425 tests passed over the absent behaviour.**

The scope reasoning was plausible and wrong: CLI threading was deferred to slice
5 as "the real-corpus job". Slice 5 is *verification*. Deferring the wiring there
does not postpone the work — it makes the verification impossible, because there
is nothing to observe. A ticked task nobody can observe is worse than an unticked
one.

## The first thing this tool has distributed

```
distributed      0 of 6 distributed
settings.json    distributed (.claude/settings.json)
```

Six skills blocked by unresolved conflicts, `settings.json` shipped anyway. The
gate is per unit, so a clean artifact goes out while dirty ones wait — the
per-skill decision from `sync-check`, now exercised by a second kind of artifact.

## Honest limit

The conflict machinery is untested by real data. The corpus has zero removals and
zero scalar disagreements, so `removed-from-core` and `scalar-disagreement` are
exercised by literals and seeded randomised trials only.

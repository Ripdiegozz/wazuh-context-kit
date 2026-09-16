# Design — `skills-core`

## What already exists, and what this adds

`skills-diff` already parses each `SKILL.md` into heading-keyed sections,
groups the seven variants, segments each section into anchor-bounded positions,
and classifies every divergent block. That is most of the work.

Extraction is a **projection** of that result, not a second analysis:

```
SkillsDiff  ──project──>  core/  +  overrides/<repo>/  +  conflicts/
                └──────invert──>  reconstructed files
```

Reusing the diff rather than re-deriving it is deliberate. Two analyses of the
same corpus drift, and the drift is invisible because each has its own tests —
the same argument that kept `covers()` a single function in the crosscheck.

```
src/skills/extract.ts      PURE  — SkillsDiff -> CoreAndOverrides
src/skills/reconstruct.ts  PURE  — core + overrides -> file content
src/skills/emit.ts         IMPURE— writes the trees
```

Both halves pure, so reconstruction can be tested against extraction with
literals and no filesystem.

## Decision 1 — the anchor is `(headingPath, line, occurrence)`

The measurement that shaped this: with a file-wide line anchor, 21 of 42 files
reconstruct; scoped to the containing heading, 42 of 42. All 29 ambiguous
anchors dissolve.

```yaml
- op: insert-after
  heading: "Workflow/1. Plan"     # the section, from the parse
  anchor: "Match how CI computes them:"
  content: |
    ...
```

`heading` is the section key `parse.ts` already produces. `anchor` resolves only
inside that section.

The third component, `occurrence`, is not needed by today's corpus — after
heading scoping, zero anchors remain ambiguous — but the resolver must still
**count** matches and fail on anything other than exactly one. SPEC 2.1.1 is
explicit that zero or many is fatal, not a warning, and a resolver that does not
count cannot enforce it.

Why this must be a requirement and not a detail: the file-wide reading **fails
quietly**. 21 files still reconstruct. A half-implementation looks half-working,
which is the failure shape that has cost this project four cycles.

## Decision 2 — conflicts are a third tree, and they gate distribution

```
core/skills/<skill>/SKILL.md
overrides/<repo>/<skill>.yml
conflicts/<skill>.yml          <- blocks distribution
```

Reconstruction applies all three, so it reaches 42 of 42. Distribution consults
only the first two and refuses when the third is non-empty for that skill.

That separation is what lets both facts be true at once: the split is provably
lossless, and nothing undeclared gets shipped.

The rejected design — conflicts as ordinary overrides — reconstructs equally
well and is strictly worse, because `sync` would distribute fifty undeclared
accidents to seven repositories as the official standard. Git merge is the
precedent: materialise, block the publishing step, require a person.

Expected initial state, and it is not a defect: five of six skills carry
conflicts, so `sync` starts blocked for them. `analyze-dashboard-vuln` is the
one likely to pass.

## Decision 3 — the core is the common sections plus each position's common lines

A section with no divergent blocks goes to the core whole. A section with
divergent blocks contributes its anchor lines — the lines common to every
variant — with the divergent positions removed and replaced by ops.

Measured consequence: the core holds 60 % of total content. The per-skill spread
is wide, 96 % down to 34 %, and `check-standards` at 34 % is the case worth
watching. Whether forcing a core there is honest is a question the measurement
answers, not the design.

## Decision 4 — reconstruction is the test, not a feature

`reconstruct.ts` exists to prove `extract.ts` correct. Every extraction test
asserts round-trip byte equality, so the two are checked against each other on
every literal input rather than only on the real corpus.

That is the guard against the failure this whole project keeps meeting: an
implementation that agrees with its own fixture. Here the fixture cannot agree,
because the assertion is that two independent transformations compose to the
identity.

`lossy[]` carries the exact diff for anything that does not round-trip, and
`reconstructed + lossy == input count` is asserted as arithmetic, not sampled.

## Decision 5 — determinism by construction

Ordering: skill, then repo, then heading path, then position index. All total
orders over strings and integers; none depends on filesystem iteration or on
`sources.yml` order.

No timestamp is written into any emitted tree. The report carries `generatedAt`
and never renders it, the same rule the crosscheck and skills-diff follow.

## What could go wrong

- **An op sequence that is order-dependent.** Applying `insert-after` twice at
  the same anchor gives different results depending on order. Ops are applied in
  emitted order and the emitted order is deterministic, but the test must apply
  them in a shuffled order and assert the result is unchanged, or the guarantee
  is only accidental.
- **A heading path that differs between variants.** If one repo renames a
  heading, its section key differs and the section looks absent rather than
  divergent. `skills-diff` already treats absent-versus-present as distinct after
  the last review round, so this should surface as a divergence — but it is worth
  an explicit test, because a renamed heading is the most likely real-world edit.
- **The ambiguous-anchor test has no natural case.** After heading scoping the
  real corpus produces zero ambiguous anchors. SPEC 2.4 still requires a test
  with a deliberately ambiguous one, so it is constructed. The report must say
  the corpus no longer exercises it rather than implying it does.

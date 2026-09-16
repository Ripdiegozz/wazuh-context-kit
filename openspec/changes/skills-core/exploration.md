# Exploration — `skills-core`

Phase 2's second slice: extraction and reconstruction. `skills-diff` measured
the terrain; this builds `core/` plus `overrides/<repo>/` and proves the split
is lossless.

Everything here was measured on 2026-09-16 against the 42 real files, **before
writing any of it**, because the acceptance bar was a ratio carried over from a
draft that predated counting.

## Finding 1 — the bar as written measures nothing

"≥ 35 of 42 byte-identical reconstructions" is trivially satisfiable. Emit an
empty `core/`, put each file whole into its own override, reconstruct 42 of 42.
Nothing was extracted and the criterion passes.

Reconstruction proves the patches invert the split. It says nothing about
whether the split is meaningful. So the bar needs a companion constraint, and
SPEC 2.4 now carries one: the core must hold ≥ 50 % of total content.

This is the same trap the previous cycle named and did not act on: a threshold
met by relaxing its own definition measures nothing, and it is worse than no
threshold because it looks like it measures something.

## Finding 2 — the core is real, and bigger than the section counts suggested

| skill | core share |
| --- | --- |
| `analyze-dashboard-vuln` | 96 % |
| `create-pr` | 74 % |
| `develop-issue` | 54 % |
| `resolve-cve` | 53 % |
| `issue-creation` | 45 % |
| `check-standards` | 34 % |
| **overall** | **60 %** |

21 common sections out of 61 sounded discouraging. It was misleading: the common
sections are the large ones. Counting sections weights a two-line heading the
same as a forty-line workflow.

That is worth remembering beyond this change — the unit you count in decides
what you conclude, and section counts and line counts told opposite stories
about the same files.

## Finding 3 — the anchor decides everything, not the divergence volume

409 patch blocks across the 42 files. 380 have a unique anchor; **29 are
ambiguous**, and SPEC 2.1.1 is explicit that an ambiguous anchor is a fatal
`sync` error, not a warning.

| Anchor strategy | Files reconstructing cleanly |
| --- | --- |
| Nearest preceding common line | **21 of 42** — below the bar |
| Scoped to the containing heading | **42 of 42** |

All 29 ambiguities dissolve when the anchor is the heading that contains the
block rather than any line in the file. Concentrated in three skills:
`create-pr`, `develop-issue`, `resolve-cve`.

And this is not a new idea — SPEC 2.1.1's own example already anchors to a
heading:

```yaml
- op: insert-after
  anchor: "## Version bases"
```

The design must make heading scoping a hard requirement rather than an
implementation choice, because the naive reading of "anchor" as "a line of text"
fails the bar by 14 files, and it fails quietly: 21 of 42 still reconstruct, so
a partial implementation looks like it half-works rather than like it is wrong.

## Finding 4 — what has no home in a core

50 of 70 divergence findings carry no marker at all. A conflict is, by
definition, a divergence nobody declared — so it belongs neither in the core
(it is not shared) nor in an override (nobody said it was deliberate).

Mechanically it can still be emitted as a patch op, and that is what makes
reconstruction reach 42 of 42. But a `core/` built that way encodes fifty
undeclared accidents as though they were decisions, and `sync` would then
distribute them.

SPEC 2.1.1 already forbids resolving conflicts automatically. The open question
is what the *artifact* does with them, which is different from what the report
does.

## Open questions for propose

1. **Where do conflicts live in the output?** Options: emitted as ordinary
   override ops (reconstructs, but launders accidents into policy); held in a
   separate `conflicts/` layer that `sync` refuses to distribute until resolved;
   or left out, making those files reconstruct `lossy`. The third is the only one
   where the artifact never asserts something nobody decided.
2. **Does `lossy[]` mean "could not reconstruct" or "reconstructed but should
   not be shipped"?** They are different failures and the criterion
   `reconstruidos + lossy == 42` reads as the first.
3. **Is `check-standards` at 34 % core worth extracting at all**, or is it
   honest to report that one skill as having no usable core rather than forcing
   one? SPEC 2.1.0 left this open deliberately.
4. **What does the ambiguous-anchor test look like?** SPEC 2.4 requires a test
   with a deliberately ambiguous anchor that fails `sync`. With heading scoping
   the real corpus produces none, so the test needs a constructed case — which
   is fine, as long as it is honest that the corpus no longer exercises it.

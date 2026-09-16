# Design — `skills-diff`

## The insight that shapes everything: the anchor is the heading

SPEC 2.1.1 specifies overrides as positional patches anchored to text:

```yaml
- op: insert-after
  anchor: "## Version bases"
```

Look at what that anchor *is*. It is a markdown heading. And a real `SKILL.md`
is a sequence of heading-delimited sections — frontmatter, then `#`, `##`,
`###`, each holding prose, code fences and `> **repo-specific` blockquotes.

So the unit of comparison is not the line. It is the **section**, keyed by its
heading path.

This matters because a line-level diff across seven variants is unreadable and,
worse, unclassifiable: a line moved by an insertion above it shows as two
changes with no relationship. Sections survive reordering, and the anchor model
SPEC already committed to falls out for free instead of needing a second
mechanism.

```
SKILL.md
├── frontmatter          { name, description }
└── sections[]           keyed by heading path, e.g. ["Workflow", "2. Prettier"]
    ├── heading
    └── body
```

## Module layout, and the purity seam

```
src/skills/parse.ts     PURE  — string -> ParsedSkill. No fs.
src/skills/diff.ts      PURE  — ParsedSkill[] -> SkillsDiff. No fs.
src/skills/render.ts    PURE  — SkillsDiff -> markdown.
src/skills/load.ts      IMPURE— walks the checkouts, reads files.
src/cli.ts              WIRING
```

The seam is the same one SPEC 6.1 draws for `src/matrix/`. Every classification
decision is a decision about strings, so every one of them is testable with a
literal — no fixture directory that could encode the same misunderstanding as
the code, which is how this project shipped a scanner that recovered zero from
real data while every test passed.

## Decision 1 — the section is the address, the line is the finding

**Revised after an independent oracle run against the real seven repositories
exposed a flaw in the first draft of this decision.** Section-granularity
classification was measured: 61 heading sections across the six skills, 21
common, 17 override, 2 sharedOverride, **21 CONFLICT**. Opening the 21 showed
the defect. In `analyze-dashboard-vuln` — the skill measured as closest to
boilerplate — a 7-line `Input` section with 2 lines differing, and a 13-line
`Input/Repo map` section with 2 lines differing, both reported as whole-section
CONFLICT. Both statements are true and both are useless: they tell a reader
something is wrong and hide what, and they give a two-line example-path
difference the same visual weight as a genuine `typecheck yes / typecheck no`
policy disagreement. At that resolution the three conflicts SPEC actually names
would have been buried under eighteen that are one line of prose.

So the heading path stays the key and the anchor — SPEC 2.1.1's override model
is anchored to a heading and that does not change. What changes is the unit
being grouped and classified: **lines within the section, not the section's
whole body.**

For each skill, for each heading path present in any variant:

1. Group the variants' bodies by exact content — unchanged, and this part of
   the first draft measured correctly. The real shapes: `Input` splits 3 repos
   / 3 repos / 1, `Input/Repo map` splits 2 / 5. A pairwise diff against an
   arbitrary base would have reported six differences where there are two or
   three populations — grouping is what makes that legible, and it stays.
2. **One group** → `common`. No further work: identical content has no lines
   to isolate.
3. **More than one group** → compute the common lines shared by every group's
   body (a reduction, not a pairwise diff against one chosen group — see
   below), then for each group compute the lines that are NOT in that common
   set. Those lines, not the group's whole body, are the finding.
4. A conflict or override now carries **magnitude**: total lines in the
   section, how many are common, how many differ. "2 of 13 lines differ" is
   the sentence a reader needs and "this section differs" is not.
5. Classification (override / sharedOverride / CONFLICT) is decided by
   whether a `repo-specific` marker falls inside a group's OWN differing
   lines — not anywhere in its whole body. A marker line elsewhere in a body
   that happens to also diverge for an unrelated reason must not launder an
   unrelated divergence into "explained".
6. Present in some variants and absent in others is still divergence,
   classified by the same rule: an absent variant contributes zero lines, so
   every line in the present variants' bodies is, trivially, not shared with
   the absent one.

**Computing the common lines without a base.** "There is no base repository"
(unchanged from the first draft — picking one would make the report's shape
depend on an arbitrary choice) applies here too, so the common-lines
computation must not privilege one group's line sequence as the reference.
It is a reduction: the common sequence across N group bodies is the longest
common subsequence of group 1 and group 2, then the longest common subsequence
of THAT result and group 3, and so on. Each step's result is a subsequence of
every body folded in so far — that is what makes the final sequence, however it
was reduced, a valid subsequence of every group's lines regardless of
processing order. Groups are folded in a fixed, sorted order (by their
lexicographically-first repo) so the computation is deterministic, which is a
different property from "grouping is meaningful" — the order affects nothing
about which lines the result contains, only the mechanics of computing it.

**What this predicts, and what it does not.** The 61/21/17/2/21 numbers above
are section-granularity and will not survive re-classification at line
granularity — they are the oracle's own baseline for checking the new output in
slice 7, not a target this change is built to reproduce. One thing the first
pass surfaced that is worth naming without deciding: several of the 21
whole-section CONFLICTs are a per-repo example path or a single table row with
no marker anywhere near it. That does not mean they are not conflicts — SPEC
says report divergence with no declared intent as CONFLICT, full stop — but it
is a sign the marker convention in the source files is incomplete, not that
the classifier is wrong. Reported faithfully, with its magnitude visible, that
is exactly the material a human needs to decide whether to extend the marker
convention. That decision belongs to `sync`'s authors, not to this command.

### Decision 1, revised again — the block is the finding, not the section

**A second independent oracle run found a second flaw, one level deeper than
the first.** Line-level reporting fixed the magnitude problem, but classifying
the WHOLE section as one label was still live: a real `develop-issue` section,
`Workflow/1. Plan`, carried BOTH a declared `> **repo-specific
(wazuh-dashboard):**` override AND a separate, unmarked wording disagreement
("affected **area**" vs "affected **plugin(s)**") a few lines apart. One
label, applied to the whole section, can only be one of those two truths.
Calling the section `override` hides the undeclared divergence under "someone
decided this". Calling it `conflict` — the safer-sounding choice — buries a
genuine, explicit, attributed decision under "nobody decided this". A person
who opens the file, finds a `repo-specific` marker sitting right next to a
reported CONFLICT, reasonably concludes the tool is wrong. For a project whose
whole thesis is a verifiable, trustworthy dataset, that is worse than
reporting less.

SPEC 2.4 already named the right unit and the first pass missed it: "**todo
bloque divergente** cae en común / override / CONFLICTO" — the divergent
BLOCK, not the section. So classification now happens at block granularity,
inside the same section:

1. Grouping whole bodies stays exactly as decided above — it is what finds the
   real populations (`3/3/1`, `2/5`) instead of pairwise noise, and that part
   has now measured correctly twice.
2. The common-line reduction across those whole-body groups (unchanged
   computation) doubles as a set of ANCHORS: lines guaranteed to appear, in
   the same relative order, in every variant.
3. Every variant's own lines are segmented into the runs that fall BETWEEN
   consecutive anchors. A run's position — which anchor precedes it — is what
   makes it possible to tell "the divergence right after anchor 2" apart from
   "the divergence right after anchor 5", even though both are, in the old
   model, just "lines not in the common set".
4. Within one such position, group the variants' runs by exact content —
   the same grouping rule as step 1, just scoped to this position instead of
   the whole section. More than one distinct run at a position is one
   divergent BLOCK; classify it (override / sharedOverride / CONFLICT) by
   whether a marker falls on THAT block's own lines, exactly as before, just
   scoped correctly. A section can now hold zero, one, or several blocks.

**The mirror-image trap, found and avoided before it shipped.** The first
attempt at this fix emitted one finding per GROUP's differing lines rather
than one finding per POSITION. Measured against the real data that produced
236 conflicts across 61 sections — collapsing seven variants of the SAME
passage into seven separate findings is the exact same information loss as
the original bug, in the opposite direction. Grouping by content WITHIN one
anchor-bounded position (step 4) is what keeps "the same passage, seven
variants" as one finding with seven groups, not seven findings.

**Magnitude stays, rescoped.** A block's `differing` count is its own extent;
`total` and `common` describe the ENCLOSING SECTION, so two small, unrelated
findings in the same 13-line section each read as "1 of 13 lines differ"
against the same section size, rather than one combined "2 of 13" hiding that
they are unrelated.

### Decision 1, revised a third time — a category must never discard an attribution

**A third independent oracle pass, cross-checking line coverage per category
rather than just counts, found a third instance of the same bug.** `common`
(21) and `override` (17) now agree exactly between two independent
implementations, and `conflict` was checked at line level, not just count: the
two cover the identical 127 lines of `create-pr` with zero difference — where
block counts differed, it was chunking granularity, not a lost or invented
finding. But one real position, in `resolve-cve`'s `Workflow/4. Verify`,
carried two groups: one explicitly marked `> **repo-specific
(wazuh-dashboard):**`, one carrying a bare `> **repo-specific:**`. The old
rule — "any unnamed marker among this position's groups makes the whole
position `sharedOverride`" — reported BOTH groups under `sharedOverride`,
erasing the wazuh-dashboard attribution the author had written down.

The shape of the failure is now familiar: section collapsed to block, block
collapsed to group, and now group collapsed to category. The per-GROUP
`marker` field was already correct; the loss happened exactly at the point a
position's several groups get folded into ONE `category` for the whole
position.

**The fix: split, don't collapse, when groups disagree on marker kind.** A
position's groups partition into unmarked, named, and unnamed. Two or more
DISTINCT unmarked groups still force `conflict` outright (design decision 2's
"deliberately dumb" rule, unchanged) — an explained group elsewhere cannot
resolve an unexplained disagreement between two others. With at most one
unmarked group and only ONE marker kind present, nothing changes: this is the
case already verified, twice, against real data. But when BOTH a named and an
unnamed group are present, the position now yields TWO blocks — an `override`
carrying the named group(s) (plus the unmarked baseline, if any) and a
`sharedOverride` carrying the unnamed group(s) (plus the same baseline).
Neither block needs a counterpart to be meaningful: when there is no unmarked
baseline at all (the real `resolve-cve` shape), each split block simply
reports its own marked group standing alone — which is the fully honest
report, because nothing at that position is actually unexplained.

The invariant this now guarantees, and the one to test directly: **no block
may be reported under a category that discards an attribution present in one
of its own groups.** A `sharedOverride` or `conflict` block containing a
`named` group is a defect on sight — cheap to check by walking every block,
and exactly what would have caught this before it shipped.

## Decision 2 — the marker decides intent, and it has two forms

```
> **repo-specific (wazuh-dashboard):** ...      -> override, attributed
> **repo-specific:** ...                        -> override, unattributed
```

97 markers measured, 15 unattributed.

An unattributed marker is its own category, `sharedOverride`. It is NOT filed
under a repository: the author declined to name one, and inventing an
attribution here would be distributed by `sync` later as though a person had
decided it. The report says "this block is deliberate and belongs to no single
repo" — which is a true statement, where "belongs to wazuh-dashboard" would be
a false one.

A group with no marker inside its OWN differing lines (Decision 1, point 5) is
part of a CONFLICT. That is the whole heuristic, and it is deliberately dumb:
the marker is a human's declared intent, and the absence of one, at the exact
lines that differ, means no human declared anything about that difference — a
marker elsewhere in the same body, attached to a different divergence, does not
count.

## Decision 3 — the frontmatter is compared, not diffed

`description` legitimately differs per repository — it names the repo. `name`
must match or the skill is not the same skill.

So frontmatter is checked as two fields, not diffed as text: `name` mismatch is
a hard error (the inputs were mis-grouped), `description` divergence is reported
as its own row rather than as a CONFLICT. A description that names a different
repo is not a conflict; it is the one place divergence is obviously correct.

## Decision 4 — measure the divergence profile, decide nothing

Per skill, the artifact carries counts: sections total, common, override,
sharedOverride, conflict.

That is what turns the bimodal finding from an anecdote into data:

| skill | expected shape |
| --- | --- |
| `analyze-dashboard-vuln` | mostly common |
| the other five | roughly half divergent |

The command does not decide whether the five have a core. A premature answer
would still pass a reconstruction test — reconstruction proves the patches
invert the split, not that the split is meaningful — so it is an error class
verification cannot catch. Measuring is the honest move and it is cheap.

## Decision 5 — the sparse path set gains `.claude`, and the cost is measured

`sparsePathsFor()` adds `.claude` for every kind. Not conditionally per repo: a
per-repo condition is a list that has to be maintained, and the repo set already
burned this project once when it was hardcoded rather than discovered.

Cone mode materialises the directory where it exists and nothing where it does
not, so a repo without `.claude` is unaffected. `repo-fetch`'s existing
requirement — every path on disk is either a top-level file or inside a declared
path — still holds with `.claude` declared.

Cost is measured, not estimated: `.cache/` is 264 MB entering this change, and
the observed cold-clone time and resulting size are recorded. The habit exists
because an estimate cost a maintainer round-trip twice.

## Decision 6 — determinism by construction

Output ordering: skill name, then heading path, then repository name. All three
are strings with a total order, none depends on filesystem iteration or on the
order repos appear in `sources.yml`.

`generatedAt` is carried in the artifact and never rendered into the markdown,
the same rule the crosscheck follows so the rendered file stays byte-identical
across runs.

## What could go wrong, and how it gets caught

- **Heading paths collide.** Two sections with the same heading text under
  different parents, or twice under the same parent. The path is the key, so a
  collision silently merges two sections. The parser must detect duplicate paths
  within one file and fail loudly rather than overwrite — a merged section would
  produce a plausible, wrong classification.
- **A marker inside a code fence.** `> **repo-specific` appearing inside a
  fenced block is text, not a marker. The parser must track fence state. This is
  the same class as the inline-literal context gate in `index-references.ts`,
  which took a review cycle to get right.
- **The bar may be unreachable.** ≥ 35 of 42 is a carried-over ratio, not a
  measured target. Reconstruction is not built in this change, so nothing here
  can fail against it — but the divergence profile this change emits is what
  tells us, before we build it, whether the bar is real.

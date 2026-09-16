# Tasks — `skills-diff`

Strict TDD: the test is written first and observed failing for the right reason
before the implementation exists. A test that passes the moment it is written
proved nothing.

Standing rule, earned four times now: **no test in the pure layer may assert
against a fixture file written from the same understanding as the code.** The
parser and the classifier take literals.

## 1. The parser — `src/skills/parse.ts`

- [x] 1.1 Write `parse.test.ts`: a `SKILL.md` literal with frontmatter and three
      headings parses into `{ frontmatter: { name, description }, sections[] }`,
      each section keyed by its heading path.
- [x] 1.2 Nested headings produce a path, not a flat name: `## Workflow` then
      `### 2. Prettier` yields `["Workflow", "2. Prettier"]`.
- [x] 1.3 Content before the first heading is its own section with an empty path
      — the preamble is real content and dropping it would lose it silently.
- [x] 1.4 A `> **repo-specific (wazuh-dashboard):**` marker is recognised and
      attributed; a `> **repo-specific:**` marker is recognised and NOT
      attributed.
- [x] 1.5 **A marker inside a fenced code block is text, not a marker.** Track
      fence state. Same defect class as the inline-literal context gate in
      `index-references.ts`, which took a review cycle to get right.
- [x] 1.6 A heading path appearing twice in one file is a loud failure, not a
      silent overwrite. A merged section produces a plausible, wrong
      classification.
- [x] 1.7 Implement until 1.1–1.6 pass.

## 2. The classifier — `src/skills/diff.ts`

Revised after an independent oracle run against the real repos (see design
decision 1): classification groups whole bodies as before, but a divergent
section reports its DIFFERING LINES with magnitude, not its whole body. The
heading path is still the key; it is no longer the reporting unit.

- [x] 2.1 Write `diff.test.ts`: seven literal variants of one section, all
      identical, classify as `common`, with magnitude `{ total, common,
      differing: 0 }`.
- [x] 2.2 Variants forming two content groups where the minority group's OWN
      differing lines carry a named marker classify as `override`, attributed
      to the repos in that group, reporting only the differing lines — not the
      group's whole body.
- [x] 2.3 Two groups where the minority's differing lines carry an unnamed
      marker classify as `sharedOverride`, attributed to no repository.
- [x] 2.4 Two groups whose differing lines carry no marker classify as
      `CONFLICT`, carrying each group's differing lines and repos, with neither
      selected.
- [x] 2.5 **A marker elsewhere in the body does not launder an unrelated
      divergence.** A section with a marker present, but NOT on the lines that
      actually differ between two groups, still classifies as `CONFLICT` for
      that divergence. This is the defect the oracle run found: whole-section
      marker presence produced false explanations.
- [x] 2.6 **Grouping, not pairwise**: a 3-identical / 4-identical split reports
      two populations, not six differences. Assert the group count, not just
      the line-level output.
- [x] 2.7 **Magnitude is exact.** A 13-line section where 2 lines differ reports
      `{ total: 13, common: 11, differing: 2 }` (or the equivalent for the
      literal under test) — assert the numbers, not just that they exist. A
      report that says "differs" with no count is the exact defect being fixed.
- [x] 2.8 A section present in some variants and absent in others is
      divergence, classified by the same rule: the absent variant contributes
      zero lines, so every line in the present bodies counts as differing.
- [x] 2.9 Classification is total: the sum of the categories equals the number
      of sections. Assert the arithmetic, not a sample.
- [x] 2.10 `name` mismatch across variants is a hard error; `description`
      divergence is its own row, not a CONFLICT.
- [x] 2.11 Per-skill counts are emitted: total, common, override, sharedOverride,
      conflict.
- [x] 2.12 Implement until 2.1–2.11 pass.
- [x] 2.13 Verify the purity seam: grep `src/skills/{parse,diff,render}.ts` and
      their tests for fs, network and clock.

Revised a second time after a second independent oracle run: SPEC 2.4's unit
is "todo bloque divergente", the divergent BLOCK, not the section — see design
decision 1's second revision. A section now segments into independent blocks
using the lines common to every variant as anchors; each block is classified
on its own, and a section carries zero, one, or several.

- [x] 2.14 Write the test: a section carrying both a declared
      `repo-specific (wazuh-dashboard)` override at one position and a
      separate, unmarked disagreement at another position yields TWO blocks —
      one `override` attributed to that repo alone, one `CONFLICT` — not one
      section-wide label either way. This is the real `develop-issue`
      `Workflow/1. Plan` shape.
- [x] 2.15 Write the test: the SAME finding does not explode into one block
      per group. All seven repos disagreeing at ONE position is one CONFLICT
      block with seven groups, not seven CONFLICTs — the mirror-image defect a
      first attempt at 2.14 actually shipped, measured at 236 conflicts across
      61 sections before the fix.
- [x] 2.16 Update `SkillDiffCounts`: `common` counts sections with zero
      blocks; `override`/`sharedOverride`/`conflict` count BLOCKS across all
      sections, not sections. `total` is their sum, and now generally exceeds
      the section count whenever any section yields more than one block.
- [x] 2.17 Implement the anchor-based segmentation until 2.14–2.16 pass,
      without regressing 2.1–2.11.

Revised a third time after cross-checking line coverage per category (not
just counts) against a second independent oracle: `common` and `override`
matched exactly and `conflict` matched at the line level, but one real
`resolve-cve` position had a named group and a bare-marker group folded into
one `sharedOverride`, discarding the named attribution — the same collapsing
bug one level further down (group to category).

- [x] 2.18 Write the test: a position with a named-marker group and a
      bare-marker group, no unmarked group, SPLITS into an `override` block
      (the named group alone) and a `sharedOverride` block (the bare-marker
      group alone) — not one block collapsed to either label.
- [x] 2.19 Write the invariant directly, applied to every test in the file
      through a checked wrapper, not just the one written for it: no block may
      carry a `named`-marker group under any category other than `override`,
      and no `conflict` block may carry an unnamed-marker group.
- [x] 2.20 Implement: split a position into two blocks when its groups
      disagree on marker kind; two or more DISTINCT unmarked groups still force
      one `conflict` block outright, unchanged.

## 3. The renderer — `src/skills/render.ts`

- [x] 3.1 Write the renderer test: every category renders with a heading and a
      count; an empty category renders as explicitly empty rather than omitted.
- [x] 3.2 A non-empty category renders its rows, showing the differing lines and
      the `X of Y lines differ` magnitude — not the whole section body. Assert
      row content, not just the heading — a report that announces a finding and
      then hides it is worse than one that says zero, and "this section
      differs" with no magnitude is the defect the oracle run found.
- [x] 3.3 The divergence profile renders as a per-skill table.
- [x] 3.4 `generatedAt` never appears in the markdown, so the file stays
      byte-identical across runs.
- [x] 3.5 The out-of-scope note for `settings.json` renders, naming the SPEC 2.4
      criterion that stays open.
- [x] 3.6 Implement until 3.1–3.5 pass.
- [x] 3.7 Following task 2.14–2.17's block-level correction: a section
      carrying both an override block and a conflict block renders BOTH,
      under their respective category headings, sharing the same heading-path
      label. Assert both categories' sections of the render contain the same
      path.

## 4. Widening the checkout — `src/fetch/clone.ts`

- [x] 4.1 Write the test: `sparsePathsFor()` includes `.claude` for every kind.
- [x] 4.2 Write the test that a repository whose tree has no `.claude` still
      checks out cleanly, and that its absence is distinguishable from a repo
      that was never fetched.
- [x] 4.3 Implement.
- [x] 4.4 Confirm the pre-existing `repo-fetch` requirement still holds: every
      path on disk is a top-level file or inside a declared path.

## 5. The loader — `src/skills/load.ts`

Revised after the real seven-repo run found the gap: "has `.claude/skills/`"
pulled `wazuh-indexer-plugins` and its three indexer-only skills into the same
comparison as the six dashboard skills, exactly the merge SPEC 2.2 forbids. The
fix is a measured rule, not a hardcoded exclusion — see the spec requirement
"A skill is diffed when it is shared, and the repository set follows from
that".

- [x] 5.1 Write the test: repositories are selected by the presence of
      `.claude/skills/`, NOT by `sources.yml`'s `kind`. A `kind: platform` repo
      with skills is included.
- [x] 5.2 A repository with no skills is reported as such, not silently dropped.
- [x] 5.3 `.claude/settings.json` is never read. Assert it, because the spec
      promises it and this is the only place that can prove it.
- [x] 5.4 Implement.
- [x] 5.5 Write the test: a skill appearing in exactly one repository does NOT
      enter `variantsBySkill` (no diff target for it), and instead appears in a
      separate single-repo-skills list naming the skill and its repository.
- [x] 5.6 Write the test: a skill appearing in two or more repositories DOES
      enter the diff — assert the boundary at exactly 2, not >2.
- [x] 5.7 Write the test: a repository whose ONLY skills are single-repo skills
      is excluded from `repos` with a reason distinct from "no .claude/skills"
      (it has skills; none of them clear the bar) — this is the exact shape of
      `wazuh-indexer-plugins`.
- [x] 5.8 Write the test: a repository with a mix of a shared skill and a
      single-repo skill is still included — one qualifying skill is enough.
- [x] 5.9 Implement the two-or-more threshold. No repository name or skill name
      is hardcoded anywhere in the implementation — the rule is arithmetic over
      already-loaded data, the same discipline `repo-fetch`'s first requirement
      exists to enforce after a repo name was once baked into `src/cli.ts`.

## 6. CLI wiring — `src/cli.ts`

- [x] 6.1 Write the determinism test: two runs at a frozen clock produce
      byte-identical `skills-diff.json` and `SKILLS-DIFF.md`.
- [x] 6.2 Write the test that conflicts exit `0` — a conflict is the expected
      output of an analysis, not a failure.
- [x] 6.3 Register the `skills-diff` command, remove its `notImplemented` stub,
      extend `USAGE`.
- [x] 6.4 Implement, writing both artifacts to `out/<ref>/`.

## 7. Against the real seven repositories — this closes the change

A green suite does not close this. Three previous cycles had one and shipped
defects that only real data found.

- [x] 7.1 Refresh the cache with the widened path set. **Record the observed
      cold-clone time and the resulting `.cache/` size as real numbers.** It was
      264 MB entering this change.
- [x] 7.2 Run `skills-diff` against all seven repositories. Record the counts.
- [x] 7.3 Confirm 42 `SKILL.md` files were read — not 18, not 45. A different
      number means the selection rule is wrong.
- [x] 7.4 Confirm `wazuh-dashboard` is included despite being `kind: platform`.
- [x] 7.5 Confirm the three known conflicts appear: `typecheck` in
      `check-standards`, the `no-changelog` label, OSD `changelogs/fragments`.
- [~] 7.6 STRUCK. The expectation was wrong: 15 counts unnamed marker LINES
      across the 42 files, and most sit in sections identical across all seven
      repos, so they never become a divergence at all. Observed: 2
      `sharedOverride` blocks, 4 unnamed-marker groups. See `verify-report.md`.
- [x] 7.7 Confirm the measured divergence profile: `analyze-dashboard-vuln`
      mostly common, the other five roughly half divergent. **This is the number
      that tells us whether the ≥ 35 of 42 reconstruction bar is real**, before
      anyone builds against it.
- [x] 7.8 Confirm no finding concerns `settings.json`.
- [x] 7.9 Record every result in the verification report, marking each as
      confirmed-against-real-repos or asserted-by-fixture.

## 8. Documentation

- [x] 8.1 Tick the criteria this change closes in SPEC 2.4, with an evidence
      header.
- [x] 8.2 State explicitly which SPEC 2.4 criterion stays open and why — the
      `settings.json` one. A debt named is not a debt hidden.
- [x] 8.3 Record the measured cache cost from 7.1 in the repo-fetch docs.

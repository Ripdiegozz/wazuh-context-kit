```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
verdict: pass
blockers: 0
critical_findings: 0
requirements: 9/9
scenarios: 17/17
test_command: bun test
test_exit_code: 0
test_output_hash: sha256:ea0a21396eff716a8eee07062a72fe2420ce432c7ca500b4b94dd76a716408e2
build_command: bun run build
build_exit_code: 0
build_output_hash: sha256:8d336b2a09f74f250e0453c8de827474ad2d788fe7279f059d93613855309d87
```

# Verification — `skills-diff`

Run 2026-09-16 against the seven real repositories at `5.0.0`.

Every result is marked **confirmed-against-real-repos** or
**asserted-by-fixture**. That distinction is the point: four previous cycles
produced green suites and shipped defects that only real data found.

## Automated checks

| Command | Observed |
| --- | --- |
| `bun test` | 302 pass, 3 skip, 0 fail |
| `bunx tsc --noEmit` | clean, exit 0 |
| purity grep over `src/skills/{parse,diff,render}.ts` | 0 matches |

## The independent oracle

The expected answer was computed separately in Python against the same repos,
before and alongside the implementation, and the implementation was checked
against that oracle rather than against itself.

**Corrected from an earlier draft of this report, which said the two
implementations "converged" and then tabled `override` at 17 vs 18 with no
explanation.** A CodeRabbit review on PR #16 flagged exactly that: an
unexplained count difference reads as convergence when the totals plainly
differ, and that is an overclaim, not a rounding error.

Stated plainly: the two implementations matched EXACTLY on `repos`, `skills`,
`sections`, and `common`. They did NOT match on `override` or `conflict`.

| | Oracle | Implementation |
| --- | --- | --- |
| repos | 7 | 7 |
| skills | 6 | 6 |
| sections | 61 | 61 |
| common | 21 | 21 |
| override | 17 | 18 |
| conflict | 54 | 50 |

Counts alone would not have been enough to call this anything. Line-level
coverage was compared per category: for `conflict` in `create-pr` both cover
**the identical 127 lines**, with zero lines unique to either side. Where
block counts differ (18 vs 14 there) it is segmentation granularity — the same
lines chunked into a different number of blocks — not a lost or invented
finding. "We count differently" and "you are missing findings" look identical
in a totals table, and only the line-level check tells them apart.

That line-level check is what made the remaining count difference worth
chasing rather than shrugging off, and a cause was found: the anchor
computation (`commonAcrossGroups` in `src/skills/diff.ts`) reduced the common
line set PAIRWISE — `lcs(lcs(a, b), c)` — which can discard a line present in
every variant depending on which pairwise alignment the reduction happens to
pick first. A dropped anchor merges positions that should stay separable,
changing block boundaries and, downstream, which blocks get counted as
`override` versus `conflict`. This is the probable cause of the residual
17-vs-18 and 54-vs-50 difference, though it was found and fixed after this
report's run and is not itself re-verified against the real repos here — see
`src/skills/diff.ts`'s `commonAcrossGroups` docblock and `diff.test.ts`'s
"anchors are a true multi-way common subsequence" test for the fix and its
regression coverage.

The oracle found three defects, and was itself wrong twice:

1. **Section granularity was too coarse.** A 13-line section differing by 2
   lines was reported identically to a policy disagreement. Fixed to line level.
2. **`wazuh-indexer-plugins` was merged into the dashboard family**, against
   SPEC 2.2. Fixed by a discovered rule — a skill is diffed when it appears in
   ≥ 2 repos — rather than a hardcoded exclusion, which would have frozen out
   any skill the indexer team later adopts.
3. **A named attribution was discarded.** A group carrying
   `repo-specific (wazuh-dashboard)` sat inside a block categorised
   `sharedOverride`, meaning "belongs to no repo". The per-group `marker` field
   was already correct; the loss happened in the collapse to one category.

The oracle's own two errors, recorded because a verification report that only
lists the code's mistakes is not reporting how verification went: it nested
sibling headings by keying off the raw `#` count, and its first per-divergence
version emitted one finding per group, producing **236 conflicts over 61
sections** — the mirror image of the collapsing bug, same information loss in
the opposite direction.

## Slice 7 results — confirmed against real repos

| # | Check | Observed |
| --- | --- | --- |
| 7.1 | Cost of widening the checkout | cold clone **34 s**, `.cache/` **264 MB** — unchanged from 264 MB before. `.claude/` is negligible. |
| 7.2 | Run completes | exit `0` |
| 7.3 | 42 `SKILL.md` read | **42**, across 7 repos |
| 7.4 | `wazuh-dashboard` included despite `kind: platform` | **yes** |
| 7.5 | The three known conflicts appear | `typecheck`, `no-changelog`, `changelogs/fragments` — all present |
| 7.6 | *(superseded — see below)* | — |
| 7.7 | Divergence profile | recorded below |
| 7.8 | No finding concerns `settings.json` | **0 findings**; the out-of-scope note is present and names the open criterion |
| 6.1 | Determinism | `diff -r` clean across two frozen-clock runs |

Invariant checked directly on the real output: **0 blocks** carry a `named`
group under any category other than `override`.

### Task 7.6 was wrong and is superseded

It expected 15 markers to land in `sharedOverride`. 15 is the count of unnamed
marker *lines across all 42 files*; most sit in sections that are identical
across all seven repos, so they never become a divergence at all. A marker
inside text that is the same everywhere is not a divergence, and reporting it as
one would be wrong.

Observed: 2 `sharedOverride` blocks, 4 groups carrying an unnamed marker. The
task is struck rather than ticked. Recording the correction is worth more than
quietly deleting it.

## The divergence profile — and what it says about the reconstruction bar

| skill | common | divergent |
| --- | --- | --- |
| `analyze-dashboard-vuln` | 7 | 3 |
| `check-standards` | 2 | 13 |
| `create-pr` | 5 | 16 |
| `develop-issue` | 2 | 13 |
| `issue-creation` | 3 | 8 |
| `resolve-cve` | 2 | 17 |

**This is the number Phase 2 needed before anyone builds reconstruction**, and
it is not good news for the plan as written.

SPEC 2.4 asks for ≥ 35 of 42 byte-identical reconstructions from `core/` plus
`overrides/<repo>/`. That threshold was the pre-measurement 15/18 ratio carried
over. The measurement now exists: across 61 sections there are **21 common** and
**70 divergence findings**, and five of the six skills are 2–5 common sections
against 8–17 divergent ones.

A "common core" for those five would be a handful of sections, with the
overrides carrying most of the content — which is the shape SPEC 2.1.0 already
warned about: not a core with patches, but related files with a shared skeleton.

Reconstruction is not built in this change, so nothing here fails against that
bar. But the bar should be revisited with these numbers in hand rather than
discovered by a later change failing it.

## Product findings for the dashboard team

1. **50 divergences carry no marker at all.** The premise that overrides are
   deliberate and marked holds for 18 findings; 50 diverge with nothing
   declaring why. Some are clearly intentional — a per-repo example path — which
   suggests the marker convention is incomplete in the source files rather than
   that there are fifty disagreements. **Confirmed against real repos.**
2. `analyze-dashboard-vuln` is effectively one file copied seven times, 7 common
   sections against 3 divergent. It is the strongest candidate for extraction
   and would likely reconstruct byte-identically everywhere.
3. The three skills the indexer maintains (`docs-review`, `perf-tuning`,
   `wcs-management`) are reported and not merged, per SPEC 2.2. They are the
   input for the cross-team conversation, not a refactor.

## Limits of this verification

- One ref, one moment. Nothing asserts on the absolute counts in a test; they
  live here as observations.
- Reconstruction is not implemented, so "≥ 35 of 42" is untested by
  construction. The profile above is evidence about it, not a test of it.
- `.claude/settings.json` is out of scope by design, and the SPEC 2.4 criterion
  naming it stays open. Stated, not hidden.

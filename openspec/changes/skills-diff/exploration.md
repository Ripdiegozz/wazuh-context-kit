# Exploration — `skills-diff`

Phase 2's first slice: the analysis. `sync` and `check` consume its output, so
designing all three together would mean fixing the output format before knowing
what is inside the files.

Everything below was measured on 2026-09-16, not read from SPEC. SPEC 2.1.0 now
carries the corrected numbers because the first draft's were written before
counting.

## Finding 1 — the files are invisible on disk and present in git

`.claude/` appears in no repository's sparse-checkout path set. `find`, `fd` and
`ls` all return nothing. The files are nonetheless in every clone's tree and
retrievable:

```sh
git -C .cache/<repo>@5.0.0 show HEAD:.claude/skills/create-pr/SKILL.md
```

This is the single most important operational fact for the implementation. A
scanner built on filesystem walking — which is what every other parser in this
project does — finds zero skills and reports it as "these repos have no skills".
That is the exact shape of the defect this project has shipped before: a
plausible, confident, wrong zero.

Two routes, and the choice is a real one:

- widen `sparsePathsFor()` to include `.claude`, so the rest of the codebase's
  filesystem assumption keeps holding;
- or read through `git show`, leaving the checkout untouched.

The first costs a re-clone of every repo and makes the cache bigger. The second
introduces a second way of reading repository content into a codebase that has
exactly one today. Neither is obviously right.

## Finding 2 — 7 repos, 42 files, and the grouping is not `kind`

| | First draft | Measured |
| --- | --- | --- |
| Repos | 3 | 7 |
| `SKILL.md` | 18 | 42 |

The seven: `wazuh-dashboard`, `wazuh-dashboard-plugins`,
`wazuh-dashboard-alerting`, `wazuh-dashboard-notifications`,
`wazuh-dashboard-reporting`, `wazuh-dashboard-security-analytics`,
`wazuh-security-dashboards-plugin`.

`wazuh-dashboard` is declared `kind: platform`, not `dashboard`. So the set
cannot be derived from `sources.yml`'s `kind` field — it has to be derived from
"does this repo have `.claude/skills/`". Deriving it any other way reproduces
the original error.

`wazuh-indexer-plugins` has three skills of its own (`docs-review`,
`perf-tuning`, `wcs-management`), each shipping an extra reference file beside
`SKILL.md`. SPEC 2.2 keeps them out of the merge deliberately — they are input
for a conversation between teams, not a refactor. They still need to be
*reported*, and the extra-file shape is a structural difference SPEC does not
mention.

## Finding 3 — divergence is bimodal, and it questions the model

Lines differing from `wazuh-dashboard` as base:

| skill | base | differing |
| --- | --- | --- |
| `analyze-dashboard-vuln` | 130 | 2–6 |
| `check-standards` | 101 | 57–71 |

One skill is boilerplate with the repo name swapped. Five differ across more
than half their lines. "Common core plus small intentional overrides" fits the
first and misfits the rest: at 50% divergence there is no core with patches,
there are six related files.

This is the central open question of the change, and it must be answered with
the diff in hand rather than now. Inventing a core for files that do not have
one produces a `core/` nobody recognises and an override pile larger than the
core — and it would pass a reconstruction test, because reconstruction only
proves the patches invert the split, not that the split means anything.

## Finding 4 — the override marker is real, with two sub-formats

97 markers across the 42 files. SPEC's quoted example exists verbatim at
`wazuh-dashboard/.claude/skills/create-pr/SKILL.md:75`.

But 15 of the 97 read `> **repo-specific:**` with no repo name, typically about
something true of several repos at once. A marker naming no repo belongs to no
`overrides/<repo>/`. Filing it under one invents an attribution the author did
not make, and that attribution would then be distributed by `sync` as though
someone had decided it.

## Finding 5 — `settings.json` is named in the criteria and is not a skill

`.claude/settings.json` sits beside the skills tree, is named in SPEC 2.4's
known-conflicts criterion, and is not a `SKILL.md`. It will not fall out of a
skills diff.

Measured: 5 distinct variants across the 7 repos, with `alerting`,
`notifications` and `security-analytics` byte-identical to each other. So it is
a 3-versus-4 split rather than a clean pairwise divergence.

## Open questions for propose

1. **Read route**: widen the sparse checkout to include `.claude`, or read
   through `git show`? This decides whether the codebase keeps one way of
   reading repository content or gains a second.
2. **The model**: do the five heavily-divergent skills enter the same
   core+overrides model, or are they reported as a family with no core until a
   human decides what should be common? The answer changes what `skills-diff`
   emits, and therefore what `sync` can consume.
3. **Unnamed markers**: what does an override file do with a block that names no
   repo? Options include a shared layer above the per-repo ones, or leaving it
   in the core, or reporting it as unclassified.
4. **`settings.json` scope**: in or out of this change? It is named in the
   criteria but is a different file format and a different divergence shape.
5. **Output shape**: SPEC calls for a readable conflict report. The eventual
   inspector (now last in the build order) will want to draw this as a graph,
   and the crosscheck's bipartite shape is the same problem. Is the report
   designed for that reader now, or only for a terminal?

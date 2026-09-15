# Proposal — `platform-core-plugins`

> Phase: `sdd-propose` · 2026-09-15 · run inline (this runtime refuses SDD child dispatch)
> Reads: [`exploration.md`](exploration.md). Product decisions arrived confirmed;
> this proposal does not re-open them.

## Intent

Two things are wrong at once, and one of them is invisible.

**The published dataset is a lie.** `out/5.0.0` carries the `--fixtures` output,
not the real one: 5 plugins instead of 9, 0 index templates instead of 20, 0 WCS
modules instead of 39. SPEC 5.1 makes `out/` the product, so the product
misstates the release it claims to describe.

**Every dependency edge into the OpenSearch Dashboards core dangles.** All four
wazuh-native plugins require `navigation`; `navigation` lives only in
`wazuh-dashboard/src/plugins`, which the matrix cannot see. A crosscheck tool
whose graph has no destination for its most common edge is not finished.

## Scope

| In | Out |
|---|---|
| `sparsePathsFor("platform")` → `["src/plugins"]` | The `asCurrentUser` collision prose page — follow-up change |
| A new matrix section for core plugins, with a narrower fact shape | Phase 1.5 inspector, Phase 2 skills, Phase 3 MCP |
| `sources.yml`: add `wazuh-indexer-security-analytics`, drop the reporting `UNRESOLVED` flag | Any change to how wazuh-native plugins are classified |
| Label `fixtures/facts.ts` shape-only | Rewriting the fixtures to mirror reality |
| Regenerate `out/5.0.0` from real data | |
| Spec updates: `repo-fetch` path set and cone-mode wording, `matrix-pipeline` new section | |
| A regression guard so a stale `out/` cannot ship again | |

## Approach

### 1. Core plugins get their own section and their own shape

The confirmed decision is a separate section rather than mixing into
`plugins[]`. Evidence gathered after that decision shows it was not merely a
presentation preference — it is forced by the data:

```
manifests under src/plugins:        64
with a sibling package.json:         2
```

`versionScheme` is derived from `package.json`, and `build.ts:77` emits an
`unknowns[]` entry for every plugin whose `versionScheme` is `unknown`. Pushing
core plugins through the existing shape would turn a 3-entry unknowns list — the
list a human is supposed to act on — into a 65-entry one. The signal would be
destroyed by the noise.

So core plugins carry a narrower fact: identity, manifest dependency fields, and
evidence. No `serverApiAccess`, no per-plugin `versionScheme`, no `world`. Their
version is the repository's, from the root `package.json`
(`opensearch-dashboards`, `3.6.0`), recorded once rather than 64 times.

**Deliberately not attempted:** deriving a core/non-core discriminator from the
manifest `version` field. It splits 47 / 9 / 8 across `opensearchDashboards`,
`8.0.0`, and `1.0.0`, so it does not discriminate — the same trap
`classify.ts:59-61` already documents for `opensearchDashboardsVersion`. The
repository's `kind` is the discriminator we already have, and it is reliable.

### 2. Dangling edges become a first-class output

Once core plugins are visible, "does every `requiredPlugins` entry resolve to
something the matrix knows?" is computable. It should be computed and reported,
because that question is the reason this change exists, and a reader should not
have to re-derive it by eye across two sections.

### 3. A guard so this defect cannot ship twice

The stale dataset survived because nothing compares committed `out/` against a
real run, and nothing can without network. The guard belongs in the opt-in
network suite: regenerate into a temp directory and assert the committed
`payloadHash` matches. Cheap, and it fails loudly the next time someone commits
a fixtures build.

The pinned-hash test in `cli.test.ts` stays as-is. It correctly asserts the
fixtures path and was never the thing that failed here.

### 4. Cost, stated plainly

Cone mode works at directory granularity, so `src/plugins` checks out all 9,191
tracked files, not just the 64 manifests. That is roughly 5.5 MB and a slower
cold clone for `wazuh-dashboard`. There is no narrower cone; a non-cone pattern
set would buy a smaller checkout at the cost of leaving the mode the rest of the
code assumes. Not worth it for 5.5 MB.

### 5. One addition that will look like a bug later

`wazuh-indexer-security-analytics` holds none of the three declared `indexer`
paths. It will resolve a SHA and contribute zero facts, exactly like
`wazuh-dashboard` does today. The maintainer chose to add it knowingly, against
the recommendation, as a record that the repository was evaluated. `sources.yml`
must carry a comment saying so, or the next reader will file it as a defect.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| `payloadHash` changes, so every downstream consumer of `out/5.0.0` sees churn | Medium | Unavoidable and correct — the current hash describes fixtures. Call it out in the PR. |
| The new section lands in `matrix.json` and breaks a consumer's schema assumptions | Medium | Additive key; nothing existing is renamed or removed. Verify `MATRIX.md` render stays stable for the existing sections. |
| Cold clone of `wazuh-dashboard` gets materially slower | Low | Measure before and after; record real numbers rather than estimating. |
| 64 core plugins swamp `MATRIX.md` | Medium | Render the core section as a summary with counts, not 64 rows. Design decides the exact form. |
| Scope creep into the prose page | Low | Explicitly out of scope; already recorded as a follow-up. |

## Rollback

Revert the commit range. `sparsePathsFor` returns to `[]`, the new section
disappears, `out/5.0.0` returns to its previous bytes. No migration, no
persisted state, no consumer contract is broken by going back — the section is
additive in both directions.

## Why not simply regenerate `out/` and stop

That fixes the symptom the maintainer reported in one command, and it was
offered. It leaves the dangling-edge hole in place, and it leaves the next stale
dataset free to ship unnoticed. The regeneration is a third of an hour; the
reason this is a change rather than a command is the other two thirds.

## Next

`sdd-spec` and `sdd-design` — they are independent of each other and both read
this proposal.

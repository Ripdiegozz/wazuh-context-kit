# Exploration — `platform-core-plugins`

> Phase: `sdd-explore` · 2026-09-15
> Run inline: this runtime refuses SDD child dispatch.

## What triggered this

The maintainer noticed that `out/5.0.0` was missing dashboard repositories —
notifications and reporting specifically. Investigation found two separate
problems, one of which is much larger than the report.

## Finding 1 — the committed dataset is the fixtures build (a defect, not a gap)

`out/5.0.0/matrix.json` carries `payloadHash: sha256:1f9274f5…`, which is
exactly the `--fixtures` hash. The real pipeline produces `sha256:c820f1fc…`.

| | committed | real pipeline |
|---|---|---|
| plugins | 5 | 9 |
| repos represented | 2 | 6 |
| resolvedRefs | 2 | 8 |
| index templates | 0 | 20 |
| WCS modules | 0 | 39 |

Commit `69b2b12 feat: commit the generated 5.0.0 dataset` **describes** the real
run in its message ("9 plugins, 20 index templates, 39 WCS modules, 8 resolved
SHAs") but the bytes committed are the fixtures output. SPEC 5.1 makes `out/`
the product, so the published product currently misstates the 5.0.0 release.

No test caught it, and the reason is worth recording: `src/cli.test.ts` verifies
the `--fixtures` run against its pinned hash, which passes correctly. Nothing
compares committed `out/` against what the real pipeline produces, because that
requires network. That is a real coverage gap, not an oversight in the tests
that exist.

## Finding 2 — every wazuh-native dependency edge into the core dangles

`sparsePathsFor("platform")` returns `[]`, so `wazuh-dashboard` resolves a SHA
and contributes nothing. That was recorded as a classification ambiguity in
SPEC 1.5.2. It is worse than that.

`wazuh-dashboard` at `5.0.0` contains **64 `opensearch_dashboards.json`
manifests under `src/plugins/`**, across 68 top-level directories, 9,191
git-tracked files, ~5.5 MB.

All four wazuh-native plugins declare hard dependencies on plugins that live
only there:

| plugin | requiredPlugins reaching into `wazuh-dashboard/src/plugins` |
|---|---|
| `wazuh` | navigation, data, dashboard, embeddable, discover, inspector, visualizations, uiActions, charts, savedObjects, opensearchDashboardsReact, opensearchDashboardsUtils, opensearchDashboardsLegacy |
| `wazuhCore` | navigation, opensearchDashboardsUtils |
| `wazuhAiAssistant` | navigation, opensearchDashboardsReact |
| `wazuhCheckUpdates` | navigation, opensearchDashboardsUtils, opensearchDashboardsReact |

Every one of them requires `navigation`, which exists only at
`wazuh-dashboard/src/plugins/navigation`. For a tool whose stated value is the
crosscheck view, a dependency graph where every edge into the core points at
nothing is a hole in the product, not a classification detail.

**Trap worth recording:** `wazuh-dashboard` also has a root-level `plugins/`
directory. It is fully git-ignored (`*` / `!.gitignore`) and empty — a local dev
mount point for other repositories, not repo content. Anyone widening the path
set by pattern-matching on "plugins" will pick the wrong one.

**Cost:** the code uses `sparse-checkout --cone`, and cone mode works at
directory granularity, so adding `src/plugins` checks out all 9,191 files, not
just the 64 manifests. Cheap in bytes, not free in file count.

## Finding 3 — two SPEC section 8 questions were mis-stated, not unanswered

Both had the same shape: the question presupposed a distinction that does not
exist.

**Open decision 1 — which reporting repo is current.** `git ls-remote` against
both returns the identical SHA at `5.0.0`:

```
wazuh-dashboard-reporting    5.0.0 -> 71b4b9e2d6252bec29468ca8ac4c4dd185f6c06a
wazuh-dashboards-reporting   5.0.0 -> 71b4b9e2d6252bec29468ca8ac4c4dd185f6c06a
```

They are mirrors. The choice is cosmetic. The maintainer's working checkout uses
the singular, which `sources.yml` already names, so the `UNRESOLVED` comment can
simply be removed.

**Open decision 4 — which `asScoped`/`asInternalUser` pair the prose page
governs.** Neither, as posed. The hazard is that *both pairs expose the same
downstream property name*:

```
context.core.opensearch.client.asCurrentUser     indexer RBAC
context.wazuh_core.api.client.asCurrentUser      Wazuh Server API RBAC
```

`wazuh-core`'s `asScoped` is called exactly once in the whole plugins repo
(`wazuh-core/server/plugin.ts:100`, internal wiring). Every consumer calls
`asCurrentUser`. A page about `asScoped` would document a method almost nobody
calls while leaving the actual collision untouched.

The two appear in the same file: `wazuh-ai-assistant/server/tools/executor.ts`
uses the indexer client at lines 231, 424, 661 and the Manager client at line
850. And the confusion has already cost something — `wazuh-core.d.ts:59-70`
hand-writes narrower local types rather than importing the real ones, to explain
why `executor.ts` omits `token`. No TODO, no FIXME: a silent workaround, which is
worse than a flagged doubt.

## Finding 4 — the fixture "drift" is not drift

`HANDOFF.md` P2 item 2 records `fixtures/facts.ts` as disagreeing with reality on
`wazuh.indexerAccess`. It does, but not by accident:

| | fixture `wazuhMain` | real manifest |
|---|---|---|
| `requiredPlugins` | 3 entries | 15 entries |
| contains `"data"` | no | yes |
| `optionalPlugins` | includes `usageCollection` | does not contain it at all |

Three entries against fifteen, and an optional plugin that does not exist
upstream. This was never a faithful copy; it is a minimal shape sample. Making it
match reality would turn it into a snapshot that rots every release, and the
opt-in network suite already verifies against the real thing. The resolution is
to label it shape-only, not to "fix" it.

## Confirmed product decisions

Collected from the maintainer before this exploration was written, so the
proposer receives them rather than inferring them.

| Decision | Answer |
|---|---|
| Platform core plugins | Widen `sparsePathsFor("platform")` to `src/plugins`, and surface the core plugins in **their own section**, not in `plugins[]` |
| `asScoped` page scope | Cover **both** pairs, organised around the `asCurrentUser` collision |
| `wazuh-indexer-security-analytics` | **Add it** to `sources.yml` |
| Route | SDD |

On the third: it has a `5.0.0` branch but is a Java source repository
(`src/`, `commons/`, `gradle/`) holding none of the three declared `indexer`
paths, so it will resolve a SHA and contribute zero facts. The maintainer chose
to add it anyway, as a record that it was evaluated. Recorded here so the
outcome is not later read as a bug.

## Recommended change boundary

This exploration covers more than one deliverable. Splitting is recommended:

- **This change (`platform-core-plugins`)** — everything touching code, specs,
  and the dataset: the platform path set and the new matrix section, the
  `sources.yml` edits, the fixture label, and regenerating `out/5.0.0`.
- **A follow-up change** — the `asCurrentUser` collision page. It is prose
  against SPEC section 3, shares no code with the above, and would otherwise
  hold this change open while it is written.

## Open questions for `sdd-propose`

1. What is the new section called, and does it live beside `plugins[]` in
   `matrix.json` or nested under a repo-level key?
2. Do core plugins get the same fact shape as wazuh-native ones, or a narrower
   one? They have no `serverApiAccess` and no Wazuh version scheme.
3. Should the dangling-edge check become a first-class output — for example, an
   `unresolvedDependencies[]` — now that the data exists to compute it?
4. Does `out/` need a regression guard that compares committed bytes against a
   real run, given that this defect shipped unnoticed?

# Design — `platform-core-plugins`

> Phase: `sdd-design` · 2026-09-15 · run inline
> Reads: [`proposal.md`](proposal.md). Respects SPEC 6.1 (the purity seam) and
> SPEC 7 (build order).

## D1 — The core section is a list of repositories, not a flat plugin list

```ts
export interface CorePlugin {
  pluginId: string;
  pluginDir: string;
  requiredPlugins: string[];
  optionalPlugins: string[];
  requiredBundles: string[];
  evidence: DerivedEvidence;
}

export interface CoreRepo {
  repo: string;
  /** From the repository root package.json. One version for all its plugins. */
  version: string | null;
  plugins: CorePlugin[];
}
```

`MatrixJson` gains `core: CoreRepo[]`.

**Why nested rather than flat.** The version is a property of the repository,
not of the plugin — that is the whole finding behind the narrow shape. A flat
list would force the version onto each of 64 entries, repeating a fact 64 times
and inviting a future reader to believe the repetitions could differ. Nesting
makes the cardinality honest.

**Why `core` and not `platformPlugins`.** The section answers "what does the
platform provide", and a consumer resolving a dependency edge looks here. `core`
reads as that. It also leaves room for a second platform repository without the
name becoming a lie.

**Rejected: adding `world: "platform"` entries to `plugins[]`.** The confirmed
decision rules it out, and the data agrees — see D3.

## D2 — `requiredBundles` joins RawManifest

`RawManifest` currently omits `requiredBundles`, which appears in every core
manifest inspected (`data`, `dashboard`, `discover` all declare it). It is a
real dependency edge — a bundle a plugin loads at runtime — and omitting it
would make the unresolved-dependency report understate reality.

Added as `requiredBundles?: string[]`, optional like every other field, because
these repositories are not ours.

**Scope limit:** `requiredBundles` is recorded and reported. It does NOT feed
`indexerAccess` or any classification. Widening a classifier on a field we have
not studied is how a rule stops describing a property and starts describing an
instance.

## D3 — Core facts are a separate parse output, not `RawPluginFacts`

```ts
export interface RawCoreFacts {
  repo: string;
  pluginDir: string;
  manifestPath: string;
  commit: string;
  manifest: RawManifest;
}
```

`RawPluginFacts` carries `repoKind`, `packageJsonPath`, and `packageVersion`
because `build.ts` derives `versionScheme` and `world` from them. Only 2 of 64
core plugins have a sibling `package.json`, so reusing that type would mean
setting `packageVersion: null` 62 times and then teaching `build.ts` to suppress
the `unknowns[]` entry it emits for exactly that case.

Suppressing a rule for a caller is how a pure function stops being one. A
separate type means `buildMatrix` never runs the wazuh-native derivation over
core input at all, and `build.ts:77` keeps its single meaning.

`BuildInput` gains `coreFacts?: RawCoreFacts[]`, optional, so every existing
caller and every existing test keeps compiling unchanged.

## D4 — Dependency resolution is pure, and runs last

```ts
export interface UnresolvedDependency {
  plugin: string;      // depending plugin id
  repo: string;        // repo of the depending plugin
  dependency: string;  // the id that resolves to nothing
  field: "requiredPlugins" | "requiredBundles";
}
```

`MatrixJson` gains `unresolvedDependencies: UnresolvedDependency[]`.

The resolver builds one id set from `plugins[]` plus every `core[].plugins[]`,
then walks both sections' `requiredPlugins` and `requiredBundles`. It runs after
both sections are assembled, inside `buildMatrix`, with no I/O — it is a fold
over data already in hand.

`optionalPlugins` is deliberately NOT checked. An optional dependency that is
absent is the feature working as designed; reporting it would produce noise
indistinguishable from the signal.

**Ordering:** the output is sorted by `(repo, plugin, field, dependency)`. Every
other list in this codebase is deterministically ordered because `payloadHash`
covers it, and this one is no different.

## D5 — Hash and compatibility

`core` and `unresolvedDependencies` enter the hashed payload. `payloadHash`
therefore changes for every ref. That is correct and unavoidable: the payload
genuinely has new content.

Everything else is additive. No key is renamed, removed, or changed in meaning,
so a consumer reading `plugins[]` or `unknowns[]` is unaffected. The
`matrix-pipeline` delta spec pins that as a scenario rather than leaving it as
an intention.

## D6 — Parsing core manifests

In `src/parse/`, a new function handles `repoKind === "platform"`:

1. Read the repository root `package.json` for `version`. Absent → `null`, not
   an unknown. A missing version is a fact about the checkout, not a question
   for a human.
2. Glob `src/plugins/*/opensearch_dashboards.json` — one level only.
3. Skip any manifest with no `id`. A manifest we cannot name cannot be the
   destination of a dependency edge, so it has no use here.

**Explicitly not read:** the root-level `plugins/` directory. It is git-ignored
upstream and empty; a glob written against "plugins" rather than "src/plugins"
silently finds nothing and produces an empty core section that looks like a
successful parse. The `repo-fetch` delta spec pins this as a scenario for that
reason.

**Not read either:** `packages/`. It contains six files named
`opensearch_dashboards.json` that are optimizer test fixtures and generator
templates, not plugins.

## D7 — Rendering

`MATRIX.md` gains a core section rendered as a summary:

```
## Core plugins

| repo | version | plugins | provides |
|---|---|---|---|
| wazuh-dashboard | 3.6.0 | 64 | navigation, data, dashboard, … |
```

`provides` lists only the core plugins something else actually depends on —
typically a handful — not all 64. A reader's question is "does the thing I
depend on exist here", and an exhaustive list answers it worse than a filtered
one.

A second section renders `unresolvedDependencies` when non-empty, and is omitted
entirely when empty. An always-present "Unresolved: none" heading trains readers
to skip the region where the real signal will eventually appear.

The existing plugin table is untouched, and the spec pins it as byte-identical
for identical input.

## D8 — The freshness guard

A new opt-in test, gated on `WAZUH_CTX_NETWORK=1` beside the existing network
suite: regenerate into a temp directory, compare the regenerated `payloadHash`
against the committed `out/<ref>/matrix.json`.

**Why not in the default suite.** It needs clones. A default-suite test that
needs network is the exact failure this project already hit once — a test that
passed for eleven seconds while quietly reaching github.com.

**Why `payloadHash` rather than a file diff.** `meta.generatedAt` differs on
every run by design and is excluded from the hash. Comparing bytes would fail
always; comparing the hash compares the payload, which is the thing that must
not go stale.

**Honest limit, stated here so nobody mistakes it for more than it is:** this
guard only fails once somebody runs it with network. It does not make a stale
commit impossible; it makes a stale commit detectable by a command that exists.
Wiring it into the SPEC 5.4 regeneration workflow is what would close the loop,
and that workflow is still unwritten.

## D9 — Cost

Cone mode is directory-granular, so `src/plugins` brings all 9,191 tracked files
(~5.5 MB), not the 64 manifests. Leaving cone mode for a pattern set would buy a
smaller checkout and cost the mode every other path set assumes.

`tasks.md` records measuring the real cold-clone delta rather than estimating
it. The last cycle's lesson was that an unmeasured forecast costs a round-trip.

## Sequence

```
sources.yml ──► fetch ──► parse ─┬─► RawPluginFacts ──┐
 (+ platform:                    │                    ├─► buildMatrix ──► render
  src/plugins)                   └─► RawCoreFacts ────┘   (pure, D4 resolver)
```

Unchanged: `src/fetch/` is still the only module touching network and git, and
`src/matrix/` plus `src/decisions/apply.ts` stay pure. `git diff --stat` over
the seam is a verification task, as it was last cycle.

## Open question deferred to apply

The exact key name inside `MatrixJson` for the unresolved report —
`unresolvedDependencies` reads clearly but is long. Not worth blocking on; apply
picks it and records the choice.

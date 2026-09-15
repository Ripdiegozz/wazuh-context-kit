# Design — `close-phase-1`

> Phase: `sdd-design` · 2026-09-15 · run inline
> Reads: [`proposal.md`](proposal.md), [`research.md`](research.md).
> Respects SPEC 6.1 (the purity seam) and SPEC 7 (build order).

## D1 — Extraction: a two-line-aware reader with a dual-signal filter

The proposal left open how the catalogs get read without a type checker. Measured
against the real `plugins/main/common/constants.ts`:

```
export const declarations        355
  value on the same line         134
  value on the next line         166   <- prettier wraps past 80 columns
  expressions                     55
```

**A single-line regex recovers 134 of 300 literals — under half.** The wrapped
form is not an edge case here, it is the majority. Any reader must accept

```ts
export const NAME = 'value';
export const NAME =
  'value';
```

as the same thing. That is one regex with an optional newline, not a parser.

### The filter is the interesting part

Two candidate signals, each wrong alone:

| Filter | Hits | Wrong entries |
|---|---|---|
| value looks like an index (`wazuh-` / `.wazuh`) | 52 | 5 |
| identifier ends `_PATTERN` / `_INDEX` | 48 | 1 |
| **both** | **47** | 0 known |

The residues are small and each was read, not assumed:

- Value-only admits `PLUGIN_PLATFORM_INSTALLATION_USER = 'wazuh-dashboard'` (an
  operating-system user), `PLUGIN_PLATFORM_INSTALLATION_USER_GROUP`, and
  `WAZUH_PLUGIN_PLATFORM_TEMPLATE_NAME = 'wazuh-kibana'` (a saved-object
  template name). None is an index.
- Convention-only admits
  `NOT_TIME_FIELD_NAME_INDEX_PATTERN = 'not_time_field_name_index_pattern'`,
  which is a **field** name.

**So the intersection is the rule.** It recovers exactly the 47 the exploration
found by hand.

### The two exclusions that are not comfortable

`WAZUH_SAMPLE_INVENTORY_AGENT = 'wazuh-inventory-agent'` and
`WAZUH_SAMPLE_VULNERABILITIES = 'wazuh-vulnerabilities'` **are real indices** —
sample data gets indexed — and the intersection drops them because they carry no
`_PATTERN` suffix.

They are not silently dropped. They go into a short, named exceptions list in the
scanner, with a comment saying why each is there. A heuristic that quietly
discards two true positives is worse than one that names them.

**Rejected: a syntax parser dependency.** `oxc-parser` would read the file
properly rather than by pattern. But the filter — not the parse — is where the
difficulty lives, and a parser does not help choose between an index name and an
OS user name. Adding a dependency that solves the easy half is not worth it. If
the catalogs ever stop being this regular, this decision should be revisited, and
D8's pinned count is what will announce that.

## D2 — Matching is by pattern, never by prefix

A declared `index_patterns` entry is a glob: `wazuh-states-vulnerabilities*`.
A reference is usually the same glob.

Matching compares the **literal pattern strings** after normalising a single
trailing `*`. It does NOT do prefix containment.

This is load-bearing. The dashboard references `wazuh-metrics-comms-v4*`; the
indexer declares `wazuh-metrics-comms*`. Prefix matching would call that a match
and **erase the finding**. The `crosscheck` spec pins it as a scenario for that
reason.

## D3 — Output shape

```ts
interface CrosscheckJson {
  meta: { generatedAt: string; tool: string };
  ref: string;
  coverage: Coverage;                    // FIRST. See D4.
  declaredUnreferenced: DeclaredIndex[];
  referencedUndeclared: IndexReference[];
  wcsWithoutConsumer: string[];
  competingCatalogs: CompetingCatalog[];
}
```

`coverage` is the first key deliberately: a reader scrolling `crosscheck.json`
meets the limits before the findings.

No `payloadHash`. This artifact is not the dataset and is not a contract other
tools hash. Determinism still applies — every list is sorted — and a test asserts
two runs are byte-identical.

## D4 — Uncoverage is data

```ts
interface UncoveredMechanism {
  kind: "regex-allowlist" | "runtime-configuration" | "computed-expression";
  file: string;
  line: number;
  note: string;
}

interface Coverage {
  recoveredNames: number;
  scannedFiles: number;
  uncovered: UncoveredMechanism[];
}
```

Detection is deliberately shallow and honest:

- `regex-allowlist` — a `RegExp` literal in the same file as index handling whose
  source mentions `wazuh-`.
- `runtime-configuration` — a call to `configuration.get(` whose result feeds a
  template literal.
- `computed-expression` — an `export const` matching neither literal form, in a
  module the dual-signal filter already identified as a catalog. This is the
  55-declaration residue from D1, and it is where the `.map()` spreads live.

These heuristics will miss cases. That is acceptable **only** because the failure
direction is right: a missed uncovered-mechanism understates our confidence, it
never overstates it. The reverse would be a lie.

`CROSSCHECK.md` renders `coverage` before any findings section — the
`crosscheck` spec pins that ordering as a scenario.

## D5 — Widening the dashboard path set

`sparsePathsFor("dashboard")` becomes:

```ts
return ["plugins", "server", "public", "common"];
```

Cone mode ignores a declared path that does not exist, so the monorepo keeps
getting `plugins/` and the five single-plugin forks start getting their real
source. One path set, both shapes, no per-repo special-casing.

`tasks.md` records measuring cold-clone time and cache size before and after.
Entering this change: 32 s, 245 MB.

**Trap worth pinning:** a declared path matching nothing is indistinguishable
from a repository with nothing, and that is exactly how the current gap hid. The
`repo-fetch` spec has a scenario for it.

## D6 — Template discovery reads every subdirectory

`parseIndexerArtifacts` currently walks `templates/states/`. It walks
`templates/` and takes every JSON with an `index_patterns` array, recording the
subdirectory it came from.

No allowlist of directory names, and no assumption that templates live in a
subdirectory at all: four sit directly under `templates/`. `states`, `streams`
and `content` exist today; a fourth appearing upstream must not require a code
change to become visible. That is precisely the failure this defect is.

A JSON qualifies when it carries a non-empty `index_patterns` array. At `5.0.0`
every JSON under `templates/` qualifies, but the rule is the field, not the
location.

`IndexTemplate` gains `group: string` — the subdirectory — so a reader can tell a
state index from a stream index without parsing the path.

## D7 — No type checker, with a review trigger

Settled in the proposal and recorded here because this is where an implementer
looks: the scanner uses no type checker, because `typescript@7.0.2` exposes no
JS-callable compiler API, and the two ways to get one — a second copy of
TypeScript, or moving the project's toolchain to the classic line — were both
rejected.

**TypeScript 7.1 is expected to publish a public compiler API.** When it ships,
the `computed-expression` uncoverage becomes recoverable without any new package.
That is debt with a trigger, and the scanner's module docblock must say so, so
the next person reads it where the limitation bites.

## D8 — The pinned count is the drift alarm

The scanner asserts the recovered-name count against a pinned expectation (47
from `constants.ts` today).

A refactor that reformats the catalogs could silently drop the count to zero, and
a crosscheck over zero references reports **every declared index as unconsumed** —
36 confident false findings. The pin turns that into a failing test.

The pinned number is a lower bound plus an exact-match assertion on a handful of
known names, not a brittle equality on everything: adding a legitimate new
pattern upstream should not break the build, but losing the ones we know about
must.

## Sequence

```
sources.yml ─► fetch (widened) ─► parse ─┬─► templates (all groups) ─┐
                                         ├─► plugin facts ───────────┼─► buildMatrix ─► matrix.json
                                         └─► index references ───────┴─► crosscheck ─► crosscheck.json
```

`src/matrix/` and `src/decisions/apply.ts` stay pure; the crosscheck's
comparison logic is pure too and lives beside them. Scanning is I/O and belongs
in `src/parse/`.

## Open question deferred to apply

Where the crosscheck's pure comparison lives — `src/crosscheck/` of its own, or
inside `src/matrix/`. It is pure either way and the purity test covers both.
Apply picks and records it.

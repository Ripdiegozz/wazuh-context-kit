# Apply Progress — `close-phase-1`

> Phase: `sdd-apply` · 2026-09-15 · run inline
> Delivered as chained slices. **This records slice 1 of 3.**

## Slice 1 — template undercount and dashboard sparse widening

Phases 1 and 2 of `tasks.md`. Two defects, no new feature.

### The defect was worse than the exploration said

The exploration reported 20 of 36 templates. While implementing, four more JSON
files turned up **directly under `templates/`**, outside any subdirectory:

```
cve.json          -> wazuh-cve*
ism-config.json   -> .opendistro-ism-config
settings.json     -> .wazuh-settings*
setup-status.json -> .wazuh-setup-status*
```

So the real figure is **20 of 40 — half the declared surface**, not 44%. Two of
the four are dot-prefixed system indices, which the slice-2 scanner will have to
accept as index-shaped. Every artifact was corrected rather than left at 36.

### A pre-existing test stopped me breaking a principle

The first implementation dropped every JSON without a non-empty
`index_patterns`. That broke `parse.test.ts`'s "unparseable template yields
indexPatterns: [] and no throw", which encodes a rule worth keeping:
**robust-empty must not become invisible.**

The refined rule distinguishes two silences:

- A file that **parsed** and declares no patterns is not a template. Walking
  `templates/` instead of `templates/states/` now reaches mappings-only JSON
  that never was one, and admitting it would inflate the declared surface with
  things that declare nothing.
- A file that **failed to parse** is a template we could not read, and stays
  visible with an empty pattern list. Dropping it would hide the breakage.

I would have shipped the blunt rule. The old test caught it.

### The widening cost nothing measurable

`sparsePathsFor("dashboard")` went from `["plugins"]` to
`["plugins", "server", "public", "common"]`.

| | before | after |
|---|---|---|
| cold clone | 32 s | **31 s** |
| `.cache/` | 245 MB | **264 MB** |

19 MB, and no measurable time — the one-second difference is noise. The concern
in the proposal was largely unfounded, and it is recorded as measured rather
than argued.

Per-repo, the five single-plugin forks went from ~20 files to real source:

| repo | before | after |
|---|---|---|
| `wazuh-dashboard-alerting` | 19 | 773 |
| `wazuh-dashboard-notifications` | 16 | 216 |
| `wazuh-dashboard-reporting` | 20 | 129 |
| `wazuh-dashboard-security-analytics` | 21 | 620 |
| `wazuh-security-dashboards-plugin` | 22 | 305 |

### Observed verification

| Command | Observed |
|---|---|
| `bun test` | 144 pass · 2 skip · 0 fail · 380 assertions · 13 files |
| `bun run typecheck` | clean |
| cold regeneration | 31 s, 264 MB cache |
| `out/5.0.0` templates | **40** — 20 states, 8 streams, 8 content, 4 root |
| WCS modules | 39, unchanged |

Baseline entering slice 1 was 137 pass · 2 skip · 0 fail.

### One task moved between slices, deliberately

Task 7.2 — replacing the SPEC 1.9 criterion that names `templates/states/` — was
planned for slice 3. It is done here instead. Slice 1 is what makes the code walk
`templates/`, so leaving the criterion behind would merge a known spec-to-code
mismatch and rely on a later slice to resolve it. A criterion that cannot notice
a sibling directory is exactly the defect; it does not get to survive the fix by
three PRs.

### Not in this slice

The crosscheck itself, the catalog scanner, uncoverage detection, and the
`HANDOFF.md` correction about Phase 1 completeness. Slices 2 and 3.

`out/5.0.0` is regenerated here because the template count is part of the
dataset, and shipping code that finds 40 while the published product still says
20 would leave the defect half-fixed.

---

## Slice 2 — the catalog scanner and uncoverage detection

Phases 3 and 4 of `tasks.md`. Reads source; compares nothing yet, so the
product output is unchanged and the slice is provably additive.

### Observed against the real repository

```
distinct index names        49
references                  579
  catalog-literal            51
  import                    110
  saved-object              418
uncovered mechanisms         88
  computed-expression        80
  runtime-configuration       7
  regex-allowlist             1
```

`guardrails.ts:199` is found at exactly the line the exploration reported, and
all three known findings — `wazuh-metrics-comms-v4*`, `wazuh-agent-stats*`,
`wazuh-agent-config*` — are recovered.

### A bug my own tests could not find

The `.ndjson` pass recovered **zero** references from the real checkout while
every test passed.

Index patterns are not top-level saved objects. Every line in those files is a
`visualization` or a `dashboard` — 384 and 78 of them — and the index it reads
sits inside its `references` array:

```json
{"name": "kibanaSavedObjectMeta.searchSourceJSON.index",
 "type": "index-pattern", "id": "wazuh-findings-v5*"}
```

There are **zero** objects whose own `type` is `index-pattern`. My scanner
checked the top level, found nothing, and reported success.

The test passed because **the fixture encoded the same assumption the code
did**. A test written from an assumption validates the assumption, not reality.
What caught it was running the scanner against the real cache and noticing a
zero that should not have been a zero. Both the fixture and the implementation
now carry a comment saying what the real shape is, so the next reader does not
re-derive it.

After the fix: 418 saved-object references.

### The dual-signal filter, measured before it was written

Neither signal works alone, against the real `constants.ts`:

| filter | hits | wrong |
|---|---|---|
| value looks like an index | 52 | 5 |
| identifier ends `_PATTERN` / `_INDEX` | 48 | 1 |
| **both** | **47** | 0 |

Value-only admits `PLUGIN_PLATFORM_INSTALLATION_USER = 'wazuh-dashboard'`, an
operating-system user. Identifier-only admits
`NOT_TIME_FIELD_NAME_INDEX_PATTERN`, a field name. Two real indices —
`WAZUH_SAMPLE_INVENTORY_AGENT` and `WAZUH_SAMPLE_VULNERABILITIES` — break the
convention and are admitted by a named exceptions list rather than silently
dropped.

### One regex replaced by subtraction

Detecting "an `export const` that is not a literal" as
`=\s*(?:\n\s*)?(?!')(.+)$` matched every literal too: `\s*` backtracks to zero
and the lookahead then tests the space rather than the quote. Expressions are
now computed by subtracting the literal matches from all declarations, which has
no such failure mode.

### The drift alarm

`WAZUH_CTX_NETWORK=1` runs a real clone and asserts a **floor** of 40 distinct
names plus four specific ones, and that all three recovery routes still
contribute. A floor rather than an equality: a new upstream pattern must not
break the build, but losing the known ones must. A silent drop to zero would
otherwise make the crosscheck report all 40 declared indices as unconsumed.

### Observed verification

| Command | Observed |
|---|---|
| `bun test` | 160 pass · 2 skip · 0 fail · 410 assertions · 14 files |
| `bun run typecheck` | clean |
| `WAZUH_CTX_NETWORK=1 bun test src/parse/index-references.test.ts` | 15 pass · 0 fail · 5.3 s |

### Not in this slice

The comparison itself, `crosscheck.json`, `CROSSCHECK.md`, the CLI subcommand,
and the SPEC 1.9 walk. Slice 3.

---

## Slice 3 — comparison, output, and closing Phase 1

Phases 5–7. `wazuh-ctx crosscheck` exists; SPEC 1.8 is built.

### The running indexer changed this slice four times

The maintainer's dev stack (`os-dev-360`) has a live indexer on 9200. It was
offered mid-slice and every number below was checked against it. Without it,
what shipped would have been confidently wrong.

**1. The three headline findings were false.** Exploration reported
`wazuh-metrics-comms-v4*`, `wazuh-agent-stats*` and `wazuh-agent-config*` as
referenced-but-undeclared, claiming a grep returned zero matches. All three are
declared: the first in `templates/streams/metrics-comms.json` verbatim, the
other two in `wcs/stateful/agent-{stats,config}/fields/template-settings.json`.
They appear in seven files each. **The tool was right and the human report was
wrong** — the scan had looked at `templates/` and never at `wcs/`.

They were repeated as evidence in the proposal, in two pull requests, and in a
task that *asserted they must appear*. All corrected.

**2. Equality matching was the wrong model.** The repository declares
`wazuh-findings-v5*`; the indexer expands it into sixteen per-category
templates, each installed. So `wazuh-findings-v5-cloud-services*` is declared.
Under equality, sixteen live index families were reported undeclared. Matching
is now glob overlap, and the test that pinned the old model was replaced with
one that says why.

**3. The scanner was blind to half the code.** It recognised only
`export const X_PATTERN = '...'` — a convention that holds in exactly one file.
The threat-intel indices live in an object map keyed `decoders`/`kvdbs`, and the
single-plugin forks compare inline (`params.index === '...'`). Six live indices,
carrying data, under security analytics, were reported as having no consumer.
The maintainer found this by domain knowledge, not the tool.

**4. But the value alone discriminates nothing.** Accepting every `wazuh-`
literal produced 77 distinct names of which **zero existed in the indexer** —
package filenames (`wazuh-agent-5.0.0.aarch64.rpm`), hosts
(`wazuh-cluster-node-01`), repositories, environments, fixtures. This
organisation prefixes everything.

The second signal became **context**: an `index:` key, a comparison against
`.index`, or an enclosing declaration named `*_INDEX`/`*_PATTERN`. Plus two
narrower rules, each measured:

- an internal dot means a filename, not an index (a leading dot is a system
  index);
- test files are excluded — three of six remaining findings came only from
  fixtures, one named `wazuh-does-not-matter*`.

```
catalogs only        49 names    threat-intel invisible
+ bare literals     205 names    94 false, zero existed
+ dot rule          188 names    77 false
+ context            71 names     6 doubtful
+ no test files      61 names     3, all production
```

**5. WCS linkage was declared all along.** The first version asked whether any
index name *contained* the module name. Module names are paths
(`content/decoders`), so it matched nothing and reported 38 of 39 as
unconsumed — a 97% false-positive rate shaped like a table. Every module carries
its own `fields/template-settings.json` with `index_patterns`. Reading it drops
the finding count from 38 to 5. Inferring from the path was never viable: a
literal rule matches 2 of 39.

### What the report says now

```
declared indices       40
recovered names        61
declared unreferenced   5
referenced undeclared   3
wcs without consumer    5
competing catalogs      2
UNCOVERED mechanisms   87
```

Two are worth a person's attention. `wazuh-cve*` is declared in the repository
and **not installed** in the running indexer. `wazuh-ai-assistant-sessions`
**exists and holds data** while no dashboard code references it — written by
something else, read by nobody here. That asymmetry is what the tool is for.

The competing-catalog finding is real and not the one exploration predicted:
`plugins/main/common/constants.ts` and `plugins/wazuh-core/common/constants.ts`
both declare `.wazuh-settings` and `wazuh-events-v5*`.

### Phase 1's criteria, and one left unticked

SPEC 1.9's 25 criteria are ticked against observed commands, and a new 1.10 adds
eight for the crosscheck — section 1.8 had none, which is part of why it went a
whole phase unbuilt.

One is deliberately **not** ticked: the crosscheck compares two repositories,
not the running system. An index can be declared, hold data, and be queried, and
still be reported unconsumed if the code names it in a shape the scanner misses.
That happened, six times, in this slice. Closing it needs `--indexer <url>`, and
that is its own change.

### Observed verification

| Command | Observed |
|---|---|
| `bun test` | 193 pass · 3 skip · 0 fail · 472 assertions · 16 files |
| `bun run typecheck` | clean |
| `wazuh-ctx crosscheck --ref 5.0.0` | the table above, against real repos |
| `wazuh-ctx matrix --ref 5.0.0` | 9 plugins, 64 core, 40 templates, 0 unresolved |
| live indexer cross-check | 49 concrete indices and 53 installed templates compared by hand |

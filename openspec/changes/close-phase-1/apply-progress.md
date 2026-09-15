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

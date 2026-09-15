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

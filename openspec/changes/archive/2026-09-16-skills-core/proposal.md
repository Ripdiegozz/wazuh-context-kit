# Proposal — `skills-core`

## Why

`skills-diff` measured the terrain. This extracts it: `core/` plus
`overrides/<repo>/`, and a reconstruction that proves the split lost nothing.

The extraction is the point of Phase 2. Six skills are maintained by hand in
seven repositories; changing the shared part today means editing seven copies
and hoping. A core plus declared overrides turns that into one edit.

## What changes

`wazuh-ctx skills-diff` gains extraction: it writes `core/skills/<skill>/SKILL.md`,
`overrides/<repo>/<skill>.yml`, and a reconstruction report. Reconstructing
`core + overrides` for a repo must reproduce its original `SKILL.md` byte for
byte.

### Decided: the anchor is scoped to its heading, and this is a hard requirement

Measured over the real corpus, 409 patch blocks across 42 files:

| Anchor strategy | Files reconstructing cleanly |
| --- | --- |
| Nearest preceding common line | **21 of 42** |
| Scoped to the containing heading | **42 of 42** |

380 of 409 anchors are unique either way. The 29 that are ambiguous — in
`create-pr`, `develop-issue` and `resolve-cve` — all resolve when the anchor is
the heading that contains the block.

SPEC 2.1.1's own example already anchors to a heading (`anchor: "## Version
bases"`). The requirement exists because the naive reading of "anchor" as "a
line of text" **fails quietly**: 21 of 42 still reconstruct, so a partial
implementation looks half-working rather than wrong. That is the failure shape
this project keeps paying for.

### Decided: conflicts go to a `conflicts/` layer and `sync` refuses to ship them

50 of 70 divergences carry no marker. A conflict is by definition a divergence
nobody declared, so it belongs neither in the core (it is not shared) nor in an
override (nobody said it was deliberate).

The precedent here is not a matter of taste. **Git merge** is the
best-known handling of exactly this situation, and it does three things: it
materialises the conflict visibly, it **blocks the operation that would publish
it**, and it requires a human. It does not pick a side and it does not silently
drop. That is fail-closed, the standard posture when a tool does not know.

So: conflicts are emitted into their own layer, reconstruction reaches 42 of 42
because the patches exist, and `sync` refuses to distribute a skill while it
carries unresolved conflicts.

The rejected alternative matters enough to name. Emitting conflicts as ordinary
overrides also reconstructs 42 of 42 and lets `sync` work from day one — and it
**converts fifty undeclared accidents into policy**, which `sync` then
distributes to seven repositories as the official standard without anyone having
looked. A tool that launders accidents into decisions is worse than one that
refuses to run.

The cost is real and stated: `sync` starts blocked for five of the six skills.
That is not the tool failing. That is the tool reporting the state of the
repositories accurately, and the pressure to resolve landing on a person with
the list in front of them — which is what SPEC 2.1.1 asks for when it says
conflicts are never auto-merged.

### Decided: the reconstruction bar gains a companion, because alone it measures nothing

"≥ 35 of 42 byte-identical" is trivially satisfiable: empty core, each file
whole as its own override, 42 of 42, nothing extracted.

Reconstruction proves the patches invert the split. It says nothing about
whether the split means anything. SPEC 2.4 now pairs it with a floor: **the core
must hold ≥ 50 % of total content.** Measured before building, the real core is
60 %, ranging from 96 % in `analyze-dashboard-vuln` to 34 % in
`check-standards`.

A threshold met by relaxing its own definition is worse than no threshold,
because it looks like it measures something.

## What this does not change

- No repository under `wazuh/*` is modified. `sync` is not built here.
- No conflict is resolved automatically.
- `skills-diff`'s existing output is unchanged.

## Risks

- **`check-standards` has a 34 % core.** Forcing an extraction there may produce
  a core nobody recognises. Whether it is honest to report that skill as having
  no usable core is left to the measurement, not decided now.
- **The ambiguous-anchor test needs a constructed case.** SPEC 2.4 requires a
  test where an ambiguous anchor fails `sync`. With heading scoping the real
  corpus produces zero, so the test must be synthetic — which is fine, provided
  the report says the corpus no longer exercises it rather than implying it does.

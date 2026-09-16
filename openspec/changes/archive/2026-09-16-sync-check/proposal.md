# Proposal — `sync-check`

## Why

Phase 2's last slice. Three of the four remaining SPEC 2.4 criteria need `sync`
and `check` to exist; the fourth is the `settings.json` one held open on purpose
since `skills-diff`.

`skills-core` produced `core/`, `overrides/` and `conflicts/`. Nothing yet
distributes them, and nothing yet notices when a distributed standard is edited
locally — which is the drift that produced six hand-maintained copies in the
first place.

## What changes

`wazuh-ctx sync` materialises the extracted standards into a target repository's
`.claude/standards/`. `wazuh-ctx check` compares what is there against the
package and reports whether it drifted.

### Decided: `sync` with everything blocked exits 0, having written nothing

Every one of the six skills is undistributable today, each carrying at least one
unresolved conflict. A `sync` run against the real corpus ships **zero skills**.

That is the tool working as designed. It looked at six skills, found undeclared
divergence in all six, and refused to publish — the git-merge posture
`skills-core` adopted deliberately. Treating a correct, informative state as a
command failure would be wrong, and it has a practical edge too: a command that
is born always-failing is one somebody removes from the pipeline, after which it
gates nothing. That is the same argument that decided the core floor.

The risk is real and is mitigated rather than dismissed: exit `0` reads as
success. The output states `0 of 6 distributed` and names what blocks each one.
Silence would be the actual danger; a loud zero is not.

### Decided: distribution is per skill, not all-or-nothing

A skill blocked by its own conflicts must not block a clean one. Conflicts are
already tracked per skill, the gate is per skill, and an all-or-nothing unit
would mean one messy skill holds six hostage.

Today this distributes nothing either way, since all six are blocked. The
decision matters for the day after the team resolves the first skill's
conflicts — at which point that skill should ship without waiting for the other
five.

### Decided: drift makes `check` exit non-zero

This **contradicts** the crosscheck's decision that drift exits `0`, and the
contradiction is deliberate rather than an oversight.

The crosscheck is a diagnostic: it reports what two sources say about each other,
and a diagnostic that fails your pipeline by doing its job becomes a tool nobody
runs. `check` is a gate. SPEC 2.3 states its purpose exactly: detect that a
distributed standard was edited locally and stop. A gate that does not stop is
not a gate.

Same project, opposite exit-code decisions, because the commands do different
jobs. Copying the earlier decision here out of a wish for consistency would have
produced a command that cannot do the only thing it exists for.

### Decided: `check` reports three states, never two

SPEC 2.4's final criterion says `check` against a repository **without**
`.claude/standards/` reports "not applicable", not "all in order". An absent
target is not a success.

| State | Exit |
| --- | --- |
| not applicable — no `.claude/standards/` | `0`, and says so |
| in sync — present, hashes match | `0` |
| drifted — present, edited locally | non-zero, with the drifted files |

Conflating "nothing to check" with "everything fine" is precisely the silence
SPEC section 1 is about.

### Decided: the fixture repository lives in `fixtures/standards-target/`

Under `fixtures/`, alongside the others, so it cannot be mistaken for a real
target. SPEC 2.3 names the demonstration concretely: `sync` materialises,
`check` passes, a local edit is introduced, `check` fails. Three steps in one
test, against a repository this project controls.

## What this does not change

- **No repository under `wazuh/*` is modified.** None has `.claude/standards/`,
  and putting one there needs a PR this project does not open.
- Nothing is published to a registry.
- No conflict is resolved.
- The GitHub Actions workflow is delivered as a proposed file under `proposals/`,
  never installed. Nothing here needs organisation permissions.

## Risks

- **The mechanism has no real target, and Phase 2 delivers it inert.** That is
  SPEC 2.3's own framing and it stays true. The demonstration is what makes
  "delivered" a word with content, so the fixture is load-bearing rather than
  illustrative — and the verification must say plainly that the real repositories
  are untouched.
- **The ambiguous-anchor criterion now needs a constructed case.** After
  `skills-core` added heading scoping and ordinals, the real corpus produces zero
  ambiguous anchors. The test is synthetic, and the report must say the corpus no
  longer exercises that path rather than implying coverage.

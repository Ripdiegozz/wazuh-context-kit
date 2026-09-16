# Exploration — `sync-check`

Phase 2's last slice, and the one SPEC is most honest about. Three of the four
remaining criteria need `sync` and `check` to exist; the fourth is the
`settings.json` one held open deliberately since `skills-diff`.

## Finding 1 — the mechanism has no real target, and SPEC says so

Verified: **no repository under `wazuh/*` has `.claude/standards/`**. Checked
every cached clone's full tree, not the working directory.

SPEC 2.3 already states this without decoration: this project cannot install CI
in `wazuh/*`, no such directory exists there, and putting one in requires a PR
this project does not open. So `check` has no real target inside Phase 2's scope
— over the cache clones the directory is absent and the command can detect
nothing.

The phase therefore delivers **the mechanism and its demonstration**, not the
mechanism operating. That is not a hedge: SPEC names the demonstration
concretely — a fixture repository inside this project with `.claude/standards/`
genuinely populated, where `sync` materialises, `check` passes, a local edit is
introduced, and `check` fails. Three steps, one test.

`proposals/` does not exist yet either. The GitHub Actions workflow is delivered
as a proposed file there, never installed.

## Finding 2 — `sync` would currently distribute nothing

This is new since SPEC 2.3 was written, and it is the most interesting tension
in the change.

`skills-core` measured every one of the six skills as **undistributable**,
because each carries at least one unresolved conflict — including
`analyze-dashboard-vuln`, which carries only 2.4 % conflicts but carries some.
The gate is any-conflict, not a threshold, following the git-merge precedent:
materialise, block publication, require a person.

So a `sync` run against the real corpus today ships **zero skills**. That is the
tool working exactly as designed and reporting the repositories' real state. But
it means the demonstration cannot use the real corpus as its happy path, and the
fixture becomes load-bearing rather than illustrative.

Two things follow, and both need deciding rather than assuming:

- What does `sync` do when everything is blocked? Exit non-zero? Exit zero
  having written nothing, with the reason? The first treats a correct,
  informative state as a failure; the second risks looking like success.
- Does `sync` have a way to ship the skills that *are* clean per-skill, or is the
  unit all-or-nothing?

## Finding 3 — `check` must distinguish three states, not two

SPEC 2.4's last criterion says `check` against a repo **without**
`.claude/standards/` must report "not applicable", not "all in order". An absent
target is not a success.

So there are three outcomes, and conflating any two of them is the defect the
criterion exists to prevent:

| State | Meaning |
| --- | --- |
| not applicable | no `.claude/standards/` — nothing to compare |
| in sync | present and hashes match |
| drifted | present and edited locally |

The exit codes need deciding. `check` is the drift detector, and the crosscheck
already established a precedent in this project: drift exits `0` because a
diagnostic that fails your pipeline by doing its job becomes a tool nobody runs.
But `check`'s whole purpose is to be a gate, which pulls the other way. These are
genuinely different commands and the earlier decision does not automatically
transfer.

## Finding 4 — distribution is an npm package, and the repos use Yarn v1

Confirmed: `wazuh-dashboard` and `wazuh-dashboard-plugins` both carry
`yarn.lock`. SPEC 2.3's reasoning holds — a package adds no new tooling to those
repos.

Nothing here publishes anything. The package is built and its materialisation is
demonstrated locally; publishing is somebody's decision, not this change's.

## Finding 5 — the anchor-ambiguity criterion now needs a constructed case

SPEC 2.4 requires a test where an override anchor resolving to zero or several
positions makes `sync` fail. After `skills-core` added heading scoping and
ordinals, the real corpus produces **zero** ambiguous anchors — the invariant
asserting every op resolves to exactly one position holds across all 42 files.

So the test is synthetic. That is fine, and the report must say the corpus no
longer exercises it rather than implying coverage it does not have.

## Open questions for propose

1. **`sync` with everything blocked**: non-zero, or zero with a stated reason?
2. **Per-skill or all-or-nothing**: may `sync` ship the clean skills while others
   are blocked? Today that ships nothing either way, but the answer decides the
   shape of the command.
3. **`check` exit codes**: does drift fail the command? It is a gate, unlike the
   crosscheck, so the earlier "drift exits 0" decision does not transfer
   automatically.
4. **Where does the fixture repository live** so that it is obviously a fixture
   and cannot be mistaken for a real target?

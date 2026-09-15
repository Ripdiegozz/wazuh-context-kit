# Workflows

Two workflows, two different jobs. Neither is self-sufficient — both need
repository settings that live outside these YAML files, in the GitHub UI.

## `ci.yml`

Hermetic. Runs on every PR into `master` and every push to `master`:
`bun test`, `tsc --noEmit`, `bun build`, and a smoke check that
`node dist/cli.js --version` prints `0.1.0`. No network beyond
`bun install --frozen-lockfile`.

The job is named `CI`. That name is what a branch protection rule references
as a required status check.

## `regenerate.yml`

Implements SPEC 5.4: a daily precheck (`git ls-remote`, no clone) against
every repo in `sources.yml`. If nothing moved relative to
`out/5.0.0/matrix.json`'s `resolvedRefs`, the job stops there — no clone, no
PR. `wazuh-dashboard-ml-commons` having no `5.0.0` branch is expected and
never treated as a failure.

If something moved: regenerates, diffs `out/`, and — only if `out/` actually
changed — runs `WAZUH_CTX_NETWORK=1 bun test` (the freshness suite in
`src/dataset-freshness.integration.test.ts`) against the regenerated tree
before opening anything. If that fails, the job fails and no branch or PR is
created.

If it passes: opens a PR against `master` from an `automation/regenerate-*`
branch, committing only `out/`, with a commit message and PR body that name
which repos moved and how the plugin/core/template/WCS/unknowns counts
changed. Then it either enables auto-merge or deliberately withholds it — see
"The auto-merge gate is narrower than CI is green" below.

## Repository settings a maintainer must enable

These are **not in the YAML** — GitHub does not let a workflow set them for
itself.

1. **Settings → General → Pull Requests → "Allow auto-merge".**
   Without this, `gh pr merge --auto --squash` in `regenerate.yml` fails
   outright (the call errors, it does not silently no-op). The regeneration
   PR is opened and then just sits there unmerged forever, same as if nobody
   had automated anything.

2. **Settings → Branches → branch protection rule on `master`, "Require
   status checks to pass before merging", with the `CI` job (from `ci.yml`)
   selected as a required check.**
   This is the actual gate. Without it, `gh pr merge --auto` merges the PR
   **immediately**, before `ci.yml` even finishes running on it — auto-merge
   with no required checks is not "merge once green", it is "merge now,
   whatever green means later." That defeats the entire point of gating
   automated regeneration behind CI.

3. Branch protection must allow the `GITHUB_TOKEN`-authored PR to be merged
   by the auto-merge mechanism (e.g. no "Require approvals" rule that blocks
   a bot-authored PR with zero human reviewers, unless that rule is
   deliberately intended to force a human to look — see the honesty note
   below).

### What this setup does **not** guarantee

- The `WAZUH_CTX_NETWORK=1` freshness check that gates PR creation runs
  **once, inside `regenerate.yml`, before the PR exists**. It is not wired as
  a required status check re-evaluated on the PR itself. If a maintainer
  wants that check to run again at merge time (e.g. because master moved in
  the meantime), it has to be added as its own PR-triggered job — this
  workflow does not do that today.
- SPEC 5.4 is explicit that a human is supposed to read the diff before
  merge ("bus factor de uno"). Auto-merge, as configured here, removes that
  read if branch protection does not also require a human review. Enabling
  auto-merge and requiring a review are independent settings — pick both if
  you want the human-in-the-loop guarantee SPEC 5.4 describes; this workflow
  only guarantees CI-green, not human-reviewed.

## Running the regeneration by hand

Actions tab → "Regenerate matrix" → "Run workflow" (this is the
`workflow_dispatch` trigger). It runs the exact same precheck-then-regenerate
logic as the schedule; if nothing moved upstream it will still exit early
with no PR.

To do the equivalent locally instead:

```bash
bun install
bun run ./src/cli.ts matrix --ref 5.0.0
git status -- out/            # see if anything actually changed
WAZUH_CTX_NETWORK=1 bun test  # optional, matches the freshness gate above
```


## The auto-merge gate is narrower than "CI is green"

`regenerate.yml` does **not** auto-merge every PR it opens.

Before opening one it counts `reconciliation` entries with `conflict: true` in
the regenerated `matrix.json`. That means a field became derivable and the
derived value disagrees with a human decision in `decisions.yml` — either the
rule is wrong or the decision was.

- **Zero conflicts** → `gh pr merge --auto --squash`. The diff is generated and
  deterministic, nobody reads it line by line, and nobody should have to.
- **One or more** → auto-merge is deliberately withheld, the PR is labelled
  `needs-human-review`, and its body says why.

SPEC 5.4 calls that cross-check "probably the most valuable signal this system
emits" and requires explicit human review for it. **No test fails on a
reconciliation conflict**, so gating auto-merge on CI alone would merge the
signal into `master` unread. Closing the bus factor must not also close the eyes.

Create a `needs-human-review` label in the repository if you want the labelling
step to do anything; without it the step logs a warning and the PR is simply
left unmerged, which is still the correct outcome.

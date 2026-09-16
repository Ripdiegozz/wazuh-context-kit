# Tasks — `sync-check`

Strict TDD: the test is written first and observed failing for the right reason.

Standing rule, earned six times: **no test in the pure layer may assert against a
fixture written from the same understanding as the code.** And the one addition
this slice makes — the end-to-end fixture uses a **real directory**, not a mocked
filesystem, because a mock agrees with whatever the code does.

## 1. Planning — `src/standards/plan.ts`

- [x] 1.1 Write `plan.test.ts`: a skill with no conflicts is planned for
      distribution; one with conflicts is blocked, carrying its reasons.
- [x] 1.2 **The gate is a filter, not a guard clause**: with six blocked skills,
      all six reasons are reported, not just the first. Assert the count.
- [x] 1.3 A clean skill is planned while another is blocked — one does not hold
      the other hostage.
- [x] 1.4 Planning performs no I/O. Verify by grep.
- [x] 1.5 Implement.

## 2. Verification — `src/standards/verify.ts`

- [x] 2.1 Write `verify.test.ts` over the three states as an enum, not a boolean
      with a special case: `not-applicable`, `in-sync`, `drifted`.
- [x] 2.2 **Absent target is `not-applicable`, never `in-sync`.** This is SPEC
      2.4's criterion and the failure it names.
- [x] 2.3 A partially-synced target — some files present, some missing — is
      `drifted` with the missing files named, NOT `not-applicable`.
- [x] 2.4 Hashes compare exact bytes. A trailing-newline difference is drift, not
      a normalised match — normalising is how a real edit gets hidden.
- [x] 2.5 A manifest from a different tool version reports *that*, not a false
      "edited locally". A false accusation is the failure class this project has
      met four times.
- [x] 2.6 Implement.

## 3. Applying — `src/standards/apply.ts`

- [x] 3.1 Write `apply.test.ts` against a real temp directory: a plan is written,
      and the manifest records the hash of exactly the bytes written.
- [x] 3.2 A blocked skill leaves nothing behind — assert absence, not just that
      the clean one is present.
- [x] 3.3 `sync` fails fatally when an anchor resolves to zero positions or fewer
      than its occurrence selects. **Constructed case**: after `skills-core` the
      real corpus has zero ambiguous anchors.
- [x] 3.4 Implement.

## 4. The three-step demonstration — `fixtures/standards-target/`

- [x] 4.1 Write the end-to-end test SPEC 2.3 names, in one test: `sync`
      materialises into the fixture, `check` passes, a local edit is introduced,
      `check` fails naming that file.
- [x] 4.2 Use a real directory. Not an in-memory filesystem, not a mock — the one
      thing that has caught defects in this project is real I/O and real data.
- [x] 4.3 Assert no file under `.cache/` changed during the suite.
- [x] 4.4 Implement.

## 5. CLI — `src/cli.ts`

- [x] 5.1 Write the test: with every skill blocked, `sync` exits `0`, writes
      nothing, and the output contains `0 of`. **Assert the message**, because the
      mitigation for "exit 0 reads as success" is the message and an untested
      message rots.
- [x] 5.2 `check` exit mapping: `not-applicable` → 0, `in-sync` → 0, `drifted` →
      non-zero. Assert all three.
- [x] 5.3 Register both commands, remove their `notImplemented` stubs, extend
      `USAGE`.
- [x] 5.4 Implement.

## 6. The proposed workflow — `proposals/`

- [x] 6.1 Write the GitHub Actions workflow that would run `check`, as a file
      under `proposals/`.
- [x] 6.2 Assert it is not under any `.github/workflows/`, and that nothing in
      this change writes into a cached clone.

## 7. Against reality — this closes the change

- [ ] 7.1 Run `sync` against the real extraction. **Expect 0 of 6 distributed**,
      each with its blocking conflicts named. That is the designed behaviour, not
      a defect.
- [ ] 7.2 Run `check` against a cached clone. Expect `not applicable` — no
      `wazuh/*` repo has `.claude/standards/`.
- [ ] 7.3 Confirm `git status` shows `.cache/` and `out/` untouched.
- [ ] 7.4 Run the three-step fixture demonstration and record each step's result.
- [ ] 7.5 Record every result, marking each confirmed-against-real-repos or
      asserted-by-fixture — and state plainly that the mechanism ships **inert**,
      because no real target exists.

## 8. Documentation

- [ ] 8.1 Tick the SPEC 2.4 criteria this change closes, with an evidence header.
- [ ] 8.2 State which criterion remains and why — `settings.json`, held open
      deliberately since `skills-diff`.
- [ ] 8.3 Record that the ambiguous-anchor test is **constructed**, and that the
      real corpus no longer exercises that path. Say it rather than implying
      coverage.
- [ ] 8.4 Document the deliberate exit-code divergence: `check` fails on drift
      while the crosscheck does not, because one is a gate and the other a
      diagnostic.

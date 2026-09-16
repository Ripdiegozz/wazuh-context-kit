# Tasks — `skills-core`

Strict TDD: the test is written first and observed failing for the right reason.
A test that passes the moment it is written proved nothing.

Standing rule, earned five times: **no test in the pure layer may assert against
a fixture written from the same understanding as the code.** Extraction and
reconstruction take literals, and the strongest assertion available here is that
the two compose to the identity — a fixture cannot agree with that.

## 1. The anchor resolver — `src/skills/anchor.ts`

- [x] 1.1 Write `anchor.test.ts`: an anchor unique inside its heading resolves to
      exactly one position, even when the same line appears elsewhere in the file.
      **This is the measured case**: 29 of 409 real anchors are ambiguous
      file-wide and unique within their heading.
- [x] 1.2 An anchor occurring twice inside its own heading is a fatal error
      naming skill, repo, anchor and match count. Not a warning (SPEC 2.1.1).
- [x] 1.3 An anchor matching nothing is fatal, not a silently skipped op.
- [x] 1.4 The resolver counts matches rather than short-circuiting on the first.
      A resolver that does not count cannot enforce 1.2.
- [x] 1.5 Implement until 1.1–1.4 pass.

## 2. Extraction — `src/skills/extract.ts`

- [x] 2.1 Write `extract.test.ts`: a section with no divergent blocks goes to
      the core whole.
- [x] 2.2 A section with divergent blocks contributes its common lines to the
      core, with each divergent position replaced by an op.
- [x] 2.3 A marked divergence becomes an op in `overrides/<repo>/`, attributed to
      the repos in its group.
- [x] 2.4 An unmarked divergence goes to the conflicts layer and appears in **no**
      `overrides/<repo>/`. Assert its absence, not just its presence elsewhere.
- [x] 2.5 An unnamed-marker divergence (`sharedOverride`) is attributed to no
      single repo.
- [x] 2.6 The core share is computed and reported per skill and overall.
- [x] 2.7 Implement until 2.1–2.6 pass.
- [x] 2.8 Verify the purity seam: grep `src/skills/{anchor,extract,reconstruct}.ts`
      and their tests for fs, network and clock.

## 3. Reconstruction — `src/skills/reconstruct.ts`

- [x] 3.1 Write `reconstruct.test.ts` asserting the round trip: for literal
      inputs, `reconstruct(extract(x)) == x`, byte for byte. This is the
      load-bearing test of the change — two independent transformations
      composing to the identity is an assertion no fixture can agree with.
- [x] 3.2 Ops applied in a **shuffled** order produce the same result, or the
      determinism guarantee is accidental rather than designed.
- [x] 3.3 A file that cannot be reconstructed lands in `lossy[]` with the exact
      diff.
- [x] 3.4 `reconstructed + lossy == input count` is asserted as arithmetic over
      the whole corpus, not sampled.
- [x] 3.5 Implement until 3.1–3.4 pass.

## 4. The core floor

- [x] 4.1 Write the test: an extraction placing every file whole into its own
      override reconstructs everything **and still fails**, because the core
      carries no content. Without this the reconstruction bar is trivially
      satisfiable.
- [x] 4.2 Implement the ≥ 50 % floor as a hard check.

## 5. Conflicts gate distribution

- [x] 5.1 Write the test: a skill carrying at least one unresolved conflict is
      reported undistributable, with the blocking conflicts named.
- [x] 5.2 A skill whose every divergence carries a marker is distributable.
- [x] 5.3 Implement.

## 6. Emission and CLI — `src/skills/emit.ts`, `src/cli.ts`

- [x] 6.1 Write the determinism test: two frozen-clock runs produce
      byte-identical `core/`, `overrides/`, conflicts layer and report.
- [x] 6.2 No timestamp is written into any emitted tree.
- [x] 6.3 Wire extraction into the CLI and extend `USAGE`.
- [x] 6.4 Implement.

## 7. Against the 42 real files — this closes the change

A green suite does not close this. Five previous cycles had one and shipped
defects only real data found.

- [x] 7.1 Run extraction over the seven real repositories. Record the counts.
- [x] 7.2 **Confirm 42 of 42 reconstruct byte-identically.** Measured
      prediction before building: 42 of 42 with heading-scoped anchors, 21 of 42
      with file-wide ones. A result of 21 means anchors are not scoped.
- [x] 7.3 Confirm the core share is ≥ 50 %. Measured prediction: 60 %.
- [x] 7.4 Confirm the per-skill spread matches the measurement:
      `analyze-dashboard-vuln` ≈ 96 %, `check-standards` ≈ 34 %. A large
      divergence from these means extraction is not splitting where the diff says.
- [~] 7.5 CORRECTED. **All six** are undistributable, not five.
      `analyze-dashboard-vuln` carries only 2.4 % conflicts but carries some, and
      the gate is any-conflict, not a threshold. The prediction was wrong; the
      behaviour is right.
- [x] 7.6 Confirm no conflict appears in any `overrides/<repo>/`.
- [x] 7.7 Confirm `git status` shows `out/` unchanged — extraction writes its own
      trees and must not touch the committed dataset.
- [x] 7.8 Record every result, marking each confirmed-against-real-repos or
      asserted-by-fixture.

## 8. Documentation

- [x] 8.1 Tick the SPEC 2.4 criteria this change closes, with an evidence header.
- [x] 8.2 State which criteria remain and why — `sync` and `check` are not built
      here.
- [x] 8.3 Record that the ambiguous-anchor test is **constructed**: after heading
      scoping the real corpus produces zero ambiguous anchors, so the corpus no
      longer exercises that path. Say so rather than implying coverage.

# Tasks — `settings-merge`

Strict TDD. Standing rule, earned six times: **no test in the pure layer may
assert against a fixture written from the same understanding as the code.**

This slice carries an extra caution worth stating up front: **the real corpus is
clean.** Zero removals, zero scalar disagreements, zero conflicts. So the
conflict machinery is exercised only by literals, and literals are exactly what
has failed this project six times. Keep the merge small enough that a reader can
check it by eye, and reach for randomised trials rather than inventing more
cases by hand — that is what found the last two defects.

## 1. The merge — `src/settings/merge.ts`

- [x] 1.1 Write `merge.test.ts`: a leaf value present in every variant lands in
      the core and in no override.
- [x] 1.2 A list entry present in some variants is an override for those, absent
      from the core.
- [x] 1.3 **A list entry present in all but one is a conflict**, naming the value
      and the repository lacking it — the removal case. It must NOT be emitted as
      an override for anybody.
- [x] 1.4 A scalar differing between variants is a conflict carrying every
      variant and its repos, with none selected.
- [x] 1.5 Two repos adding different entries to the same list both produce
      overrides and no conflict.
- [x] 1.6 **The `n - 1` threshold has a floor**: with two variants, asymmetry is
      an addition, not a removal. Without this every two-repo difference becomes
      a conflict.
- [x] 1.7 Leaf paths are walked, not objects — a difference nested inside an
      object is reported at its leaf, not at the top.
- [x] 1.8 Duplicate entries within one variant are reported, not silently
      deduplicated. A duplicate is a finding about that file.
- [x] 1.9 Entries differing only by whitespace are different. No normalisation —
      this file grants permissions and normalising hides real differences.
- [x] 1.10 Implement until 1.1–1.9 pass.

## 2. Reconstruction — `src/settings/apply.ts`

- [x] 2.1 Write the round trip: `apply(merge(x)) == x` value-for-value, for
      literal inputs. This is the load-bearing test; a fixture cannot agree with
      two transformations composing to the identity.
- [x] 2.2 Repository processing order does not change the core or any override.
      Assert by running the same input in two orders.
- [x] 2.3 List entries are emitted sorted, so output never depends on which repo
      contributed an entry.
- [x] 2.4 Implement.
- [x] 2.5 Verify the purity seam over `src/settings/`.

## 3. Typed conflicts in the existing layer

- [x] 3.1 Write the test: a settings conflict enters the same `conflicts/` layer
      as skill conflicts and carries its kind.
- [x] 3.2 The report groups by kind, so a reader sees one place to look and still
      sees that the causes differ.
- [x] 3.3 A settings conflict alone blocks distribution for that repository, with
      the reason naming it.
- [x] 3.4 Implement.

## 4. Wiring

- [x] 4.1 Extraction emits `core/.claude/settings.json` and per-repo overrides.
- [x] 4.2 `sync` materialises them alongside the skills.
- [x] 4.3 Determinism: two frozen-clock runs produce byte-identical output.

## 5. Against the seven real files — this closes the change

- [x] 5.1 Run extraction. **Expect: 22 core entries, 3–6 additions per repo,
      0 conflicts.** Record the observed numbers.
- [x] 5.2 Confirm every repository's `settings.json` reconstructs exactly from
      core plus its override — 7 of 7.
- [x] 5.3 Confirm the three byte-identical repos (`alerting`, `notifications`,
      `security-analytics`) produce identical overrides, since they add the same
      three entries.
- [x] 5.4 Confirm no conflict is reported, and **state in the report that the
      conflict paths are therefore untested by real data** rather than implying
      coverage.
- [x] 5.5 Confirm `.cache/` and `out/` untouched.
- [x] 5.6 Record every result, marking each confirmed-against-real-repos or
      asserted-by-fixture.

## 6. Documentation

- [x] 6.1 Tick SPEC 2.4's last criterion with an evidence header. **Phase 2 closes.**
- [x] 6.2 State that the removal and scalar-disagreement paths are exercised by
      constructed cases only, and why that is acceptable here.
- [x] 6.3 Record the product finding for the dashboard team: `reporting` uses
      bare `yarn test` where the other six use `yarn test:jest`. Under this model
      it is an addition and distributes cleanly; whether it should be uniform is
      their call, not the tool's.

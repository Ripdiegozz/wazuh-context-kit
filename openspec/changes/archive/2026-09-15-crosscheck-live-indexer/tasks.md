# Tasks — `crosscheck-live-indexer`

Strict TDD: in every slice the test is written first and observed failing for
the right reason before the implementation exists. A test that passes the moment
it is written proved nothing.

One rule carried over from the previous cycle: **no test in this change may
assert against a fixture file that was written from the same understanding as
the code it tests.** The pure layer takes literals. That is why it is pure.

## 1. The pure comparison — `src/crosscheck/live.ts`

- [x] 1.1 Write `src/crosscheck/live.test.ts` with the installed-set cases,
      stated as literal `RawClusterState` values: a data stream with one backing
      index resolves to the stream name; the backing index does not appear as a
      standalone installed index; a plain index appears as itself.
- [x] 1.2 Add the ownership case that a `.ds-` prefix check would get wrong: a
      backing index whose name does not follow the convention still resolves via
      the cluster's `backingIndices` report, and a plain index literally named
      with a `.ds-` prefix that no stream claims is NOT swallowed.
- [x] 1.3 Add the three-population cases: declared-not-installed,
      installed-not-declared, template-only-in-cluster.
- [x] 1.4 Add the alias-generation case: `wazuh-threatintel-decoders-a` is
      covered by declared `wazuh-threatintel-decoders*` with no special-casing.
- [x] 1.5 Implement `buildLiveComparison` until 1.1–1.4 pass. Import `covers()`
      from `build.ts`; do not write a second matcher.
- [x] 1.6 Confirm the purity seam still holds: grep `src/crosscheck/` for fs,
      network and clock, test files included.
- [x] 1.7 Add the partition case: `installedNotDeclared` splits into a
      `wazuh` group (`wazuh-*` / `.wazuh-*`) reported in full, and a
      `platformManaged` group reported with its count, with nothing dropped
      from either.
- [x] 1.8 Add the same-subject join case: a declared exact pattern
      (`wazuh-threatintel-filters`) and an installed name that extends it
      (`wazuh-threatintel-filters-a`) are reported as one
      `sameSubjectMismatches` finding, removed from both
      `declaredNotInstalled` and `installedNotDeclared`, with `covers()`
      itself still returning `false` for the pair.
- [x] 1.9 Implement the partition and the same-subject join in
      `buildLiveComparison` until 1.7–1.8 pass.
- [x] 1.10 Defect fix (real-cluster run): add the test that a declared
      pattern existing ONLY in a WCS module's `template-settings.json`
      (`.wazuh-internal-state*`, `.iocs_development_*iocs`) participates in
      the live comparison on both sides — installed and not flagged, or
      genuinely missing and reported in `declaredNotInstalled` naming the WCS
      path.
- [x] 1.11 Implement `declaredFromWcsModules` until 1.10 passes. Never a
      placeholder path: each entry names its own module's
      `wcs/<module>/fields/template-settings.json`.

## 2. The renderer — `src/crosscheck/render-live.ts`

- [x] 2.1 Write the renderer test: a comparison with all three populations
      non-empty renders each with a heading and a count; an empty population
      renders as explicitly empty rather than being omitted.
- [x] 2.2 Add the case that the JSON form is the `LiveComparison` alone, with no
      wrapper and no timestamp — a timestamp would make piped output differ
      between runs for no reason.
- [x] 2.3 Implement until 2.1–2.2 pass.
- [x] 2.4 Render the partitioned `installedNotDeclared` (Wazuh namespace in
      full, platform-managed under its own heading with its count) and the
      `sameSubjectMismatches` section; implement until it passes.
- [x] 2.5 Defect fix (real-cluster run): strengthen the renderer test so
      every non-empty population is asserted to render its actual rows, not
      merely a heading and a count — the real run showed
      `templatesOnlyInCluster` announcing a finding in the JSON form while
      the text form printed the heading and nothing else.

## 3. The client — `src/indexer/client.ts`

- [x] 3.1 Write `src/indexer/client.test.ts` against an injected transport: the
      three endpoints are requested, all with GET, and the returned
      `RawClusterState` carries the raw shapes unchanged.
- [x] 3.2 Add the assertion that no request uses a state-changing method — the
      spec promises read-only and this is the only place that can prove it.
- [x] 3.3 Add the failure cases: `401` surfaces as an auth error carrying no
      credential value; a TLS `code` surfaces as a certificate error; a refused
      connection and a timeout each surface distinguishably.
- [x] 3.4 Implement `fetchClusterState` until 3.1–3.3 pass, with the TLS
      override applied per request and a request timeout always set.
- [x] 3.5 Assert, in a test, that the client never sets
      `NODE_TLS_REJECT_UNAUTHORIZED`.
- [x] 3.6 Add the pinning test: the recorded request to `_cat/indices` carries
      `expand_wildcards=all`, and the recorded request to `_data_stream` does
      not carry it at all.
- [x] 3.7 Implement the parameter on the `_cat/indices` request only, until
      3.6 passes.
- [x] 3.8 Defect fix (real-cluster run): add the test that no `IndexerError`
      message starts with `wazuh-ctx:` — `src/cli.ts` already prefixes every
      printed error with `wazuh-ctx crosscheck: `, and the real run showed
      the doubled `wazuh-ctx crosscheck: wazuh-ctx: certificate verification
      failed ...`.
- [x] 3.9 Remove the client's own `wazuh-ctx:` prefix (auth, certificate,
      unreachable messages) until 3.8 passes. Wording otherwise unchanged.

## 4. CLI wiring — `src/cli.ts`

- [x] 4.1 Write the byte-identical test in `src/cli.test.ts`: two runs at the
      same ref and frozen time, one with `--indexer` pointed at an unreachable
      URL and one without, produce identical files under `out/<ref>/`. Use a
      closed port so the case needs no cluster and still exercises the ordering.
- [x] 4.2 Write the exit-code tests: unreachable indexer exits non-zero with a
      message naming the URL; `--indexer` absent leaves behaviour unchanged.
- [x] 4.3 Register `--indexer`, `--indexer-skip-tls-verify` and `--format` in
      `parseArgs`, and extend `USAGE`.
- [x] 4.4 Read `WAZUH_CTX_INDEXER_USERNAME` / `WAZUH_CTX_INDEXER_PASSWORD` in
      `runCrosscheck`; never log either value.
- [x] 4.5 Place the live path strictly after both `writeFile` calls, so the
      determinism guarantee holds by construction and not by care.
- [x] 4.6 Implement the error taxonomy from design decision 6.
- [x] 4.7 Defect fix (real-cluster run): feed `buildLiveComparison` the union
      of `declared` (indexer templates) and `declaredFromWcsModules(parsed.wcsModules)`
      — not `declared` alone. The offline `buildCrosscheck` call is
      unaffected; only the live comparison's declared set changes.

## 5. Configuration boundary

- [x] 5.1 Write the test that a `sources.yml` carrying a username or password
      field is rejected by the schema rather than honoured.
- [x] 5.2 Implement the rejection.

## 6. Verification against the real cluster — this closes the change

A green suite does not close this. The previous cycle had one and shipped six
defects.

- [x] 6.1 Run `crosscheck --indexer https://localhost:9200
      --indexer-skip-tls-verify` against the live stack with credentials in the
      environment. Record the observed counts as real numbers.
- [x] 6.2 Confirm `wazuh-cve*` appears in `declaredNotInstalled`. It is declared
      in the repository and absent from the cluster; a run that misses it is
      wrong no matter what the tests say.
- [~] 6.3 STRUCK. This expectation was wrong: `wazuh-ai-assistant-sessions` IS
      covered by a declared pattern. It is unreferenced only in the offline
      dashboard-reference sense, a different question. See `verify-report.md`.
- [x] 6.4 Confirm no `.ds-*` backing index appears anywhere in the output.
- [x] 6.5 Confirm `git status` reports `out/` unchanged after the live run.
- [x] 6.6 Run once WITHOUT `--indexer-skip-tls-verify` and confirm it fails with
      a message naming the flag, rather than proceeding or hanging.
- [x] 6.7 Run once with a wrong password and confirm the message names both env
      vars, asserts nothing about which one was wrong, and leaks no value.
- [x] 6.8 Record every result above in the verification report, marking each
      finding as confirmed-against-cluster rather than asserted-by-fixture.

## 7. Documentation

- [x] 7.1 Tick the last criterion in SPEC 1.10, with the evidence header the
      other closed sections use.
- [x] 7.2 Document the env vars, the TLS flag and the exit-code contract,
      including why drift exits `0`.
- [x] 7.3 Record that `--indexer` is never used in CI, and why.

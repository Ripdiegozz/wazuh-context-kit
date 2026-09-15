```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:5d873f82fca40034502e336b50ba48699a30e5bcc0cede2be94c3006ca568392
verdict: pass
blockers: 0
critical_findings: 0
requirements: 10/10
scenarios: 18/18
test_command: bun test
test_exit_code: 0
test_output_hash: sha256:15353eb46236afac004707de95db2d3a303d1daa303611ed58ccdaed3e165500
build_command: bun run build
build_exit_code: 0
build_output_hash: sha256:508daa6df099ef630a2fc50ce37b4cfe080c4abd6473d885b37bfbb7283e3d21
```

# Verification — `crosscheck-live-indexer`

Run 2026-09-15 against the `os-dev-360` stack: OpenSearch `3.6.0`,
`cluster_name: wazuh-cluster`, `https://localhost:9200`, self-signed
certificate.

Every finding below is marked **confirmed-against-cluster** or
**asserted-by-fixture**. That distinction is the point of this report. The
previous cycle produced a green suite and six defects; a green suite is
evidence about the tests, not about the behaviour.

## Automated checks

| Command | Observed |
| --- | --- |
| `bun test` | 236 pass, 3 skip, 0 fail — 239 tests, 19 files, 596 assertions |
| `bunx tsc --noEmit` | clean, exit 0 |
| `rg 'node:fs\|node:net\|fetch(\|Date.now\|new Date' src/crosscheck/` | 0 matches — purity seam holds, test files included |

The 3 skips are the pre-existing network-gated integration tests, unchanged by
this change.

## The independent oracle

Before any implementation existed, the expected answer was computed separately
in Python, reading the declared patterns straight from the cached checkout and
querying the cluster directly. The implementation was then checked against that
oracle rather than against itself.

This mattered. It found two defects with no code written:

- `_cat/indices` excludes hidden indices by default — 52 of 103. Six declared
  patterns were installed, running, and invisible. Design decision 8.
- `wazuh-threatintel-filters` is declared without a trailing `*` unlike every
  sibling. Design decision 10.

## Slice 6 results — confirmed against the cluster

| # | Check | Observed |
| --- | --- | --- |
| 6.1 | Live run completes | exit `0`, 42 declared patterns vs 103 resolved installed names |
| 6.2 | `wazuh-cve*` in `declaredNotInstalled` | **yes**, from both `templates/cve.json` and `wcs/cve/` |
| 6.3 | *(superseded — see below)* | — |
| 6.4 | No `.ds-*` backing index anywhere in output | **none**, 0 matches |
| 6.5 | `out/<ref>/` unchanged by `--indexer` | **byte-identical**, `diff -r` clean at frozen time |
| 6.6 | Without `--indexer-skip-tls-verify` | exits `2`: `certificate verification failed for https://localhost:9200. Pass --indexer-skip-tls-verify to accept it for this run.` |
| 6.7 | Wrong password | exits `2`, names both env vars, states that `401` does not distinguish missing from wrong, leaks no value |

Populations reported, matching the independent oracle exactly:

| Population | Count |
| --- | --- |
| declared, not installed | 3 (`.iocs_development_*iocs`, `wazuh-cve*` ×2 sources) |
| installed, not declared — Wazuh namespace | 3 |
| installed, not declared — platform-managed | 46 |
| template-only in cluster | 1 |
| same subject, declaration does not match | 2 |

### Task 6.3 was wrong and is superseded

It required `wazuh-ai-assistant-sessions` to appear in `installedNotDeclared`.
That expectation came from a stale observation. The index **is** covered by a
declared pattern; it is unreferenced only in the offline dashboard-reference
sense, which is a different question answered by a different report. The task
is struck rather than ticked. Recording the correction is worth more than
quietly deleting it.

## Defects the live run found that the test suite did not

**The declared set excluded WCS module patterns.** `src/cli.ts` built the live
comparison's declared set from `parsed.templates` alone, while
`wcs/<module>/fields/template-settings.json` carries real `index_patterns` that
`buildCrosscheck` already consumes. Consequences in both directions:
`.wazuh-internal-state` was falsely reported as installed-but-undeclared when it
is declared as `.wazuh-internal-state*`; and `.iocs_development_*iocs`, declared
only in WCS and genuinely absent, never surfaced at all.

That is the same false-accusation class as decision 8, arriving through a
different door, and it passed a 231-test suite. Fixed by feeding the union of
template and WCS patterns, with each WCS-sourced entry naming its own
`template-settings.json` path.

**A doubled error prefix.** `wazuh-ctx crosscheck: wazuh-ctx: ...` — the client
added a prefix the CLI already supplies. Cosmetic, fixed.

**One reported defect was not real.** A "template-only in cluster" section
appearing with a count and no rows was an artifact of the verifier's own `rg -v`
filter, which removed the single `.opensearch-sap-*` row. The renderer was
correct. Recorded because a verification report that only lists confirmed hits
is not reporting how the verification actually went.

## Product findings for the indexer team

1. **`wazuh-threatintel-filters` is declared without a trailing `*`** in both
   `plugins/setup/src/main/resources/templates/content/filters.json` and
   `wcs/content/filters/fields/template-settings.json`. Every sibling — decoders,
   enrichments, integrations, kvdbs, policies, rules — declares a glob. The
   installed index is `wazuh-threatintel-filters-a`, so the declaration matches
   nothing and the same subject appears on both sides of the comparison at once.
   **Confirmed against cluster.**
2. **`wazuh-cve*` is declared and not installed**, from two separate
   declarations. **Confirmed against cluster.**
3. **`.iocs_development_*iocs` is declared and not installed.** The pattern
   shape also looks unintentional. **Confirmed against cluster.**
4. Three `.wazuh-*` indices exist that no template or WCS module declares:
   `.wazuh-content-manager-jobs`, `.wazuh-content-manager-resource-locks`,
   `.wazuh-cti-consumers`. **Confirmed against cluster.** Whether these are
   meant to be declared is a question for the team, not for this tool.

## Limits of this verification

- One cluster, one moment. `.opendistro-ism-managed-index-history-2026.09.15-1`
  carries today's date and will not exist tomorrow; the platform-managed count
  of 46 is not a stable number and nothing asserts on it.
- The comparison is only as complete as the declared-pattern discovery. If a
  third declaration site exists that neither templates nor WCS modules cover,
  this run would not reveal it.
- CI never runs this path. It has no stack.

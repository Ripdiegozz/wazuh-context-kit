# Crosscheck Specification — delta

## ADDED Requirements

### Requirement: An optional live-indexer comparison

The system MUST accept an optional `--indexer <url>` argument on `crosscheck`.
When given, it MUST additionally compare the patterns the repositories declare
against what a running indexer actually has, and report the disagreement
(SPEC 1.10).

When the argument is absent, behaviour MUST be unchanged: offline,
deterministic, and reaching no network beyond the existing repository fetch.

The comparison MUST use only read endpoints — `_cat/indices`, `_data_stream`,
`_index_template` — and MUST NOT issue any request that creates, modifies or
deletes cluster state.

#### Scenario: Absent flag changes nothing

- GIVEN a `crosscheck` invocation without `--indexer`
- WHEN it completes
- THEN no request is made to any indexer
- AND the output is identical to the behaviour before this change

#### Scenario: The comparison reaches the cluster read-only

- GIVEN `--indexer <url>` against a reachable cluster, and a recording transport
- WHEN the comparison runs
- THEN every recorded request is a GET against one of the three declared endpoints
- AND no request uses a state-changing method

### Requirement: Runtime data never enters the committed artifact

The system MUST produce `out/<ref>/` byte-identical whether or not `--indexer`
was given.

The committed artifacts claim determinism. Machine-specific, non-reproducible
cluster state written into them would make that claim false, and CI — which has
no stack — would fail its own freshness guard. This is the one point on which
every external precedent surveyed agrees.

The live comparison MUST be written to stdout instead, with a `--format json`
variant for machine consumption. The system MUST NOT create a new file for it.

#### Scenario: Byte-identical output

- GIVEN two `crosscheck` runs at the same ref and frozen time, one with
  `--indexer` and one without
- WHEN both complete
- THEN every file under `out/<ref>/` is byte-identical between the two runs

#### Scenario: The comparison is a stream, not a file

- GIVEN a `--indexer` run
- WHEN it completes
- THEN the comparison appears on stdout
- AND no file exists that did not exist after an equivalent offline run

### Requirement: Credentials come from the environment, never from committed configuration

The system MUST read indexer credentials from `WAZUH_CTX_INDEXER_USERNAME` and
`WAZUH_CTX_INDEXER_PASSWORD`.

The system MUST NOT read credentials from `sources.yml`, and MUST NOT write a
credential to any file or to its own output.

`sources.yml` is committed. A credential field in it is a credential in git.

#### Scenario: Credentials are not a config field

- GIVEN a `sources.yml` carrying a username or password field
- WHEN the schema is validated
- THEN the field is rejected rather than honoured

#### Scenario: A rejected credential is reported without guessing

- GIVEN an indexer that answers `401`
- WHEN the comparison runs
- THEN the run fails with a message naming the two environment variables
- AND the message does not assert whether the credentials were missing or wrong,
  because `401` does not distinguish them
- AND no credential value appears in the message

### Requirement: TLS verification is on by default and disabling it is explicit

The system MUST verify the indexer's certificate by default, and MUST fail
loudly when verification fails rather than proceeding.

`--indexer-skip-tls-verify` MUST disable verification for that invocation only.
The override MUST be scoped to the request; the system MUST NOT set
`NODE_TLS_REJECT_UNAUTHORIZED`, which is process-global and would weaken every
other TLS call in the process.

#### Scenario: A self-signed certificate fails without the flag

- GIVEN an indexer presenting a certificate that does not validate
- AND no `--indexer-skip-tls-verify`
- WHEN the comparison runs
- THEN the run fails
- AND the message identifies the failure as certificate verification
- AND the message names the flag that would accept it

#### Scenario: The flag accepts it, and nothing else

- GIVEN the same indexer and `--indexer-skip-tls-verify`
- WHEN the comparison runs
- THEN it succeeds
- AND `NODE_TLS_REJECT_UNAUTHORIZED` is unset in the process environment

### Requirement: Data-stream backing indices resolve to their stream

The system MUST resolve each `.ds-<stream>-NNNNNN` backing index to the data
stream that owns it, using the mapping reported by `_data_stream`, and MUST
compare the stream name rather than the backing index name.

Measured on the reference stack: 22 of 52 concrete indices are backing indices.
Comparing `_cat/indices` output directly would invent 22 names no repository
declares and lose the 22 stream names the repositories do declare — a result
that is wrong in both directions at once.

The mapping MUST come from the cluster's own report, not from a pattern match
over the `.ds-` prefix.

#### Scenario: A backing index is reported under its stream

- GIVEN a data stream with a backing index named `.ds-<stream>-000001`
- WHEN the comparison runs
- THEN the stream name participates in the comparison
- AND the backing index name is not reported as an index nobody declares

#### Scenario: Resolution is declared, not inferred

- GIVEN a backing index whose name does not follow the conventional shape
- WHEN `_data_stream` reports its owning stream
- THEN the reported ownership is used

### Requirement: Disagreement is information, not failure

The system MUST exit `0` when the repositories and the cluster disagree.

A non-zero exit MUST mean the tool failed: the indexer was unreachable,
authentication was rejected, or certificate verification failed.

`terraform plan -detailed-exitcode` is real precedent for encoding drift in the
exit code, and it carries documented operational scars — teams have wired its
exit `2` into gates and been burned. Drift here is the expected output of a
diagnostic, not an error condition, and must not become a tripwire nobody asked
for.

#### Scenario: Drift exits zero

- GIVEN a cluster whose installed set differs from the declared set
- WHEN the comparison completes
- THEN the differences are reported
- AND the exit code is `0`

#### Scenario: A failure exits non-zero

- GIVEN an indexer URL that cannot be reached
- WHEN the comparison runs
- THEN the exit code is non-zero
- AND the message distinguishes this from a disagreement

### Requirement: The live comparison is verified against a real cluster

The change MUST record, as observed numbers, the result of running the
comparison against a real indexer — not against fixtures alone.

The previous cycle shipped six defects through a fully green suite. Four were
caught by consulting a real indexer and two by human review; none by tests. A
fixture that encodes the same assumption as the code proves the assumption, not
the behaviour. This requirement exists so that the verification of this change
cannot be satisfied the way the last one was.

#### Scenario: Recorded real-cluster run

- GIVEN a reachable indexer
- WHEN the change is verified
- THEN the verification records the observed counts and disagreements as real
  numbers
- AND the record distinguishes findings confirmed against the cluster from those
  asserted only by fixtures

### Requirement: Hidden indices are included in the installed set

The system MUST request `expand_wildcards=all` when listing concrete indices,
and MUST NOT send that parameter to `_data_stream`, which rejects it.

Measured: the default `_cat/indices` listing reports 52 of 103 indices. Six
patterns the repositories declare are hidden, installed, and running — among
them `.wazuh-settings`, `.wazuh-setup-status` and `.wazuh-internal-state`.
Comparing against the default listing accuses all six of being absent.

A tool whose purpose is to be trusted about production state must not produce a
false accusation about production state through a defaulted query parameter.

#### Scenario: The concrete-index query asks for hidden indices

- GIVEN a `--indexer` run and a recording transport
- WHEN the client queries concrete indices
- THEN the request carries `expand_wildcards=all`

#### Scenario: The data-stream query does not

- GIVEN the same run
- WHEN the client queries data streams
- THEN the request does not carry `expand_wildcards`

#### Scenario: A declared hidden index is not reported as missing

- GIVEN a declared pattern matching an index that exists and is hidden
- WHEN the comparison runs
- THEN that pattern does not appear in `declaredNotInstalled`

### Requirement: Undeclared installed names are partitioned, never silently dropped

The system MUST report every installed name that no declared pattern covers,
split into two groups: names in the Wazuh namespace (`wazuh-*` or `.wazuh-*`),
and everything else, reported as platform-managed with its count.

The system MUST NOT omit the second group. Once hidden indices are included, 46
of 50 undeclared names are plugin runtime state — security-analytics detector
and alert indices, the OpenSearch Dashboards index, OpenDistro configuration.
Reporting them as findings buries the four that matter; discarding them makes
the tool the arbiter of which surprises deserve mention, and a tool that filters
on your behalf will eventually hide the one you needed.

#### Scenario: Both groups reach the reader

- GIVEN an installed set containing both Wazuh-namespace and platform names that
  no pattern declares
- WHEN the comparison renders
- THEN the Wazuh-namespace names are listed individually
- AND the platform-managed group appears with its count
- AND no undeclared name is absent from both groups

### Requirement: A pattern and an index that are the same subject are reported as one

The system MUST identify the case where a declared pattern and an installed name
refer to the same subject but fail to match, and MUST report it as a single
finding rather than as two unrelated entries in two lists.

`wazuh-threatintel-filters` is declared without a trailing `*`, unlike every one
of its siblings. The installed index is `wazuh-threatintel-filters-a`. The
mismatch places the same subject on both sides at once. A reader scanning two
long lists will not notice that the two entries are one problem.

The system MUST NOT resolve this by loosening the match. The mismatch is the
finding.

#### Scenario: The two sides are joined

- GIVEN a declared exact pattern and an installed name that extends it
- AND no other declared pattern covers that name
- WHEN the comparison renders
- THEN the report states that the two are the same subject and that the
  declaration does not match it
- AND the matcher still treats them as not matching

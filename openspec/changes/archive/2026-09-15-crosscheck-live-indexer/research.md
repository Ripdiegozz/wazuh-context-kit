# Research — `crosscheck-live-indexer`

> This document was produced by a generic-purpose agent under an explicit research
> task, not by the `sdd-research` phase agent. This runtime refuses `sdd-*` child
> dispatch, so this is not a blind independent research phase in the SDD sense —
> treat it as auditable external evidence gathered against the same two lanes
> `sdd-research` would have covered, not as a procedurally independent check.

## Lane 1 — CLI conventions for talking to an OpenSearch/Elasticsearch cluster

### Claim 1.1 — `opensearch-cli` uses a profile file, not bare flags, and has no documented insecure-TLS flag

The official `opensearch-cli` stores cluster credentials in `~/.opensearch-cli/config.yaml`,
keyed by named profiles with `endpoint`, `user`, and `password` fields (or an `aws_iam`
block for AWS auth), selected at invocation with `-p`/`--profile` or overridden with
`-c`/`--config`. The user guide does not document a TLS-verification-bypass flag.

Source: https://github.com/opensearch-project/opensearch-cli/blob/main/USER_GUIDE.md

### Claim 1.2 — the OpenSearch Go client (and its config helper) reads `OPENSEARCH_URL`, `OPENSEARCH_USERNAME`, `OPENSEARCH_PASSWORD`, `OPENSEARCH_AUTH`, `OPENSEARCH_SKIP_SSL`

`opensearchconfig-go`, a helper built on `opensearch-project/opensearch-go`, documents:
`OPENSEARCH_URL` (falls back to `http://localhost:9200`), `OPENSEARCH_USERNAME` and
`OPENSEARCH_PASSWORD` ("only if auth is set to basic"), `OPENSEARCH_AUTH` (`none` |
`basic` | `iam`), and `OPENSEARCH_SKIP_SSL` to skip the SSL check.

Source: https://github.com/shopsmart/opensearchconfig-go

Note: this is a community config helper around the official Go client, not the
official client's own env-var contract — I could not find an authoritative
OpenSearch document that defines `OPENSEARCH_URL`/`OPENSEARCH_SKIP_SSL` as a
cross-client standard. Treat this as one documented instance of the pattern, not
a spec.

### Claim 1.3 — the Elastic Python client documents `ELASTIC_PASSWORD`, `ELASTIC_API_KEY`, `ELASTIC_TOKEN`, plus `ca_certs`/`ssl_assert_fingerprint`, and explicitly recommends against disabling verification

Elastic's official Python client docs use `ELASTIC_PASSWORD` for the generated
`elastic` user's password, and document `ELASTIC_API_KEY` / `ELASTIC_TOKEN` for the
other two supported auth modes. For self-signed certificates, the documented path
is pointing the client at the actual CA (`ca_certs=$ES_CONF_PATH/certs/http_ca.crt`)
or pinning a certificate fingerprint (`ssl_assert_fingerprint`, Python 3.10+) —
not turning verification off. The docs state plainly: "Running Elasticsearch
without security enabled is not recommended."

Source: https://www.elastic.co/docs/reference/elasticsearch/clients/python/connecting

### Claim 1.4 — Elasticsearch Curator's config file uses `verify_certs: false` (older docs: `ssl_no_validate`), with an explicit warning attached

Curator's config file documents `verify_certs` (older 3.x/4.x/5.x docs call the
same option `ssl_no_validate`) to disable certificate verification, with the
caveat spelled out directly in the docs: "Valid use cases for doing so include
the use of self-signed certificates that cannot be otherwise verified and would
generate error messages" — and "Setting `verify_certs` to `False` will likely
result in a warning message that your SSL certificates are not trusted. This is
expected behavior." Curator does not hide the tradeoff; it names it and moves on.

Source: https://www.elastic.co/guide/en/elasticsearch/client/curator/current/configfile.html

### Claim 1.5 — `escli` (an independent CLI, not Elastic's) uses `--server`, `--username`, `--password`, and an explicit, unambiguous flag name for bypassing certificate checks

`escli` documents `--server ADDR` for the cluster URL, `--username`/`--password`
for basic auth, and — notably — `--insecurely-bypass-certificate-verification`
rather than a terse `--insecure`. The flag's own name carries the warning; no
separate warning text was found in what I could fetch of its docs.

Source: https://github.com/DaveCTurner/escli

Other tools use shorter but less explicit spellings for the same switch: a
search surfaced `--insecure` for one Elasticsearch CLI variant and an
`ES_INSECURE` env var / `insecure` config key for another (`esctl`). I could
not verify either of those two independently against primary docs within this
research pass — they come from a single aggregated search summary, not a
fetched primary source, so treat them as **unconfirmed leads**, not established
fact.

### Claim 1.6 — self-signed certificates fail with a specific, well-known TLS error, not a generic connection failure

Elasticsearch clients (elasticsearch-py, and by inheritance the broader
urllib3/OpenSSL stack most of these tools sit on) fail an unverified self-signed
certificate with `[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed:
self signed certificate in certificate chain`. This is a chain-validation error
raised by the TLS library, not a message authored by the specific CLI — every
tool built on the standard TLS stack will surface some variant of this same
underlying error unless it explicitly catches and rewords it.

Source: https://github.com/elastic/elasticsearch-py/issues/1006 (issue thread
discussing and reproducing the exact error text; corroborated by
https://github.com/elastic/elasticsearch-py/issues/591)

### What Lane 1 means for the decision

Across every tool checked, the pattern is consistent even though exact spellings
differ: a URL/endpoint flag or env var, separate username/password flags or env
vars, and a **separately named, explicit** switch for disabling TLS verification
that never doubles as anything else. The two clearest, most defensible
conventions to imitate are:

- **Env vars**: `<PRODUCT>_URL`, `<PRODUCT>_USERNAME`, `<PRODUCT>_PASSWORD` —
  this is the shape used by both the OpenSearch config helper (`OPENSEARCH_URL`,
  `OPENSEARCH_USERNAME`, `OPENSEARCH_PASSWORD`) and Elastic's own Python client
  (`ELASTIC_PASSWORD`). Since this tool talks to a Wazuh/OpenSearch stack
  specifically, `WAZUH_INDEXER_URL` / `WAZUH_INDEXER_USERNAME` /
  `WAZUH_INDEXER_PASSWORD` (or an `OPENSEARCH_*` prefix, matching the actual
  product) both have direct precedent; there is no single universal prefix to
  copy verbatim, since OpenSearch and Elastic disagree with each other.
- **The insecure-TLS flag should be explicit and self-describing**, following
  `escli`'s `--insecurely-bypass-certificate-verification` and Curator's
  documented, undisguised `verify_certs`/`ssl_no_validate` — not a terse
  `--insecure` that could be mistaken for a generic "don't ask me questions"
  switch. A per-invocation flag (already decided per the prompt) matches this:
  it is never a default, never silent, and its name should say exactly what it
  does, not use a euphemism.

## Lane 2 — Where environment-dependent output belongs

### Claim 2.1 — `clig.dev` establishes a stdout/stderr split by data kind, not by importance

The Command Line Interface Guidelines state directly: "The primary output for
your command should go to `stdout`. Anything that is machine readable should
also go to `stdout` — this is where piping sends things by default," while "Log
messages, errors, and so on should all be sent to `stderr`." It further
distinguishes human-facing output from machine-facing output by TTY detection,
and recommends flags like `--plain`/`--json` when a script needs stable,
parseable output. It does **not** discuss reproducibility or committed-artifact
concerns directly — its stdout/stderr split is about audience (human vs. next
program in a pipe), not about reproducible-vs-machine-specific data.

Source: https://clig.dev/

### Claim 2.2 — the twelve-factor app treats process output as a stream the app must not persist itself

Factor XI ("Logs") states a twelve-factor app "never concerns itself with
routing or storage of its output stream" and that "each running process writes
its event stream, unbuffered, to `stdout`" — persistence, routing, and
aggregation are the execution environment's job, not the app's. This is a
weaker but adjacent precedent to the actual question: it argues diagnostic/
observational output should not be written to files by the tool itself at all,
which — if applied here — would push the indexer comparison towards stdout
rather than a second committed-adjacent file.

Source: https://12factor.net/logs

### Claim 2.3 — `terraform plan -detailed-exitcode` is the closest real precedent for "drift is information, not failure," and it is a documented, deliberate three-way exit code, not an accident

HashiCorp's own docs: "-detailed-exitcode: Returns a detailed exit code when the
command exits. When provided, this argument changes the exit codes and their
meanings to provide more granular information about what the resulting plan
contains" — `0` = succeeded, empty diff; `1` = error; `2` = succeeded, non-empty
diff. This is opt-in (`-detailed-exitcode` must be passed); plain `terraform
plan` returns 0 for a successful plan regardless of whether it found changes.

Source: https://developer.hashicorp.com/terraform/cli/commands/plan

Whether this is "good practice or a trap" has real, documented disagreement.
Several open HashiCorp issues and community threads report `-detailed-exitcode`
returning `2` in cases operators consider false positives (e.g. output-type
changes, refresh-only runs), which breaks naive CI gates built on "exit code 2
means fail the build." The community-documented mitigation is to combine it
with `-refresh-only` to isolate real infrastructure drift from pending config
edits, and to never wire exit code 2 to an auto-apply step.

Sources:
https://github.com/hashicorp/terraform/issues/38097 ,
https://github.com/hashicorp/terraform/issues/35117 ,
https://discuss.hashicorp.com/t/terraform-detailed-exitcode-causes-plan-to-fail-when-exit-code-2/76890

**I could not find an authoritative source calling the three-way exit code
either an unambiguous best practice or a design mistake** — the primary docs
present it neutrally as a feature; the caution comes entirely from operators'
CI experience reports, which is legitimate evidence but not a normative
standard. State this as a documented risk, not a settled verdict.

### Claim 2.4 — SBOM tooling documents an explicit, named tension between spec-required timestamps and reproducibility, and treats non-reproducible fields as something to make overridable, not something to keep out of the artifact by moving it elsewhere

An open `syft` issue states the SPDX SBOM spec "includes required fields like
timestamps that aren't reproducible, which creates a key challenge," forcing a
choice between "build reproducibility OR spec-compliant SBOMs." CycloneDX's
Python generator added support for `SOURCE_DATE_EPOCH` (the reproducible-builds
project's standard env var for pinning a build timestamp) specifically to let a
generated SBOM be reproducible when the environment opts in.

Sources:
https://github.com/anchore/syft/issues/1100 ,
https://github.com/CycloneDX/cyclonedx-python/pull/1084

This is a **different shape of problem** than this tool's: SBOM tools have one
artifact that unavoidably contains a timestamp field, and they neutralize the
non-determinism by pinning the timestamp via an env var, not by splitting the
artifact into a reproducible part and an environment-dependent part. It is
weak, indirect evidence for "keep environment-dependent facts out of the
committed artifact" (the problem is treated as a defect to fix, not a feature to
support), but it is not a direct precedent for "put the volatile part in a
second file."

### Claim 2.5 — reproducible-builds.org's own definition is about identical inputs producing identical outputs, and says nothing about mixed-mode tools

"A build is reproducible if given the same source code, build environment and
build instructions, any party can recreate bit-by-bit identical copies of all
specified artifacts." This defines what "reproducible" means for the *existing*
committed artifact (`out/<ref>/matrix.json`, `crosscheck.json`) and supports
Finding 3 in `exploration.md` — mixing in machine-specific runtime facts would
make that artifact fail its own definition — but it does not say anything about
where a second, deliberately non-reproducible output belongs. That question is
outside this project's scope; it's a general software-distribution definition,
not a CLI design guide.

Source: https://reproducible-builds.org/docs/definition/

### Claim 2.6 — `npm audit` uses a binary, threshold-gated non-zero exit code for "problems found," not a three-way code

`npm audit` exits `0` when no vulnerability at or above the configured
`--audit-level` is found, and non-zero when one is — a binary success/failure
signal keyed to a severity threshold, not Terraform's three-way "no changes /
error / changes" split. This is closer to clig.dev's plain "zero on success,
non-zero on failure" guidance than to `-detailed-exitcode`.

Source: https://docs.npmjs.com/cli/v11/commands/npm-audit/

### What Lane 2 means for the decision (there is no single settled convention — here are the defensible options and who uses each)

I found **no authoritative, cross-tool standard** that says "runtime/diagnostic
comparison output goes exactly here" for a tool whose primary product is a
committed deterministic artifact. What exists is a set of adjacent, partially
applicable precedents that point the same general direction without adding up
to one documented rule:

1. **clig.dev's stdout/stderr split** supports keeping the live-indexer
   comparison out of any file by default and printing it as terminal output
   (stdout, or a `--format json` variant per clig.dev's own suggestion for
   scripts) — this is the most directly applicable authoritative guidance found,
   but it was written for command output in general, not for the specific
   committed-artifact-vs-live-check split this tool has.
2. **Twelve-factor's "the app doesn't persist its own stream"** is compatible
   with option 1 and argues against the tool writing a second file itself at
   all — if a developer wants a saved copy, redirecting stdout is their
   choice, not the tool's.
3. **A separate, clearly-named, gitignored file** (e.g.
   `out/<ref>/indexer-report.json`, added to `.gitignore`) is a defensible third
   option with indirect support from the SBOM precedent (Claim 2.4: don't let
   non-reproducible data live inside the artifact that claims reproducibility)
   and from reproducible-builds.org's definition (Claim 2.5), but I found no
   tool that does exactly this as a named pattern — it is inferred from
   principle, not observed practice.
4. **Terraform's three-way exit code** is real, official precedent for
   "disagreement is information, not failure" (open question 5 in
   `exploration.md`), but it comes with documented operational scars (Claim
   2.3) — teams have been burned wiring exit code 2 into automatic gates. If
   this tool adds a non-zero-but-not-error exit code for "indexer disagrees
   with repo," that choice should be deliberate and documented, not copied
   uncritically.

Between options 1 and 3: stdout-only is simpler and matches the strongest
authoritative source found (clig.dev); a gitignored file is friendlier for a
developer who wants to `diff` two runs but has no cited authority beyond
inference from the reproducibility literature. I did not find evidence to
declare one of these definitively "correct" — this is exactly the kind of
open question the exploration document already flagged as unresolved, and the
research confirms it stays unresolved by external precedent. Whichever is
chosen, the one point every source agrees on is negative but firm: the
machine-specific comparison must not be written into `out/<ref>/matrix.json` or
`out/<ref>/crosscheck.json` themselves.

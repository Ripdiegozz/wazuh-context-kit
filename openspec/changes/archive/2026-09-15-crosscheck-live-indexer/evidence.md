# Measured evidence — live indexer, 2026-09-15

Everything below was observed against the running `os-dev-360` stack, not
inferred. It exists because the previous cycle shipped six defects through a
fully green suite: a fixture that encodes the same assumption as the code
proves the assumption, not the behaviour.

Cluster: OpenSearch `3.6.0`, `cluster_name: wazuh-cluster`, deb build.

## Transport: how the certificate and credentials actually behave

| Probe | Observed |
| --- | --- |
| `curl` without `-k` | exit `60` — the certificate genuinely does not validate |
| No credentials | HTTP `401` |
| Wrong credentials | HTTP `401` |

Bun's `fetch`, probed directly:

- Default (verification on): throws `TypeError` with
  `code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE"`, message
  `unable to verify the first certificate`.
- With per-request `tls: { rejectUnauthorized: false }`: HTTP `200`.

Two consequences for the design:

1. The insecure path does **not** need `NODE_TLS_REJECT_UNAUTHORIZED=0`. That
   env var is process-global and would silently weaken every other TLS call in
   the process. Bun scopes the override to a single request, so the flag can
   mean exactly what it says and nothing more.
2. The failure without the flag is distinguishable by `code`, so the tool can
   fail loudly with a message naming the flag, rather than surfacing a generic
   network error the developer has to decode.

Authentication failure is indistinguishable between "no credentials" and "wrong
credentials" — both are `401`. The message must not claim to know which.

## Endpoint shapes

| Endpoint | Count | Shape needed |
| --- | --- | --- |
| `_cat/indices?format=json` | 52 | array; `index` is the concrete name |
| `_data_stream` | 22 | `data_streams[].name`, `.template`, `.indices[].index_name` |
| `_index_template` | 53 | `index_templates[].name`, `.index_template.index_patterns` |

## The backing-index problem is real and measurable

Of the 52 concrete indices, **22 are data-stream backing indices** named
`.ds-<stream>-NNNNNN`, and 30 are plain. The 22 backing indices correspond
exactly to the 22 data streams.

A comparison that treats `_cat/indices` output as the installed set would report
22 phantom names that no repository declares, and would miss the 22 data-stream
names that repositories DO declare. `_data_stream` supplies the mapping from
backing index to stream name, so the resolution is declared data, not a regex
over `.ds-` prefixes.

The 30 plain indices include three that belong to the platform rather than to
Wazuh — `.kibana_1`, `.opendistro-job-scheduler-lock`, `.opendistro_security` —
and seven `wazuh-threatintel-*-a` indices whose `-a` suffix is an alias
generation, not part of any declared pattern.

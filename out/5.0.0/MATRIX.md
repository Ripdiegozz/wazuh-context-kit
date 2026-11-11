# Wazuh context matrix — `5.0.0`

> Generated from `matrix.json`. Never edit by hand.

## Plugins

| plugin | repo | world | version | server API | indexer access | evidence |
|---|---|---|---|---|---|---|
| `alertingDashboards` | wazuh-dashboard-alerting | upstream-fork | osd | none | `osd-data`, `osd-data-source`, `os-plugin-bound` | `7d315e80` |
| `notificationsDashboards` | wazuh-dashboard-notifications | upstream-fork | osd | none | `osd-data`, `osd-data-source`, `os-plugin-bound` | `de53dc98` |
| `wazuh` | wazuh-dashboard-plugins | wazuh-native | wazuh | wazuh-core | `osd-data` | `f9145897` |
| `wazuhAiAssistant` | wazuh-dashboard-plugins | wazuh-native | wazuh | wazuh-core | — | `f9145897` |
| `wazuhCheckUpdates` | wazuh-dashboard-plugins | wazuh-native | wazuh | wazuh-core | — | `f9145897` |
| `wazuhCore` | wazuh-dashboard-plugins | wazuh-native † | wazuh | none | — | `f9145897` |
| `reportsDashboards` | wazuh-dashboard-reporting | upstream-fork | osd | none | `osd-data`, `osd-data-source` | `2f399687` |
| `securityAnalyticsDashboards` | wazuh-dashboard-security-analytics | upstream-fork | osd | none | `osd-data`, `osd-data-source`, `os-plugin-bound` | `d5f39090` |
| `securityDashboards` | wazuh-security-dashboards-plugin | upstream-fork | osd | none | `osd-data-source`, `os-plugin-bound` | `97c31cd2` |

† Human assertions — not derivable, decided by a person

- `wazuhCore.world` — diego.garcia, 2026-09-14 (`decisions.yml`)
  > The classification rule in SPEC 1.5.2 detects a wazuh-native plugin by its dependency on wazuhCore. wazuh-core is the plugin that PROVIDES that contract, so it does not and cannot declare itself as a dependency, and the rule returns unknown. Recorded as a human assertion rather than adding a fourth rule keyed on a specific plugin id: special-casing one name inside the classifier would make the rule describe an instance instead of a property, and every future provider plugin would need its own branch.

## Unknowns — pending human decision

| plugin | field | reason |
|---|---|---|
| `wazuhAiAssistant` | `indexerAccess` | indexer access not derivable from the manifest |
| `wazuhCheckUpdates` | `indexerAccess` | indexer access not derivable from the manifest |
| `wazuhCore` | `indexerAccess` | indexer access not derivable from the manifest |

## Annotations

- **warning** `wazuhCore` — wazuh-core exposes Server API surface only: serverAPIClient, manageHosts, api.client. It carries no OpenSearch client, so it is never an indexer access path. Note that asScoped/asInternalUser exist on BOTH core.opensearch.client (OSD, indexer RBAC) and wazuh-core api.client (Server API RBAC). Any statement about asScoped that does not say which of the two it means is ambiguous. See SPEC section 8, open decision 4. _(diego.garcia, 2026-09-14)_

## Skipped

- `wazuh-dashboard-ml-commons` — no 5.0.0 branch

## Core plugins

| repo | version | plugins | depended on |
|---|---|---|---|
| wazuh-dashboard | `3.6.0` | 65 | `charts`, `contentManagement`, `dashboard`, `data`, `discover`, `embeddable`, `expressions`, `inspector`, `navigation`, `opensearchDashboardsLegacy`, `opensearchDashboardsReact`, `opensearchDashboardsUtils`, `savedObjects`, `savedObjectsManagement`, `uiActions`, `visAugmenter`, `visualizations` |

## Index templates (40)

- `decoders` — `wazuh-threatintel-decoders*`
- `filters` — `wazuh-threatintel-filters`
- `integrations` — `wazuh-threatintel-integrations*`
- `ioc` — `wazuh-threatintel-enrichments*`
- `kvdbs` — `wazuh-threatintel-kvdbs*`
- `policies` — `wazuh-threatintel-policies*`
- `rules` — `wazuh-threatintel-rules*`
- `vulnerabilities` — `.wazuh-threatintel-vulnerabilities*`
- `cve` — `wazuh-cve*`
- `ism-config` — `.opendistro-ism-config`
- `settings` — `.wazuh-settings*`
- `setup-status` — `.wazuh-setup-status*`
- `agent-config` — `wazuh-agent-config*`
- `agent-stats` — `wazuh-agent-stats*`
- `fim-files` — `wazuh-states-fim-files*`
- `fim-registry-keys` — `wazuh-states-fim-registry-keys*`
- `fim-registry-values` — `wazuh-states-fim-registry-values*`
- `inventory-browser-extensions` — `wazuh-states-inventory-browser-extensions*`
- `inventory-groups` — `wazuh-states-inventory-groups*`
- `inventory-hardware` — `wazuh-states-inventory-hardware*`
- `inventory-hotfixes` — `wazuh-states-inventory-hotfixes*`
- `inventory-interfaces` — `wazuh-states-inventory-interfaces*`
- `inventory-networks` — `wazuh-states-inventory-networks*`
- `inventory-packages` — `wazuh-states-inventory-packages*`
- `inventory-ports` — `wazuh-states-inventory-ports*`
- `inventory-processes` — `wazuh-states-inventory-processes*`
- `inventory-protocols` — `wazuh-states-inventory-protocols*`
- `inventory-services` — `wazuh-states-inventory-services*`
- `inventory-system` — `wazuh-states-inventory-system*`
- `inventory-users` — `wazuh-states-inventory-users*`
- `sca` — `wazuh-states-sca*`
- `vulnerabilities` — `wazuh-states-vulnerabilities*`
- `active-responses` — `wazuh-active-responses*`
- `ai-assistant-sessions` — `wazuh-ai-assistant-sessions*`
- `events` — `wazuh-events-v5*`
- `findings` — `wazuh-findings-v5*`
- `metrics-agents` — `wazuh-metrics-agents*`
- `metrics-comms` — `wazuh-metrics-comms-v4*`
- `metrics-normalization` — `wazuh-metrics-normalization*`
- `raw` — `wazuh-events-raw-v5*`

---

- ref: `5.0.0`
- payloadHash: `sha256:53cfa497d98ec9ee1313207a292a8c8886aec3138ffa9985001a07e138b00d5c`
- resolvedAt: `2026-11-11T11:56:14.399Z`
- resolvedRefs:
  - `wazuh-dashboard` → `9716853e1ed2aaf311350e43df4d4ff9df2bf75b`
  - `wazuh-dashboard-alerting` → `7d315e800e3ccc1276e7c3396d32898000a4c279`
  - `wazuh-dashboard-notifications` → `de53dc980f9d2972aac3cc3bc6bcfb8456cf1f73`
  - `wazuh-dashboard-plugins` → `f91458975132e75484afbfeb3596b8af83096826`
  - `wazuh-dashboard-reporting` → `2f3996873e8dcdd08a2a3b7a72d34ab18651df69`
  - `wazuh-dashboard-security-analytics` → `d5f3909039a975bdb7f9dcb3fead63293e5659a7`
  - `wazuh-indexer-plugins` → `a891740a4527d8749d74b2ee54869e6452ebc011`
  - `wazuh-indexer-security-analytics` → `71c3fc846a7b44c4ff8935041b4bf7cf660b485d`
  - `wazuh-security-dashboards-plugin` → `97c31cd2f1e32d2812387372b8dd27f82ae51a27`

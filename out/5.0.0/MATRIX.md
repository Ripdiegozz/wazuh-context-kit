# Wazuh context matrix — `5.0.0`

> Generated from `matrix.json`. Never edit by hand.

## Plugins

| plugin | repo | world | version | server API | indexer access | evidence |
|---|---|---|---|---|---|---|
| `alertingDashboards` | wazuh-dashboard-alerting | upstream-fork | osd | none | `osd-data`, `osd-data-source`, `os-plugin-bound` | `91960a2c` |
| `notificationsDashboards` | wazuh-dashboard-notifications | upstream-fork | osd | none | `osd-data`, `osd-data-source`, `os-plugin-bound` | `5053d160` |
| `wazuh` | wazuh-dashboard-plugins | wazuh-native | wazuh | wazuh-core | `osd-data` | `ec17ceb5` |
| `wazuhAiAssistant` | wazuh-dashboard-plugins | wazuh-native | wazuh | wazuh-core | — | `ec17ceb5` |
| `wazuhCheckUpdates` | wazuh-dashboard-plugins | wazuh-native | wazuh | wazuh-core | — | `ec17ceb5` |
| `wazuhCore` | wazuh-dashboard-plugins | wazuh-native † | wazuh | none | — | `ec17ceb5` |
| `reportsDashboards` | wazuh-dashboard-reporting | upstream-fork | osd | none | `osd-data`, `osd-data-source` | `d419cafb` |
| `securityAnalyticsDashboards` | wazuh-dashboard-security-analytics | upstream-fork | osd | none | `osd-data`, `osd-data-source`, `os-plugin-bound` | `ff8cb4c4` |
| `securityDashboards` | wazuh-security-dashboards-plugin | upstream-fork | osd | none | `osd-data-source`, `os-plugin-bound` | `4ebdf5f4` |

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
- payloadHash: `sha256:0f7ab9152f8597cfecfacebee5b691800227fac7766381167973541da4d2d6de`
- resolvedAt: `2026-10-06T11:20:50.428Z`
- resolvedRefs:
  - `wazuh-dashboard` → `e1bfe434e8609cb20ba80d938bea4ad611161bbd`
  - `wazuh-dashboard-alerting` → `91960a2c10b8870b3a28130be185e382490d621e`
  - `wazuh-dashboard-notifications` → `5053d160fcab562e8194255f36e048cbc060e9ae`
  - `wazuh-dashboard-plugins` → `ec17ceb574ac27be468c9c11fdcc1cb7aea3d9af`
  - `wazuh-dashboard-reporting` → `d419cafb5c524bcd6e730251fcd43a69a943d920`
  - `wazuh-dashboard-security-analytics` → `ff8cb4c426af91d0a32069d10d28d8d0c6a05c8d`
  - `wazuh-indexer-plugins` → `1fd34982fe829cd01a1ae1ef3d916bd3715008c8`
  - `wazuh-indexer-security-analytics` → `550bec8a625a73bee67775e90af032fdb9daa7ca`
  - `wazuh-security-dashboards-plugin` → `4ebdf5f4ae03de37bdb4b3b33763d1db4f757fc5`

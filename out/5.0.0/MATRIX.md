# Wazuh context matrix — `5.0.0`

> Generated from `matrix.json`. Never edit by hand.

## Plugins

| plugin | repo | world | version | server API | indexer access | evidence |
|---|---|---|---|---|---|---|
| `alertingDashboards` | wazuh-dashboard-alerting | upstream-fork | osd | none | `osd-data`, `osd-data-source`, `os-plugin-bound` | `91960a2c` |
| `notificationsDashboards` | wazuh-dashboard-notifications | upstream-fork | osd | none | `osd-data`, `osd-data-source`, `os-plugin-bound` | `5053d160` |
| `wazuh` | wazuh-dashboard-plugins | wazuh-native | wazuh | wazuh-core | `osd-data` | `2b027b36` |
| `wazuhAiAssistant` | wazuh-dashboard-plugins | wazuh-native | wazuh | wazuh-core | — | `2b027b36` |
| `wazuhCheckUpdates` | wazuh-dashboard-plugins | wazuh-native | wazuh | wazuh-core | — | `2b027b36` |
| `wazuhCore` | wazuh-dashboard-plugins | wazuh-native † | wazuh | none | — | `2b027b36` |
| `reportsDashboards` | wazuh-dashboard-reporting | upstream-fork | osd | none | `osd-data`, `osd-data-source` | `f0cb16a2` |
| `securityAnalyticsDashboards` | wazuh-dashboard-security-analytics | upstream-fork | osd | none | `osd-data`, `osd-data-source`, `os-plugin-bound` | `93d73629` |
| `securityDashboards` | wazuh-security-dashboards-plugin | upstream-fork | osd | none | `osd-data-source`, `os-plugin-bound` | `a5cbb045` |

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
- payloadHash: `sha256:9f74a4301243006623d3f30438c662631e644dc55e0b928fe1697f8aff403f69`
- resolvedAt: `2026-10-17T08:38:03.557Z`
- resolvedRefs:
  - `wazuh-dashboard` → `2c33d85c9dc10d14158c4ee9dd92382f4c048793`
  - `wazuh-dashboard-alerting` → `91960a2c10b8870b3a28130be185e382490d621e`
  - `wazuh-dashboard-notifications` → `5053d160fcab562e8194255f36e048cbc060e9ae`
  - `wazuh-dashboard-plugins` → `2b027b3604694534177a350cde93babdd5e4bb9f`
  - `wazuh-dashboard-reporting` → `f0cb16a2dc97e87616745b3678bd8455f2fdefb2`
  - `wazuh-dashboard-security-analytics` → `93d736298f3815d6af14b8926c66ade344c52387`
  - `wazuh-indexer-plugins` → `f40de4f8ed57ce1d296e5e711724df26eb596e5e`
  - `wazuh-indexer-security-analytics` → `84626660ed96217687a59b394f8cd6918ad27876`
  - `wazuh-security-dashboards-plugin` → `a5cbb045048ad58084ba1f7d40046bb3f116e652`

# Wazuh context matrix — `5.0.0`

> Generated from `matrix.json`. Never edit by hand.

## Plugins

| plugin | repo | world | version | server API | indexer access | evidence |
|---|---|---|---|---|---|---|
| `alertingDashboards` | wazuh-dashboard-alerting | upstream-fork | osd | none | `osd-data`, `osd-data-source`, `os-plugin-bound` | `48b0fc05` |
| `notificationsDashboards` | wazuh-dashboard-notifications | upstream-fork | osd | none | `osd-data`, `osd-data-source`, `os-plugin-bound` | `deebf080` |
| `wazuh` | wazuh-dashboard-plugins | wazuh-native | wazuh | wazuh-core | `osd-data` | `33a578f1` |
| `wazuhAiAssistant` | wazuh-dashboard-plugins | wazuh-native | wazuh | wazuh-core | — | `33a578f1` |
| `wazuhCheckUpdates` | wazuh-dashboard-plugins | wazuh-native | wazuh | wazuh-core | — | `33a578f1` |
| `wazuhCore` | wazuh-dashboard-plugins | wazuh-native † | wazuh | none | — | `33a578f1` |
| `reportsDashboards` | wazuh-dashboard-reporting | upstream-fork | osd | none | `osd-data`, `osd-data-source` | `71b4b9e2` |
| `securityAnalyticsDashboards` | wazuh-dashboard-security-analytics | upstream-fork | osd | none | `osd-data`, `osd-data-source`, `os-plugin-bound` | `ad17e81b` |
| `securityDashboards` | wazuh-security-dashboards-plugin | upstream-fork | osd | none | `osd-data-source`, `os-plugin-bound` | `0d227eac` |

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
| wazuh-dashboard | `3.6.0` | 64 | `charts`, `contentManagement`, `dashboard`, `data`, `discover`, `embeddable`, `expressions`, `inspector`, `navigation`, `opensearchDashboardsLegacy`, `opensearchDashboardsReact`, `opensearchDashboardsUtils`, `savedObjects`, `savedObjectsManagement`, `uiActions`, `visAugmenter`, `visualizations` |

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
- payloadHash: `sha256:83b2d79f074cba6650495f4927823a18944b8cb2b609a4bff8f77d095f68ec3c`
- resolvedAt: `2026-09-21T10:01:09.725Z`
- resolvedRefs:
  - `wazuh-dashboard` → `1f5bcfe8e4d3ea44ba85cc59f14d7aea1df2558a`
  - `wazuh-dashboard-alerting` → `48b0fc05d3a9cf67eaf3d829d47992a5398cc310`
  - `wazuh-dashboard-notifications` → `deebf080ade530eb662ff8599a57ed6e24198554`
  - `wazuh-dashboard-plugins` → `33a578f12188a084e1e5ef5f218d473bf7962243`
  - `wazuh-dashboard-reporting` → `71b4b9e2d6252bec29468ca8ac4c4dd185f6c06a`
  - `wazuh-dashboard-security-analytics` → `ad17e81beba94299724878138dda560732a8253d`
  - `wazuh-indexer-plugins` → `8e465076e8fff96d01ec71368ef11c3346365e6b`
  - `wazuh-indexer-security-analytics` → `f6b1763fb436134b59eed96e3aff88f4b56108ca`
  - `wazuh-security-dashboards-plugin` → `0d227eac38719a42d9b21f07e040f956fff55502`

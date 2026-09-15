# Wazuh context matrix — `5.0.0`

> Generated from `matrix.json`. Never edit by hand.

## Plugins

| plugin | repo | world | version | server API | indexer access | evidence |
|---|---|---|---|---|---|---|
| `alertingDashboards` | wazuh-dashboard-alerting | upstream-fork | osd | none | `osd-data`, `osd-data-source`, `os-plugin-bound` | `48b0fc05` |
| `notificationsDashboards` | wazuh-dashboard-notifications | upstream-fork | osd | none | `osd-data`, `osd-data-source`, `os-plugin-bound` | `deebf080` |
| `wazuh` | wazuh-dashboard-plugins | wazuh-native | wazuh | wazuh-core | `osd-data` | `83695a6a` |
| `wazuhAiAssistant` | wazuh-dashboard-plugins | wazuh-native | wazuh | wazuh-core | — | `83695a6a` |
| `wazuhCheckUpdates` | wazuh-dashboard-plugins | wazuh-native | wazuh | wazuh-core | — | `83695a6a` |
| `wazuhCore` | wazuh-dashboard-plugins | wazuh-native † | wazuh | none | — | `83695a6a` |
| `reportsDashboards` | wazuh-dashboard-reporting | upstream-fork | osd | none | `osd-data`, `osd-data-source` | `71b4b9e2` |
| `securityAnalyticsDashboards` | wazuh-dashboard-security-analytics | upstream-fork | osd | none | `osd-data`, `osd-data-source`, `os-plugin-bound` | `295daaac` |
| `securityDashboards` | wazuh-security-dashboards-plugin | upstream-fork | osd | none | `osd-data-source`, `os-plugin-bound` | `4f034db7` |

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

## Index templates (20)

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

---

- ref: `5.0.0`
- payloadHash: `sha256:5ef7718cbed5104e88bc839af862cce63c12e51690ff77d07736adccb9f3b178`
- resolvedAt: `2026-09-15T16:21:18.155Z`
- resolvedRefs:
  - `wazuh-dashboard` → `4a07e4289a5866b9c0de5f3d26a97c7205d4d401`
  - `wazuh-dashboard-alerting` → `48b0fc05d3a9cf67eaf3d829d47992a5398cc310`
  - `wazuh-dashboard-notifications` → `deebf080ade530eb662ff8599a57ed6e24198554`
  - `wazuh-dashboard-plugins` → `83695a6a5af487f1fb3140b5082f2b83eef7f7e1`
  - `wazuh-dashboard-reporting` → `71b4b9e2d6252bec29468ca8ac4c4dd185f6c06a`
  - `wazuh-dashboard-security-analytics` → `295daaac63d9887ff6d2a5dc85ffeca2015cdfd0`
  - `wazuh-indexer-plugins` → `e4ba55fcafd8e2c309dc4fc07e01d890463fd895`
  - `wazuh-indexer-security-analytics` → `c9340eb7b3b6d45cbd9cbd6173cec331b00c9f25`
  - `wazuh-security-dashboards-plugin` → `4f034db7b9374b81bab48884ebe47e68ce68ad38`

# Index crosscheck — `5.0.0`

> Generated from `crosscheck.json`. Never edit by hand.

## Coverage

**This report is not a completeness claim.** It lists indices whose references a static scan could recover. Where a name is assembled at runtime, or accepted by shape rather than written down, no scanner can see it — so *declared, never referenced* means **no reference was found**, not that none exists.

- Distinct index names recovered: **61**
- Repositories scanned: `wazuh-dashboard-alerting`, `wazuh-dashboard-notifications`, `wazuh-dashboard-plugins`, `wazuh-dashboard-reporting`, `wazuh-dashboard-security-analytics`, `wazuh-security-dashboards-plugin`

### Mechanisms this scan cannot see (87)

| kind | where | why |
|---|---|---|
| `computed-expression` | `plugins/main/common/constants.ts:15` | PLUGIN_VERSION is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:16` | PLUGIN_VERSION_SHORT is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:17` | PLUGIN_MAJOR_VERSION is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:236` | WAZUH_SAMPLE_ALERTS_INDEX_SHARDS is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:237` | WAZUH_SAMPLE_ALERTS_INDEX_REPLICAS is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:252` | WAZUH_SAMPLE_ALERTS_DEFAULT_NUMBER_DOCUMENTS is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:253` | WAZUH_SETTING_ALERTS_SAMPLE_PREFIX is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:258` | WAZUH_SETTING_SCA_SAMPLE_PREFIX is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:262` | WAZUH_SETTING_FIM_FILES_SAMPLE_PREFIX is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:266` | WAZUH_SETTING_FIM_REGISTRY_KEYS_SAMPLE_PREFIX is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:270` | WAZUH_SETTING_FIM_REGISTRY_VALUES_SAMPLE_PREFIX is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:274` | WAZUH_SETTING_INVENTORY_HARDWARE_SAMPLE_PREFIX is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:278` | WAZUH_SETTING_INVENTORY_HOTFIXES_SAMPLE_PREFIX is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:282` | WAZUH_SETTING_INVENTORY_INTERFACES_SAMPLE_PREFIX is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:286` | WAZUH_SETTING_INVENTORY_PACKAGES_SAMPLE_PREFIX is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:290` | WAZUH_SETTING_INVENTORY_PORTS_SAMPLE_PREFIX is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:294` | WAZUH_SETTING_INVENTORY_NETWORKS_SAMPLE_PREFIX is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:298` | WAZUH_SETTING_INVENTORY_PROCESSES_SAMPLE_PREFIX is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:302` | WAZUH_SETTING_INVENTORY_PROTOCOLS_SAMPLE_PREFIX is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:306` | WAZUH_SETTING_INVENTORY_SYSTEM_SAMPLE_PREFIX is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:310` | WAZUH_SETTING_INVENTORY_GROUPS_SAMPLE_PREFIX is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:314` | WAZUH_SETTING_INVENTORY_USERS_SAMPLE_PREFIX is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:318` | WAZUH_SETTING_VULNERABILITIES_SAMPLE_PREFIX is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:322` | WAZUH_SETTING_INVENTORY_SERVICES_SAMPLE_PREFIX is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:326` | WAZUH_SETTING_INVENTORY_BROWSER_EXTENSIONS_SAMPLE_PREFIX is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:333` | WAZUH_SETTING_METRICS_AGENTS_SAMPLE_PREFIX is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:337` | WAZUH_SETTING_METRICS_COMMS_SAMPLE_PREFIX is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:341` | WAZUH_SETTING_METRICS_NORMALIZATION_SAMPLE_PREFIX is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:345` | WAZUH_SETTING_AGENT_STATS_SAMPLE_PREFIX is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:350` | WAZUH_SAMPLE_DATA_CATEGORIES_TYPE_DATA is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:577` | WAZUH_SECURITY_PLUGINS is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:582` | WAZUH_CONFIGURATION_CACHE_TIME is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:585` | WAZUH_API_RESERVED_ID_LOWER_THAN is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:586` | WAZUH_API_RESERVED_WUI_SECURITY_RULES is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:708` | HEALTH_CHECK_REDIRECTION_TIME is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:712` | WAZUH_PLUGIN_PLATFORM_SETTING_TIME_FILTER is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:720` | WAZUH_PLUGIN_PLATFORM_SETTING_MAX_BUCKETS is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:724` | WAZUH_PLUGIN_PLATFORM_SETTING_METAFIELDS is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:728` | UI_LOGGER_LEVELS is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:734` | UI_TOAST_COLOR is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:755` | PLUGIN_PLATFORM_REQUEST_HEADERS is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:763` | UI_COLOR_STATUS is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:774` | API_NAME_AGENT_STATUS is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:781` | UI_COLOR_AGENT_STATUS is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:789` | UI_LABEL_NAME_AGENT_STATUS is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:797` | UI_ORDER_AGENT_STATUS is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:806` | AGENT_STATUS_CODE is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:834` | AGENT_UPGRADE_STATUS_POLL_INTERVAL_MS is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:836` | AGENT_UPGRADE_STATUS_POLL_TIMEOUT_MS is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:926` | SEARCH_BAR_WQL_VALUE_SUGGESTIONS_COUNT is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:928` | SEARCH_BAR_WQL_VALUE_SUGGESTIONS_DISPLAY_COUNT is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:931` | SEARCH_BAR_DEBOUNCE_UPDATE_TIME is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:944` | SUPPORTED_LANGUAGES is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:949` | SUPPORTED_LANGUAGES_ARRAY is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:1026` | INDEX_PATTERN_EVENTS_REQUIRED_FIELDS is assembled, not a literal; folding it needs a type checker |
| `runtime-configuration` | `plugins/main/public/components/settings/api/api-table.js:121` | the index name comes from the deployed instance's configuration |
| `runtime-configuration` | `plugins/main/public/react-services/generic-request.js:36` | the index name comes from the deployed instance's configuration |
| `runtime-configuration` | `plugins/main/public/react-services/wz-api-check.js:20` | the index name comes from the deployed instance's configuration |
| `runtime-configuration` | `plugins/main/public/react-services/wz-request.ts:261` | the index name comes from the deployed instance's configuration |
| `runtime-configuration` | `plugins/main/server/controllers/wazuh-elastic.ts:88` | the index name comes from the deployed instance's configuration |
| `regex-allowlist` | `plugins/wazuh-ai-assistant/server/tools/guardrails.ts:199` | indices are accepted by shape; no name exists here as a string |
| `computed-expression` | `plugins/wazuh-core/common/constants.ts:18` | PLUGIN_VERSION is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/wazuh-core/common/constants.ts:19` | PLUGIN_VERSION_SHORT is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/wazuh-core/common/constants.ts:20` | PLUGIN_MAJOR_VERSION is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/wazuh-core/common/constants.ts:36` | WAZUH_SECURITY_PLUGINS is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/wazuh-core/common/constants.ts:41` | WAZUH_CONFIGURATION_CACHE_TIME is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/wazuh-core/common/constants.ts:44` | WAZUH_API_RESERVED_ID_LOWER_THAN is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/wazuh-core/common/constants.ts:45` | WAZUH_API_RESERVED_WUI_SECURITY_RULES is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/wazuh-core/common/constants.ts:116` | HEALTH_CHECK_REDIRECTION_TIME is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/wazuh-core/common/constants.ts:121` | WAZUH_PLUGIN_PLATFORM_SETTING_TIME_FILTER is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/wazuh-core/common/constants.ts:129` | WAZUH_PLUGIN_PLATFORM_SETTING_MAX_BUCKETS is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/wazuh-core/common/constants.ts:133` | WAZUH_PLUGIN_PLATFORM_SETTING_METAFIELDS is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/wazuh-core/common/constants.ts:137` | UI_LOGGER_LEVELS is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/wazuh-core/common/constants.ts:143` | UI_TOAST_COLOR is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/wazuh-core/common/constants.ts:164` | PLUGIN_PLATFORM_REQUEST_HEADERS is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/wazuh-core/common/constants.ts:172` | UI_COLOR_STATUS is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/wazuh-core/common/constants.ts:181` | API_NAME_AGENT_STATUS is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/wazuh-core/common/constants.ts:188` | UI_COLOR_AGENT_STATUS is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/wazuh-core/common/constants.ts:196` | UI_LABEL_NAME_AGENT_STATUS is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/wazuh-core/common/constants.ts:204` | UI_ORDER_AGENT_STATUS is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/wazuh-core/common/constants.ts:213` | AGENT_STATUS_CODE is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/wazuh-core/common/constants.ts:655` | SEARCH_BAR_WQL_VALUE_SUGGESTIONS_COUNT is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/wazuh-core/common/constants.ts:657` | SEARCH_BAR_WQL_VALUE_SUGGESTIONS_DISPLAY_COUNT is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/wazuh-core/common/constants.ts:660` | SEARCH_BAR_DEBOUNCE_UPDATE_TIME is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/wazuh-core/common/constants.ts:667` | WAZUH_CORE_CONFIGURATION_CACHE_SECONDS is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/wazuh-core/common/constants.ts:670` | WAZUH_ROLE_ADMINISTRATOR_ID is assembled, not a literal; folding it needs a type checker |
| `runtime-configuration` | `plugins/wazuh-core/server/services/manage-hosts.ts:132` | the index name comes from the deployed instance's configuration |

## Declared, never referenced (5)

| index pattern | template | group |
|---|---|---|
| `.opendistro-ism-config` | `plugins/setup/src/main/resources/templates/ism-config.json` | — |
| `.wazuh-setup-status*` | `plugins/setup/src/main/resources/templates/setup-status.json` | — |
| `.wazuh-threatintel-vulnerabilities*` | `plugins/setup/src/main/resources/templates/content/vulnerabilities.json` | content |
| `wazuh-ai-assistant-sessions*` | `plugins/setup/src/main/resources/templates/streams/ai-assistant-sessions.json` | streams |
| `wazuh-cve*` | `plugins/setup/src/main/resources/templates/cve.json` | — |

## Referenced, never declared (24)

> The dashboard reaches for an index the indexer declares no template for.

| index pattern | referenced at | via |
|---|---|---|
| `.wazuh-cti-consumers` | `plugins/wazuh-ai-assistant/server/tools/catalog/get-cti-status.ts:125` | inline-literal |
| `wazuh-inventory-agent` | `plugins/main/common/constants.ts:246` | catalog-literal |
| `wazuh-inventory-agent` | `plugins/main/public/components/add-modules-data/sample-data.tsx:29` | import |
| `wazuh-inventory-agent` | `plugins/main/public/components/overview/it-hygiene/dashboards/dashboard.tsx:12` | import |
| `wazuh-inventory-agent` | `plugins/main/public/components/overview/it-hygiene/networks/inventories/interfaces/inventory.tsx:10` | import |
| `wazuh-inventory-agent` | `plugins/main/public/components/overview/it-hygiene/networks/inventories/networks/inventory.tsx:10` | import |
| `wazuh-inventory-agent` | `plugins/main/public/components/overview/it-hygiene/networks/inventories/protocols/inventory.tsx:10` | import |
| `wazuh-inventory-agent` | `plugins/main/public/components/overview/it-hygiene/networks/inventories/services/inventory.tsx:10` | import |
| `wazuh-inventory-agent` | `plugins/main/public/components/overview/it-hygiene/networks/inventories/traffic/inventory.tsx:10` | import |
| `wazuh-inventory-agent` | `plugins/main/public/components/overview/it-hygiene/packages/inventories/hotfixes/inventory.tsx:10` | import |
| `wazuh-inventory-agent` | `plugins/main/public/components/overview/it-hygiene/packages/inventories/packages/inventory.tsx:10` | import |
| `wazuh-inventory-agent` | `plugins/main/public/components/overview/it-hygiene/packages/inventories/web-browsers/inventory.tsx:10` | import |
| `wazuh-inventory-agent` | `plugins/main/public/components/overview/it-hygiene/processes/inventory.tsx:9` | import |
| `wazuh-inventory-agent` | `plugins/main/public/components/overview/it-hygiene/services/inventory.tsx:9` | import |
| `wazuh-inventory-agent` | `plugins/main/public/components/overview/it-hygiene/system/inventories/hardware/inventory.tsx:9` | import |
| `wazuh-inventory-agent` | `plugins/main/public/components/overview/it-hygiene/system/inventories/system/inventory.tsx:9` | import |
| `wazuh-inventory-agent` | `plugins/main/public/components/overview/it-hygiene/users/inventories/groups/inventory.tsx:10` | import |
| `wazuh-inventory-agent` | `plugins/main/public/components/overview/it-hygiene/users/inventories/users/inventory.tsx:10` | import |
| `wazuh-inventory-agent` | `plugins/main/server/routes/wazuh-elastic.ts:15` | import |
| `wazuh-vulnerabilities` | `plugins/main/common/constants.ts:247` | catalog-literal |
| `wazuh-vulnerabilities` | `plugins/main/public/components/add-modules-data/sample-data.tsx:29` | import |
| `wazuh-vulnerabilities` | `plugins/main/public/components/overview/vulnerabilities/dashboards/inventory/inventory.tsx:59` | import |
| `wazuh-vulnerabilities` | `plugins/main/public/components/overview/vulnerabilities/dashboards/overview/dashboard.tsx:9` | import |
| `wazuh-vulnerabilities` | `plugins/main/server/routes/wazuh-elastic.ts:15` | import |

## WCS modules with no known consumer (5)

- `ai-assistant/sessions`
- `content/ioc`
- `content/vulnerabilities`
- `cve`
- `internal-state`

## Competing catalogs (2)

> More than one module declares this name as a literal. Neither is wrong; the two can drift apart without anything failing.

- `.wazuh-settings` — `plugins/main/common/constants.ts`, `plugins/wazuh-core/common/constants.ts`
- `wazuh-events-v5*` — `plugins/main/common/constants.ts`, `plugins/wazuh-core/common/constants.ts`

---

- ref: `5.0.0`

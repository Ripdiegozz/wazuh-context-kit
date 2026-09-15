# Index crosscheck — `5.0.0`

> Generated from `crosscheck.json`. Never edit by hand.

## Coverage

**This report is not a completeness claim.** It lists indices whose references a static scan could recover. Where a name is assembled at runtime, or accepted by shape rather than written down, no scanner can see it — so *declared, never referenced* means **no reference was found**, not that none exists.

- Distinct index names recovered: **61**
- Repositories scanned: `wazuh-dashboard-alerting`, `wazuh-dashboard-notifications`, `wazuh-dashboard-plugins`, `wazuh-dashboard-reporting`, `wazuh-dashboard-security-analytics`, `wazuh-security-dashboards-plugin`

### Mechanisms this scan cannot see (10)

| kind | where | why |
|---|---|---|
| `computed-expression` | `plugins/main/common/constants.ts:236` | WAZUH_SAMPLE_ALERTS_INDEX_SHARDS is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:237` | WAZUH_SAMPLE_ALERTS_INDEX_REPLICAS is assembled, not a literal; folding it needs a type checker |
| `computed-expression` | `plugins/main/common/constants.ts:1026` | INDEX_PATTERN_EVENTS_REQUIRED_FIELDS is assembled, not a literal; folding it needs a type checker |
| `runtime-configuration` | `plugins/main/public/components/settings/api/api-table.js:121` | the index name comes from the deployed instance's configuration |
| `runtime-configuration` | `plugins/main/public/react-services/generic-request.js:36` | the index name comes from the deployed instance's configuration |
| `runtime-configuration` | `plugins/main/public/react-services/wz-api-check.js:20` | the index name comes from the deployed instance's configuration |
| `runtime-configuration` | `plugins/main/public/react-services/wz-request.ts:261` | the index name comes from the deployed instance's configuration |
| `runtime-configuration` | `plugins/main/server/controllers/wazuh-elastic.ts:88` | the index name comes from the deployed instance's configuration |
| `regex-allowlist` | `plugins/wazuh-ai-assistant/server/tools/guardrails.ts:199` | indices are accepted by shape; no name exists here as a string |
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

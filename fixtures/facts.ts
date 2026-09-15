/**
 * SHAPE-ONLY FIXTURES. These are NOT a mirror of any real repository.
 *
 * `wazuhMain` declares 3 `requiredPlugins` where the real `plugins/main`
 * manifest at 5.0.0 declares 15, and its `optionalPlugins` names
 * `usageCollection`, which the real manifest does not contain at all. The
 * divergence is by construction, not drift: these fixtures exist to exercise
 * the SHAPE of the pipeline with a readable amount of data.
 *
 * A consequence worth knowing before you "fix" anything here: because the
 * fixture omits `data`, `wazuh.indexerAccess` computes to `[]` where the real
 * manifest yields `["osd-data"]`. That difference is expected.
 *
 * Do NOT sync these to reality. A fixture that mirrors an upstream repository
 * is a snapshot, and a snapshot rots on every release. Verification against
 * the real thing is the opt-in network suite's job
 * (`WAZUH_CTX_NETWORK=1`), and it already does it.
 */
/**
 * Hand-written fixtures modelled on real manifests from branch 5.0.0
 * (SPEC 1.2, 4). Modelled on, not copied from -- see the banner above.
 *
 * These exist so the pure core can be exercised with nothing cloned. Values are
 * transcribed from the manifests quoted in the spec; the commits are synthetic
 * placeholders because the fixture is about shape, not provenance.
 */

import type { RawPluginFacts } from "../src/matrix/types.ts";

const COMMIT_PLUGINS = "5157de35aa0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d";
const COMMIT_SECURITY_ANALYTICS = "a91c02f1bb2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e";

export const wazuhMain: RawPluginFacts = {
  repo: "wazuh-dashboard-plugins",
  repoKind: "dashboard",
  pluginDir: "plugins/main",
  manifestPath: "plugins/main/opensearch_dashboards.json",
  packageJsonPath: "plugins/main/package.json",
  commit: COMMIT_PLUGINS,
  packageVersion: "5.0.0",
  manifest: {
    id: "wazuh",
    configPath: ["wazuh"],
    requiredPlugins: ["navigation", "opensearchDashboardsReact", "wazuhCore"],
    optionalPlugins: ["securityDashboards", "usageCollection"],
  },
};

export const wazuhCore: RawPluginFacts = {
  repo: "wazuh-dashboard-plugins",
  repoKind: "dashboard",
  pluginDir: "plugins/wazuh-core",
  manifestPath: "plugins/wazuh-core/opensearch_dashboards.json",
  packageJsonPath: "plugins/wazuh-core/package.json",
  commit: COMMIT_PLUGINS,
  packageVersion: "5.0.0",
  manifest: {
    id: "wazuhCore",
    configPath: ["wazuh_core"],
    requiredPlugins: ["opensearchDashboardsReact"],
    optionalPlugins: ["securityDashboards"],
  },
};

export const wazuhCheckUpdates: RawPluginFacts = {
  repo: "wazuh-dashboard-plugins",
  repoKind: "dashboard",
  pluginDir: "plugins/wazuh-check-updates",
  manifestPath: "plugins/wazuh-check-updates/opensearch_dashboards.json",
  packageJsonPath: "plugins/wazuh-check-updates/package.json",
  commit: COMMIT_PLUGINS,
  packageVersion: "5.0.0",
  manifest: {
    id: "wazuhCheckUpdates",
    configPath: ["wazuh_check_updates"],
    requiredPlugins: ["navigation", "wazuhCore"],
    optionalPlugins: [],
  },
};

export const wazuhAiAssistant: RawPluginFacts = {
  repo: "wazuh-dashboard-plugins",
  repoKind: "dashboard",
  pluginDir: "plugins/wazuh-ai-assistant",
  manifestPath: "plugins/wazuh-ai-assistant/opensearch_dashboards.json",
  packageJsonPath: "plugins/wazuh-ai-assistant/package.json",
  commit: COMMIT_PLUGINS,
  packageVersion: "5.0.0",
  manifest: {
    id: "wazuhAiAssistant",
    configPath: ["wazuh_ai_assistant"],
    requiredPlugins: ["navigation", "wazuhCore"],
    optionalPlugins: [],
  },
};

/** Mundo B. Transcribed verbatim from SPEC section 4. */
export const securityAnalytics: RawPluginFacts = {
  repo: "wazuh-dashboard-security-analytics",
  repoKind: "dashboard",
  pluginDir: ".",
  manifestPath: "opensearch_dashboards.json",
  packageJsonPath: "package.json",
  commit: COMMIT_SECURITY_ANALYTICS,
  packageVersion: "3.6.0.0",
  manifest: {
    id: "securityAnalyticsDashboards",
    configPath: ["opensearch_security_analytics"],
    opensearchDashboardsVersion: "3.6.0",
    requiredPlugins: [
      "data",
      "navigation",
      "opensearchDashboardsUtils",
      "contentManagement",
      "opensearchDashboardsReact",
    ],
    optionalPlugins: ["dataSource", "dataSourceManagement"],
    requiredOSDataSourcePlugins: ["opensearch-security-analytics"],
  },
};

/** A manifest with no `id`. Must NOT fall back to the directory name. */
export const anonymousPlugin: RawPluginFacts = {
  repo: "wazuh-dashboard-alerting",
  repoKind: "dashboard",
  pluginDir: "plugins/alerting-dashboards",
  manifestPath: "plugins/alerting-dashboards/opensearch_dashboards.json",
  packageJsonPath: null,
  commit: "cccccccccccccccccccccccccccccccccccccccc",
  packageVersion: null,
  manifest: {
    requiredPlugins: ["data"],
  },
};

export const allFacts: RawPluginFacts[] = [
  wazuhMain,
  wazuhCore,
  wazuhCheckUpdates,
  wazuhAiAssistant,
  securityAnalytics,
];

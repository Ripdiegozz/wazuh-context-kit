/**
 * Tests for the single `github.com/wazuh/<repo>` URL helper (src/github.ts).
 *
 * Written before any caller was switched over -- this pins the exact string
 * shapes `src/fetch/index.ts` and `src/mcp/docs-validate.ts` already relied
 * on, so migrating them to this module cannot silently change behaviour.
 */

import { describe, expect, test } from "bun:test";
import { orgBaseUrl, repoBrowseUrl, repoCloneUrl } from "./github.ts";

describe("orgBaseUrl", () => {
  test("is the wazuh org root", () => {
    expect(orgBaseUrl()).toBe("https://github.com/wazuh");
  });
});

describe("repoCloneUrl", () => {
  test("matches the .git clone URL fetch/index.ts and docs-validate.ts used to hardcode", () => {
    expect(repoCloneUrl("wazuh-dashboard-plugins")).toBe(
      "https://github.com/wazuh/wazuh-dashboard-plugins.git",
    );
  });
});

describe("repoBrowseUrl", () => {
  test("is well-formed for a known repo/commit/path", () => {
    const url = repoBrowseUrl(
      "wazuh-dashboard-alerting",
      "abc1234def5678900000000000000000000000",
      "plugins/alerting/opensearch_dashboards.json",
    );

    expect(url).toBe(
      "https://github.com/wazuh/wazuh-dashboard-alerting/blob/abc1234def5678900000000000000000000000/plugins/alerting/opensearch_dashboards.json",
    );
    // Well-formed: parses as a URL, host is exactly github.com, path carries org/repo/blob/commit/path.
    const parsed = new URL(url);
    expect(parsed.hostname).toBe("github.com");
    expect(parsed.pathname).toBe(
      "/wazuh/wazuh-dashboard-alerting/blob/abc1234def5678900000000000000000000000/plugins/alerting/opensearch_dashboards.json",
    );
  });
});

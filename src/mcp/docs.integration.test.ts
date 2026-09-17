/**
 * Opt-in canary against the real `documentation.wazuh.com` (SPEC "A broken
 * 1-to-1 guarantee fails loudly, and `docs` reports unavailable", task 6.4).
 *
 * Asserts the published availability guarantee itself: a known page's `.md`
 * twin returns 200 + `text/markdown` + a body not starting with `<!DOCTYPE`
 * (research-docs-contract.md finding 5). Status alone would miss the failure
 * mode SPEC 3.1 warns about -- the site serving the HTML page under the `.md`
 * path with a 200 -- which is exactly why `fetchDocs` checks all three
 * signals together.
 *
 * Skipped unless `WAZUH_CTX_NETWORK=1`, following the established gate in
 * `src/fetch/network.integration.test.ts:22-24`. Never part of the default
 * `bun test`.
 */

import { describe, expect, test } from "bun:test";
import type { DocsVersionMap } from "../sources.ts";
import { fetchDocs } from "./docs.ts";

const NETWORK_ENABLED = process.env.WAZUH_CTX_NETWORK === "1";
const maybeTest = NETWORK_ENABLED ? test : test.skip;

describe("docs canary against the real documentation.wazuh.com", () => {
  maybeTest(
    "a known page's .md twin returns 200 + text/markdown + a body not starting with <!DOCTYPE",
    async () => {
      // 4.14 is measured 200 today (research-docs-contract.md finding 3) and
      // is not the beta path most likely to move before this canary is read.
      const docsVersionMap: DocsVersionMap = {
        owner: "diego.garcia",
        lastReviewed: "2026-09-17",
        map: { "4.14.0": "4.14" },
      };

      const result = await fetchDocs(fetch, docsVersionMap, {
        ref: "4.14.0",
        path: "getting-started/components/index",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`expected success, got: ${result.message}`);
      expect(result.markdown.startsWith("<!DOCTYPE")).toBe(false);
      expect(result.markdown).toContain("Copyright");
      expect(result.citationUrl).toBe(
        "https://documentation.wazuh.com/4.14/getting-started/components/index.html",
      );
    },
  );
});

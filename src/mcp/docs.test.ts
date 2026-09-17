/**
 * Tests for `docs` (design "`docs`: mapping, fetch, citation"; SPEC "`docs`
 * returns Markdown and cites the canonical HTML", "The version mapping is
 * explicit configuration, never derived", "A broken 1-to-1 guarantee fails
 * loudly").
 *
 * Strict TDD: written before `docs.ts` exists, so the first `bun test` run
 * must fail on the import before anything is implemented.
 *
 * All three tests here use an injected fake transport -- no network, per
 * design "Every file that touches the world takes its dependency injected".
 * The real-network canary (task 6.4) lives in `docs.integration.test.ts`,
 * gated behind `WAZUH_CTX_NETWORK=1`.
 */

import { describe, expect, test } from "bun:test";
import type { DocsVersionMap } from "../sources.ts";
import { fetchDocs, type DocsFetchLike, type DocsHttpResponseLike } from "./docs.ts";

const REAL_MD_BODY = "<!-- Copyright (C) 2015, Wazuh, Inc. -->\n\n# Components\n";
const HTML_ERROR_BODY = "<!DOCTYPE html><html><body>Not Found</body></html>";

function fakeResponse(
  status: number,
  contentType: string | null,
  body: string,
): DocsHttpResponseLike {
  return {
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === "content-type" ? contentType : null),
    },
    text: async () => body,
  };
}

describe("fetchDocs", () => {
  test("a mapped ref builds the .md URL and cites the .html twin", async () => {
    const requestedUrls: string[] = [];
    const transport: DocsFetchLike = async (url) => {
      requestedUrls.push(url);
      return fakeResponse(200, "text/markdown", REAL_MD_BODY);
    };
    const docsVersionMap: DocsVersionMap = {
      owner: "diego.garcia",
      lastReviewed: "2026-09-17",
      map: { "5.0.0": "5.0-beta" },
    };

    const result = await fetchDocs(transport, docsVersionMap, {
      ref: "5.0.0",
      path: "getting-started/components/index",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.requestedUrl).toBe(
      "https://documentation.wazuh.com/5.0-beta/getting-started/components/index.md",
    );
    expect(result.citationUrl).toBe(
      "https://documentation.wazuh.com/5.0-beta/getting-started/components/index.html",
    );
    expect(result.markdown).toBe(REAL_MD_BODY);
    expect(requestedUrls).toEqual([result.requestedUrl]);
  });

  test("an unmapped ref fails with a message distinct from a fetch miss on a mapped-but-dead path", async () => {
    const deadTransport: DocsFetchLike = async () =>
      fakeResponse(404, "text/html", HTML_ERROR_BODY);
    const docsVersionMap: DocsVersionMap = {
      owner: "diego.garcia",
      lastReviewed: "2026-09-17",
      // Measured dead today (research-docs-contract.md finding 4's original value).
      map: { "5.0.0": "5.0" },
    };

    const unmapped = await fetchDocs(deadTransport, docsVersionMap, {
      ref: "9.9.9",
      path: "getting-started/components/index",
    });
    const deadMapped = await fetchDocs(deadTransport, docsVersionMap, {
      ref: "5.0.0",
      path: "getting-started/components/index",
    });

    expect(unmapped.ok).toBe(false);
    expect(deadMapped.ok).toBe(false);
    if (unmapped.ok || deadMapped.ok) throw new Error("expected both to fail");

    expect(unmapped.reason).toBe("unmapped-ref");
    expect(deadMapped.reason).toBe("unavailable");
    expect(unmapped.message).not.toBe(deadMapped.message);
    expect(unmapped.message).toContain("9.9.9");
    expect(deadMapped.message).toContain("404");
  });

  test("a 200 carrying content-type text/html under a .md path reports docs unavailable", async () => {
    const transport: DocsFetchLike = async () => fakeResponse(200, "text/html", HTML_ERROR_BODY);
    const docsVersionMap: DocsVersionMap = {
      owner: "diego.garcia",
      lastReviewed: "2026-09-17",
      map: { "5.0.0": "5.0-beta" },
    };

    const result = await fetchDocs(transport, docsVersionMap, {
      ref: "5.0.0",
      path: "getting-started/components/index",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("unavailable");
    expect(result.message).toContain("text/html");
    // The HTML body must never be handed back as if it were documentation.
    expect(result).not.toHaveProperty("markdown");
  });
});

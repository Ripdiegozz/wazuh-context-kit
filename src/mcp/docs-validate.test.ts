/**
 * Tests for the mapping validator (design "The validator"; SPEC "The version
 * mapping is validated against reality, not trusted").
 *
 * Strict TDD: written before `docs-validate.ts` exists, so the first
 * `bun test` run must fail on the import before anything is implemented.
 *
 * Both tests use injected fakes for the fetch transport and the git runner --
 * no network, no real git process, per design "Every file that touches the
 * world takes its dependency injected".
 */

import { describe, expect, test } from "bun:test";
import type { GitRunner } from "../fetch/types.ts";
import type { DocsVersionMap } from "../sources.ts";
import type { DocsFetchLike, DocsHttpResponseLike } from "./docs.ts";
import { validateDocsMap } from "./docs-validate.ts";

function fakeResponse(status: number, contentType: string | null, body: string): DocsHttpResponseLike {
  return {
    status,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? contentType : null) },
    text: async () => body,
  };
}

describe("validateDocsMap", () => {
  test("fails on a mapping entry whose path 404s, naming the entry and its lastReviewed", async () => {
    const docsVersionMap: DocsVersionMap = {
      owner: "diego.garcia",
      lastReviewed: "2026-09-14",
      map: { "5.0.0": "5.0" }, // measured dead: every URL under /5.0/ 404s
    };
    const transport: DocsFetchLike = async () =>
      fakeResponse(404, "text/html", "<!DOCTYPE html><html></html>");
    const git: GitRunner = async () => ({ code: 0, stdout: "", stderr: "" });

    const result = await validateDocsMap({ transport, git, docsVersionMap, cwd: "/tmp" });

    expect(result.ok).toBe(false);
    const entry = result.entries.find((e) => e.ref === "5.0.0");
    expect(entry).toBeDefined();
    expect(entry?.ok).toBe(false);
    const named = entry?.problems.some(
      (problem) => problem.includes("5.0.0") && problem.includes("2026-09-14"),
    );
    expect(named).toBe(true);
  });

  test("reports a changed release state and does not rewrite the mapping", async () => {
    const docsVersionMap: DocsVersionMap = {
      owner: "diego.garcia",
      lastReviewed: "2026-09-17",
      map: { "5.0.0": "5.0-beta" }, // assumes no GA tag yet
    };
    const snapshotBefore = JSON.parse(JSON.stringify(docsVersionMap));

    const transport: DocsFetchLike = async () =>
      fakeResponse(200, "text/markdown", "<!-- Copyright (C) 2015, Wazuh, Inc. -->\n");
    const git: GitRunner = async () => ({
      code: 0,
      stdout: [
        "aaa1\trefs/tags/v5.0.0-alpha0",
        "bbb2\trefs/tags/v5.0.0-beta5",
        // A GA tag has since appeared, contradicting the entry's assumption.
        "ccc3\trefs/tags/v5.0.0",
      ].join("\n"),
      stderr: "",
    });

    const result = await validateDocsMap({ transport, git, docsVersionMap, cwd: "/tmp" });

    expect(result.ok).toBe(false);
    const entry = result.entries.find((e) => e.ref === "5.0.0");
    expect(entry?.ok).toBe(false);
    const reportsReleaseChange = entry?.problems.some(
      (problem) => problem.toLowerCase().includes("ga") || problem.toLowerCase().includes("release"),
    );
    expect(reportsReleaseChange).toBe(true);

    // The whole point: it never rewrites the mapping.
    expect(docsVersionMap).toEqual(snapshotBefore);
  });
});

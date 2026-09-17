/**
 * ONE thin end-to-end protocol test (task 6.11; design "Testing splits in
 * two"): a real `Client` from `@modelcontextprotocol/client` (devDependency)
 * driving a real `McpServer` over `InMemoryTransport.createLinkedPair()`.
 *
 * Everything else about `docs`/`schema`/`runtime` is already proven directly
 * below the protocol boundary in `docs.test.ts`, `schema.test.ts` and
 * `runtime.test.ts` -- this file exists ONLY to prove that `server.ts`'s
 * wiring (capability registration, the conditional `runtime` registration)
 * actually holds together end to end. It deliberately does not re-assert
 * every handler requirement through the protocol (research-mcp-sdk.md: "that
 * would make each assertion pay for transport setup while proving nothing
 * extra").
 *
 * `InMemoryTransport` is not reachable from `@modelcontextprotocol/core`
 * (research-mcp-sdk.md finding 3); both halves of the linked pair come from
 * `@modelcontextprotocol/client`, the same package `Client` is imported
 * from, per that research's own warning that the two packages bundle
 * separate copies with private state.
 *
 * Task 6.7 ("`runtime` absent leaves `docs` and `schema` serving") is
 * asserted HERE rather than as a standalone unit test: it is a statement
 * about what the protocol advertises (`resources/list`), which nothing
 * below the protocol boundary can observe -- `McpServer` exposes no public
 * accessor for its registered resources (only `resources/list` over the
 * wire does).
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { buildMcpServer } from "./server.ts";
import { loadDataset, type DatasetLoaded } from "./dataset.ts";
import { runStartup } from "./startup.ts";
import { createTelemetrySink } from "./telemetry.ts";
import type { DocsFetchLike, DocsHttpResponseLike } from "./docs.ts";
import type { Sources } from "../sources.ts";
import type { GitCommand, GitResult, GitRunner } from "../fetch/types.ts";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const REAL_OUT_ROOT = join(REPO_ROOT, "out");
const REF = "5.0.0";
const FIXED_NOW = "2026-09-17T00:00:00.000Z";
const clock = () => FIXED_NOW;

const SOURCES: Sources = {
  refs: [REF],
  repos: [],
  docsVersionMap: { owner: "test", lastReviewed: "2026-09-17", map: { [REF]: "5.0" } },
};

function fakeDocsResponse(status: number, contentType: string, body: string): DocsHttpResponseLike {
  return {
    status,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? contentType : null) },
    text: async () => body,
  };
}

const docsTransport: DocsFetchLike = async () =>
  fakeDocsResponse(200, "text/markdown", "# Getting started\n\nSome real content.");

async function realDataset(): Promise<DatasetLoaded> {
  const result = await loadDataset(REAL_OUT_ROOT, REF);
  if (!result.ok) throw new Error("expected the real committed dataset to load");
  return result;
}

/** One connected `{ client, close }` pair over a fresh in-memory link. */
async function connectedClient(runtimeSnapshot: Parameters<typeof buildMcpServer>[0]["runtimeSnapshot"]) {
  const dataset = await realDataset();
  const telemetry = createTelemetrySink({ enabled: false, path: "/dev/null/unused", clock });

  const server = buildMcpServer({
    dataset,
    clock,
    sources: SOURCES,
    docsTransport,
    telemetry,
    runtimeSnapshot,
  });

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "wazuh-ctx-test-client", version: "0.0.0" });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

describe("mcp/server.ts wiring (task 6.11)", () => {
  // `docs` is a `ResourceTemplate` registered with `list: undefined`
  // (research-mcp-sdk.md §1: opts a template out of `resources/list`
  // enumeration -- it still matches and reads by URI pattern, it is just
  // never advertised in the listing). So "docs and schema serving" is
  // asserted directly: `schema` is listed, and `docs` still answers a real
  // read -- neither is affected by `runtime`'s absence.
  test("6.7: with no runtime backend, `schema` is listed and `docs` still answers a read", async () => {
    const { client, close } = await connectedClient(null);
    try {
      const { resources } = await client.listResources();
      expect(resources.map((r) => r.name)).toEqual(["schema"]);

      const docsResult = await client.readResource({ uri: `docs://${REF}/getting-started/components/index` });
      const first = docsResult.contents[0];
      if (first === undefined || !("text" in first) || typeof first.text !== "string") {
        throw new Error("expected a text content item");
      }
      expect(first.text).toContain("Getting started");
    } finally {
      await close();
    }
  });

  test("a configured runtime backend adds `runtime` to the listing without removing `schema`", async () => {
    const { client, close } = await connectedClient({ url: "https://runtime.example/api", data: { ok: true } });
    try {
      const { resources } = await client.listResources();
      const names = resources.map((r) => r.name).sort();
      expect(names).toEqual(["runtime", "schema"]);
    } finally {
      await close();
    }
  });

  test("schema reads back the real dataset's ref through the protocol", async () => {
    const { client, close } = await connectedClient(null);
    try {
      const result = await client.readResource({ uri: "schema://matrix" });
      const first = result.contents[0];
      if (first === undefined || !("text" in first) || typeof first.text !== "string") {
        throw new Error("expected a text content item");
      }
      const parsed = JSON.parse(first.text) as { ref: string };
      expect(parsed.ref).toBe(REF);
    } finally {
      await close();
    }
  });

  test("docs resolves a templated ref/path URI through the protocol", async () => {
    const { client, close } = await connectedClient(null);
    try {
      const result = await client.readResource({ uri: `docs://${REF}/getting-started/components/index` });
      const first = result.contents[0];
      if (first === undefined || !("text" in first) || typeof first.text !== "string") {
        throw new Error("expected a text content item");
      }
      expect(first.text).toContain("Getting started");
      expect(first.text).toContain("Source:");
    } finally {
      await close();
    }
  });
});

describe("mcp startup -> protocol ordering (SPEC 3.6, strengthening startup.test.ts:203-234)", () => {
  // A `GitRunner` fake, not a real temp repository: `SOURCES.repos` above is
  // `[]`, so `resolveWorld` can never recognise ANY remote against it -- the
  // ref gate in `runStartup` only ever compares branches for a *recognised*
  // repository (`world.ts`'s own docblock), so this fake always takes the
  // "serve, world unknown" path regardless of what it returns. What matters
  // here is not the git fixture, it's that `announce` fires before the
  // caller can hold `{ ok: true }` -- and this test then goes one step
  // further than `startup.test.ts`'s own ordering test by using that
  // `{ ok: true }` to build a REAL server and drive a REAL protocol read
  // through it, instead of the caller simulating "first query answered" by
  // pushing a string.
  const fakeGit: GitRunner = async (command: GitCommand): Promise<GitResult> => {
    const verb = command.argv[0];
    if (verb === "rev-parse") return { code: 0, stdout: "/fake/repo\n", stderr: "" };
    if (verb === "config") return { code: 0, stdout: "https://github.com/some-org/unrelated.git\n", stderr: "" };
    if (verb === "symbolic-ref") return { code: 0, stdout: "main\n", stderr: "" };
    throw new Error(`unexpected git call in fake runner: ${command.argv.join(" ")}`);
  };

  test("announce is recorded before a real client's resources/read resolves", async () => {
    const events: string[] = [];

    const startup = await runStartup({
      git: fakeGit,
      cwd: "/fake/cwd",
      sources: SOURCES,
      matrix: (await realDataset()).matrix,
      allowRefMismatch: false,
      announce: () => {
        events.push("announce");
      },
    });

    expect(startup.ok).toBe(true);
    expect(events).toEqual(["announce"]);

    const dataset = await realDataset();
    const telemetry = createTelemetrySink({ enabled: false, path: "/dev/null/unused", clock });
    const server = buildMcpServer({
      dataset,
      clock,
      sources: SOURCES,
      docsTransport,
      telemetry,
      runtimeSnapshot: null,
    });

    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "wazuh-ctx-test-client", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    try {
      // The REAL query: an actual `resources/read` round-trip over the
      // in-memory transport, not a string the test pushes itself.
      const result = await client.readResource({ uri: "schema://matrix" });
      events.push("read-answered");

      const first = result.contents[0];
      if (first === undefined || !("text" in first) || typeof first.text !== "string") {
        throw new Error("expected a text content item");
      }
      expect(JSON.parse(first.text)).toMatchObject({ ref: REF });

      // The world was announced strictly before the real protocol read came
      // back -- proven by an actual query, not simulated by the test.
      expect(events).toEqual(["announce", "read-answered"]);
    } finally {
      await client.close();
      await server.close();
    }
  });
});

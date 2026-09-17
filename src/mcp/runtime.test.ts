/**
 * Tests for the `runtime` resource's backend resolution (SPEC "`runtime`
 * absent never blocks `docs` or `schema`"; design "`runtime`: optional
 * resource; conditional registration").
 *
 * Strict TDD: written before `runtime.ts` exists, so the first `bun test`
 * run must fail on the import before anything is implemented.
 *
 * SPEC 3.3 names two live-only surfaces (the dashboard's configuration
 * registry, effective cluster roles) that this project has no static
 * client for -- unlike `src/indexer/client.ts`'s three named GETs, there is
 * no established wire contract for either here. So `resolveRuntimeBackend`
 * does exactly what `src/indexer/client.ts`'s docblock already establishes
 * as the right split (design "Finding 4" / "runtime degrades at the
 * composition edge"): ONE GET against the configured instance URL, reported
 * raw and unjudged, with every failure mode collapsing to `null` -- never a
 * thrown error -- because a caller (`server.ts`) that receives `null` is
 * the entire mechanism by which `runtime` fails to register instead of
 * crashing startup.
 */

import { describe, expect, test } from "bun:test";
import {
  resolveRuntimeBackend,
  runtimeHandlers,
  type RuntimeFetchLike,
  type RuntimeHttpResponseLike,
} from "./runtime.ts";

function fakeResponse(status: number, body: unknown): RuntimeHttpResponseLike {
  return { status, json: async () => body };
}

describe("resolveRuntimeBackend", () => {
  test("no instance configured resolves to null (SPEC: no instance configured)", async () => {
    const transport: RuntimeFetchLike = () => {
      throw new Error("must not be called with no instance configured");
    };

    const result = await resolveRuntimeBackend(transport, undefined);

    expect(result).toBeNull();
  });

  test("a configured instance that does not respond resolves to null, not a throw", async () => {
    const transport: RuntimeFetchLike = async () => {
      throw new Error("ECONNREFUSED");
    };

    const result = await resolveRuntimeBackend(transport, { url: "https://runtime.invalid/api/status" });

    expect(result).toBeNull();
  });

  test("a non-2xx response resolves to null", async () => {
    const transport: RuntimeFetchLike = async () => fakeResponse(503, { status: "down" });

    const result = await resolveRuntimeBackend(transport, { url: "https://runtime.invalid/api/status" });

    expect(result).toBeNull();
  });

  test("a reachable instance resolves to a raw, unjudged snapshot", async () => {
    const body = { configuration: { "some.key": "value" }, roles: ["admin"] };
    const transport: RuntimeFetchLike = async (url) => {
      expect(url).toBe("https://runtime.example/api/status");
      return fakeResponse(200, body);
    };

    const result = await resolveRuntimeBackend(transport, { url: "https://runtime.example/api/status" });

    expect(result).not.toBeNull();
    expect(result?.url).toBe("https://runtime.example/api/status");
    expect(result?.data).toEqual(body);
  });
});

describe("runtimeHandlers", () => {
  test("wraps a resolved snapshot as an available response", () => {
    const handlers = runtimeHandlers({ url: "https://runtime.example/api/status", data: { ok: true } });

    const response = handlers.snapshot();

    expect(response.available).toBe(true);
    expect(response.url).toBe("https://runtime.example/api/status");
    expect(response.data).toEqual({ ok: true });
  });
});

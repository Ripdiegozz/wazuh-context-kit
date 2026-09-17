/**
 * `startServeServer` — the HTTP wiring for `wazuh-ctx serve` (SPEC 1.5.1).
 *
 * A thin adapter over `./handlers.ts`, mirroring `src/mcp/server.ts`'s own
 * description of itself: the actual logic lives one layer down, already
 * tested directly; this module only turns an HTTP request into a handler
 * call and a handler result into an HTTP response.
 *
 * Two hard requirements, both load-bearing (task brief):
 * - Binds to `127.0.0.1` ONLY, never `0.0.0.0` -- this is a local inspector
 *   for the person maintaining the dataset, not a service exposed to the
 *   network.
 * - Never sends `Access-Control-Allow-Origin: *` (or any CORS header at
 *   all): nothing here needs to be reachable from an arbitrary origin.
 */

import {
  createServeHandlers,
  type PostAnnotationsRequest,
  type PostDecisionsRequest,
  type ServeHandlersOptions,
} from "./handlers.ts";

const BIND_HOSTNAME = "127.0.0.1";

export interface StartServeServerOptions extends ServeHandlersOptions {
  /** `0` picks a free port (used by tests); a caller running `wazuh-ctx serve` passes a fixed one. */
  readonly port?: number;
}

export interface RunningServeServer {
  readonly hostname: string;
  readonly port: number;
  /** Base URL, always ending in `/`, e.g. `http://127.0.0.1:54321/`. */
  readonly url: string;
  stop(): void;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function startServeServer(options: StartServeServerOptions): RunningServeServer {
  const handlers = createServeHandlers(options);

  const server = Bun.serve({
    hostname: BIND_HOSTNAME,
    port: options.port ?? 0,
    async fetch(request) {
      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/api/matrix") {
        const result = await handlers.getMatrix();
        return jsonResponse(result.status, result.body);
      }

      if (request.method === "GET" && url.pathname === "/api/unknowns") {
        const result = await handlers.getUnknowns();
        return jsonResponse(result.status, result.body);
      }

      if (request.method === "GET" && url.pathname === "/api/crosscheck") {
        const result = await handlers.getCrosscheck();
        return jsonResponse(result.status, result.body);
      }

      if (request.method === "GET" && url.pathname === "/api/decisions") {
        const target = url.searchParams.get("target") ?? undefined;
        const result = await handlers.getDecisions(target);
        return jsonResponse(result.status, result.body);
      }

      if (request.method === "GET" && url.pathname === "/api/annotations") {
        const result = await handlers.getAnnotations();
        return jsonResponse(result.status, result.body);
      }

      if (request.method === "POST" && url.pathname === "/api/decisions") {
        const payload = (await request.json()) as PostDecisionsRequest;
        const result = await handlers.postDecisions(payload);
        return jsonResponse(result.status, result.body);
      }

      if (request.method === "POST" && url.pathname === "/api/annotations") {
        const payload = (await request.json()) as PostAnnotationsRequest;
        const result = await handlers.postAnnotations(payload);
        return jsonResponse(result.status, result.body);
      }

      return jsonResponse(404, { error: "not-found", message: `no route for ${request.method} ${url.pathname}` });
    },
  });

  return {
    hostname: server.hostname ?? BIND_HOSTNAME,
    port: server.port ?? 0,
    url: server.url.toString(),
    stop() {
      server.stop(true);
    },
  };
}

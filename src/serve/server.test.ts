/**
 * Tests for the HTTP wiring (`wazuh-ctx serve`, SPEC 1.5.1). Binds to
 * `127.0.0.1` only (never `0.0.0.0`) and never sends
 * `Access-Control-Allow-Origin: *`.
 *
 * Strict TDD: written before `server.ts` exists.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createNodeServeFs } from "./handlers.ts";
import { startServeServer } from "./server.ts";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const REAL_OUT_ROOT = join(REPO_ROOT, "out");
const REF = "5.0.0";

function makeServer(root: string) {
  return startServeServer({
    outRoot: REAL_OUT_ROOT,
    ref: REF,
    root,
    clock: () => "2026-09-17T12:00:00.000Z",
    telemetryPath: join(root, "telemetry.jsonl"),
    fs: createNodeServeFs(),
    port: 0,
  });
}

describe("startServeServer", () => {
  test("binds to 127.0.0.1 only, never 0.0.0.0", async () => {
    const server = makeServer(REPO_ROOT);
    try {
      expect(server.hostname).toBe("127.0.0.1");
    } finally {
      server.stop();
    }
  });

  test("GET /api/matrix serves the fixture dataset", async () => {
    const server = makeServer(REPO_ROOT);
    try {
      const response = await fetch(`${server.url}api/matrix`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { matrix: { ref: string } };
      expect(body.matrix.ref).toBe(REF);
    } finally {
      server.stop();
    }
  });

  test("GET /api/unknowns serves the telemetry-ordered work queue", async () => {
    const server = makeServer(REPO_ROOT);
    try {
      const response = await fetch(`${server.url}api/unknowns`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { unknowns: unknown[] };
      expect(Array.isArray(body.unknowns)).toBe(true);
    } finally {
      server.stop();
    }
  });

  test("GET /api/crosscheck serves the bipartite view", async () => {
    const server = makeServer(REPO_ROOT);
    try {
      const response = await fetch(`${server.url}api/crosscheck`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { orphans: unknown };
      expect(body.orphans).toBeDefined();
    } finally {
      server.stop();
    }
  });

  test("GET /api/decisions serves the current parsed decisions.yml entries", async () => {
    const server = makeServer(REPO_ROOT);
    try {
      const response = await fetch(`${server.url}api/decisions`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { target: string; entries: unknown[] };
      expect(body.target).toBe("decisions.yml");
      expect(Array.isArray(body.entries)).toBe(true);
    } finally {
      server.stop();
    }
  });

  test("GET /api/decisions?target=decisions.local.yml serves the local overlay", async () => {
    const server = makeServer(REPO_ROOT);
    try {
      const response = await fetch(`${server.url}api/decisions?target=decisions.local.yml`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { target: string; entries: unknown[] };
      expect(body.target).toBe("decisions.local.yml");
    } finally {
      server.stop();
    }
  });

  test("GET /api/annotations serves the current parsed annotations.yml entries", async () => {
    const server = makeServer(REPO_ROOT);
    try {
      const response = await fetch(`${server.url}api/annotations`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { target: string; entries: unknown[] };
      expect(body.target).toBe("annotations.yml");
      expect(Array.isArray(body.entries)).toBe(true);
    } finally {
      server.stop();
    }
  });

  test("POST /api/decisions in preview mode never sets Access-Control-Allow-Origin: *", async () => {
    const server = makeServer(REPO_ROOT);
    try {
      const response = await fetch(`${server.url}api/decisions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: "decisions.yml", confirm: false, entries: [] }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).not.toBe("*");
    } finally {
      server.stop();
    }
  });

  test("an unknown route answers 404", async () => {
    const server = makeServer(REPO_ROOT);
    try {
      const response = await fetch(`${server.url}api/does-not-exist`);
      expect(response.status).toBe(404);
    } finally {
      server.stop();
    }
  });
});

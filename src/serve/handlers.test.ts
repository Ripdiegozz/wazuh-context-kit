/**
 * Tests for the pure route handlers behind `wazuh-ctx serve` (SPEC 1.5.1).
 *
 * Every handler is exercised against real fixture files under `out/5.0.0/`
 * (the same fixture convention `src/mcp/dataset.test.ts` uses) and a real
 * temp directory for the human-layer files -- never the live `.cache/` and
 * never a network call, matching SPEC 1.5.3 criterion 5 ("Corre contra
 * fixtures, sin haber clonado ningún repo").
 *
 * Strict TDD: written before `handlers.ts` exists.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodeServeFs, createServeHandlers } from "./handlers.ts";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const REAL_OUT_ROOT = join(REPO_ROOT, "out");
const REF = "5.0.0";

const FIXED_NOW = "2026-09-17T12:00:00.000Z";
const clock = () => FIXED_NOW;

async function withTempRoot<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "wazuh-ctx-serve-handlers-"));
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("GET /api/matrix (getMatrix)", () => {
  test("serves out/5.0.0/matrix.json via the shared dataset loader, fixture-only, no network", async () => {
    const handlers = createServeHandlers({
      outRoot: REAL_OUT_ROOT,
      ref: REF,
      root: REPO_ROOT,
      clock,
      telemetryPath: join(REPO_ROOT, "does-not-exist-telemetry.jsonl"),
      fs: createNodeServeFs(),
    });

    const response = await handlers.getMatrix();

    if (response.status !== 200) throw new Error(`expected 200, got ${response.status}`);
    expect(response.body.matrix.ref).toBe(REF);
    expect(response.body.provenance.ref).toBe(REF);
  });

  test("derived evidence carries a server-computed browse url -- the UI must not guess the org prefix", async () => {
    const handlers = createServeHandlers({
      outRoot: REAL_OUT_ROOT,
      ref: REF,
      root: REPO_ROOT,
      clock,
      telemetryPath: join(REPO_ROOT, "does-not-exist-telemetry.jsonl"),
      fs: createNodeServeFs(),
    });

    const response = await handlers.getMatrix();

    if (response.status !== 200) throw new Error(`expected 200, got ${response.status}`);
    const plugin = response.body.matrix.plugins.find((p) => p.evidence.kind === "derived");
    if (!plugin) throw new Error("expected at least one plugin with derived evidence in the fixture");
    const evidence = plugin.evidence;
    if (evidence.kind !== "derived") throw new Error("narrowed above");
    expect(evidence.url).toBe(
      `https://github.com/wazuh/${plugin.repo}/blob/${evidence.commit}/${evidence.manifestPath}`,
    );
  });
});

describe("GET /api/unknowns (getUnknowns)", () => {
  test("orders the real dataset's unknowns using telemetry from a temp file, fixture-only", async () => {
    await withTempRoot(async (root) => {
      const telemetryPath = join(root, "telemetry.jsonl");
      const handlers = createServeHandlers({
        outRoot: REAL_OUT_ROOT,
        ref: REF,
        root,
        clock,
        telemetryPath,
        fs: createNodeServeFs(),
      });

      const response = await handlers.getUnknowns();

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.unknowns)).toBe(true);
      // No telemetry recorded yet -- every entry reports zero queries.
      for (const entry of response.body.unknowns) {
        expect(entry.totalQueries).toBe(0);
      }
    });
  });
});

describe("GET /api/crosscheck (getCrosscheck)", () => {
  test("shapes out/5.0.0/crosscheck.json as a bipartite view with both orphan sides", async () => {
    const handlers = createServeHandlers({
      outRoot: REAL_OUT_ROOT,
      ref: REF,
      root: REPO_ROOT,
      clock,
      telemetryPath: join(REPO_ROOT, "does-not-exist-telemetry.jsonl"),
      fs: createNodeServeFs(),
    });

    const response = await handlers.getCrosscheck();

    if (response.status !== 200) throw new Error(`expected 200, got ${response.status}`);
    expect(response.body.ref).toBe(REF);
    expect(response.body.orphans).toHaveProperty("declaredUnreferenced");
    expect(response.body.orphans).toHaveProperty("referencedUndeclared");
  });
});

describe("POST /api/decisions (postDecisions) -- preview vs commit", () => {
  test("criterion 4: preview mode writes NOTHING to disk, and returns added/changed/removed", async () => {
    await withTempRoot(async (root) => {
      const decisionsPath = join(root, "decisions.yml");
      const before = "- plugin: existingPlugin\n  field: world\n  value: unknown\n  author: a@b.c\n  date: '2026-01-01'\n  reason: seed\n  status: active\n";
      await writeFile(decisionsPath, before, "utf8");
      const statBefore = await stat(decisionsPath);

      const handlers = createServeHandlers({
        outRoot: REAL_OUT_ROOT,
        ref: REF,
        root,
        clock,
        telemetryPath: join(root, "telemetry.jsonl"),
        fs: createNodeServeFs(),
      });

      const response = await handlers.postDecisions({
        target: "decisions.yml",
        confirm: false,
        entries: [
          {
            plugin: "existingPlugin",
            field: "world",
            value: "wazuh-native",
            author: "diego.garcia@wazuh.com",
            date: "2026-09-17",
            reason: "manifest now confirms it",
            status: "active",
          },
        ],
      });

      if (response.status !== 200) throw new Error(`expected 200, got ${response.status}`);
      expect(response.body.committed).toBe(false);
      expect(response.body.diff.changed).toHaveLength(1);
      expect(response.body.diff.changed[0]?.key).toBe("existingPlugin::world");

      const after = await readFile(decisionsPath, "utf8");
      const statAfter = await stat(decisionsPath);
      expect(after).toBe(before);
      expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);
    });
  });

  test("confirm: true writes the proposed decisions.yml to disk", async () => {
    await withTempRoot(async (root) => {
      const decisionsPath = join(root, "decisions.yml");

      const handlers = createServeHandlers({
        outRoot: REAL_OUT_ROOT,
        ref: REF,
        root,
        clock,
        telemetryPath: join(root, "telemetry.jsonl"),
        fs: createNodeServeFs(),
      });

      const response = await handlers.postDecisions({
        target: "decisions.yml",
        confirm: true,
        entries: [
          {
            plugin: "newPlugin",
            field: "world",
            value: "wazuh-native",
            author: "diego.garcia@wazuh.com",
            date: "2026-09-17",
            reason: "manifest confirms it",
            status: "active",
          },
        ],
      });

      if (response.status !== 200) throw new Error(`expected 200, got ${response.status}`);
      expect(response.body.committed).toBe(true);

      const written = await readFile(decisionsPath, "utf8");
      expect(written).toContain("newPlugin");
    });
  });

  test("allowlist guard: refuses to write outside decisions.yml/annotations.yml/decisions.local.yml even with confirm: true", async () => {
    await withTempRoot(async (root) => {
      const handlers = createServeHandlers({
        outRoot: REAL_OUT_ROOT,
        ref: REF,
        root,
        clock,
        telemetryPath: join(root, "telemetry.jsonl"),
        fs: createNodeServeFs(),
      });

      const response = await handlers.postDecisions({
        // Bypasses the request type's own enum on purpose -- this proves the
        // refusal comes from the shared `assertAllowedWrite` chokepoint, not
        // just from the request type happening to be narrow.
        target: "../../etc/passwd" as never,
        confirm: true,
        entries: [],
      });

      expect(response.status).toBe(403);
    });
  });
});

describe("POST /api/annotations (postAnnotations)", () => {
  test("preview mode writes nothing; confirm writes annotations.yml", async () => {
    await withTempRoot(async (root) => {
      const annotationsPath = join(root, "annotations.yml");
      const handlers = createServeHandlers({
        outRoot: REAL_OUT_ROOT,
        ref: REF,
        root,
        clock,
        telemetryPath: join(root, "telemetry.jsonl"),
        fs: createNodeServeFs(),
      });

      const preview = await handlers.postAnnotations({
        target: "annotations.yml",
        confirm: false,
        entries: [
          {
            plugin: "somePlugin",
            kind: "note",
            text: "worth reviewing",
            author: "diego.garcia@wazuh.com",
            date: "2026-09-17",
          },
        ],
      });
      if (preview.status !== 200) throw new Error(`expected 200, got ${preview.status}`);
      expect(preview.body.committed).toBe(false);
      expect(preview.body.diff.added).toHaveLength(1);

      let threw = false;
      try {
        await readFile(annotationsPath, "utf8");
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);

      const commit = await handlers.postAnnotations({
        target: "annotations.yml",
        confirm: true,
        entries: [
          {
            plugin: "somePlugin",
            kind: "note",
            text: "worth reviewing",
            author: "diego.garcia@wazuh.com",
            date: "2026-09-17",
          },
        ],
      });
      if (commit.status !== 200) throw new Error(`expected 200, got ${commit.status}`);
      expect(commit.body.committed).toBe(true);

      const written = await readFile(annotationsPath, "utf8");
      expect(written).toContain("somePlugin");
    });
  });
});

describe("GET /api/decisions (getDecisions)", () => {
  test("returns the current parsed decisions.yml entries, and writes nothing", async () => {
    await withTempRoot(async (root) => {
      const decisionsPath = join(root, "decisions.yml");
      const before = "- plugin: existingPlugin\n  field: world\n  value: unknown\n  author: a@b.c\n  date: '2026-01-01'\n  reason: seed\n  status: active\n";
      await writeFile(decisionsPath, before, "utf8");
      const statBefore = await stat(decisionsPath);

      const handlers = createServeHandlers({
        outRoot: REAL_OUT_ROOT,
        ref: REF,
        root,
        clock,
        telemetryPath: join(root, "telemetry.jsonl"),
        fs: createNodeServeFs(),
      });

      const response = await handlers.getDecisions("decisions.yml");

      if (response.status !== 200) throw new Error(`expected 200, got ${response.status}`);
      expect(response.body.target).toBe("decisions.yml");
      expect(response.body.entries).toHaveLength(1);
      expect(response.body.entries[0]?.plugin).toBe("existingPlugin");

      const after = await readFile(decisionsPath, "utf8");
      const statAfter = await stat(decisionsPath);
      expect(after).toBe(before);
      expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);
    });
  });

  test("returns an empty array when decisions.yml is absent (optional-if-missing)", async () => {
    await withTempRoot(async (root) => {
      const handlers = createServeHandlers({
        outRoot: REAL_OUT_ROOT,
        ref: REF,
        root,
        clock,
        telemetryPath: join(root, "telemetry.jsonl"),
        fs: createNodeServeFs(),
      });

      const response = await handlers.getDecisions("decisions.yml");

      if (response.status !== 200) throw new Error(`expected 200, got ${response.status}`);
      expect(response.body.entries).toEqual([]);
    });
  });

  test("reads decisions.local.yml when asked for that target", async () => {
    await withTempRoot(async (root) => {
      const localPath = join(root, "decisions.local.yml");
      await writeFile(
        localPath,
        "- plugin: localPlugin\n  field: world\n  value: unknown\n  author: a@b.c\n  date: '2026-01-01'\n  reason: local override\n  status: active\n",
        "utf8",
      );

      const handlers = createServeHandlers({
        outRoot: REAL_OUT_ROOT,
        ref: REF,
        root,
        clock,
        telemetryPath: join(root, "telemetry.jsonl"),
        fs: createNodeServeFs(),
      });

      const response = await handlers.getDecisions("decisions.local.yml");

      if (response.status !== 200) throw new Error(`expected 200, got ${response.status}`);
      expect(response.body.target).toBe("decisions.local.yml");
      expect(response.body.entries[0]?.plugin).toBe("localPlugin");
    });
  });
});

describe("GET /api/annotations (getAnnotations)", () => {
  test("returns the current parsed annotations.yml entries, and writes nothing", async () => {
    await withTempRoot(async (root) => {
      const annotationsPath = join(root, "annotations.yml");
      const before = "- plugin: somePlugin\n  kind: note\n  text: worth reviewing\n  author: a@b.c\n  date: '2026-01-01'\n";
      await writeFile(annotationsPath, before, "utf8");
      const statBefore = await stat(annotationsPath);

      const handlers = createServeHandlers({
        outRoot: REAL_OUT_ROOT,
        ref: REF,
        root,
        clock,
        telemetryPath: join(root, "telemetry.jsonl"),
        fs: createNodeServeFs(),
      });

      const response = await handlers.getAnnotations();

      if (response.status !== 200) throw new Error(`expected 200, got ${response.status}`);
      expect(response.body.target).toBe("annotations.yml");
      expect(response.body.entries).toHaveLength(1);
      expect(response.body.entries[0]?.plugin).toBe("somePlugin");

      const after = await readFile(annotationsPath, "utf8");
      const statAfter = await stat(annotationsPath);
      expect(after).toBe(before);
      expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);
    });
  });

  test("returns an empty array when annotations.yml is absent (optional-if-missing)", async () => {
    await withTempRoot(async (root) => {
      const handlers = createServeHandlers({
        outRoot: REAL_OUT_ROOT,
        ref: REF,
        root,
        clock,
        telemetryPath: join(root, "telemetry.jsonl"),
        fs: createNodeServeFs(),
      });

      const response = await handlers.getAnnotations();

      if (response.status !== 200) throw new Error(`expected 200, got ${response.status}`);
      expect(response.body.entries).toEqual([]);
    });
  });
});

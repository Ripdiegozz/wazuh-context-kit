/**
 * `createServeHandlers` — the pure route logic behind `wazuh-ctx serve`
 * (SPEC 1.5.1). This is the composition edge for the inspector, sibling to
 * `src/mcp/server.ts` (design note in that file: "Every handler below is a
 * thin adapter"). `src/serve/server.ts` is the only caller; it turns these
 * plain `{ status, body }` results into an actual HTTP response.
 *
 * Reuses, never re-implements:
 * - `src/mcp/dataset.ts`'s `loadDataset`/`provenanceFor` for `matrix.json`.
 * - `src/mcp/telemetry.ts`'s `readTelemetryRecords` for `/api/unknowns`'s
 *   ordering (SPEC 5.5).
 * - `src/decisions/schema.ts`'s `parseDecisions`/`parseAnnotations` for both
 *   the on-disk YAML and the proposed request body -- the diff in
 *   `yaml-diff.ts` always runs over parsed structures, never raw text.
 * - `./write-guard.ts`'s `assertAllowedWrite` as the ONE chokepoint every
 *   write passes through (SPEC 1.5.3 criterion 1), even though the request
 *   type already narrows `target` to an allowed literal -- defense in depth,
 *   proven by a test that bypasses the type with `as never`.
 *
 * Clock and fs are injected (constructor-parameter style, mirroring
 * `src/indexer/client.ts`'s injected `transport`), so tests can supply a
 * fixed clock and either the real `createNodeServeFs()` against a temp
 * directory, or a fake in-memory one.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { repoBrowseUrl } from "../github.ts";
import { loadDataset, provenanceFor, type Clock, type Provenance } from "../mcp/dataset.ts";
import { readTelemetryRecords } from "../mcp/telemetry.ts";
import {
  parseAnnotations,
  parseDecisions,
  type Annotation,
  type Decision,
} from "../decisions/schema.ts";
import type { CrosscheckJson, Evidence, MatrixJson, MatrixPlugin } from "../matrix/types.ts";
import { assertAllowedWrite, WriteRefused } from "./write-guard.ts";
import { diffEntries, formatDiffLines, type EntriesDiff } from "./yaml-diff.ts";
import { buildCrosscheckView, type CrosscheckView } from "./crosscheck-view.ts";
import { orderUnknownsByTelemetry, type UnknownWithTelemetry } from "./unknowns.ts";

export type { Clock };

/** Minimal fs surface this module needs, injected so it never opens sockets or unbounded paths itself. */
export interface ServeFs {
  /** `undefined` when the file does not exist (ENOENT); throws on any other error. */
  readTextFile(path: string): Promise<string | undefined>;
  writeTextFile(path: string, content: string): Promise<void>;
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as NodeJS.ErrnoException).code === "ENOENT"
  );
}

/** The real filesystem. `server.ts` uses this; tests use it too, against a temp directory. */
export function createNodeServeFs(): ServeFs {
  return {
    async readTextFile(path) {
      try {
        return await readFile(path, "utf8");
      } catch (err) {
        if (isEnoent(err)) return undefined;
        throw err;
      }
    },
    async writeTextFile(path, content) {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(path, content, "utf8");
    },
  };
}

export interface ServeHandlersOptions {
  /** `out/` -- `loadDataset`/crosscheck read `<outRoot>/<ref>/...` from here. */
  readonly outRoot: string;
  readonly ref: string;
  /** Repo root: where `decisions.yml`/`annotations.yml`/`decisions.local.yml` live. */
  readonly root: string;
  readonly clock: Clock;
  readonly telemetryPath: string;
  readonly fs: ServeFs;
}

export interface HttpResult<T> {
  readonly status: number;
  readonly body: T;
}

/** A literal-status result, so callers narrow on `status` (e.g. `=== 200`) rather than casting. */
export interface HttpOk<T> {
  readonly status: 200;
  readonly body: T;
}

export interface HttpRefused {
  readonly status: 403 | 404;
  readonly body: RefusedBody;
}

/**
 * `Evidence`, widened with the browse URL derived server-side for `kind:
 * "derived"` entries -- `src/github.ts`'s `repoBrowseUrl`, never a client-side
 * guess at the org prefix (that guess is exactly what `ui/src/components/
 * matrix/EvidenceBadge.tsx` used to make; see `src/github.ts`'s doc comment).
 */
export type EvidenceOut = Evidence & { readonly url?: string };

export interface MatrixPluginOut extends Omit<MatrixPlugin, "evidence"> {
  readonly evidence: EvidenceOut;
}

export interface MatrixJsonOut extends Omit<MatrixJson, "plugins"> {
  readonly plugins: MatrixPluginOut[];
}

function withBrowseUrls(matrix: MatrixJson): MatrixJsonOut {
  return {
    ...matrix,
    plugins: matrix.plugins.map((plugin) => ({
      ...plugin,
      evidence: withBrowseUrl(plugin.repo, plugin.evidence),
    })),
  };
}

function withBrowseUrl(repo: string, evidence: Evidence): EvidenceOut {
  if (evidence.kind !== "derived") return evidence;
  return { ...evidence, url: repoBrowseUrl(repo, evidence.commit, evidence.manifestPath) };
}

export interface MatrixResponseBody {
  readonly matrix: MatrixJsonOut;
  readonly provenance: Provenance;
}

export interface UnknownsResponseBody {
  readonly unknowns: UnknownWithTelemetry[];
}

const DECISIONS_TARGETS = ["decisions.yml", "decisions.local.yml"] as const;
export type DecisionsTarget = (typeof DECISIONS_TARGETS)[number];
const ANNOTATIONS_TARGET = "annotations.yml" as const;

export interface PostDecisionsRequest {
  readonly target: DecisionsTarget;
  readonly confirm?: boolean;
  readonly entries: unknown;
}

export interface PostAnnotationsRequest {
  readonly target: typeof ANNOTATIONS_TARGET;
  readonly confirm?: boolean;
  readonly entries: unknown;
}

export interface SaveResponseBody<T> {
  readonly target: string;
  readonly committed: boolean;
  readonly diff: {
    readonly added: readonly T[];
    readonly removed: readonly T[];
    readonly changed: readonly { key: string; before: T; after: T }[];
  };
  readonly lines: string[];
}

export interface RefusedBody {
  readonly error: string;
  readonly message: string;
}

/**
 * `GET /api/decisions` / `GET /api/annotations` response: the current parsed
 * entries of the target file, read through the exact same path
 * `postDecisions`/`postAnnotations` already use for their "existing" side of
 * the diff -- so recovering the current entries never again needs to POST an
 * empty proposal and read `diff.removed` back out.
 */
export interface DecisionsResponseBody {
  readonly target: string;
  readonly entries: readonly Decision[];
}

export interface AnnotationsResponseBody {
  readonly target: string;
  readonly entries: readonly Annotation[];
}

function decisionKey(d: Decision): string {
  return `${d.plugin}::${d.field}`;
}

function annotationKey(a: Annotation): string {
  return `${a.plugin}::${a.kind}::${a.text}::${a.author}::${a.date}`;
}

function diffBody<T>(diff: EntriesDiff<T>): SaveResponseBody<T>["diff"] {
  return {
    added: diff.added,
    removed: diff.removed,
    changed: diff.changed.map(({ key, before, after }) => ({ key, before, after })),
  };
}

async function readYamlArray(fs: ServeFs, path: string): Promise<unknown> {
  const raw = await fs.readTextFile(path);
  if (raw === undefined) return [];
  return parseYaml(raw);
}

export interface ServeHandlers {
  getMatrix(): Promise<HttpOk<MatrixResponseBody> | HttpRefused>;
  getUnknowns(): Promise<HttpOk<UnknownsResponseBody>>;
  getCrosscheck(): Promise<HttpOk<CrosscheckView> | HttpRefused>;
  /** `target` defaults to `"decisions.yml"`; pass `"decisions.local.yml"` for the local escape hatch. */
  getDecisions(target?: string): Promise<HttpOk<DecisionsResponseBody> | HttpRefused>;
  getAnnotations(): Promise<HttpOk<AnnotationsResponseBody> | HttpRefused>;
  postDecisions(
    request: PostDecisionsRequest,
  ): Promise<HttpOk<SaveResponseBody<Decision>> | HttpRefused>;
  postAnnotations(
    request: PostAnnotationsRequest,
  ): Promise<HttpOk<SaveResponseBody<Annotation>> | HttpRefused>;
}

function isDecisionsTarget(value: string): value is DecisionsTarget {
  return (DECISIONS_TARGETS as readonly string[]).includes(value);
}

export function createServeHandlers(options: ServeHandlersOptions): ServeHandlers {
  async function loadMatrix(): Promise<MatrixJson> {
    const loaded = await loadDataset(options.outRoot, options.ref);
    if (!loaded.ok) {
      throw new Error(loaded.message);
    }
    return loaded.matrix;
  }

  return {
    async getMatrix() {
      const loaded = await loadDataset(options.outRoot, options.ref);
      if (!loaded.ok) {
        return {
          status: 404,
          body: { error: loaded.reason, message: loaded.message },
        };
      }
      return {
        status: 200,
        body: {
          matrix: withBrowseUrls(loaded.matrix),
          provenance: provenanceFor(loaded.matrix, options.clock),
        },
      };
    },

    async getUnknowns() {
      const matrix = await loadMatrix();
      const records = await readTelemetryRecords(options.telemetryPath);
      const unknowns = orderUnknownsByTelemetry(matrix.unknowns, records);
      return { status: 200, body: { unknowns } };
    },

    async getCrosscheck() {
      const path = join(options.outRoot, options.ref, "crosscheck.json");
      const raw = await options.fs.readTextFile(path);
      if (raw === undefined) {
        return {
          status: 404,
          body: { error: "absent", message: `crosscheck not found at ${path}` },
        };
      }
      const crosscheck = JSON.parse(raw) as CrosscheckJson;
      return { status: 200, body: buildCrosscheckView(crosscheck) };
    },

    async getDecisions(target = "decisions.yml") {
      if (!isDecisionsTarget(target)) {
        return {
          status: 403,
          body: {
            error: "write-refused",
            message: `refusing to read outside decisions.yml, decisions.local.yml: requested "${target}"`,
          },
        };
      }

      let resolvedPath: string;
      try {
        resolvedPath = assertAllowedWrite(options.root, target);
      } catch (err) {
        if (err instanceof WriteRefused) {
          return { status: 403, body: { error: "write-refused", message: err.message } };
        }
        throw err;
      }

      const raw = await readYamlArray(options.fs, resolvedPath);
      const entries = parseDecisions(raw, target);
      return { status: 200, body: { target, entries } };
    },

    async getAnnotations() {
      let resolvedPath: string;
      try {
        resolvedPath = assertAllowedWrite(options.root, ANNOTATIONS_TARGET);
      } catch (err) {
        if (err instanceof WriteRefused) {
          return { status: 403, body: { error: "write-refused", message: err.message } };
        }
        throw err;
      }

      const raw = await readYamlArray(options.fs, resolvedPath);
      const entries = parseAnnotations(raw, ANNOTATIONS_TARGET);
      return { status: 200, body: { target: ANNOTATIONS_TARGET, entries } };
    },

    async postDecisions(request) {
      let resolvedPath: string;
      try {
        resolvedPath = assertAllowedWrite(options.root, request.target);
      } catch (err) {
        if (err instanceof WriteRefused) {
          return { status: 403, body: { error: "write-refused", message: err.message } };
        }
        throw err;
      }

      const proposed = parseDecisions(request.entries, "decisions (request body)");
      const existingRaw = await readYamlArray(options.fs, resolvedPath);
      const existing = parseDecisions(existingRaw, request.target);

      const diff = diffEntries(existing, proposed, decisionKey);
      const lines = formatDiffLines(diff);

      if (request.confirm === true) {
        await options.fs.writeTextFile(resolvedPath, stringifyYaml(proposed));
      }

      return {
        status: 200,
        body: {
          target: request.target,
          committed: request.confirm === true,
          diff: diffBody(diff),
          lines,
        },
      };
    },

    async postAnnotations(request) {
      let resolvedPath: string;
      try {
        resolvedPath = assertAllowedWrite(options.root, request.target);
      } catch (err) {
        if (err instanceof WriteRefused) {
          return { status: 403, body: { error: "write-refused", message: err.message } };
        }
        throw err;
      }

      const proposed = parseAnnotations(request.entries, "annotations (request body)");
      const existingRaw = await readYamlArray(options.fs, resolvedPath);
      const existing = parseAnnotations(existingRaw, request.target);

      const diff = diffEntries(existing, proposed, annotationKey);
      const lines = formatDiffLines(diff);

      if (request.confirm === true) {
        await options.fs.writeTextFile(resolvedPath, stringifyYaml(proposed));
      }

      return {
        status: 200,
        body: {
          target: request.target,
          committed: request.confirm === true,
          diff: diffBody(diff),
          lines,
        },
      };
    },
  };
}

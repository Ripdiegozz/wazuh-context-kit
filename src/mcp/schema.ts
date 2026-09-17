/**
 * The `schema` resource handlers (SPEC "schema serves the published dataset
 * without network"; "Every schema response carries its provenance"; "A
 * dataset older than 30 days warns on every response").
 *
 * Plain functions over an already-loaded, already-verified dataset (design
 * "Testing splits in two" -- handler logic is tested directly, below the MCP
 * protocol boundary). `mcp/server.ts` (unit 6) is where these get wrapped by
 * `registerResource` and given a transport; nothing here knows about
 * `@modelcontextprotocol/*`.
 *
 * The refusal gates that decide whether a `DatasetLoaded` ever reaches this
 * module belong to `dataset.ts` (load, verify) and, for the world/ref gates,
 * unit 5's `startup.ts` -- this file only answers once startup has already
 * decided to serve.
 */

import {
  indexTemplatesOf,
  matrixOf,
  provenanceFor,
  wcsModulesOf,
  type Clock,
  type DatasetLoaded,
  type Provenance,
} from "./dataset.ts";
import type { IndexTemplate, MatrixJson, WcsModule } from "../matrix/types.ts";

/** A `schema` answer: provenance plus the requested slice of the dataset. */
export interface SchemaResponse<T> extends Provenance {
  readonly data: T;
}

export interface SchemaHandlers {
  readonly matrix: () => SchemaResponse<MatrixJson>;
  readonly indexTemplates: () => SchemaResponse<IndexTemplate[]>;
  readonly wcsModules: () => SchemaResponse<WcsModule[]>;
}

/**
 * Builds the `schema` handlers for one already-loaded dataset. Provenance is
 * computed once per call (not cached across calls) so a long-lived server
 * process re-evaluates staleness against the injected clock on every query,
 * rather than freezing the "as of" answer to the moment it started.
 */
export function schemaHandlers(loaded: DatasetLoaded, clock: Clock): SchemaHandlers {
  function wrap<T>(data: T): SchemaResponse<T> {
    return { ...provenanceFor(loaded.matrix, clock), data };
  }

  return {
    matrix: () => wrap(matrixOf(loaded)),
    indexTemplates: () => wrap(indexTemplatesOf(loaded)),
    wcsModules: () => wrap(wcsModulesOf(loaded)),
  };
}

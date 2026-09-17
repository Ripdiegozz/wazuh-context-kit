/**
 * `mcp/server.ts` — capability registration, at the composition edge (design
 * "The one structural decision", "Module layout").
 *
 * `docs` and `schema` are ALWAYS registered; `runtime` is registered ONLY
 * when `options.runtimeSnapshot` is not `null` (SPEC "`runtime` absent never
 * blocks `docs` or `schema`"; design "Unavailability is registration, not a
 * flag" -- there is no protocol-level way to mark one resource unavailable,
 * so `runtime`'s absence is encoded as "never call `registerResource`" for
 * it, which makes "`docs`/`schema` never see it" hold by construction).
 *
 * Every handler below is a thin adapter: the actual logic already lives in
 * `schema.ts`, `docs.ts` and `runtime.ts` (design "Testing splits in two" --
 * those modules carry the requirements and are tested directly, below the
 * protocol boundary). Nothing here decides a refusal gate; `startup.ts`
 * already ran by the time `buildMcpServer` is called (`cli.ts`'s `runMcp`).
 *
 * Telemetry is recorded on every read, unconditionally (`telemetry.ts`'s own
 * docblock: an absent sink is a no-op, never a call site that has to
 * remember to check) -- and never with query content, only
 * `(plugin, field, resolved)`.
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import type { Clock, DatasetLoaded } from "./dataset.ts";
import { schemaHandlers } from "./schema.ts";
import type { DocsFetchLike } from "./docs.ts";
import { fetchDocs } from "./docs.ts";
import type { RuntimeSnapshot } from "./runtime.ts";
import { runtimeHandlers } from "./runtime.ts";
import type { TelemetrySink } from "./telemetry.ts";
import type { Sources } from "../sources.ts";

const SCHEMA_URI = "schema://matrix";
const RUNTIME_URI = "runtime://snapshot";
/** `{+path}` is RFC 6570 reserved expansion -- lets `path` carry `/` (e.g. `getting-started/components/index`). */
const DOCS_URI_TEMPLATE = "docs://{ref}/{+path}";

export interface BuildMcpServerOptions {
  readonly dataset: DatasetLoaded;
  readonly clock: Clock;
  readonly sources: Sources;
  readonly docsTransport: DocsFetchLike;
  readonly telemetry: TelemetrySink;
  /** `null` means "no runtime backend" (SPEC scenarios); `runtime` is not registered. */
  readonly runtimeSnapshot: RuntimeSnapshot | null;
  readonly serverInfo?: { readonly name: string; readonly version: string };
}

const DEFAULT_SERVER_INFO = { name: "wazuh-context-kit", version: "0.1.0" };

/** Builds the wired `McpServer`. Caller (`cli.ts`'s `runMcp`) connects it to a transport. */
export function buildMcpServer(options: BuildMcpServerOptions): McpServer {
  const server = new McpServer(options.serverInfo ?? DEFAULT_SERVER_INFO, {
    capabilities: { resources: {} },
  });

  const schema = schemaHandlers(options.dataset, options.clock);

  server.registerResource(
    "schema",
    SCHEMA_URI,
    {
      title: "schema",
      description: "The published dataset (matrix, index templates, WCS modules), offline, with provenance.",
      mimeType: "application/json",
    },
    async () => {
      const response = schema.matrix();
      await options.telemetry.record({ plugin: "schema", field: "matrix", resolved: true });
      return {
        contents: [{ uri: SCHEMA_URI, mimeType: "application/json", text: JSON.stringify(response) }],
      };
    },
  );

  server.registerResource(
    "docs",
    new ResourceTemplate(DOCS_URI_TEMPLATE, { list: undefined }),
    {
      title: "docs",
      description: "On-demand Wazuh documentation for a mapped ref, citing the canonical HTML page.",
      mimeType: "text/markdown",
    },
    async (uri, variables) => {
      const ref = String(Array.isArray(variables.ref) ? variables.ref[0] : variables.ref);
      const rawPath = variables.path;
      const path = Array.isArray(rawPath) ? rawPath.join("/") : String(rawPath ?? "");

      const result = await fetchDocs(options.docsTransport, options.sources.docsVersionMap, { ref, path });
      await options.telemetry.record({ plugin: "docs", field: path, resolved: result.ok });

      if (!result.ok) {
        return { contents: [{ uri: uri.href, mimeType: "text/plain", text: result.message }] };
      }

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: `${result.markdown}\n\nSource: ${result.citationUrl}`,
          },
        ],
      };
    },
  );

  // Conditional registration IS the degradation mechanism (module doc): no
  // `if` anywhere else ever re-checks this. `docs`/`schema` above are
  // registered unconditionally, before this branch runs.
  if (options.runtimeSnapshot !== null) {
    const runtime = runtimeHandlers(options.runtimeSnapshot);

    server.registerResource(
      "runtime",
      RUNTIME_URI,
      {
        title: "runtime",
        description: "Live instance surface (configuration registry, effective roles) -- raw, unjudged.",
        mimeType: "application/json",
      },
      async () => {
        const response = runtime.snapshot();
        await options.telemetry.record({ plugin: "runtime", field: "snapshot", resolved: true });
        return {
          contents: [{ uri: RUNTIME_URI, mimeType: "application/json", text: JSON.stringify(response) }],
        };
      },
    );
  }

  return server;
}

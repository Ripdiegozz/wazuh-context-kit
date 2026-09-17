# Research: MCP TypeScript SDK v2 API Surface

Date: 2026-09-17
Scope: `@modelcontextprotocol/server@2.0.0` (v2 line), for a server exposing three
resources (`docs`, `schema`, `runtime`) — no tools. Node >= 22, bun build/test.

## Executive summary

- v2's server package uses `registerResource(name, uri, config, handler)` (static)
  or `registerResource(name, new ResourceTemplate(uriTemplate, opts), config, handler)`
  (dynamic), same shape as v1's method of the same name — the API did not change
  its arity across the version, only the package it lives in.
- stdio moved to a dedicated subpath: `@modelcontextprotocol/server/stdio`, versus
  v1's `@modelcontextprotocol/sdk/server/stdio.js`. Root barrel does not export it.
- `InMemoryTransport.createLinkedPair()` is **not** reachable from
  `@modelcontextprotocol/core` — confirmed by inspecting `core`'s published
  `exports` map, which has only `"."` and `"./internal"`. It is re-exported from
  both `@modelcontextprotocol/client` and `@modelcontextprotocol/server`, but the
  official testing guide itself still requires the `Client` class from
  `@modelcontextprotocol/client` to drive a round-trip test, and — more
  importantly — states that `createLinkedPair` only covers the legacy
  (2025-era) protocol, not the current 2026-07-28 revision this project would
  speak. Recommendation below.
- There is no protocol-level "mark this one resource unavailable" primitive.
  Capability is a package-level boolean (`resources: { listChanged: true|false }`),
  not per-resource. The conventional pattern is: don't register the resource at
  all when its backend is absent, or have its handler throw a protocol error
  (e.g. `ResourceNotFoundError`) when invoked.
- v2's `exports` map for `@modelcontextprotocol/server` is fully static (no `./*`
  wildcard subpaths), which is exactly the pattern whose absence caused bundler
  resolution failures in v1. No v2-specific bun bundling report was found, but
  the shape itself avoids the known v1 failure mode. Flagged as unverified in
  practice (no direct build attempt was run, per research-only constraint).
- Docs describe v2 as "the stable release line implementing the 2026-07-28 spec"
  and say v1 "continues to receive bug fixes and security updates for at least 6
  months after v2's release." No sentence explicitly says "use v2 for new
  projects," but the docs site's own default/home is the v2 docs, with v1 pushed
  to a separate archived subdomain — a structural signal, not a quoted directive.

---

## 1. Registering a resource

Source: `docs/servers/resources.md`, fetched from
`https://cdn.jsdelivr.net/gh/modelcontextprotocol/typescript-sdk@main/docs/servers/resources.md`.

Static resource:

```ts
server.registerResource(
    'config',
    'config://app',
    {
        title: 'Application Config',
        description: 'Application configuration data',
        mimeType: 'text/plain'
    },
    async uri => ({
        contents: [{ uri: uri.href, text: 'log_level=info\nregion=eu-west-1' }]
    })
);
```

Handler return shape — an object with a `contents` array; each item carries the
`uri` and either `text` or a base64 `blob`, plus optional `mimeType`:

```ts
{
    contents: [
        { uri: uri.href, mimeType: 'text/markdown', text: 'content here' },
        { uri: uri.href, mimeType: 'image/png', blob: 'base64data' }
    ]
}
```

Dynamic/templated resources use `ResourceTemplate`, imported alongside
`McpServer` from `@modelcontextprotocol/server`. `list: undefined` opts the
template out of enumeration (matches by pattern only); a `list` callback makes
matches discoverable:

```ts
new ResourceTemplate('users://{userId}/profile', { list: undefined })
// handler receives the matched variables as its second argument:
async (uri, { userId }) => ({ contents: [...] })

new ResourceTemplate('teams://{teamId}/roster', {
    list: async () => ({
        resources: [{ uri: 'teams://core/roster', name: 'Core team roster' }]
    })
})
```

The same doc also carries a security note directly relevant to a `docs`
resource that reads from disk: never pass a template variable or client-supplied
URI to a filesystem API unchecked — resolve with `realpath` and verify
containment before reading:

```ts
const requested = await realpath(path.join(DOCS_ROOT, String(file)));
if (!requested.startsWith(DOCS_ROOT + path.sep)) {
    throw new Error(`${uri.href} resolves outside the docs root`);
}
```

Note: one WebFetch pass over the v2 migration guide paraphrased a variant
requiring a `metadata` field on the config object (`{ metadata: {} }`). That
variant did **not** appear in the resources.md source fetched directly and is
almost certainly a summarization artifact of the fetch tool (it runs content
through a small intermediate model) rather than the real signature — treat the
resources.md example above (`title`/`description`/`mimeType`, no `metadata`
key) as authoritative since it came from the dedicated resources guide, not a
generic migration summary.

## 2. stdio transport in v2

Source: `docs/migration/upgrade-to-v2.md` (fetched twice via WebFetch,
consistent both times) —
`https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/main/docs/migration/upgrade-to-v2.md`.

> "stdio transports moved to a `./stdio` subpath. Import `StdioServerTransport`
> from `@modelcontextprotocol/server/stdio`. The package root barrels do **not**
> export these."

```ts
// v2
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { McpServer } from '@modelcontextprotocol/server';

const server = new McpServer({ name: 'wazuh-context-kit', version: '0.1.0' });
// ... registerResource calls ...
const transport = new StdioServerTransport();
await server.connect(transport);
```

Confirmed independently against the published `exports` map of
`@modelcontextprotocol/server@2.0.0` (fetched from
`https://cdn.jsdelivr.net/npm/@modelcontextprotocol/server@2.0.0/package.json`),
which lists an explicit `"./stdio"` export entry (ESM + CJS + types) alongside
`"."`, `"./validators/ajv"`, `"./validators/cf-worker"`, and `"./_shims"`.

**Difference from v1**: v1 exposes stdio at
`@modelcontextprotocol/sdk/server/stdio.js` (nested path, file extension
required in the specifier, `sdk` package root). v2 flattens this to a single
subpath segment off the dedicated `server` package: `@modelcontextprotocol/server/stdio`
(no `.js`, resolved through the `exports` map's conditions instead of a literal
file path).

## 3. InMemoryTransport reachability — core vs client vs server

This is the load-bearing question, so it was checked from the primary source:
the published `package.json` of `@modelcontextprotocol/core@2.0.0`, fetched
verbatim from `https://unpkg.com/@modelcontextprotocol/core@2.0.0/package.json`:

```json
"exports": {
  ".": { "import": {...}, "require": {...} },
  "./internal": { "import": {...}, "require": {...} }
},
"dependencies": { "zod": "^4.2.0" }
```

`core` exposes exactly two entry points — `.` and `./internal` — and its own
`docs`/type surface is schemas only (it is described in its own `description`
field as "public Zod schemas (spec + OAuth/OpenID)"). **`InMemoryTransport` is
not reachable from `@modelcontextprotocol/core`.** There is no transport code in
this package at all; it is schema-only, as its dependency list (zod alone) and
name already implied.

Per `docs/migration/upgrade-to-v2.md`:

> "`InMemoryTransport` is now exported from `@modelcontextprotocol/client` and
> `@modelcontextprotocol/server` (both re-export it). The two packages bundle
> separate copies with private state, so the halves of a linked pair must come
> from the **same package's** import."

So `@modelcontextprotocol/server` (already a dependency) does export
`InMemoryTransport`. However, `docs/testing.md` (fetched from
`https://cdn.jsdelivr.net/gh/modelcontextprotocol/typescript-sdk@main/docs/testing.md`)
shows the actually-recommended testing pattern still imports `Client` from
`@modelcontextprotocol/client` regardless of which transport is used:

> "Start from the `createServer` factory you ship... and pass `handler.fetch` as
> the client transport's `fetch` option." — using `Client` and
> `StreamableHTTPClientTransport`, both from `@modelcontextprotocol/client`.

> "`InMemoryTransport.createLinkedPair()` returns two transports that are each
> other's wire... [it] connects 2025-era instances only; `handler.fetch` is the
> in-process entry for 2026-07-28 coverage."

That is decisive on two counts:
1. `core` never had the helper; it lives in `client`/`server`, so the
   established fact that `core` is zod-only checks out and this is not a case
   of a hidden capability in the schema package.
2. Even the copy exported from `@modelcontextprotocol/server` is not the
   currently-recommended route for full protocol-version coverage —
   `createLinkedPair` is documented as a legacy (2025-era) shortcut.
   `handler.fetch` + `createMcpHandler` is the in-process entry for the current
   2026-07-28 revision, and that pattern still needs a real `Client` instance
   from `@modelcontextprotocol/client` to drive it.

**Recommendation**: add `@modelcontextprotocol/client` as a devDependency
(option a). This is not "the cheaper" option in isolation, but the SDK's own
documented in-process testing pattern for the current protocol revision
requires a `Client`/transport pairing from that package regardless — there is
no supported way to drive a real MCP round trip in-process using `core` or
`server` alone. Given the project only needs `client` at dev/test time (never
bundled into the shipped `dist/cli.ts` output), the cost is bounded to devDeps.
Combine it with option (b) as defense in depth, not as a substitute: unit-test
each resource handler directly (no protocol machinery at all) for fast,
granular coverage of the `docs`/`schema`/`runtime` logic, and keep exactly one
thin end-to-end test using `createMcpHandler` + `Client` +
`StreamableHTTPClientTransport` (or `handler.fetch`) to prove the wiring
(registration, capability advertisement, transport) actually works together.

## 4. Capability declaration and per-resource unavailability

Source: WebSearch results quoting `McpServer`'s capability handling (GitHub
issue #893, discussing `registerCapabilities`), corroborated by `docs/servers/resources.md`'s
subscription-capability section, and `docs/servers/errors.md`.

Resource capability is declared at the `McpServer` constructor or via
`registerCapabilities`, as a package-level flag, not a per-resource one:

```ts
{ capabilities: { resources: { listChanged: true } } }
// or, for subscriptions:
{ capabilities: { resources: { subscribe: true } } }
```

`docs/servers/resources.md` shows subscription tracking as an in-handler
concern (`server.setRequestHandler('resources/subscribe', ...)`,
`server.sendResourceUpdated(...)`), again scoped to the whole resources
capability, not one resource name.

`docs/servers/errors.md` (fetched via jsdelivr) confirms there is **no**
protocol-level mechanism to advertise one resource as degraded while keeping
capability enabled for the others:

> "A resource, prompt, or completion callback produces only protocol errors" —
> the document lists error codes/subclasses (e.g. `ResourceNotFoundError`) as
> the only per-request signal; it does not define a partial-capability or
> per-resource availability state.

**Conclusion — no protocol-level per-resource unavailable flag exists.** For
the `runtime` resource (optional, may lack a backend), the conventional
approaches are:
- Do not call `registerResource('runtime', ...)` at all when the runtime
  backend is absent — the resource simply does not appear in
  `resources/list`, and `docs`/`schema` are unaffected since capability and
  registration are independent per call.
- Or register it unconditionally but have its handler return an explicit
  "not available" payload (e.g. a `text` content item stating the runtime
  backend is absent) or throw `ResourceNotFoundError`/a protocol error when
  read — this keeps it discoverable but signals unavailability per-read
  rather than at listing time.

Given the requirement ("degrade to not available without blocking the other
two"), the cleaner option is conditional registration at server construction
time — `docs` and `schema` are always registered; `runtime` is registered only
if its backend is detected, otherwise skipped entirely. This needs zero
protocol-level support and cannot affect the other two resources by
construction.

## 5. Bundling with `bun build --target node`

Source: published `exports` map of `@modelcontextprotocol/server@2.0.0`
(fetched via jsdelivr, reproduced in full):

```
".", "./stdio", "./validators/ajv", "./validators/cf-worker", "./_shims"
```

Every entry is a fully static subpath with explicit `import`/`require`
conditions (both `.mjs`/`.d.mts` and `.cjs`/`.d.cts` supplied) — there is no
`"./*"` wildcard subpath pattern. This matters because a WebSearch pass
surfaced multiple **v1** bundling failures rooted exactly in that pattern:
v1's `@modelcontextprotocol/sdk` exports only allowed wildcard imports like
`./dist/esm/*`, and Node's/bundlers' extension resolution for those wildcard
targets caused `ERR_MODULE_NOT_FOUND`-class failures under strict ESM
resolution and under `bun build --compile` (see
`https://github.com/kubb-labs/kubb/issues/4051` and
`https://github.com/modelcontextprotocol/typescript-sdk/issues/709`, both
about v1's `@modelcontextprotocol/sdk`, not v2).

**No issue report specific to `@modelcontextprotocol/server@2.0.0` and bun
was found** in the search performed. The `./_shims` export's conditional
branches (`workerd`/`browser`/`node`/`default`) are the one part of the map
that depends on the *resolution condition* rather than the *subpath string*;
`bun build --target node` should select the `node` condition, which points to
`shimsNode.mjs`/`.cjs`, and the `default` branch also happens to point at the
same Node shim — so even a bundler that fails to recognize a `workerd` or
`browser` custom condition should still land on the Node-appropriate shim by
falling through to `default`. This is a structural inference from reading the
exports map, not a verified build — **flagged as unverified**: this research
task explicitly excluded running an actual `bun build` against the package.

No native modules or `dynamic require()` calls were found or claimed anywhere
in the fetched docs; the package is described throughout as pure
TypeScript/ESM+CJS dual-published, with platform-specific behavior isolated to
the `_shims` conditional export rather than runtime `require()` branching.

## 6. Stability signal — is v2 the documented default for new servers?

Sources: `docs/index.md` and `docs/migration/upgrade-to-v2.md`, both fetched
from `raw.githubusercontent.com`/`cdn.jsdelivr.net` mirrors of
`github.com/modelcontextprotocol/typescript-sdk`.

`docs/index.md`:

> "v2 is the stable release line implementing the 2026-07-28 spec."

> "Coming from v1 (`@modelcontextprotocol/sdk`) → **Upgrade**" (link to the
> migration guide), with a note that "if you need v1, its documentation is at
> ts.sdk.modelcontextprotocol.io."

`docs/migration/support-2026-07-28.md`'s existence, plus the dedicated
`docs/migration/upgrade-to-v2.md` guide and a shipped codemod
(`npx @modelcontextprotocol/codemod@latest v1-to-v2 .`), all read as v2 being
the actively maintained forward path, with v1 explicitly time-boxed:

> "v1.x continues to receive bug fixes and security updates for at least 6
> months after v2's release" (paraphrased from a WebFetch summarization pass
> over the migration guide; not confirmed as an exact quote against the raw
> source, flagged accordingly).

**No sentence found anywhere in the fetched docs explicitly says "use v2 for
new projects" or the inverse ("v2 not yet recommended for new servers").**
The structural evidence — v2 docs are the default at `docs/index.md`, v1 is
pushed to a separate legacy subdomain, a migration codemod exists, and v2
shipped as `2.0.0` (not a `0.x` or prerelease) after five betas per the
established facts — points toward v2 being the intended default for new work,
but this is inference from structure and package metadata, not a quoted
recommendation. Given the established facts state v2 published 2026-07-27
after five betas and reached a `2.0.0` (not prerelease) tag, and the docs site
itself defaults to v2, this project can reasonably treat v2 as the intended
line for new servers — but this should be understood as an inference, not a
verified explicit endorsement.

---

## Recommendation

**Depend on `@modelcontextprotocol/server@2.0.0`** (pulling in `@modelcontextprotocol/core@2.0.0`
and `zod`), matching the two established facts already measured (2 direct deps,
node >=20 compatible with this project's >=22 floor). Reasons:
- It is the actively documented, currently-versioned (`2.0.0`, post-beta) line,
  with v1 explicitly time-boxed for support and pushed to a legacy docs
  subdomain.
- Its `registerResource`/`ResourceTemplate` API directly fits the "resources,
  not tools" requirement with no workaround needed.
- Its `exports` map is fully static (no wildcard subpaths), which avoids the
  concrete class of v1 bundler-resolution failures found during this research
  — though this was not verified with an actual `bun build` run.

**Test strategy**:
- Add `@modelcontextprotocol/client@2.0.0` as a **devDependency** (not a
  runtime dependency — it will not appear in the `bun build --target node`
  output for `src/cli.ts`). It is required because the SDK's own documented
  in-process testing pattern for the current 2026-07-28 protocol revision
  (`createMcpHandler` + `handler.fetch`) still needs a real `Client` instance
  to drive requests; `createLinkedPair` (theoretically reachable from
  `@modelcontextprotocol/server` itself) is explicitly documented as a
  legacy/2025-era-only shortcut, not full coverage for the protocol version
  this project targets.
- Write direct unit tests against each resource handler function (`docs`,
  `schema`, `runtime`) below the protocol boundary — no transport, no client,
  just calling the async handler with a constructed `uri`/params and asserting
  on the returned `contents` shape. Bun's `bun:test` runner is sufficient here
  with no MCP-specific dependency at all.
- Keep exactly one thin end-to-end test that boots the real `McpServer`,
  registers all three resources (including the conditional `runtime` skip
  path), wraps it with `createMcpHandler`, and drives it with `Client` +
  `StreamableHTTPClientTransport`/`handler.fetch` from
  `@modelcontextprotocol/client`, to prove registration, capability
  advertisement, and transport wiring work end to end.
- For the `runtime`-resource degradation requirement, register it
  conditionally (only when its backend is detected) rather than relying on any
  protocol-level "unavailable" flag — none exists.

**What could not be verified** (stated plainly rather than guessed):
- No actual `bun build --target node` was run against
  `@modelcontextprotocol/server@2.0.0`; the "no known issue" conclusion in
  §5 is inferred from the `exports` map shape, not from a real build.
  Validate with a small spike before committing to it in design.
- The exact wording "v1.x continues to receive bug fixes and security updates
  for at least 6 months after v2's release" was returned by an intermediate
  WebFetch summarization pass, not confirmed against the raw markdown byte for
  byte. Treat that specific phrase as approximate, though the "v2 is the
  stable release line" quote in §6 was corroborated across two separate
  fetches of the same source.
- No explicit, quotable sentence recommending v2 over v1 for new servers (or
  the reverse) was located anywhere in the fetched documentation; §6's
  conclusion is structural inference, clearly labeled as such.

# `asInternalUser` audit: every call site, classified

> **Companion to** [`as-current-user.md`](./as-current-user.md), which explains why
> two unrelated permission systems both spell the accessor `asCurrentUser`. Read
> that page first; this page assumes it.
>
> **Purpose:** that page's list of "legitimate `asInternalUser`" uses was derived by
> reading call sites, not from a policy anyone agreed to. This page turns the
> implicit precedent into an explicit list a human can approve or reject, line by
> line.
>
> **Status:** proposed. Not policy until a maintainer signs it.
> **Scope of the audit:** `wazuh-dashboard-plugins@5.0.0` and
> `wazuh-security-dashboards-plugin@5.0.0` only.
> **Audited:** 2026-09-15/16, against the cached 5.0.0 checkouts.

## Counts

| Classification | Count |
|---|---|
| `system-by-design` | 14 |
| `suspicious` | 3 |
| `unclear` | 1 |
| **Total call sites** | **18** |

Plus 10 non-call-site matches (type declarations, plugin wiring, comments, one
name collision) itemised at the end, and 11 matches in 6 test files excluded.

## How much to trust this

Trust the **client identification** and the **operation** columns highly: both are
read directly off the object path and the method at the cited line, and the object
path is the reliable discriminator (`as-current-user.md`, "Telling them apart in
review"). Trust the **reachability** column moderately: every "reachable from a user
request" claim is backed by a route registration cited by file and line, but a
route being registered is not the same as knowing which OSD-level authentication
or authorization the deployment puts in front of it, and I did not verify that.
Trust the **classification** column least — it is a judgement, and the three
`suspicious` entries are exactly the ones where a maintainer could reasonably
disagree on the evidence rather than on the facts. Two specific soft spots are
named honestly below: the health-check task runner (`core.healthCheck`) is
implemented outside both checkouts, so I could not prove whether health-check
tasks are re-runnable on demand from an HTTP request; and one call site
(`cluster-uuid.ts:9`) is classified `unclear` because I could not read its route
registration before the cached checkouts were removed from disk. Nothing in this
page asserts a runtime behaviour I could not point at a line for.

## Summary table

Paths are relative to each checkout root. `OSD core` =
`core.opensearch.client` (indexer / OpenSearch Security RBAC). `wazuh-core` =
the Wazuh Server API client (Server API RBAC).

### `wazuh-dashboard-plugins@5.0.0`

| # | File : line | Client | Operation | Reachable from user request? | Class |
|---|---|---|---|---|---|
| 1 | `plugins/main/server/controllers/wazuh-api.ts:167` | `wazuh-core` (via `context.wazuh.api.client`) | `request('get', '/cluster/local/info')` on Server API host `id` | Yes — `POST /api/check-stored-api`, `plugins/main/server/routes/wazuh-api.ts:10-21` | `system-by-design` |
| 2 | `plugins/main/server/controllers/wazuh-api.ts:304` | `wazuh-core` | `request('GET', '/cluster/local/info')` on Server API host from `request.body.id` | Yes — `POST /api/check-api`, `plugins/main/server/routes/wazuh-api.ts:24-48` | `system-by-design` |
| 3 | `plugins/main/server/controllers/wazuh-api.ts:995` | OSD core | `transport.request({method:'GET', path:'/'})` — indexer cluster root, reads `cluster_uuid` | Yes — `GET /api/setup`, `plugins/main/server/routes/wazuh-api.ts:108-115` | **`suspicious`** |
| 4 | `plugins/main/server/controllers/wazuh-elastic.ts:113` | OSD core | `cat.templates()` — every index template in the cluster | Yes — `GET /elastic/template/{pattern}`, `plugins/main/server/routes/wazuh-elastic.ts:153-165` | **`suspicious`** |
| 5 | `plugins/main/server/health-check/index-patterns.ts:175` | OSD core | `cat.templates({format:'json'})` | No route found; runs as a registered health-check task (see §Evidence A) | `system-by-design` |
| 6 | `plugins/main/server/health-check/server-api.ts:51` | `wazuh-core` (`services.serverAPIClient`) | `request('GET', '/')` on Server API host `apiHostID` — reads `api_version` | No route found; health-check task `server-api:connection-compatibility` (§Evidence A) | `system-by-design` |
| 7 | `plugins/main/server/health-check/server-api.ts:125` | OSD core | passed to `checkCCS` → `transport.request GET /_remote/info` | No route found; same task as #6 | `system-by-design` |
| 8 | `plugins/main/server/health-check/server-api.ts:197` | OSD core | passed to `checkCCS` → `transport.request GET /_remote/info` | No route found; health-check task `server-api:run-as` (§Evidence A) | `system-by-design` |
| 9 | `plugins/main/server/lib/ccs-detector.ts:49` | OSD core | `transport.request GET /_remote/info` — remote-cluster list | Yes — three user-facing callers, see §Finding 3 | **`suspicious`** |
| 10 | `plugins/main/server/start/initialize/index.ts:51` | OSD core | `indices.putTemplate` on `WAZUH_PLUGIN_PLATFORM_TEMPLATE_NAME` for `<.kibana>*` | No — `jobInitializeRun` from `plugins/main/server/plugin.ts:802` inside `start()` | `system-by-design` |
| 11 | `plugins/main/server/start/initialize/index.ts:62` | OSD core | `indices.create({index: PLUGIN_PLATFORM_INDEX})` | No — same, `plugins/main/server/plugin.ts:802` | `system-by-design` |
| 12 | `plugins/main/server/start/initialize/index.ts:91` | OSD core | `indices.getTemplate` on the platform template | No — same, `plugins/main/server/plugin.ts:802` | `system-by-design` |
| 13 | `plugins/main/server/start/initialize/index.ts:111` | OSD core | `indices.exists({index: PLUGIN_PLATFORM_INDEX})` | No — same, `plugins/main/server/plugin.ts:802` | `system-by-design` |
| 14 | `plugins/wazuh-ai-assistant/server/plugin.ts:144` | OSD core (`CoreStart`) | passed to `runFieldDriftCanary` → `indices.getMapping` on the queried index families | No — `public start(core: CoreStart)` at `plugins/wazuh-ai-assistant/server/plugin.ts:126` | `system-by-design` |
| 15 | `plugins/wazuh-check-updates/server/services/cti-registration/cluster-uuid.ts:9` | OSD core (`getCore()` module singleton) | `transport.request({method:'GET', path:'/'})` — reads `cluster_uuid` as the CTI OAuth `client_id` | Could not establish — see §Finding 4 | **`unclear`** |
| 16 | `plugins/wazuh-core/server/services/manage-hosts.ts:257` | `wazuh-core` (`this.serverAPIClient`) | `request('GET', '/security/users/me')` — reads `allow_run_as` of the service account | Yes, indirectly — see §Evidence B | `system-by-design` |
| 17 | `plugins/wazuh-core/server/services/manage-hosts.ts:280` | `wazuh-core` | `request('GET', '/cluster/local/info')` — node/cluster name for the host registry | Yes, indirectly — see §Evidence B | `system-by-design` |

### `wazuh-security-dashboards-plugin@5.0.0`

| # | File : line | Client | Operation | Reachable from user request? | Class |
|---|---|---|---|---|---|
| 18 | `server/plugin.ts:206` | OSD core (`CoreStart`) | client handed to `createMigrationOpenSearchClient`, `setupIndexTemplate` and `migrateTenantIndices` against the OSD index | No — `public async start(core: CoreStart)` at `server/plugin.ts:191`, inside `if (config.multitenancy?.enabled)` at `server/plugin.ts:200` | `system-by-design` |

This checkout contains exactly one `asInternalUser` occurrence in total.

---

## Findings

Only non-`system-by-design` entries get a section. The `system-by-design` entries
that carry a caveat get one too, because the caveat is the part a maintainer
should be able to argue with.

### Finding 1 — `GET /api/setup` reads the indexer cluster root as the system (call site #3)

**Class: `suspicious`.**

`plugins/main/server/controllers/wazuh-api.ts:995`:

```ts
const osResp =
  await context.core.opensearch.client.asInternalUser.transport.request({
    method: 'GET',
    path: '/',
  });
const clusterUuid = osResp?.body?.cluster_uuid ?? null;
```

Route: `plugins/main/server/routes/wazuh-api.ts:108-115` registers
`GET /api/setup` with `validate: false`, handled by `ctrl.getSetupInfo`. The
handler returns `cluster_uuid` to the caller in its response body
(`wazuh-api.ts:1001-1006`).

**Concrete risk.** Any caller who reaches this route gets the indexer's
`cluster_uuid` regardless of whether their own OpenSearch Security role grants
the cluster-root read. The value itself is low-sensitivity — a cluster
identifier, not data — so this is a small leak, not a large one. What makes it
`suspicious` rather than fine is that it is a plain user-facing route with a
`context` in hand, and `context.core.opensearch.client.asCurrentUser` was
available on the same object one property away. There is no comment at the call
site justifying the choice, which is the condition `as-current-user.md`
("Choosing, in practice") sets for a legitimate `asInternalUser`.

**Argument for overruling me.** If the deployment intends `/api/setup` to work
for every authenticated dashboard user including ones with no indexer cluster
permissions, `asCurrentUser` would make `cluster_uuid` come back `null` for
those users and the setup panel would degrade. That is a real design reason. If
the maintainer accepts it, the fix is a justifying comment, not a client change.

### Finding 2 — `GET /elastic/template/{pattern}` enumerates all cluster templates as the system (call site #4)

**Class: `suspicious`.** This is the strongest of the three.

`plugins/main/server/controllers/wazuh-elastic.ts:113`:

```ts
const data =
  await context.core.opensearch.client.asInternalUser.cat.templates();
```

Route: `plugins/main/server/routes/wazuh-elastic.ts:153-165` registers
`GET /elastic/template/{pattern}` with `pattern` as a free-form
`schema.string()`, handled by `ctrl.getTemplate`.

**Concrete risk.** `cat.templates()` with no argument returns *every* index
template in the cluster. The handler then matches the user-supplied `pattern`
against that list (`wazuh-elastic.ts:120-135`) and reports back whether a
template covering it exists. A user whose OpenSearch Security role grants them
no template-read permission at all can therefore use this route as an oracle:
supply any pattern, learn whether the cluster has a template for it. That is
index-namespace enumeration across tenants the user may have no business
knowing about. Neither the cluster-wide fetch nor the match is constrained by
the caller's permissions at any point.

**Mitigating evidence, stated plainly.** The route registration is preceded by a
maintainer comment at `plugins/main/server/routes/wazuh-elastic.ts:153`:

```
// TODO: this seems that is unused and could be removed
```

So this may be dead surface. "Probably unused" is not the same as "not
registered", and it *is* registered. If it is genuinely unused, deleting the
route closes the finding more cleanly than switching the client.

### Finding 3 — cross-cluster-search detection runs as the system inside three user routes (call site #9)

**Class: `suspicious`, and the one I am least sure about.**

`plugins/main/server/lib/ccs-detector.ts:49`:

```ts
const isCCS = await checkCCS(context.core.opensearch.client.asInternalUser);
```

`checkCCS` (`plugins/main/server/lib/ccs-detector.ts:24-34`) issues
`GET /_remote/info`, which returns the cluster's configured remote clusters
including their seed node addresses.

Three user-facing callers, all taking a per-request `context`:

- `plugins/main/server/controllers/wazuh-hosts.ts:44` — in `getHostsEntries`
- `plugins/main/server/controllers/wazuh-hosts.ts:67` — in `getCCSStatus`, which
  first calls `invalidateCCSCache()` at line 66, so a user request can force a
  fresh privileged `GET /_remote/info`
- `plugins/main/server/controllers/wazuh-api.ts:53` — in `resolveHostId`, reached
  from `checkStoredAPI` (`wazuh-api.ts:147`) and `getToken` (`wazuh-api.ts:70`),
  i.e. from `POST /api/check-stored-api` and `POST /api/login`
  (`plugins/main/server/routes/wazuh-api.ts:20` and `:50-61`)

**Concrete risk.** The `_remote/info` body itself never crosses back to the
user — only a boolean does. But the boolean is load-bearing at
`plugins/main/server/controllers/wazuh-hosts.ts:44-51`: when `isCCS` is true the
handler returns *all* configured Server API host entries; when false it returns
only `result[0]`. So a system-privileged read decides how many API hosts a user
is shown. The exposure is therefore "which hosts appear in my host list",
decided by a cluster property the user may not be permitted to read, rather than
raw remote-cluster topology.

Secondary observation, worth a maintainer's eye independently of the client
choice: the cache at `plugins/main/server/lib/ccs-detector.ts:22` is a
module-level singleton with a 60 s TTL
(`plugins/main/server/lib/ccs-detector.ts:15`), shared process-wide across all
users. Since what it caches is a system-scoped cluster property, that is
consistent — but it also means one user's `getCCSStatus` call
(`wazuh-hosts.ts:66-67`) invalidates and repopulates the value every other
user's request then reads.

**Argument for overruling me.** `cluster:monitor/remote/info` is a cluster-level
permission that ordinary Wazuh dashboard users would not normally hold. Under
`asCurrentUser`, `checkCCS` would throw for them, the `catch` at
`ccs-detector.ts:50` would cache `isCCS: false`, and CCS deployments would
silently show every non-privileged user a single host. That is a worse failure
than the leak. If the maintainer accepts that reasoning, this becomes
`system-by-design` — but it should then say so in a comment at the call site,
because right now nothing at `ccs-detector.ts:49` records the decision.

### Finding 4 — CTI cluster-UUID fetch: caller chain incomplete (call site #15)

**Class: `unclear`.**

`plugins/wazuh-check-updates/server/services/cti-registration/cluster-uuid.ts:9`:

```ts
const clusterResp =
  await getCore().opensearch.client.asInternalUser.transport.request({
    method: 'GET',
    path: '/',
  });
```

**What I could establish.** The client is OSD core, reached through the
plugin's `getCore()` module singleton (`../../plugin-services`) rather than
through a request `context` — so no per-request `asCurrentUser` is available at
this line without threading one in. The operation is the indexer cluster root,
read for `cluster_uuid`. Its only non-test caller is
`plugins/wazuh-check-updates/server/services/cti-registration/token.ts:31`,
inside `resolveCtiOAuthClientId`, which uses the UUID as the OAuth `client_id`
for CTI environment registration and only falls through to it when neither a
request-body override nor `process.env.WAZUH_CTI_CLIENT_ID` is set
(`token.ts:19-37`).

**What I could not establish.** Whether `resolveCtiOAuthClientId` is invoked
from a registered HTTP route, and if so which one and with what validation. The
existence of `plugins/wazuh-check-updates/server/routes/cti-registration/token.test.ts`
(which mocks `fetchClusterUuid` at line 44) is strong circumstantial evidence
that a route module sits beside it, but I did not read that route file before
the cached checkouts were removed from disk, and a test file is not a route
registration.

**What would settle it.** Read
`plugins/wazuh-check-updates/server/routes/cti-registration/token.ts` (and
`plugins/wazuh-check-updates/server/routes/index.ts`) and check whether
`resolveCtiOAuthClientId` is reached from a `router.get`/`router.post` handler.
If it is, this call site becomes the same shape as Finding 1 — user-triggered,
system-credentialed read of the indexer cluster root — and should be classified
the same way as #3, whatever that turns out to be. If it is only reached from a
startup or scheduled path, it is `system-by-design` and the `getCore()` singleton
is the right accessor.

### Caveat on the four health-check call sites (#5, #6, #7, #8) — `system-by-design`, conditionally

I classified these `system-by-design`, but a maintainer should know exactly how
far the evidence goes.

**What is solid.** All four run inside task objects handed to
`core.healthCheck.register(...)` from `plugins/main/server/plugin.ts`:

- `plugins/main/server/plugin.ts:760-765` registers
  `initializationTaskCreatorServerAPIConnectionCompatibility` as
  `server-api:connection-compatibility` — this is the task containing #6 and #7
  (`plugins/main/server/health-check/server-api.ts:137-175`)
- `plugins/main/server/plugin.ts:768-773` registers
  `initializationTaskCreatorServerAPIRunAs` as `server-api:run-as` — the task
  containing #8 (`plugins/main/server/health-check/server-api.ts:178-210`)
- `plugins/main/server/plugin.ts:781-787` registers
  `initializationTaskCreatorIndexPatternBatch` — the batch that reaches #5 via
  `ensureIndexPatternHasTemplate`, called at
  `plugins/main/server/health-check/index-patterns.ts:275`

No `router.get`/`router.post` in either checkout registers a route that calls any
of these task creators; I searched for one and found none.

**What is not solid.** `core.healthCheck` is a *server-side core service* that is
defined in neither of the two audited checkouts. I looked for it and could not
find its implementation: the only `healthCheck` surface I located was a
client-side `core.healthCheck` consumed by the OSD `healthcheck` plugin's public
code, plus a `healthcheck` server plugin whose `setup()` calls `defineRoutes` —
i.e. health-check results are plainly exposed over HTTP, and I could not rule
out that the *runner* is re-triggerable by a user request.

**Why I classified them `system-by-design` anyway, and where to attack that.**
Even if a user can re-trigger a health check, what these four calls read are
system properties, not user data: "is the index template installed", "what
version is the Server API", "does this cluster have remotes configured". The
answer does not and should not vary by who asked; running them as the asking
user would make the health check report a *per-user* health, which is not what
a health check is for. The place to attack this classification is not the
client choice but the exposure: if a health-check task's *result payload* is
returned verbatim to a user over HTTP, then #6's `api_version` and #5's
template names reach a user who may not be entitled to them, and that is worth
a separate look at the health-check result API rather than at these four lines.

### Caveat on `manage-hosts.ts` (#16, #17) — `system-by-design`, with a reachability note

**Evidence B.** `getRegistryDataByHost`
(`plugins/wazuh-core/server/services/manage-hosts.ts:241`) is declared `private`,
and has two in-class callers on background paths:

- `plugins/wazuh-core/server/services/manage-hosts.ts:201`
- `plugins/wazuh-core/server/services/manage-hosts.ts:333`

reached from `manageHosts.start()`, which `wazuh-core`'s `start()` deliberately
does not await (`plugins/wazuh-core/server/plugin.ts:129-135`, with the comment
citing issue #8085).

But it is also called from two user-facing handlers across the plugin boundary,
where the TypeScript `private` modifier does not apply because the object
arrives through the loosely-typed route handler context:

- `plugins/main/server/controllers/wazuh-api.ts:187` — in `checkStoredAPI`,
  route `POST /api/check-stored-api` (`plugins/main/server/routes/wazuh-api.ts:10-21`)
- `plugins/main/server/controllers/wazuh-api.ts:330` — in `checkAPI`,
  route `POST /api/check-api` (`plugins/main/server/routes/wazuh-api.ts:24-48`)

So a user request *can* drive `GET /security/users/me` and
`GET /cluster/local/info` on the Server API under the dashboard's own service
account.

**Why still `system-by-design`.** `GET /security/users/me` here is asking a
question *about the service account itself* — specifically whether the
dashboard's own Server API user is permitted to `run_as`
(`manage-hosts.ts:257-276`, storing into `API_USER_STATUS_RUN_AS`). Under
`asCurrentUser` this call would return the *logged-in user's* run-as
capability, which is a different fact and would populate the host registry with
the wrong value. This is the clearest case in the audit where `asCurrentUser`
would not merely restrict the answer, it would answer a different question.
`GET /cluster/local/info` at line 280 populates the same registry record in the
same pass.

**Worth flagging separately from the classification:** a method marked `private`
is being called from another plugin. That is a typing gap, not a privilege bug,
but it means the background/foreground boundary here is weaker than the source
reads.

### Caveat on `checkStoredAPI` / `checkAPI` (#1, #2) — `system-by-design` on a bootstrap argument

Both are unambiguously in user-facing routes
(`plugins/main/server/routes/wazuh-api.ts:10-21` and `:24-48`), so this is a
judgement call, not a reachability question.

**Why `system-by-design`.** These two handlers exist to answer "is this
configured Server API host reachable and credentialed correctly". They sit in
the same route file as, and logically before, `POST /api/login`
(`plugins/main/server/routes/wazuh-api.ts:50-61` → `ctrl.getToken`). Per
`as-current-user.md`, `wazuh-core`'s `asCurrentUser` is a scoped client that
reads the user's `wz-token` cookie (`server-api-client.ts:516`). At
connectivity-check time that cookie may not exist yet, so `asCurrentUser` has no
credential to use. Checking that the dashboard's *own* stored credential works
is, correctly, a question about the system's credential.

**Argument for overruling me.** `checkStoredAPI` does not stop at a boolean: it
returns `api.cluster_info` — the Server API's node and cluster names — in its
response body (`plugins/main/server/controllers/wazuh-api.ts:195-203`). So any
caller who reaches `POST /api/check-stored-api` learns the cluster and node
naming of a configured Wazuh Server, obtained with the service account. If a
maintainer judges that cluster/node names should be gated on Server API RBAC,
these two flip to `suspicious` and the fix is to narrow the response body rather
than to change the client, since the bootstrap argument for the client itself
still holds.

---

## Non-call-sites, itemised rather than dropped

None of these execute a privileged request; all are reported so the list is
auditable against a fresh `rg asInternalUser`.

**Type declarations and interface members (7):**

| File : line | What |
|---|---|
| `plugins/wazuh-core/server/services/server-api-client.ts:80` | `private asInternalUser: ServerAPIInternalUserClient` — field declaration |
| `plugins/wazuh-core/server/services/server-api-client.ts:102` | `this.asInternalUser = { ... }` — construction of the client object |
| `plugins/wazuh-core/server/types.ts:22` | interface member |
| `plugins/wazuh-core/server/types.ts:40` | interface member |
| `plugins/main/server/plugin.ts:163` | `declare module` augmentation of `RequestHandlerContext.wazuh.api.client` |
| `plugins/wazuh-ai-assistant/server/wazuh-core.d.ts:116` | hand-written local declaration (the "witness case" in `as-current-user.md`) |

**Plugin wiring — exposes the client, does not call it (3):**

| File : line | What |
|---|---|
| `plugins/wazuh-core/server/plugin.ts:99` | exposed on the `wazuh_core` route handler context |
| `plugins/wazuh-core/server/plugin.ts:114` | returned from `setup()` |
| `plugins/wazuh-core/server/plugin.ts:142` | returned from `start()` |

**Comments only (4 lines, 3 files):**
`plugins/wazuh-ai-assistant/common/constants.ts:58`,
`plugins/wazuh-ai-assistant/server/plugin.ts:133`,
`plugins/wazuh-ai-assistant/server/tools/field-drift-canary.ts:121` and `:122`.

**Name collision, not this API (3 lines, 1 file):**
`plugins/main/public/components/security/roles-mapping/helpers/rule-editor.helper.ts:72`,
`:94`, `:109` — a local function `hasInternalUsers` about Wazuh security
role-mapping rules. Client-side, unrelated.

## Excluded test files

**11 matching lines across 6 test files, all in `wazuh-dashboard-plugins@5.0.0`.**
Zero excluded from `wazuh-security-dashboards-plugin@5.0.0`, which has exactly
one `asInternalUser` occurrence in total (call site #18). No mock or fixture
files matched the search; every exclusion is a `*.test.ts` file.

| File | Matching lines |
|---|---|
| `plugins/main/server/health-check/server-api.test.ts` | 1 (`:63`) |
| `plugins/main/server/lib/ccs-detector.test.ts` | 4 (`:14`, `:62`, `:82`, `:101`) |
| `plugins/wazuh-ai-assistant/server/settings/ai-providers-client.test.ts` | 1 (`:24`) |
| `plugins/wazuh-ai-assistant/server/settings/index-settings-provider.test.ts` | 1 (`:25`) |
| `plugins/wazuh-ai-assistant/server/settings/ism-settings-provider.test.ts` | 1 (`:24`) |
| `plugins/wazuh-core/server/services/manage-hosts.test.ts` | 3 (`:36`, `:65`, `:153`) |

All eleven are mock client stubs or assertions on mocks. One is worth a note
rather than silence: the three `wazuh-ai-assistant/server/settings/*.test.ts`
files mock an `asInternalUser` client, but their corresponding *sources* contain
no `asInternalUser` — the only client accessor in
`plugins/wazuh-ai-assistant/server/settings/` is
`context.core.opensearch.client.asCurrentUser`, at
`plugins/wazuh-ai-assistant/server/settings/opensearch-user.ts:19` and `:25`.
The tests mock a broader client shape than the code uses. That is a test-fixture
inaccuracy, not a privilege issue, but it would mask a future regression if a
settings provider ever switched accessors.

## What a reader must check that I could not

1. **The health-check runner's trigger and result exposure.** `core.healthCheck`
   is a server-side core service implemented outside both audited checkouts, so
   I could not determine whether registered tasks are re-runnable on demand from
   an HTTP request, nor whether task *results* are returned to users. This
   affects call sites #5, #6, #7 and #8. The question to answer is not "which
   client" but "does a user see `api_version` and template names in a
   health-check result payload".

2. **`plugins/wazuh-check-updates/server/routes/cti-registration/token.ts`.**
   Unread. It decides whether call site #15 is user-triggered, which decides its
   classification. This is the single cheapest item on this list to close.

3. **Deployment role definitions.** Every `suspicious` verdict here assumes that
   some real deployment has users whose OpenSearch Security role does *not*
   grant `cluster:monitor/main`, `cluster:monitor/remote/info`, or template
   reads. If every user in every supported deployment is effectively a cluster
   admin, all three findings are theoretical. Conversely, if tenant-isolated
   read-only roles are a supported configuration, Finding 2 is a real
   cross-tenant enumeration path. Nothing in these two checkouts answers this.

4. **Whether `GET /elastic/template/{pattern}` is actually dead.** The route is
   registered (`plugins/main/server/routes/wazuh-elastic.ts:153-165`) and a
   maintainer comment on line 153 guesses it is unused. Confirming that from
   client-side callers or from access logs converts Finding 2 from "fix the
   client" into "delete the route".

5. **OSD-level authentication in front of the cited routes.** Every "reachable
   from a user request" claim in this page shows a route registration, not an
   authorization check. Whether `GET /api/setup`, `GET /elastic/template/{pattern}`
   and the `/api/check-*` routes require an authenticated session — and with what
   minimum privilege — is decided by the security plugin's configuration and by
   OSD core, both outside the classification scope here.

6. **Re-verification against a fresh checkout.** The cached checkouts were
   removed from disk part-way through this audit. Every line number above was
   read directly from source before that happened, and none is reconstructed from
   memory of a different version — but nothing here has been re-confirmed against
   a re-fetched `5.0.0`, and a reviewer signing this as policy should re-run
   `rg -n asInternalUser` over both checkouts and confirm the count of 18 call
   sites, 10 non-call-sites and 11 excluded test lines still holds.

# `asInternalUser` audit: every call site, classified

> **Precision corrected 2026-09-17, on the maintainer's reading.** An earlier
> draft of this audit described `asInternalUser` as running "with system
> credentials" and "bypassing RBAC". Both are wrong in a way that matters.
>
> - `asCurrentUser` — the user logged into the session.
> - `asInternalUser` — **the user configured in the application's configuration**.
>
> It does not bypass RBAC. It runs as a *different principal*, which has its own
> RBAC, and whose permissions are whatever an administrator configured — broad in
> a typical deployment, but configured rather than inherent.
>
> That changes how the findings below should be read. A finding is not "this code
> escapes permissions"; it is "this code answers as somebody else". Whether that
> somebody else can see more than the caller depends on the deployment, which is
> why every finding names what it reads rather than asserting an impact.

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

| Classification | Count | First draft |
|---|---|---|
| `system-by-design` | 15 | 14 |
| `suspicious` | 1 | 3 |
| `low` | 1 | — |
| `unclear` | 1 | 1 |
| **Total call sites** | **18** | **18** |

**Two findings moved on re-reading**, after the maintainer corrected this
audit's central framing. `asInternalUser` is *the user configured in the
application's configuration*, not "the system", and it does not bypass RBAC — it
answers as a different principal with its own. Once the question stops being
"does this escape permissions?" and becomes "who answers, and what do they hand
back?", two of the three suspicious findings read differently:

- **`/api/setup`** → `low`. A fixed, non-parameterised read returning one
  identifier the caller cannot influence.
- **CCS detection** → `system-by-design`. It asks a question about the
  *installation*; under `asCurrentUser` it would fail closed and silently
  misroute every unprivileged user in exactly the deployments it exists for.
- **`/elastic/template/{pattern}`** stays `suspicious`, but the earlier claim
  that it "enumerates all cluster templates" was wrong about what the caller
  receives. It returns one bit. It is a probing oracle, not a dump.

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
| 3 | `plugins/main/server/controllers/wazuh-api.ts:995` | OSD core | `transport.request({method:'GET', path:'/'})` — indexer cluster root, reads `cluster_uuid` | Yes — `GET /api/setup`, `plugins/main/server/routes/wazuh-api.ts:108-115` | **`low`** |
| 4 | `plugins/main/server/controllers/wazuh-elastic.ts:113` | OSD core | `cat.templates()` — reads every index template; returns only a found/not-found bit | Yes — `GET /elastic/template/{pattern}`, `plugins/main/server/routes/wazuh-elastic.ts:153-165` | **`suspicious`** |
| 5 | `plugins/main/server/health-check/index-patterns.ts:175` | OSD core | `cat.templates({format:'json'})` | No route found; runs as a registered health-check task (see §Evidence A) | `system-by-design` |
| 6 | `plugins/main/server/health-check/server-api.ts:51` | `wazuh-core` (`services.serverAPIClient`) | `request('GET', '/')` on Server API host `apiHostID` — reads `api_version` | No route found; health-check task `server-api:connection-compatibility` (§Evidence A) | `system-by-design` |
| 7 | `plugins/main/server/health-check/server-api.ts:125` | OSD core | passed to `checkCCS` → `transport.request GET /_remote/info` | No route found; same task as #6 | `system-by-design` |
| 8 | `plugins/main/server/health-check/server-api.ts:197` | OSD core | passed to `checkCCS` → `transport.request GET /_remote/info` | No route found; health-check task `server-api:run-as` (§Evidence A) | `system-by-design` |
| 9 | `plugins/main/server/lib/ccs-detector.ts:49` | OSD core | `transport.request GET /_remote/info` — remote-cluster list; result never returned, decides host routing | Yes — three user-facing callers, see §Finding 3 | `system-by-design` |
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

### Finding 1 — `GET /api/setup` reads the indexer cluster root as the configured internal user (call site #3)

**Class: `low`** — downgraded from `suspicious` on re-reading, see below.

`plugins/main/server/controllers/wazuh-api.ts:993-1006`:

```ts
const osResp =
  await context.core.opensearch.client.asInternalUser.transport.request({
    method: 'GET', path: '/',
  });
const clusterUuid = osResp?.body?.cluster_uuid ?? null;
```

The response body to the session user carries `app-version`, `revision`,
`configuration_file` and `cluster_uuid`.

**What it actually is.** A fixed, non-parameterised read of the indexer root,
returning one identifier. The session user cannot influence what is read. Under a
restrictive OpenSearch Security configuration a user who could not read `/`
themselves learns `cluster_uuid` — a low-value identifier, not data.

**Why it was over-stated before.** The earlier draft leaned on "runs as the
system", which invited reading this as a privilege escape. It is not: it answers
as the configured account, and what it returns is one fixed field.

**Worth a maintainer's eye anyway**, for two reasons the call site itself shows:
`asCurrentUser` is one property away with no comment explaining the choice; and
the same response returns `configuration_file`, a filesystem path, which is
arguably more interesting than the UUID and which this audit did not originally
flag at all.

### Finding 2 — `GET /elastic/template/{pattern}` answers an existence question using templates the caller may not see (call site #4)

**Class: `suspicious`.** The strongest of the three, and weaker than the earlier
draft claimed.

`plugins/main/server/controllers/wazuh-elastic.ts:112-113` calls
`cat.templates()` **with no argument**, so the configured internal user reads
every index template in the cluster. Route:
`plugins/main/server/routes/wazuh-elastic.ts:154-165`, `GET
/elastic/template/{pattern}` with `pattern: schema.string()`.

**Correction to the earlier draft.** It said this "enumerates all cluster
templates". That is wrong about what the caller receives. The enumeration happens
*inside* the handler; the response is one bit:

```ts
return isIncluded && ... .length
  ? response.ok({ body: { status: true,  data: `Template found for ${pattern}` } })
  : response.ok({ body: { status: false, data: `No template found for ${pattern}` } });
```

So it is a **probing oracle**, not a dump: a caller with no template permissions
can test, one guess at a time, whether a template matching a pattern exists.

**And the matching is very loose**, which cuts both ways:

```ts
return item.includes(pattern) || pattern.includes(item);
```

Substring in *both* directions, after stripping a trailing `*`. A short or empty
pattern matches almost everything, so the oracle answers "found" to most inputs —
which makes it poor at probing and also means the endpoint's own answer is close
to meaningless.

**The cheapest resolution is not in this code.** `routes/wazuh-elastic.ts:153`
carries the maintainer's own comment:

```
// TODO: this seems that is unused and could be removed
```

If that is right, deleting the route closes the finding without touching the
client. Confirming whether anything calls it is a smaller job than reasoning
about the accessor.

### Finding 3 — cross-cluster-search detection reads cluster topology (call site #9)

**Class: `system-by-design`** — reclassified from `suspicious`, see below.

`plugins/main/server/lib/ccs-detector.ts:49` calls `checkCCS` with the configured
internal user, caching the result. The boolean decides, at
`plugins/main/server/controllers/wazuh-api.ts:52-59`, whether the session's
chosen host id is honoured or the request falls back to the first configured
host. The boolean itself is never returned to the caller.

**Why it moves.** "Is this a cross-cluster-search deployment?" is a property of
the *installation*, not of the user, and `_remote/info` is ordinarily not
readable by an unprivileged account. Under `asCurrentUser` the call would throw
for most users, be caught, and cache `false` — silently routing every
non-privileged user to the wrong API host in exactly the deployments CCS exists
for. That failure is worse than the thing the reclassification gives up.

**Where to attack this reasoning.** The boolean is not returned, but its
*consequence* is user-visible: which host answers. A maintainer who considers the
routing difference itself to be information disclosure would keep this at
`suspicious`, and that is a defensible position this audit does not hold.

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

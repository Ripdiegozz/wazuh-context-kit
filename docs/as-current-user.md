# `asCurrentUser`: two APIs, one name

> **Audience:** anyone writing server-side code in a Wazuh dashboard plugin.
> **Status:** hand-written prose. This is the one page `wazuh-ctx` cannot
> generate, because the fact it carries is not declared anywhere — it lives in
> how two independent codebases happened to name their methods.
> **Owner:** _unassigned._ This page needs one. See the end.

## The one-sentence version

There are two completely unrelated permission systems in a Wazuh dashboard
plugin, and the accessor for "act as the logged-in user" is spelled
`asCurrentUser` in both.

```ts
context.core.opensearch.client.asCurrentUser   // indexer RBAC   (OpenSearch Security)
context.wazuh_core.api.client.asCurrentUser    // Server API RBAC (Wazuh Server)
```

Pick the wrong one and your code still compiles, still runs, still passes
review, and enforces a permission system you were not thinking about.

## Why this page exists

Reaching for `asInternalUser` when you meant `asCurrentUser` is a security bug
that behaves perfectly in development. There is no error, no warning, no failing
test. In dev you are usually an admin, so the two produce identical output. The
difference only appears in production, for a user whose permissions are narrower
than yours — which is to say, it appears as a data leak rather than as a bug
report.

That hazard is well understood. What this page adds is the part that is not:
**the danger is not `asScoped` versus `asInternalUser`. It is that both systems
expose `asCurrentUser`.**

Evidence for that framing, from the repositories as they stand:

- `wazuh-core`'s own `asScoped` is called **exactly once** in the entire
  `wazuh-dashboard-plugins` repository — `wazuh-core/server/plugin.ts:100` —
  and that call is internal wiring. No downstream consumer calls it.
- Plugins never call OpenSearch Dashboards' `.asScoped()` either. The platform
  does it for them, per request.
- Every consumer of either system calls `asCurrentUser`.

A page about `asScoped` would document a method almost nobody invokes, and leave
the collision that actually bites completely untouched.

## The two systems

### 1. OpenSearch Dashboards core — indexer RBAC

```ts
context.core.opensearch.client.asCurrentUser   // the user logged into the session
context.core.opensearch.client.asInternalUser  // the user set in the app's configuration
```

This governs what the **indexer** will return. `asCurrentUser` runs the query
under the session user's own OpenSearch Security principal, so document-level
and field-level security apply.

`asInternalUser` runs it as **the account an administrator configured in the
application's configuration**. Say it that way rather than "as the system": it
does not bypass RBAC, it answers as a *different principal* that has its own
RBAC. Its reach is whatever that account was granted — broad in a typical
deployment, but configured rather than inherent.

The distinction is not pedantry. "Bypasses permissions" invites you to look for
an escape hatch; "answers as somebody else" tells you the actual question, which
is *who* that somebody is in the deployment you are reasoning about. Two
installations can run identical code and give this accessor very different
reach.

Applies to **both worlds** — Wazuh-native plugins and upstream forks alike.

### 2. `wazuh-core` — Wazuh Server API RBAC

```ts
context.wazuh_core.api.client.asCurrentUser   // the logged-in user
context.wazuh_core.api.client.asInternalUser  // the dashboard's service account
```

This governs what the **Wazuh Server API** will return — agents, groups,
rulesets, configuration. A completely separate permission model, with separate
roles and separate policies. It has nothing to do with OpenSearch Security.

Applies to **Wazuh-native plugins only** (World A).

`main` re-exposes this under `context.wazuh.api.client` as well
(`plugins/main/server/plugin.ts:161-179`), so the same object arrives under two
different names depending on which plugin you are in. Both are the Server API,
neither is the indexer.

## How each one gets its credential

This is the part worth actually understanding, because it explains why the
mistake is invisible.

**`wazuh-core`'s `asScoped(context, request)`**
(`wazuh-core/server/services/server-api-client.ts:491-520`) returns a client
whose every request sets:

```ts
token: getCookieValueByName(request.headers.cookie, 'wz-token')   // line 516
```

The user's own Server API session token, read from a cookie on the incoming
request. If run-as is enabled for that host, `authenticate()` additionally
passes `useRunAs: true` with the current user's auth context (lines 496-505).

**`wazuh-core`'s `asInternalUser`** (constructed at lines 102-111, executed by
`_requestAsInternalUser` at 530-552) authenticates once through
`_authenticateInternalUser` with `useRunAs: false` (line 479), caches the
resulting token per `apiHostID`, and refreshes it on a 401. That is the
dashboard's own service account. It is not tied to any request, and it does not
care who is logged in.

The service's own doc comment (lines 22-27) states the contract:

> Every other header — most importantly `Authorization` — is decided by this
> service, so a caller can never choose the credential that is used upstream.

Which is exactly right, and exactly why the choice of *accessor* is the whole
decision. You cannot fix a wrong `asInternalUser` downstream by passing a
header. The accessor is the credential.

A practical consequence that has already confused people: call sites using the
scoped Server API client **omit `token` entirely**, because the closure injects
it. Code that looks like it forgot to authenticate is usually correct, and code
that passes an explicit token is usually the suspicious one.

## Telling them apart in review

The accessor name is useless. Read the **object path**, not the method:

| If the path contains | It is | Permission system |
|---|---|---|
| `core.opensearch.client` | OSD core | indexer / OpenSearch Security |
| `opensearchClient` | OSD core | indexer / OpenSearch Security |
| `wazuh_core.api.client` | `wazuh-core` | Wazuh Server API |
| `wazuh.api.client` | `wazuh-core`, re-exposed by `main` | Wazuh Server API |
| `wazuhClient` (local alias) | `wazuh-core` | Wazuh Server API |

That last row matters: `wazuh-check-updates` aliases the Server API client as
`wazuhClient` in `server/services/cti-registration/*`, and it sits in sibling
files next to `opensearchClient.asCurrentUser`. The two are one letter apart in
the eye and a whole permission model apart in effect.

## The witness case

`wazuh-ai-assistant/server/tools/executor.ts` uses both, in the same file:

```
line 231  context.core.opensearch.client.asCurrentUser.search(...)   // indexer
line 424  context.core.opensearch.client.asCurrentUser.search(...)   // indexer
line 661  context.core.opensearch.client.asCurrentUser.search(...)   // indexer
line 850  context.wazuh_core.api.client.asCurrentUser.request(...)   // Server API
```

Four calls, one accessor name, two permission systems. If you are looking for a
single place to understand this page, it is that file.

The same plugin already documents the distinction, twice, because its authors hit
it:

- `server/tools/types.ts:121-133` splits its request types into `IndexerRequest`
  and `ManagerRequest`, each naming its client explicitly.
- `server/wazuh-core.d.ts:59-70` hand-writes narrower local types rather than
  importing the real ones, specifically to explain the `wz-token` closure.

That second one is worth pausing on. A developer chose to maintain a parallel
type declaration by hand instead of importing the real thing, purely so the
distinction could be written down where it would be read. There is no `TODO` and
no `FIXME` anywhere near either API in either repository — nobody flagged
uncertainty. The confusion did not produce a question; it produced a silent
workaround. That is the more expensive outcome, and it is the reason this page
is worth its length.

## Choosing, in practice

Ask two questions, in this order.

**1. Which backend am I talking to?** The indexer, or the Server API? This
decides which of the two clients you use, and it is not a judgement call.

**2. Should this action be constrained by what the logged-in user may see?**

- **Yes** — almost always. Use `asCurrentUser`. Anything driven by a user
  action, anything whose result is rendered back to that user.
- **No** — use `asInternalUser`, and justify it in a comment at the call site.
  Legitimate cases are narrow: health checks, plugin bootstrap, background jobs
  with no user in scope, reading configuration the user cannot be expected to
  hold permissions for.

If you cannot write the justification, the answer was `asCurrentUser`.

There is no case where the right answer is "whichever one is already imported".

## What this page does not cover

- How to configure OpenSearch Security roles, or Wazuh Server API roles. This is
  about picking a client, not about administering either system.
- `run-as`. `wazuh-core`'s scoped client may enable it per host; the mechanics of
  when and why are a separate page nobody has written.
- The 27 call sites inside `wazuh-dashboard` itself, where OSD core plugins
  consume their own client. Those follow upstream OpenSearch Dashboards
  conventions and are out of scope for Wazuh plugin authors.

## This page needs an owner

`SPEC.md` section 8 has said from the first draft that this page needs a human
author and an owner. The scope question that blocked it — *which* of the two
APIs it governs — is now answered: **both**, because the collision is the
hazard. The draft above is written from the code as it stood on 2026-09-15.

What it still needs from a person:

1. **An owner**, named here, who re-reads it when either client changes.
2. **A review of the "legitimate `asInternalUser`" list.** It was derived from
   reading call sites, not from a policy anyone agreed to. Some current uses may
   be wrong; this page currently treats them as precedent.
3. **A decision on where it lives.** It sits in `docs/` today. Once Phase 2
   ships, `.claude/standards/` is the natural home, and then `wazuh-ctx sync`
   distributes it and `wazuh-ctx check` keeps it from drifting.

Until point 1 is done, this page is accurate and unowned, which is a state with
a short shelf life.

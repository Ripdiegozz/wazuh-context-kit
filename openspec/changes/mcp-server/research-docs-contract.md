# Research — the `llms.txt` documentation contract

Lane: SPEC §3.1 (`docs` resource). All evidence below was measured with `curl`
against `documentation.wazuh.com` on **2026-09-17**. Every claim names the URL
and what it returned. Read-only HTTPS fetches of published documentation.

## Executive summary

Three findings, one of which is a live defect in shipped configuration.

1. **`llms.txt` is published once, at the site root — not per version.** SPEC §3.1
   says "`/5.0-beta/llms.txt` returns 404", which is true but understates it:
   `/current/`, `/5.0/`, `/4.14/` and `/5.0-beta/` **all** 404. Only
   `https://documentation.wazuh.com/llms.txt` exists.
2. **`sources.yml` maps `5.0.0 → "5.0"`, and `/5.0/` does not exist.** Every URL
   under that path 404s. The Wazuh 5.0 documentation lives at `/5.0-beta/`.
   The shipped `docsVersionMap` would send every 5.0 lookup into a 404.
3. **The 1-to-1 guarantee holds where the version path exists, and misses are
   clean.** A hit is `200` + `content-type: text/markdown`. A miss is `404` +
   `content-type: text/html`. There is no soft-404, so a canary can assert on
   both signals.

## Finding 1 — `llms.txt` lives only at the root

| URL | Status | Body |
| --- | --- | --- |
| `https://documentation.wazuh.com/llms.txt` | **200** | 19,856 b, `# Wazuh documentation` |
| `https://documentation.wazuh.com/current/llms.txt` | 404 | 164,036 b HTML error page |
| `https://documentation.wazuh.com/5.0/llms.txt` | 404 | 164,036 b HTML error page |
| `https://documentation.wazuh.com/4.14/llms.txt` | 404 | 164,036 b HTML error page |
| `https://documentation.wazuh.com/5.0-beta/llms.txt` | 404 | 164,036 b HTML error page |
| `https://documentation.wazuh.com/current/llms-full.txt` | 404 | 164,036 b HTML error page |

All four 404 bodies are byte-identical in length — one shared error page.

**Consequence for the canary**: it must fetch the root `llms.txt`, not a
version-scoped one. SPEC §3.1 cites the contract as living at
`wazuh-documentation:5.0.0/source/llms.txt` — that is the *source* path in the
repository, not the published URL.

## Finding 2 — the contract text, verbatim, as published today

From `https://documentation.wazuh.com/llms.txt`:

```
### Content retrieval
- **Preferred format** Ingest documentation using the Markdown (`.md`) versions.
- **Path transformation** For any HTML page, obtain the Markdown version by
  replacing `.html` with `.md`.
- **Availability guarantee** Every public HTML documentation page has a 1-to-1
  Markdown equivalent at the same path.

### Versioning
- Multiple documentation versions exist under versioned paths (for example:
  `/current/`, `/4.14/`, `/4.2/`).
- **Default authority** Use `/current/` as the latest and authoritative
  documentation by default.
- **Version override** Use a specific version path only when the user explicitly
  requests that version.
- All listed versions are actively supported.

### Citations
- **Canonical citation** Always cite the canonical HTML URL (`.html`) in
  outputs, even when ingesting Markdown content.
```

Note the drift from SPEC §3.1, which records the supported list as
`/current/`, `/5.0/`, `/4.14/`, `/3.13/`. **Today's list is `/current/`, `/4.14/`,
`/4.2/`, and it is prefixed "for example" — it is illustrative, not exhaustive.**
Treating it as an allowlist would be a misreading.

## Finding 3 — measured version paths

Probed `<version>/getting-started/components/index.md`:

| Version path | Status | Size |
| --- | --- | --- |
| `/current/` | 200 | 2,427 b |
| `/4.14/` | 200 | 2,427 b |
| `/4.2/` | 200 | 2,397 b |
| `/3.13/` | 200 | 2,410 b |
| `/5.0-beta/` | 200 | 2,990 b |
| **`/5.0/`** | **404** | 164,036 b error page |

`/4.2/` and `/3.13/` respond even though `/3.13/` is no longer listed in
`llms.txt` — confirming the "for example" reading above.

**`/current/` is an alias for `/4.14/`**, not for 5.0. Byte-identical content:

```
current:  sha256 7dc7cb135860baa4…
4.14:     sha256 7dc7cb135860baa4…
5.0-beta: sha256 c878c0b37b68aa84…
```

This matters more than it looks. The dataset this tool ships is pinned to code
ref `5.0.0`, and the documentation for that code is at `/5.0-beta/`. Defaulting
to `/current/` would silently answer 5.0 questions with 4.14 documentation —
precisely the obsolescence failure SPEC §3.2 refuses to tolerate for `schema`.
The same refusal has to apply to `docs`.

## Finding 4 — the shipped `docsVersionMap` is wrong today

`sources.yml:38-43`:

```yaml
docsVersionMap:
  owner: diego.garcia
  lastReviewed: "2026-09-14"
  map:
    "5.0.0": "5.0"      # ← 404s; the 5.0 docs are at /5.0-beta/
    "4.14.0": "4.14"    # ← verified 200
```

No code reads this block yet (`src/sources.ts:37-42` tolerates and ignores it),
so nothing is currently broken at runtime — the defect is latent, and Phase 3 is
what would activate it.

Two candidate corrections, both for the maintainer to rule on, since this is
hand-maintained prose with a named owner:

- `"5.0.0": "5.0-beta"` — points at documentation that exists and matches the
  code ref. Carries the risk that the path disappears when 5.0 goes GA.
- leave `"5.0"` and let the mapping fail loudly — SPEC §3.6 already requires
  "`docs` fails with a clear message for an unmapped version path". But this path
  is *mapped*, just dead, so it would fail as a fetch miss rather than a mapping
  error. Those deserve different messages.

Either way the `lastReviewed` date moves, because the file was reviewed
2026-09-14 and the world it describes is not the world that answers today.

## Finding 5 — hit and miss are cleanly distinguishable

| Request | Status | `content-type` | Size |
| --- | --- | --- | --- |
| `current/getting-started/components/index.md` | 200 | `text/markdown` | 2,427 b |
| `current/this-page-does-not-exist-xyz.md` | 404 | `text/html` | 164,036 b |

**There is no soft-404.** A missing page returns a real 404 status, and the body
is HTML, not Markdown. Both signals agree.

The canary should therefore assert **both**: status `200` *and*
`content-type: text/markdown` *and* a body that does not begin with `<!DOCTYPE`.
Status alone would miss a regression where the site starts serving the HTML page
under the `.md` path with a 200 — the exact failure mode SPEC §3.1 warns about
("return silence or raw HTML").

Real `.md` bodies open with a copyright comment, which makes a cheap positive
assertion:

```
<!-- Copyright (C) 2015, Wazuh, Inc. -->

# Components
```

## Finding 6 — `robots.txt` permits this

`https://documentation.wazuh.com/robots.txt` (200, 619 b) disallows exactly one
path, `/resources/`, and repeats that single rule for `*` and for every named AI
crawler — `GPTBot`, `OAI-SearchBot`, `ChatGPT-User`, `ClaudeBot`, `Claude-User`,
`PerplexityBot`, `Perplexity-User`, `Google-Extended`, `Applebot-Extended`,
`CCBot`, `Bytespider`.

Documentation paths are not disallowed for anyone. No `Crawl-delay` is declared.
No rate-limiting headers were observed; responses are served from CloudFront with
`cache-control: max-age=86400,public`.

Nothing here forbids the `docs` resource. A courteous client should still set a
descriptive `User-Agent` and avoid bulk crawling — which the design already
avoids, because §3.1's whole point is "there is no crawler": fetch one page on
demand.

## URL template

```
https://documentation.wazuh.com/<versionPath>/<section>/<page>.md
```

Cite the `.html` twin of the same path, per the contract.

## Risks

- **The version list is illustrative, not authoritative.** `llms.txt` says "for
  example", and `/3.13/` responds while going unlisted. Deriving supported
  versions by parsing `llms.txt` would be wrong; SPEC §3.1 already requires the
  mapping be explicit configuration, and this confirms why.
- **`/5.0-beta/` is a beta path and will move.** Whatever `5.0.0` maps to, it is
  a hand-maintained value with a review date, and it will go stale at GA. That is
  the accepted cost of the design, not a flaw in it.
- **The contract is a promise nobody versions.** Confirmed: the published list of
  supported versions already differs from what SPEC §3.1 recorded. The canary is
  not paranoia; the drift has already happened once.

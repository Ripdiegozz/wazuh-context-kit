# Apply progress — `crosscheck-live-indexer`

All 44 tasks complete; task 6.3 struck rather than ticked (see
`verify-report.md` — the expectation itself was wrong).

## New modules

| Path | Side of the seam |
| --- | --- |
| `src/indexer/types.ts` | impure — `RawClusterState`, `IndexerError`, transport seam |
| `src/indexer/client.ts` | impure — the only new module that touches the network |
| `src/crosscheck/live-types.ts` | pure |
| `src/crosscheck/live.ts` | pure — `buildLiveComparison`, `declaredFromWcsModules` |
| `src/crosscheck/render-live.ts` | pure |

## Modified

- `src/cli.ts` — `--indexer`, `--indexer-skip-tls-verify`, `--format`;
  credentials read once from the environment; the live path runs strictly after
  both `writeFile` calls, so determinism holds by construction.
- `src/crosscheck/build.ts` — `covers()` exported for reuse. Not reimplemented:
  two glob matchers drift, and the drift is invisible because each has its own
  tests.
- `src/sources.ts` — `repoSourceSchema` is now `.strict()`, so a `username` or
  `password` field is rejected rather than silently stripped. Scoped to the repo
  entry: the real `sources.yml` carries a legitimate top-level `docsVersionMap`.

## Notes worth keeping

- `zod`'s `z.object()` strips unknown keys by default, so a plain schema does
  not reject a stray credential field. `.strict()` was required.
- Bun types a per-request `tls` option, so the TLS override needed no unsafe
  cast beyond the transport injection boundary.
- `exactOptionalPropertyTypes: true` rejects assigning `undefined` to an
  optional key; conditional test helpers must omit the key entirely.
- The byte-identical CLI test needed a real (non-fixture) crosscheck run, since
  crosscheck rejects `--fixtures`. Solved without network by symlinking the warm
  `.cache/`: `fetchRepos` without `--refresh` cache-hits on a purely local
  `git -C <dir> rev-parse HEAD`.

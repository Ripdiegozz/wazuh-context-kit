```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:061f79485b4225f94f84873f959ce7e4a829c974dd9ca0659ab40973a47be7b7
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 9/9
scenarios: 19/19
test_command: bun test
test_exit_code: 0
test_output_hash: sha256:993467850c2bfc8eddf2551746e017dc4ebd278e47f6b038f26b798c89c67840
build_command: bun run build
build_exit_code: 0
build_output_hash: sha256:185fcc4bafdcd2134f52ae6737546f1108e2628db4a8569a2cfa7921fa498ad8
```

# Verify Report — `close-phase-1`

> Phase: `sdd-verify` · 2026-09-15 · run inline (this runtime refuses SDD child
> dispatch), so this is a full-context re-verification and not a blind one.

**Verdict: PASS WITH WARNINGS.** All 9 requirements and 19 scenarios carry
runtime evidence. `wazuh-ctx crosscheck` exists; SPEC 1.8 is built; Phase 1 is
closed for real.

## Evidence

| Command | Exit | Observed |
|---|---|---|
| `bun test` | 0 | 197 pass · 3 skip · 0 fail · 483 assertions · 16 files |
| `bun run typecheck` | 0 | clean |
| `bun run build` | 0 | `dist/cli.js` |
| `wazuh-ctx matrix --ref 5.0.0` | 0 | 9 plugins, 64 core, 40 templates, 0 unresolved |
| `wazuh-ctx crosscheck --ref 5.0.0` | 0 | 61 names, 6 repos, 10 uncovered mechanisms |
| live indexer on `localhost:9200` | — | 49 concrete indices, 53 installed templates, compared by hand |

## Requirement coverage

### `source-parse` — 3 requirements

Every `templates/` subdirectory parsed, not only `states/`: verified at 40
templates (20 states, 8 streams, 8 content, 4 root). Index references recovered
from plugin source without a type checker. Uncoverage emitted as structured data.

### `repo-fetch` — 2 requirements

Both dashboard repository shapes covered, proven on disk against a `file://`
origin. Cost measured, not estimated: cold clone 32 s → 31 s, `.cache/`
245 MB → 264 MB.

### `crosscheck` — 4 requirements

The three populations reported; coverage travels with the result and leads the
rendered report; the artifact is separate so `matrix.json`'s `payloadHash` never
moves with scanner changes; competing catalogs reported and never fatal.

## The verification that mattered was not a test

A live indexer, offered mid-change, corrected the model four times. **All four
defects passed the test suite.**

1. **Three findings carried since exploration were false.**
   `wazuh-metrics-comms-v4*`, `wazuh-agent-stats*` and `wazuh-agent-config*` are
   all declared. They were repeated as evidence in a proposal, two pull
   requests, and a task that *asserted they must appear*.
2. **Equality matching was the wrong model.** The repository declares
   `wazuh-findings-v5*`; the indexer expands it into sixteen installed
   templates.
3. **The scanner saw one file's convention.** Six live indices under security
   analytics were reported as having no consumer. Found by the maintainer's
   product knowledge, not by the tool.
4. **But a `wazuh-` prefix proves nothing.** 77 distinct names recovered, zero
   existing.

Then review found two more that also passed every test: exact index names
prefix-matched against each other so two distinct indices cancelled and both
findings vanished, and a one-line index map never closed.

**Six defects, all green.** The pattern is the same each time: a fixture
encoding the same assumption as the code proves the assumption, not the
behaviour.

## Warnings

**1. One acceptance criterion is deliberately unticked.** SPEC 1.10's last item:
the crosscheck compares two repositories, not the running system. An index can
be declared, hold data, be queried, and still be reported unconsumed. That
happened six times here. `--indexer <url>` is the fix and is scoped as its own
change.

**2. Recovery from source has a ceiling, and the report says so.** Ten
mechanisms remain unrecoverable — a regex allowlist accepting by shape, six
runtime-configuration lookups, three computed expressions. `CROSSCHECK.md` opens
with them rather than closing with them.

**3. This verification is not independent.** The runtime refuses SDD child
dispatch, so the context that implemented the change also verified it. Given
that six defects in this change passed a green suite, a fresh session re-reading
these specs against the diff would be worth its cost.

## Task ledger

49 of 49, delivered as #10, #11 and #12. Task 8.6 was **inverted** rather than
ticked: it asked for evidence of three findings that do not exist, and a task
that asserts a finding must appear can only be satisfied by a bug.

## Result contract

- **status:** `done`
- **next_recommended:** `sdd-archive`
- **risks:** repo-versus-repo comparison with a known blind spot; a
  non-independent verification; static recovery with a stated ceiling
- **skill_resolution:** `paths-injected`

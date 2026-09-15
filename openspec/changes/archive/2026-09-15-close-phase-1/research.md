# Research: Full Constant Folding for Index-Name Extraction

> **Note on process**: This research ran under a generic-purpose agent, not the dedicated
> `sdd-research` phase agent, because this runtime refuses `sdd-*` child dispatch in the
> current session. Treat it as informed evidence-gathering rather than a blind,
> independently-dispatched SDD research phase. All findings below are cited; where evidence
> was inconclusive or absent, that gap is stated explicitly rather than filled in.

## Decision under evaluation

The project needs to extract index names referenced by TS/JS source across several
OpenSearch Dashboards plugin repos and cross-reference them against index templates
declared by a separate indexer repo. The maintainer's working assumption is that this
requires **full constant folding**: resolving identifiers to their constant initializers
across module boundaries, and evaluating expressions (`.map()` spreads, `.replace()` +
string concatenation), not just scanning string literals. The motivating case is
`plugins/main/common/constants.ts`, which declares ~46 exported constants such as
`WAZUH_X_PATTERN = 'wazuh-states-vulnerabilities*'`, consumed elsewhere via
`import { WAZUH_X_PATTERN }` with no string literal at the call site, plus derived
entries built from array spreads and string replacement/concatenation.

---

## Lane 1 — Does the TypeScript compiler API give this for free?

**Claim 1.1 — The classic TS compiler API can resolve an identifier through an alias to
its declaration, and can read out a literal-typed constant's value.**
`typeChecker.getAliasedSymbol()` follows all symbol links and resolves an imported
alias to the symbol it ultimately points to; this is the documented mechanism for
turning `import { X }` into the declaration of `X`. Once resolved to the `const`
declaration, a `const x = 'foo'` has TypeScript's narrowed literal type `"foo"`, which
the checker exposes through the type of the symbol.
- <https://github.com/microsoft/TypeScript/issues/37365> (discussion of
  `getAliasedSymbol` / `getImmediateAliasedSymbol` in the checker API)
- <https://github.com/microsoft/TypeScript/issues/55088> (checker API symbol/alias
  behavior)
- <https://github.com/Microsoft/TypeScript/issues/29130> (identifiers resolving to
  unit/literal-typed values — background on why literal types make this possible)

This answers the "is it possible in principle" question affirmatively for the
**classic JavaScript-based `typescript` package** (5.x/6.x): the compiler API was
designed to let tools like `ts-morph` and `typescript-eslint` do exactly this kind of
symbol resolution.

**Claim 1.2 — TypeScript 7.0 (the native Go port, `tsgo`) does NOT expose a public,
stable, JavaScript-callable compiler API or type checker. This is the decisive finding.**
Multiple sources from the TypeScript team itself and downstream tooling maintainers
converge on the same fact:
- The official 7.0 Beta announcement states plainly that a stable programmatic API is
  not expected until **TypeScript 7.1**, "several months" after the 7.0 release, and
  recommends installing the classic compiler under an alias
  (`"typescript": "npm:@typescript/typescript6@^6.0.0"`) for any tool that needs the
  JS-callable API while using 7.0/`tsgo` only for CLI type-checking.
  <https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-beta/>
- The "Announcing TypeScript Native Previews" post describes only an early,
  IPC-based API layer ("API consumers can communicate with a TypeScript process
  through IPC") plus a native Node addon (`libsyncrpc`) for synchronous calls from
  JS — this is not a drop-in replacement for the classic `ts.Program` /
  `ts.TypeChecker` object model; it is a message-passing protocol still under active
  design, and the language service itself (go-to-definition, hover, completions) is
  described as early-stage and incomplete (auto-imports "not fully ported").
  <https://devblogs.microsoft.com/typescript/announcing-typescript-native-previews/>
- `microsoft/typescript-go` issue #516 (open, "Awaiting More Feedback") is a
  from-the-community request for a transformer-plugin or compiler-API story on the
  Go port; it records that implementing JS-callable bindings into the Go internals is
  considered non-trivial ("complicated" due to cross-language binding), and that as of
  this issue there is no committed design, only discussion.
  <https://github.com/microsoft/typescript-go/issues/516>
- Third-party coverage of the 7.0 RC and GA, cross-checked against the above primary
  sources, states the same conclusion in blunter terms: "TypeScript 7.0 ships with no
  programmatic compiler API," internal packages have no stability guarantee, and
  `internal/checker` is called out as one of the least stable files in the repo.
  <https://www.digitalapplied.com/blog/typescript-7-0-rc-go-native-compiler-2026-upgrade-guide>,
  <https://dev.to/dev_encyclopedia/why-your-typescript-7-upgrade-broke-eslint-ts-jest-and-ts-morph-385k>

**This project pins `"typescript": "7.0.2"` in `devDependencies`**
(`/home/runner/wazuh-context-kit/package.json:32`), i.e. exactly the release family
that the TypeScript team itself says has no public JS API. The documented workaround
— installing the JS-based compiler under a version alias purely for tooling/analysis
while keeping 7.0.2 for `tsc --noEmit` type-checking — is the TypeScript team's own
stated path, not a workaround this research is inventing:
> "don't replace `typescript` in your dependencies with the 7.x line if you use
> `typescript-eslint`, `ts-jest`, `ts-morph`, or any tool doing programmatic
> type-checking. Keep `typescript` pinned to 6.x for those tools..."
<https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-beta/>
(paraphrased summary of the same guidance appears independently at
<https://dev.to/dev_encyclopedia/why-your-typescript-7-upgrade-broke-eslint-ts-jest-and-ts-morph-385k>)

**Claim 1.3 — Bun and the classic checker.** No official Bun statement was found
confirming or denying that the classic `typescript` npm package (5.x/6.x, used as a
pure library, not as a build step) runs correctly under the Bun runtime. This is a
**gap**, not a confirmed fact: the classic `typescript` package is plain
Node-targeting JavaScript with no native addons, and Bun advertises broad
Node-API/npm compatibility, so there is no known structural reason it would fail —
but no authoritative source (TypeScript team, Bun team, or ts-morph maintainers)
was found stating this explicitly, and the maintainer of `ts-morph` has not
responded, as of the retrieved content, to the open community question about
`typescript-go` compatibility (<https://github.com/dsherret/ts-morph/issues/1621>,
opened March 2025, no maintainer reply in the fetched content). **Treat "the classic
checker runs fine under Bun for analysis-only use" as a reasonable, cheaply-verifiable
inference, not a cited fact.**

---

## Lane 2 — Lighter-weight AST options

**Claim 2.1 — None of the common non-checker parsers do cross-file, type-aware symbol
resolution; they are single-file (or single-module) syntax/scope tools.**
- **Bun.Transpiler**: explicitly single-file. Bun's own docs describe it as: "The
  transpiler does not resolve modules or execute the code. The result is a string of
  vanilla JavaScript code." It supports `.tsx` syntax stripping and an `inline` option
  for constants **defined in the same file**, but performs no cross-module import
  resolution and exposes no AST object, only transformed source text.
  <https://bun.sh/docs/runtime/transpiler>
- **oxc-parser**: parses TS/TSX syntax; a separate "semantic analyzer" layer (not the
  parser) builds scope trees and symbol tables, but oxc's own documentation
  distinguishes this from full type checking, and describes it as validating code
  semantics/binding within its own scope model, not evaluating cross-file constant
  expressions.
  <https://oxc.rs/docs/guide/usage/parser.html>,
  <https://deepwiki.com/oxc-project/oxc/4-parser-and-semantic-analysis>
- **@babel/parser / SWC**: syntax parsers/compiler platforms; no source found claiming
  cross-file, type-aware constant resolution for either. (This is a negative result —
  no evidence found, not evidence of absence-with-citation; treat as a gap if this
  matters for the decision.)

**Claim 2.2 — `ts-morph` does wrap the full TypeScript compiler/checker**, which is why
it is the one option in this lane capable of the alias/constant resolution the project
needs — and it is exactly the tool named across multiple sources (§1.2) as **broken
under TypeScript 7 / `tsgo`** because it depends on the classic JS-callable API that
7.0 does not expose. ts-morph's own front page confirms only that it "wraps the
TypeScript compiler API," without itself detailing `.tsx` support or version pinning
in the fetched excerpt — those specifics come from the third-party TS7-migration
coverage in §1.2, which lists `ts-morph` by name as one of the tools that "cannot use
`tsgo` as a drop-in replacement" and requires the classic API.
<https://ts-morph.com/>,
<https://dev.to/dev_encyclopedia/why-your-typescript-7-upgrade-broke-eslint-ts-jest-and-ts-morph-385k>
No source was found confirming ts-morph runs under Bun specifically (a further gap,
same caveat as 1.3) — but since ts-morph is a pure-JS library built on the classic
`typescript` package, the same reasoning applies.

**Implication for Lane 2**: there is no shortcut here. If the checker-backed approach
(`ts-morph` or hand-rolled use of the classic `ts.TypeChecker`) is out, the lighter
parsers do not substitute for it — they would only get the project back to
string-literal / single-file scanning, which is the exact limitation the maintainer
is trying to escape with the `WAZUH_X_PATTERN` case.

---

## Lane 3 — Prior art for this exact problem

**Finding**: No authoritative, directly-on-point tool was found that extracts
Elasticsearch/OpenSearch index names (or SQL table names) from application source code
specifically to cross-reference against a schema/template registry. Search across
Elasticsearch-static-analysis and schema-drift-detection terms surfaced tools that are
adjacent but not the same problem:
- **BugHound**, a static code analyzer that *stores its findings in* Elasticsearch —
  unrelated to extracting index names from source.
  <https://github.com/mhaskar/Bughound>
- General schema-drift-detection literature (Streamkap, VirtualMetric) addresses
  drift between a *live* source schema and downstream consumers, not static
  extraction of identifiers from application code.
  <https://streamkap.com/resources-and-guides/schema-drift-detection>

**Adjacent, more useful precedent — dead-code/unused-export detectors (`knip`,
formerly `ts-prune`)**, which face a structurally similar problem (resolve
identifier usage across a codebase) and openly document the same class of gap this
project will hit: *"False positives usually come from dynamic imports, framework
conventions, or generated files that Knip cannot resolve statically."* Their
documented mitigation is not "solve it," it is a manual escape hatch — an
`ignore`/`ignoreDependencies` allowlist in configuration for cases the tool cannot
resolve.
<https://knip.dev/typescript/unused-exports> (general capability description);
false-positive/dynamic-import limitation summarized via
<https://blog.openreplay.com/remove-unused-files-dependencies-knip/> and
<https://www.pistack.xyz/posts/2026-06-19-dead-code-detection-tools-knip-ts-prune-vulture-unimported/>
(`ts-prune` now in maintenance mode, `knip` recommended as successor).

**A second, more technical data point — `terser`'s constant-folding limits**: even a
mature, widely-used JS minifier with an explicit constant-folding pass fails to fold
values that are logically constant but structurally non-trivial. TypeScript compiles
`enum` to an IIFE that mutates an object; terser does not recognize that pattern as
constant and leaves `E.ONE` / `E[0]` unfolded rather than inlining `0` / `"ONE"`, even
though the values never change. The tracked feature request treats "recognize this
IIFE pattern" as future work, not an existing capability.
<https://github.com/terser/terser/issues/1064>
This is useful negative evidence: it shows that "constant folding" is not a solved,
boring feature even in tools whose entire job is constant folding — it degrades
quickly once the shape of the constant gets more complex than a direct literal
assignment, which is directly analogous to the project's `.map()`-spread and
`.replace()+concat` cases.

**Conclusion for Lane 3**: no authoritative statement was found declaring this class
of problem formally unsolvable, but no prior art was found that has solved the exact
"extract-and-cross-reference index names via full constant folding" problem either.
The closest available precedent (dead-code detectors) treats unresolvable dynamic
cases as an explicit, manually-curated exception list rather than something the
static engine resolves — which is a concrete design precedent for Lane 4's fallback.

---

## Lane 4 — The honest limit

**Claim 4.1 — There is a general theoretical ceiling, not just a tooling gap.**
Static determination of a non-trivial runtime property of an arbitrary program
(which includes "what string value will this identifier hold at this call site")
is, in the general case, undecidable — the practical framing used across the static
analysis literature traces to Rice's theorem, cited in the general background article
on static program analysis.
<https://en.wikipedia.org/wiki/Static_program_analysis>
This is why every real tool in Lanes 2–3 documents a **gap list**, not "we handle
everything."

**Claim 4.2 — Mature tools handle this by explicit exclusion/allowlisting, not silent
approximation.**
- `eslint-plugin-import`'s `no-dynamic-require` rule documents plainly that using an
  expression (e.g. concatenating a path and a variable) as a `require()` argument
  "makes it harder for tools to do static code analysis, or to find where in the
  codebase a module is used" — i.e., the rule exists specifically to flag the cases
  the tool itself cannot safely resolve, rather than attempting to resolve them.
  <https://github.com/import-js/eslint-plugin-import/blob/main/docs/rules/no-dynamic-require.md>
- `knip`/`ts-prune` (§Lane 3) surface unresolved dynamic cases as **false positives
  the user must allowlist**, not as errors the engine claims to have resolved.
- `webpack`'s `DefinePlugin` + minifier constant-folding pipeline only folds values
  it can prove are compile-time deterministic; anything not covered by that
  (a variable computed at runtime, or read from environment/config) is left as
  runtime code by design — determinism is a documented precondition for folding, not
  an assumption the tool makes silently.
  <https://webpack.js.org/plugins/define-plugin/>

**Applicability to this project**: the project has at least two known categories of
values that fall outside what any constant-folding approach (compiler-API-based or
hand-rolled) can enumerate: values read from runtime configuration, and values
accepted by a regex/allowlist pattern rather than a finite enumerated set. Per the
precedent above, the honest and auditable way to report this is an explicit,
visible "unresolved / could not statically determine" list alongside the resolved
set — never a silently-incomplete "complete" result.

---

## What this means for the decision

**Full constant folding is *expensive*, and on TypeScript 7.0.2 specifically it is
currently *blocked* for the checker-backed approach, not merely expensive.**

- The TypeScript compiler API *can* do exactly what the maintainer wants
  (`getAliasedSymbol` + literal-type inspection resolves `import { WAZUH_X_PATTERN }`
  back to its declared value) — but only in the **classic JS-based compiler**
  (5.x/6.x package), which is what `ts-morph` and similar tools depend on.
- **TypeScript 7.0 (`tsgo`, the Go native port) has no public, stable JS-callable
  compiler API as of GA**, and the TypeScript team's own guidance is not to point
  tools that need the programmatic API at the 7.x line at all — they should keep
  `typescript` pinned to 6.x for that purpose. A public API is targeted for 7.1,
  "several months" out, with no confirmed ship date found in this research.
- This project pins `typescript: 7.0.2`. Concretely: reaching for `ts-morph` or the
  classic compiler API today means adding the classic `typescript` package
  side-by-side (via the documented npm alias trick) purely as an analysis-time
  dependency, separate from the 7.0.2 the project uses for its own type-checking —
  not writing a hand-rolled interpreter, but also not "free" from the pinned
  toolchain as-is.
- None of the lighter-weight parsers (Bun's own transpiler, oxc, Babel, SWC) are a
  substitute — none do cross-file, type-aware constant resolution. Reaching for them
  instead of the checker would silently downgrade the tool back to literal-only
  scanning, reproducing the exact gap the `WAZUH_X_PATTERN` case was raised to avoid.
- No prior art was found that has solved this exact "index name extraction +
  schema cross-reference via full constant folding" problem end-to-end. The nearest
  precedent (dead-code detectors) resolves what it can and explicitly allowlists what
  it cannot — which is the documented, credible fallback shape for this project's
  known-dynamic cases (runtime-configured values, regex-accepted identifiers), not a
  reason to avoid attempting resolution at all.

**Bottom line for the maintainer's concern**: "full constant folding" is not
inherently "write a TypeScript interpreter" — a compiler API already does the
symbol-alias and literal-type resolution — but on this project's exact pinned
toolchain (TypeScript 7.0.2, no public API), getting that API means adding the
classic `typescript` package as a parallel analysis dependency, which is itself a
decision with its own cost and needs explicit sign-off; it is not a hidden freebie
inside the already-pinned 7.0.2.

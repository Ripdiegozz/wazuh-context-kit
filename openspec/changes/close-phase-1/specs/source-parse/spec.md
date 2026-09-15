# Source-Parse Specification — delta for `close-phase-1`

## Purpose

Corrects a defect that hides 44% of the declared index surface, and adds the
source scanning the crosscheck consumes.

## Requirements

### Requirement: Every template directory is parsed, not only `states/`

The system MUST discover index templates under **every** subdirectory of the
indexer's `templates/` path, and MUST NOT restrict discovery to
`templates/states/` (SPEC 1.2, 1.8).

At `5.0.0` the tree holds `states/` (20), `streams/` (8), `content/` (8), and
four JSON files directly under `templates/`. Reading only `states/` declares
**20 of 40**.

This matters beyond completeness: seven index patterns referenced by dashboard
code are declared in `streams/` and `content/`. A crosscheck built on the
narrower parse would report all seven as undeclared.

#### Scenario: Templates from sibling directories

- GIVEN an indexer checkout with `templates/states/`, `templates/streams/` and `templates/content/`, each holding JSON with `index_patterns`
- WHEN parse completes
- THEN templates from all three directories are present
- AND each records which directory it came from

#### Scenario: An unknown future subdirectory is included

- GIVEN a `templates/` subdirectory whose name the implementation has never seen
- WHEN parse completes
- THEN its templates with `index_patterns` are discovered
- AND no directory name is hardcoded as an allowlist

### Requirement: Index references are recovered from plugin source

The system MUST recover index names referenced by dashboard plugin source, by
resolving identifiers to their string literals within catalog modules and
following import edges, and MUST do so without a type checker.

The project pins `typescript@7.0.2`, which ships no JS-callable compiler API.
Acquiring one would mean a second copy of TypeScript or moving the project's
toolchain; neither is in scope.

#### Scenario: A literal in a catalog module

- GIVEN `export const WAZUH_VULNERABILITIES_PATTERN = 'wazuh-states-vulnerabilities*'`
- WHEN the scanner reads that module
- THEN `wazuh-states-vulnerabilities*` is recovered, attributed to that file and line

#### Scenario: A consumer importing the identifier

- GIVEN a file importing `WAZUH_VULNERABILITIES_PATTERN` from a catalog module and using it
- WHEN the scanner runs
- THEN that file is recorded as a consumer of `wazuh-states-vulnerabilities*`
- AND the index is not reported as unconsumed

#### Scenario: Saved-object index patterns

- GIVEN an `.ndjson` asset containing an object of `"type":"index-pattern"`
- WHEN the scanner reads it
- THEN the index title is recovered as a reference

### Requirement: What the scan cannot see is recorded as data

The system MUST emit, as structured output, every site where an index name is
determined by a mechanism the scanner cannot resolve, identifying the file, the
line and the mechanism.

Three mechanisms are known: a regex allowlist accepting names by shape
(`guardrails.ts:199`), a name read from runtime configuration
(`wazuh-elastic.ts:87-91`), and entries assembled by `.map()` spreads or string
concatenation.

A report claiming an index has no consumer is **false** when a consumer reaches
it through one of these. Uncoverage is therefore part of the result, not a
caveat in prose.

#### Scenario: A regex allowlist is reported

- GIVEN a module that matches index names against a regular expression instead of listing them
- WHEN the scanner runs
- THEN an uncovered-mechanism entry names that file, line and kind
- AND the entry is present in the machine-readable output, not only in rendered text

#### Scenario: Recovered count is pinned

- GIVEN the catalog modules at a known revision
- WHEN the scanner runs
- THEN the number of recovered names is asserted against a pinned expectation
- AND a silent drop to zero fails rather than passing as "nothing referenced"

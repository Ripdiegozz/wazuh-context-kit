/**
 * `buildCrosscheck` — SPEC 1.8, the question no single repository can answer.
 *
 * A pure function. No fs, no network, no clock: `generatedAt` is injected like
 * everywhere else in this project.
 */

import type {
  CompetingCatalog,
  CrosscheckJson,
  DeclaredIndex,
  IndexReference,
  MatchedIndex,
} from "../matrix/types.ts";
import type { CrosscheckInput } from "./types.ts";

/**
 * Both sides are globs over the same space of concrete index names, so they
 * are compared as globs — not as strings.
 *
 * An earlier version compared by equality, on the belief that the dashboard's
 * `wazuh-metrics-comms-v4*` had no declaration while the indexer declared only
 * `wazuh-metrics-comms*`. Checking the running indexer disproved it twice
 * over: the repository declares `wazuh-metrics-comms-v4*` exactly, and the
 * `-v5` sub-families the strict rule flagged each have their own installed
 * template. Of 31 findings that rule produced, at least 22 were false, and six
 * of them were indices holding live data.
 */
function isGlob(pattern: string): boolean {
  return pattern.endsWith("*");
}

function prefixOf(pattern: string): string {
  return isGlob(pattern) ? pattern.slice(0, -1) : pattern;
}

/**
 * Does a declared pattern cover a referenced one?
 *
 * The trailing `*` is not decoration — it is the difference between a name and
 * a family, and treating every name as a prefix silently merges distinct
 * indices. An earlier version did exactly that: `wazuh-a` declared and
 * `wazuh-ab` referenced matched each other, and BOTH findings vanished.
 *
 *   both globs      -> they overlap in either direction. `wazuh-states-fim*`
 *                      referenced against `wazuh-states-fim-files*` declared
 *                      does reach a templated index.
 *   declared glob   -> it must cover the exact reference.
 *   reference glob  -> its family must include the exact declaration.
 *   both exact      -> equality, and nothing else.
 */
export function covers(declared: string, reference: string): boolean {
  const d = prefixOf(declared);
  const r = prefixOf(reference);

  if (isGlob(declared) && isGlob(reference)) return d.startsWith(r) || r.startsWith(d);
  if (isGlob(declared)) return r.startsWith(d);
  if (isGlob(reference)) return d.startsWith(r);
  return d === r;
}

/**
 * A WCS module is consumed when something references the index IT declares.
 *
 * The first version asked whether any index name contained the module name.
 * Module names are paths — `content/decoders`, `ai-assistant/sessions` — so
 * that could never match: it reported 38 of 39 modules as unconsumed, a 97%
 * false-positive rate dressed as a table. The link was declared all along, in
 * each module's own template-settings.json.
 *
 * A module that declares no index cannot be judged, so it is not reported.
 */
function wcsIsConsumed(
  module: { indexPatterns: string[] },
  references: readonly IndexReference[],
): boolean {
  if (module.indexPatterns.length === 0) return true;
  return module.indexPatterns.some((pattern) =>
    references.some((r) => covers(pattern, r.name)),
  );
}

export function buildCrosscheck(input: CrosscheckInput): CrosscheckJson {
  const referencedNames = input.references.map((r) => r.name);
  const declaredPatterns = input.declared.map((d) => d.pattern);

  const declaredUnreferenced: DeclaredIndex[] = input.declared
    .filter((d) => !referencedNames.some((name) => covers(d.pattern, name)))
    .sort((a, b) => a.pattern.localeCompare(b.pattern) || a.template.localeCompare(b.template));

  // One entry per referencing site, not per name: a reader needs the file and
  // line to act on it, and the same undeclared name reached from two places is
  // two things to fix.
  const referencedUndeclared: IndexReference[] = input.references
    .filter((r) => !declaredPatterns.some((pattern) => covers(pattern, r.name)))
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) || a.file.localeCompare(b.file) || a.line - b.line,
    );

  // The join's matches, kept instead of discarded. Same `covers` predicate as
  // the two filters above, so a pair appears here exactly when it is absent
  // from both orphan lists -- the three sets partition the join and cannot
  // disagree about what matched.
  const matched: MatchedIndex[] = input.declared
    .flatMap((d) =>
      input.references
        .filter((r) => covers(d.pattern, r.name))
        .map((reference) => ({ pattern: d.pattern, template: d.template, reference })),
    )
    .sort(
      (a, b) =>
        a.pattern.localeCompare(b.pattern) ||
        a.reference.name.localeCompare(b.reference.name) ||
        a.reference.file.localeCompare(b.reference.file) ||
        a.reference.line - b.reference.line,
    );

  const wcsWithoutConsumer = input.wcsModules
    .filter((module) => !wcsIsConsumed(module, input.references))
    .map((module) => module.name)
    .sort((a, b) => a.localeCompare(b));

  // Only a catalog literal DECLARES a name. An import consumes one, and a saved
  // object names one without declaring it, so neither competes.
  const declaringFiles = new Map<string, Set<string>>();
  for (const r of input.references) {
    if (r.via !== "catalog-literal") continue;
    const files = declaringFiles.get(r.name) ?? new Set<string>();
    files.add(r.file);
    declaringFiles.set(r.name, files);
  }

  const competingCatalogs: CompetingCatalog[] = [...declaringFiles.entries()]
    .filter(([, files]) => files.size > 1)
    .map(([name, files]) => ({ name, files: [...files].sort((a, b) => a.localeCompare(b)) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // `coverage` is first on purpose: a reader scrolling this file meets the
  // limits before the findings. "No consumer found" is not "no consumer
  // exists", and the difference is the whole honesty of the report.
  return {
    meta: { generatedAt: input.generatedAt, tool: input.tool },
    ref: input.ref,
    coverage: {
      recoveredNames: new Set(input.references.map((r) => r.name)).size,
      scannedRepos: [...input.scannedRepos].sort((a, b) => a.localeCompare(b)),
      uncovered: input.uncovered,
    },
    declaredUnreferenced,
    referencedUndeclared,
    matched,
    wcsWithoutConsumer,
    competingCatalogs,
  };
}

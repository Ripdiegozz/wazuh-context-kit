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
function prefixOf(pattern: string): string {
  return pattern.endsWith("*") ? pattern.slice(0, -1) : pattern;
}

/**
 * Two globs overlap when either could match an index the other does.
 *
 * `wazuh-findings-v5*` and `wazuh-findings-v5-cloud-services*` overlap: the
 * repository declares the general form and the running indexer expands it into
 * a template per category, so a reference to the specific one is declared.
 */
function overlaps(a: string, b: string): boolean {
  const [x, y] = [prefixOf(a), prefixOf(b)];
  return x.startsWith(y) || y.startsWith(x);
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
    references.some((r) => overlaps(pattern, r.name)),
  );
}

export function buildCrosscheck(input: CrosscheckInput): CrosscheckJson {
  const referencedNames = input.references.map((r) => r.name);
  const declaredPatterns = input.declared.map((d) => d.pattern);

  const declaredUnreferenced: DeclaredIndex[] = input.declared
    .filter((d) => !referencedNames.some((name) => overlaps(d.pattern, name)))
    .sort((a, b) => a.pattern.localeCompare(b.pattern) || a.template.localeCompare(b.template));

  // One entry per referencing site, not per name: a reader needs the file and
  // line to act on it, and the same undeclared name reached from two places is
  // two things to fix.
  const referencedUndeclared: IndexReference[] = input.references
    .filter((r) => !declaredPatterns.some((pattern) => overlaps(pattern, r.name)))
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) || a.file.localeCompare(b.file) || a.line - b.line,
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
    wcsWithoutConsumer,
    competingCatalogs,
  };
}

/**
 * `scanIndexReferences` — index names referenced by dashboard plugin source
 * (SPEC 1.8; source-parse delta).
 *
 * "Which index a plugin reads is a code fact, not a manifest fact." There is no
 * type checker available here: `typescript@7.0.2` is the Go port and ships no
 * JS-callable compiler API, and the two ways to obtain one — a second copy of
 * TypeScript, or moving the project's own toolchain to the classic line — were
 * both rejected. So recovery is syntactic.
 *
 * REVIEW TRIGGER: TypeScript 7.1 is expected to publish a public compiler API.
 * When it ships, the `computed-expression` uncoverage below becomes recoverable
 * without adding a package, and this module should be revisited. That is debt
 * with a date, not a permanent limit.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { IndexReference, UncoveredMechanism } from "../matrix/types.ts";
import type { ParseTarget } from "./types.ts";

export interface ScanResult {
  references: IndexReference[];
  uncovered: UncoveredMechanism[];
  /** Excluded from the reference set: a fixture is not a consumer. */
  testFilesSkipped: number;
}

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

/**
 * Test files are not consumers.
 *
 * A fixture naming an index is evidence that somebody knows the name, not that
 * the product reads it. Measured: three of six findings came only from tests —
 * `wazuh-does-not-matter*`, `wazuh-alerts-*`, `wazuh-agents-index-*`. The first
 * is self-describing.
 *
 * A name that appears in BOTH a test and production still counts, because
 * production is where it was found.
 */
function isTestFile(path: string): boolean {
  return (
    /\.(test|spec)\.[jt]sx?$/.test(path) ||
    /(^|\/)(test|tests|__tests__|__mocks__)\//.test(path) ||
    /\.mock\.[jt]sx?$/.test(path)
  );
}

/**
 * Real indices whose identifier breaks the naming convention.
 *
 * Sample data gets indexed, so these are genuine index names — they simply
 * carry no `_PATTERN` suffix. Naming them beats silently discarding two true
 * positives.
 */
const IDENTIFIER_EXCEPTIONS = new Set([
  "WAZUH_SAMPLE_INVENTORY_AGENT",
  "WAZUH_SAMPLE_VULNERABILITIES",
]);

/**
 * Index-shaped strings that are not indices.
 *
 * Outside a catalog there is no identifier to corroborate the value, so these
 * have to be named. All three were found in the real code: two are the
 * operating-system user and group the platform installs as, one is a
 * saved-object template name.
 */
const VALUE_DENYLIST = new Set(["wazuh-dashboard", "wazuh-kibana"]);

function toPosix(path: string): string {
  return path.split("\\").join("/");
}

/** A value shaped like an index: `wazuh-…` or a dot-prefixed system index. */
function looksLikeIndex(value: string): boolean {
  if (VALUE_DENYLIST.has(value)) return false;
  if (!/^\.?wazuh-/.test(value) && !/^\.opendistro-/.test(value)) return false;

  // A leading dot marks a system index; an INTERNAL dot means this is not an
  // index at all. Without this, the prefix test alone admits every package
  // filename in the repository -- `wazuh-agent-5.0.0.aarch64.rpm`,
  // `wazuh-agent_5.0.0_amd64.deb`, `wazuh-agent-5.0.0.msi`. Measured against
  // the running indexer, none of the 94 names the prefix test alone produced
  // existed; this is what separates a name from a filename.
  return !value.slice(1).includes(".");
}

/** An identifier the codebase uses for index names. */
function looksLikeIndexIdentifier(name: string): boolean {
  return name.endsWith("_PATTERN") || name.endsWith("_INDEX") || IDENTIFIER_EXCEPTIONS.has(name);
}

/**
 * Both signals must agree.
 *
 * Measured against the real `constants.ts`: the value test alone admits an
 * operating-system user (`PLUGIN_PLATFORM_INSTALLATION_USER = 'wazuh-dashboard'`)
 * and a saved-object template name; the identifier test alone admits a FIELD
 * name (`NOT_TIME_FIELD_NAME_INDEX_PATTERN`). Together they select exactly the
 * 47 real names.
 */
function isIndexConstant(identifier: string, value: string): boolean {
  return looksLikeIndexIdentifier(identifier) && looksLikeIndex(value);
}

/**
 * `export const NAME = 'value';` — on one line, or wrapped onto the next.
 *
 * Prettier wraps past 80 columns, and in the real catalog 166 of 300 literals
 * are wrapped. A single-line pattern recovers under half.
 */
const CONST_LITERAL = /^export const ([A-Z_0-9]+) =\s*(?:\n\s*)?'([^']*)';/gm;

/**
 * Every `export const` declaration, literal or not.
 *
 * Expressions are computed by subtracting the literal matches from these rather
 * than by a negative lookahead: `=\s*(?!')` backtracks `\s*` to zero and then
 * tests the lookahead against the space, so every literal matches too.
 */
const CONST_ANY = /^export const ([A-Z_0-9]+)\s*=/gm;

const IMPORT_NAMES = /^import\s*\{([^}]*)\}\s*from\s*['"][^'"]+['"]/gm;
const REGEX_ALLOWLIST = /=\s*\/\^?[^/\n]*wazuh-[^/\n]*\//;
const RUNTIME_CONFIG = /configuration\s*\.\s*get\s*\(/;

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

async function listFiles(root: string): Promise<string[]> {
  try {
    return (await readdir(root, { recursive: true })).map(toPosix);
  } catch {
    return [];
  }
}

export async function scanIndexReferences(target: ParseTarget): Promise<ScanResult> {
  const entries = await listFiles(target.dir);

  const references: IndexReference[] = [];
  const uncovered: UncoveredMechanism[] = [];
  /** identifier -> index name, from every catalog in the tree. */
  const catalog = new Map<string, string>();

  const allSource = entries.filter((e) => SOURCE_EXTENSIONS.some((x) => e.endsWith(x)));
  const sourceFiles = allSource.filter((e) => !isTestFile(e));
  const testFilesSkipped = allSource.length - sourceFiles.length;
  const ndjsonFiles = entries.filter((e) => e.endsWith(".ndjson"));

  // Pass 1: catalogs. Identifiers must be known before an import can mean anything.
  for (const file of sourceFiles) {
    let text: string;
    try {
      text = await readFile(join(target.dir, file), "utf8");
    } catch {
      continue;
    }

    for (const m of text.matchAll(CONST_LITERAL)) {
      const [, identifier, value] = m as unknown as [string, string, string];
      if (!isIndexConstant(identifier, value)) continue;
      catalog.set(identifier, value);
      references.push({
        name: value,
        file,
        line: lineOf(text, m.index!),
        via: "catalog-literal",
        identifier,
      });
    }

    // An `export const` that is not a literal is an expression we cannot fold.
    //
    // Only reported for modules that ARE catalogs -- one that declares at least
    // one real index name. An ordinary module full of expressions is not a
    // coverage gap, and reporting it would drown the real ones.
    const literalNames = new Set(
      [...text.matchAll(CONST_LITERAL)].map((m) => (m as unknown as string[])[1]!),
    );
    const isCatalog = [...text.matchAll(CONST_LITERAL)].some(
      (m) => isIndexConstant((m as unknown as string[])[1]!, (m as unknown as string[])[2]!),
    );
    if (isCatalog) {
      for (const m of text.matchAll(CONST_ANY)) {
        const identifier = (m as unknown as string[])[1]!;
        if (literalNames.has(identifier)) continue;
        uncovered.push({
          kind: "computed-expression",
          file,
          line: lineOf(text, m.index!),
          note: `${identifier} is assembled, not a literal; folding it needs a type checker`,
        });
      }
    }

    if (REGEX_ALLOWLIST.test(text)) {
      const index = text.search(REGEX_ALLOWLIST);
      uncovered.push({
        kind: "regex-allowlist",
        file,
        line: lineOf(text, index),
        note: "indices are accepted by shape; no name exists here as a string",
      });
    }

    if (RUNTIME_CONFIG.test(text)) {
      const index = text.search(RUNTIME_CONFIG);
      uncovered.push({
        kind: "runtime-configuration",
        file,
        line: lineOf(text, index),
        note: "the index name comes from the deployed instance's configuration",
      });
    }
  }

  // Pass 1b: index-shaped literals the code itself marks as indices.
  //
  // The catalog convention holds in `plugins/main` and nowhere else: the
  // threat-intel indices live in an object map keyed `decoders`/`kvdbs`, and
  // the single-plugin forks compare inline. Requiring an identifier suffix made
  // six live indices look unconsumed.
  //
  // But the value alone discriminates nothing. Accepting every `wazuh-`
  // literal produced 77 distinct names of which ZERO existed in the running
  // indexer — packages, hosts, repositories, environments, test fixtures. This
  // organisation prefixes everything.
  //
  // So the second signal is CONTEXT: the surrounding code has to say the string
  // is an index. That is what both real shapes provide.
  for (const file of sourceFiles) {
    let text: string;
    try {
      text = await readFile(join(target.dir, file), "utf8");
    } catch {
      continue;
    }

    const lines = text.split("\n");
    // Depth inside an enclosing `const SOMETHING_INDEX... = {` block, so a map
    // of index names counts even though its keys are `decoders`, not
    // `DECODERS_PATTERN`.
    let indexMapDepth = 0;

    lines.forEach((line, i) => {
      if (indexMapDepth > 0) {
        indexMapDepth += (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0);
      } else if (/\b(?:const|let|var)\s+[A-Za-z_0-9]*(?:INDEX|PATTERN|Index|Pattern)[A-Za-z_0-9]*\b[^=]*=\s*\{/.test(line)) {
        indexMapDepth = 1;
      }

      const sameLineContext =
        /\bindex\s*:/.test(line) ||
        /\.index\b/.test(line) ||
        /\bindexName\b/.test(line) ||
        /\bindex_patterns?\b/.test(line) ||
        /\bindexPattern\b/.test(line);

      if (indexMapDepth === 0 && !sameLineContext) return;

      for (const m of line.matchAll(/['"`](\.?[a-z][a-z0-9.*_-]*)['"`]/g)) {
        const value = m[1]!;
        if (!looksLikeIndex(value)) continue;
        const alreadyCatalogued = references.some(
          (r) => r.via === "catalog-literal" && r.file === file && r.name === value,
        );
        if (alreadyCatalogued) continue;
        references.push({ name: value, file, line: i + 1, via: "inline-literal" });
      }
    });
  }

  // Pass 2: import edges. A consumer naming a known identifier consumes it.
  for (const file of sourceFiles) {
    let text: string;
    try {
      text = await readFile(join(target.dir, file), "utf8");
    } catch {
      continue;
    }

    for (const m of text.matchAll(IMPORT_NAMES)) {
      const line = lineOf(text, m.index!);
      for (const raw of (m as unknown as string[])[1]!.split(",")) {
        const identifier = raw.trim().split(/\s+as\s+/)[0]!.trim();
        const name = catalog.get(identifier);
        if (name === undefined) continue;
        references.push({ name, file, line, via: "import", identifier });
      }
    }
  }

  // Pass 3: saved objects. One JSON per line -- a whole-file parse throws, and
  // a grep cannot tell an index title from any other string.
  for (const file of ndjsonFiles) {
    let text: string;
    try {
      text = await readFile(join(target.dir, file), "utf8");
    } catch {
      continue;
    }

    text.split("\n").forEach((rawLine, i) => {
      if (rawLine.trim() === "") return;
      let parsed: { references?: unknown };
      try {
        parsed = JSON.parse(rawLine) as { references?: unknown };
      } catch {
        return;
      }

      // The index name is NOT the object's own `type`/`id`. Every line here is
      // a `visualization` or a `dashboard`; the index it reads appears inside
      // its `references` array as `{type: "index-pattern", id: "<index name>"}`.
      // Checking the top-level type finds nothing at all -- verified against
      // the real checkout, where 384 visualizations and 78 dashboards yield 25
      // distinct index ids and zero top-level index-pattern objects.
      if (!Array.isArray(parsed.references)) return;
      for (const ref of parsed.references as Array<Record<string, unknown>>) {
        if (ref?.type !== "index-pattern" || typeof ref.id !== "string") continue;
        if (!looksLikeIndex(ref.id)) continue;
        references.push({ name: ref.id, file, line: i + 1, via: "saved-object" });
      }
    });
  }

  references.sort(
    (a, b) =>
      a.name.localeCompare(b.name) || a.file.localeCompare(b.file) || a.line - b.line,
  );
  uncovered.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.kind.localeCompare(b.kind),
  );

  return { references, uncovered, testFilesSkipped };
}

#!/usr/bin/env node
/**
 * wazuh-ctx — single binary for the whole kit (SPEC 1.1).
 *
 * Argument parsing uses node:util parseArgs. Six subcommands do not justify
 * commander or yargs.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { allFacts } from "../fixtures/facts.ts";
import { loadHumanLayers } from "./decisions/load.ts";
import { cacheDirFor } from "./fetch/clone.ts";
import { createFetchIo } from "./fetch/git-runner.ts";
import { fetchRepos } from "./fetch/index.ts";
import { buildMatrix } from "./matrix/build.ts";
import { renderMatrixMarkdown } from "./matrix/render.ts";
import type { BuildInput } from "./matrix/types.ts";
import { buildCrosscheck } from "./crosscheck/build.ts";
import { buildLiveComparison, declaredFromWcsModules } from "./crosscheck/live.ts";
import { renderCrosscheckMarkdown } from "./crosscheck/render.ts";
import { renderLiveComparisonJson, renderLiveComparisonText } from "./crosscheck/render-live.ts";
import { fetchClusterState } from "./indexer/client.ts";
import { IndexerError } from "./indexer/types.ts";
import type { FetchLike, HttpResponseLike } from "./indexer/types.ts";
import { scanIndexReferences } from "./parse/index-references.ts";
import { parseFetchedRepos, toParseTargets } from "./parse/index.ts";
import { loadSources } from "./sources.ts";

const VERSION = "0.1.0";
const TOOL = `wazuh-ctx@${VERSION}`;

/** Fixture SHAs are fixed, so the instant they were "resolved" is fixed too. */
const FIXTURE_RESOLVED_AT = "2026-09-14T00:00:00Z";

const USAGE = `wazuh-ctx ${VERSION}

  Generated, verifiable domain context for the Wazuh dashboard and indexer.

USAGE
  wazuh-ctx <command> [options]

COMMANDS
  matrix        Generate out/<ref>/matrix.json and MATRIX.md
  crosscheck    Declared indices vs indices the dashboard actually references
  skills-diff   Three-way diff of the shared .claude skills
  sync          Materialise .claude/standards/ from the package
  check         Verify .claude/standards/ against the package
  serve         Local inspector UI
  mcp           MCP server: docs | schema | runtime

OPTIONS
  --ref <ref>           Branch to target (default: 5.0.0)
  --fixtures            Build from bundled fixtures; no clone, no network
  --refresh             Refresh cached checkouts in place instead of reusing them
  --strict              Exit non-zero when unknowns[] is non-empty
  --frozen-time <iso>   Pin meta.generatedAt for reproducible runs
  --out <dir>           Output directory (default: out)
  --indexer <url>       crosscheck: also compare against a running indexer (read-only)
  --indexer-skip-tls-verify
                        crosscheck: accept a certificate that does not validate
  --format <text|json>  crosscheck: format of the --indexer comparison on stdout (default: text)
  -h, --help            Show this message
  -v, --version         Show version

ENVIRONMENT (crosscheck --indexer only)
  WAZUH_CTX_INDEXER_USERNAME, WAZUH_CTX_INDEXER_PASSWORD
                        Indexer credentials. Never read from sources.yml.
`;

interface CommandResult {
  code: number;
}

/** Oldest wins: staleness must be conservative (design decision, resolvedAt). */
function oldestIso(values: readonly string[]): string | null {
  if (values.length === 0) return null;
  return values.reduce((oldest, current) => (current < oldest ? current : oldest));
}

async function buildFromFixtures(
  layers: Awaited<ReturnType<typeof loadHumanLayers>>,
  ref: string,
  generatedAt: string,
): Promise<BuildInput> {
  return {
    decisions: layers.decisions,
    annotations: layers.annotations,
    ref,
    facts: allFacts,
    // Fixtures declare no platform repository, so there is no core section to
    // build. Empty by construction, not by omission.
    coreRepos: [],
    resolvedRefs: Object.fromEntries(
      [...new Set(allFacts.map((f) => f.repo))].map((repo) => [
        repo,
        allFacts.find((f) => f.repo === repo)!.commit,
      ]),
    ),
    // Fixture SHAs are constants, so their resolution instant is one too.
    resolvedAt: FIXTURE_RESOLVED_AT,
    generatedAt,
    tool: TOOL,
    skipped: [{ repo: "wazuh-dashboard-ml-commons", reason: "no 5.0.0 branch" }],
  };
}

async function buildFromRealData(
  layers: Awaited<ReturnType<typeof loadHumanLayers>>,
  ref: string,
  generatedAt: string,
  refresh: boolean,
): Promise<BuildInput | { fatal: string }> {
  let sources: Awaited<ReturnType<typeof loadSources>>;
  try {
    sources = await loadSources(process.cwd());
  } catch (error) {
    return { fatal: (error as Error).message };
  }

  const cacheRoot = resolve(process.cwd(), ".cache");
  const io = createFetchIo();

  let fetchOutcome: Awaited<ReturnType<typeof fetchRepos>>;
  try {
    fetchOutcome = await fetchRepos({ repos: sources.repos, ref, cacheRoot, refresh, io });
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return { fatal: `git not found on PATH (${err.message})` };
    }
    throw error;
  }

  const targets = toParseTargets(sources, fetchOutcome.fetched);
  const parsed = await parseFetchedRepos(targets);

  // resolvedAt lives inside the hashed payload (build.ts) and must never come
  // from the wall clock (design finding 1): read it back from the cache
  // stamp fetch/ already wrote, oldest across all fetched repos.
  const stampResolvedAts = await Promise.all(
    fetchOutcome.fetched.map(async (repo) => {
      const stampPath = `${cacheDirFor(cacheRoot, repo.repo, ref)}.fetch.json`;
      const raw = await io.readStamp(stampPath);
      if (raw === null) return null;
      try {
        return (JSON.parse(raw) as { resolvedAt: string }).resolvedAt;
      } catch {
        return null;
      }
    }),
  );
  const validResolvedAts = stampResolvedAts.filter((value): value is string => value !== null);
  // Edge case: nothing fetched at all (every repo skipped) — nothing to be
  // deterministic about, so the clock is the only reasonable source left.
  const resolvedAt = oldestIso(validResolvedAts) ?? io.now();

  return {
    decisions: layers.decisions,
    annotations: layers.annotations,
    ref,
    facts: parsed.facts,
    coreRepos: parsed.coreRepos,
    templates: parsed.templates,
    wcsModules: parsed.wcsModules,
    resolvedRefs: Object.fromEntries(fetchOutcome.fetched.map((f) => [f.repo, f.commit])),
    resolvedAt,
    generatedAt,
    tool: TOOL,
    skipped: fetchOutcome.skipped,
  };
}

async function runMatrix(values: Record<string, unknown>): Promise<CommandResult> {
  const ref = (values.ref as string | undefined) ?? "5.0.0";
  const outDir = (values.out as string | undefined) ?? "out";
  const frozenTime = values["frozen-time"] as string | undefined;
  const useFixtures = values.fixtures === true;
  const useRefresh = values.refresh === true;

  const layers = await loadHumanLayers(process.cwd());
  const now = new Date().toISOString();
  const generatedAt = frozenTime ?? now;

  const input = useFixtures
    ? await buildFromFixtures(layers, ref, generatedAt)
    : await buildFromRealData(layers, ref, generatedAt, useRefresh);

  if ("fatal" in input) {
    console.error(`wazuh-ctx matrix: ${input.fatal}`);
    return { code: 2 };
  }

  const matrix = buildMatrix(input);
  const markdown = renderMatrixMarkdown(matrix);

  const target = join(outDir, ref);
  await mkdir(target, { recursive: true });
  await writeFile(join(target, "matrix.json"), `${JSON.stringify(matrix, null, 2)}\n`, "utf8");
  await writeFile(join(target, "MATRIX.md"), markdown, "utf8");

  const asserted = matrix.plugins.reduce(
    (total, plugin) => total + Object.keys(plugin.assertions).length,
    0,
  );

  console.log(`ref           ${matrix.ref}`);
  console.log(`plugins       ${matrix.plugins.length}`);
  const corePlugins = matrix.core.reduce((total, repo) => total + repo.plugins.length, 0);
  console.log(`core plugins  ${corePlugins} from ${matrix.core.length} platform repo(s)`);
  console.log(`unresolved    ${matrix.unresolvedDependencies.length} dependency edge(s)`);
  console.log(`asserted      ${asserted} cell(s) from decisions.yml`);
  console.log(`unknowns      ${matrix.unknowns.length}`);
  console.log(`skipped       ${matrix.skipped.length}`);
  console.log(`payloadHash   ${matrix.payloadHash}`);
  console.log(`written       ${join(target, "matrix.json")}`);
  console.log(`              ${join(target, "MATRIX.md")}`);

  if (matrix.unknowns.length > 0) {
    console.log("\nunknowns — pending human decision (SPEC 1.5.4):");
    for (const unknown of matrix.unknowns) {
      console.log(`  ${unknown.plugin}.${unknown.field}: ${unknown.reason}`);
    }
  }

  const conflicts = matrix.reconciliation.filter((entry) => entry.conflict === true);
  if (conflicts.length > 0) {
    console.log("\nCONFLICTS — a rule or a decision is wrong (SPEC 5.4):");
    for (const entry of conflicts) {
      console.log(
        `  ${entry.plugin}.${entry.field}: decided ${JSON.stringify(entry.decidedValue)}, ` +
          `derived ${JSON.stringify(entry.derivedValue)}`,
      );
    }
  }

  const retirable = matrix.reconciliation.filter(
    (entry) => entry.status === "superseded" && entry.conflict !== true,
  );
  if (retirable.length > 0) {
    console.log("\nsuperseded — now derivable, retire from decisions.yml:");
    for (const entry of retirable) {
      console.log(`  ${entry.plugin}.${entry.field}`);
    }
  }

  if (values.strict === true && matrix.unknowns.length > 0) {
    console.error(`\n--strict: ${matrix.unknowns.length} unresolved field(s).`);
    return { code: 1 };
  }

  return { code: 0 };
}

/**
 * `crosscheck` — SPEC 1.8. Which indices the indexer declares, against which
 * the dashboard actually references.
 *
 * Scanning source is deliberately NOT part of `matrix`: it reads thousands of
 * files and the matrix does not need it. Only this command pays for it.
 */
async function runCrosscheck(values: Record<string, unknown>): Promise<CommandResult> {
  const ref = (values.ref as string | undefined) ?? "5.0.0";
  const outDir = (values.out as string | undefined) ?? "out";
  const frozenTime = values["frozen-time"] as string | undefined;

  // The crosscheck reads plugin SOURCE, which the fixtures do not carry.
  // Accepting the flag and cloning anyway would make a documented no-network
  // mode quietly reach the network.
  if (values.fixtures === true) {
    console.error(
      "wazuh-ctx crosscheck: --fixtures is not supported; it applies to `matrix` only.\n" +
        "The crosscheck scans plugin source, which the bundled fixtures do not contain.",
    );
    return { code: 2 };
  }

  let sources: Awaited<ReturnType<typeof loadSources>>;
  try {
    sources = await loadSources(process.cwd());
  } catch (error) {
    console.error(`wazuh-ctx crosscheck: ${(error as Error).message}`);
    return { code: 2 };
  }

  const cacheRoot = resolve(process.cwd(), ".cache");
  const io = createFetchIo();

  let fetchOutcome: Awaited<ReturnType<typeof fetchRepos>>;
  try {
    fetchOutcome = await fetchRepos({
      repos: sources.repos,
      ref,
      cacheRoot,
      refresh: values.refresh === true,
      io,
    });
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      console.error(`wazuh-ctx crosscheck: git not found on PATH (${err.message})`);
      return { code: 2 };
    }
    throw error;
  }

  const targets = toParseTargets(sources, fetchOutcome.fetched);
  const parsed = await parseFetchedRepos(targets);

  // One DeclaredIndex per pattern: a template may declare several.
  const declared = parsed.templates.flatMap((template) =>
    template.indexPatterns.map((pattern) => ({
      pattern,
      template: template.path,
      group: template.group,
    })),
  );

  const references = [];
  const uncovered = [];
  const scannedRepos: string[] = [];
  for (const target of targets) {
    if (target.repoKind !== "dashboard") continue;
    const scan = await scanIndexReferences(target);
    references.push(...scan.references);
    uncovered.push(...scan.uncovered);
    scannedRepos.push(target.repo);
  }

  const crosscheck = buildCrosscheck({
    ref,
    generatedAt: frozenTime ?? new Date().toISOString(),
    tool: TOOL,
    declared,
    references,
    uncovered,
    wcsModules: parsed.wcsModules.map((m) => ({ name: m.name, indexPatterns: m.indexPatterns })),
    scannedRepos,
  });

  const target = join(outDir, ref);
  await mkdir(target, { recursive: true });
  await writeFile(
    join(target, "crosscheck.json"),
    `${JSON.stringify(crosscheck, null, 2)}\n`,
    "utf8",
  );
  await writeFile(join(target, "CROSSCHECK.md"), renderCrosscheckMarkdown(crosscheck), "utf8");

  const indexerUrl = values.indexer as string | undefined;
  const format = (values.format as string | undefined) ?? "text";
  // `--format json` is a documented machine-readable STREAM (docs/live-
  // indexer.md: "get the comparison as a machine-readable stream"). That
  // promise means stdout carries the JSON document and nothing else, so
  // `--indexer ... --format json | jq` works on the real output. The human
  // summary below still has somewhere to go -- stderr -- it just cannot
  // share stdout with the JSON. Text mode (the default, and the case with no
  // `--indexer` at all) is unaffected: the summary stays on stdout, which is
  // the existing, read-by-humans behaviour.
  const jsonStdoutOnly = indexerUrl !== undefined && format === "json";
  const summary = jsonStdoutOnly ? console.error : console.log;

  summary(`ref                    ${crosscheck.ref}`);
  summary(`declared indices       ${declared.length}`);
  summary(`recovered names        ${crosscheck.coverage.recoveredNames}`);
  summary(`repos scanned          ${scannedRepos.length}`);
  summary(`declared unreferenced  ${crosscheck.declaredUnreferenced.length}`);
  summary(`referenced undeclared  ${crosscheck.referencedUndeclared.length}`);
  summary(`wcs without consumer   ${crosscheck.wcsWithoutConsumer.length}`);
  summary(`competing catalogs     ${crosscheck.competingCatalogs.length}`);
  summary(`UNCOVERED mechanisms   ${crosscheck.coverage.uncovered.length}  <- this report is not complete`);
  summary(`written                ${join(target, "crosscheck.json")}`);
  summary(`                       ${join(target, "CROSSCHECK.md")}`);

  // The live comparison, strictly after both writeFile calls above. This is
  // what makes the byte-identical guarantee (SPEC: "runtime data never
  // enters the committed artifact") hold BY CONSTRUCTION: nothing below this
  // line can reach the values already written to out/<ref>/, because by the
  // time it runs they are already on disk.
  if (indexerUrl !== undefined) {
    const username = process.env.WAZUH_CTX_INDEXER_USERNAME;
    const password = process.env.WAZUH_CTX_INDEXER_PASSWORD;
    // Never both guessed at: either both are present, or none are sent. A
    // 401 already covers "missing or wrong"; there is no third message to
    // invent for "half-supplied".
    const credentials = username !== undefined && password !== undefined ? { username, password } : undefined;
    const skipTlsVerify = values["indexer-skip-tls-verify"] === true;

    // Bun's `fetch` already accepts the per-request `tls` override this
    // client needs (design decision 5); this closure is the one place that
    // touches the real network for the whole command.
    const transport: FetchLike = (url, init) =>
      fetch(url, init as RequestInit) as unknown as Promise<HttpResponseLike>;

    try {
      const state = await fetchClusterState(transport, indexerUrl, credentials, { skipTlsVerify });
      // The live comparison's declared set is templates PLUS WCS modules: a
      // WCS module's own template-settings.json declares patterns exactly
      // like an indexer template does, and `declared` above (used for the
      // OFFLINE crosscheck) deliberately does not carry them -- see
      // declaredFromWcsModules's docblock for the defect this fixes.
      const liveDeclared = [...declared, ...declaredFromWcsModules(parsed.wcsModules)];
      const live = buildLiveComparison(state, liveDeclared);
      if (jsonStdoutOnly) {
        // Nothing else may touch stdout in this mode -- not even a leading
        // blank line -- or the stream stops being valid JSON.
        console.log(renderLiveComparisonJson(live));
      } else {
        console.log("");
        console.log(renderLiveComparisonText(live));
      }
    } catch (error) {
      if (error instanceof IndexerError) {
        console.error(`wazuh-ctx crosscheck: ${error.message}`);
        return { code: 2 };
      }
      throw error;
    }
  }

  return { code: 0 };
}

function notImplemented(command: string, specSection: string): CommandResult {
  console.error(
    `wazuh-ctx ${command}: not implemented yet. See SPEC ${specSection}.\n` +
      "Build order is deliberate (SPEC 7) — this phase has not started.",
  );
  return { code: 2 };
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (!command || command === "-h" || command === "--help" || command === "help") {
    console.log(USAGE);
    return 0;
  }

  if (command === "-v" || command === "--version" || command === "version") {
    console.log(VERSION);
    return 0;
  }

  let parsed;
  try {
    parsed = parseArgs({
      args: argv.slice(1),
      allowPositionals: true,
      options: {
        ref: { type: "string" },
        out: { type: "string" },
        "frozen-time": { type: "string" },
        fixtures: { type: "boolean" },
        refresh: { type: "boolean" },
        strict: { type: "boolean" },
        indexer: { type: "string" },
        "indexer-skip-tls-verify": { type: "boolean" },
        format: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (error) {
    console.error(`wazuh-ctx: ${(error as Error).message}`);
    return 64;
  }

  if (parsed.values.help === true) {
    console.log(USAGE);
    return 0;
  }

  switch (command) {
    case "matrix":
      return (await runMatrix(parsed.values)).code;
    case "crosscheck":
      return (await runCrosscheck(parsed.values)).code;
    case "skills-diff":
      return notImplemented("skills-diff", "2.1").code;
    case "sync":
      return notImplemented("sync", "2.3").code;
    case "check":
      return notImplemented("check", "2.3").code;
    case "serve":
      // Moved to LAST in the build order (SPEC 7, 2026-09-16): an inspector
      // built now would show 9 plugins and 3 unknowns; built after Phases 2
      // and 3 it shows the standards package and the MCP surface too. The
      // "1.5" in its name no longer indicates its position.
      return notImplemented("serve", "Phase 1.5, now last in SPEC 7").code;
    case "mcp":
      return notImplemented("mcp", "Phase 3").code;
    default:
      console.error(`wazuh-ctx: unknown command '${command}'\n`);
      console.log(USAGE);
      return 64;
  }
}

process.exit(await main());

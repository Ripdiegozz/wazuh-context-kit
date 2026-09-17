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
import { createFetchIo, createGitRunner } from "./fetch/git-runner.ts";
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
import { loadDataset } from "./mcp/dataset.ts";
import type { DocsFetchLike, DocsHttpResponseLike } from "./mcp/docs.ts";
import { resolveRuntimeBackend } from "./mcp/runtime.ts";
import type { RuntimeFetchLike, RuntimeHttpResponseLike } from "./mcp/runtime.ts";
import { buildMcpServer } from "./mcp/server.ts";
import { runStartup } from "./mcp/startup.ts";
import { createTelemetrySink } from "./mcp/telemetry.ts";
import { parseFetchedRepos, toParseTargets } from "./parse/index.ts";
import { scanIndexReferences } from "./parse/index-references.ts";
import { buildSkillsDiffJson } from "./skills/diff.ts";
import { emitExtraction } from "./skills/emit.ts";
import { extractSkill } from "./skills/extract.ts";
import type { ExtractedSkill } from "./skills/extract.ts";
import { loadSkills } from "./skills/load.ts";
import { renderSkillsDiffMarkdown } from "./skills/render.ts";
import { loadSettingsVariants } from "./settings/load.ts";
import { mergeSettings } from "./settings/merge.ts";
import type { MergedSettings } from "./settings/types.ts";
import { createNodeServeFs } from "./serve/handlers.ts";
import { startServeServer } from "./serve/server.ts";
import { loadSources } from "./sources.ts";
import { applySync, checkStandards } from "./standards/apply.ts";
import { planSync } from "./standards/plan.ts";
import { renderSyncSummary } from "./standards/render.ts";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

const VERSION = "0.1.0";
const TOOL = `wazuh-ctx@${VERSION}`;

/** Matches the dev proxy target in `ui/vite.config.ts`; both must move together. */
const DEFAULT_SERVE_PORT = 4590;

/** Fixture SHAs are fixed, so the instant they were "resolved" is fixed too. */
const FIXTURE_RESOLVED_AT = "2026-09-14T00:00:00Z";

const USAGE = `wazuh-ctx ${VERSION}

  Generated, verifiable domain context for the Wazuh dashboard and indexer.

USAGE
  wazuh-ctx <command> [options]

COMMANDS
  matrix        Generate out/<ref>/matrix.json and MATRIX.md
  crosscheck    Declared indices vs indices the dashboard actually references
  skills-diff   Cross-repo diff of the shared .claude skills, classified and reported
                --extract also writes core/, overrides/<repo>/, conflicts/ (SPEC 2.1)
  sync          Materialise .claude/standards/ from the package (SPEC 2.3)
                --repo <name> --target <dir> are both required
  check         Verify .claude/standards/ against the package (SPEC 2.3)
                --target <dir> is required; reports not-applicable | in-sync | drifted
  serve         Local inspector UI (SPEC 1.5) — 127.0.0.1 only
  mcp           MCP server: docs | schema | runtime (stdio; SPEC Phase 3)

OPTIONS
  --ref <ref>           Branch to target (default: 5.0.0)
  --fixtures            Build from bundled fixtures; no clone, no network
  --refresh             Refresh cached checkouts in place instead of reusing them
  --strict              Exit non-zero when unknowns[] is non-empty
  --extract             skills-diff: also project core/, overrides/<repo>/, conflicts/
  --frozen-time <iso>   Pin meta.generatedAt for reproducible runs
  --out <dir>           Output directory (default: out)
  --repo <name>         sync: which repository's overrides to materialise
  --target <dir>        sync/check: the repository directory to write into / inspect
  --indexer <url>       crosscheck: also compare against a running indexer (read-only)
  --indexer-skip-tls-verify
                        crosscheck: accept a certificate that does not validate
  --format <text|json>  crosscheck: format of the --indexer comparison on stdout (default: text)
  --port <n>            serve: port to bind on 127.0.0.1 (default: 4590)
  --allow-ref-mismatch  mcp: serve schema even when the dataset ref does not
                        match the working tree's branch (refused by default)
  --no-telemetry        mcp: disable the local (plugin, field, resolved) sink entirely
  --runtime <url>       mcp: the optional runtime resource's live instance (read-only);
                        absent or unreachable degrades to "runtime unavailable" --
                        docs and schema are never affected
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
    localOverrides: layers.localOverrides,
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
    localOverrides: layers.localOverrides,
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

/**
 * `skills-diff` — SPEC 2.1. Classifies every divergent block across the seven
 * repositories that carry `.claude/skills/`, and reports the conflicts. It
 * never resolves them: a CONFLICT exit is still exit `0` (SPEC 2.1.1 — this
 * is the expected output of an analysis, not a failure).
 *
 * Deliberately no `--fixtures` support: the bundled fixtures carry no skills
 * content, and accepting the flag anyway would make a documented no-network
 * mode silently report zero skills — the exact "confident, plausible, wrong
 * zero" this change exists to close (see `matrix, crosscheck` for the sibling
 * decision on `--fixtures` scope).
 */
async function runSkillsDiff(values: Record<string, unknown>): Promise<CommandResult> {
  const ref = (values.ref as string | undefined) ?? "5.0.0";
  const outDir = (values.out as string | undefined) ?? "out";
  const frozenTime = values["frozen-time"] as string | undefined;

  if (values.fixtures === true) {
    console.error(
      "wazuh-ctx skills-diff: --fixtures is not supported; it applies to `matrix` only.\n" +
        "The bundled fixtures carry no .claude/skills content.",
    );
    return { code: 2 };
  }

  let sources: Awaited<ReturnType<typeof loadSources>>;
  try {
    sources = await loadSources(process.cwd());
  } catch (error) {
    console.error(`wazuh-ctx skills-diff: ${(error as Error).message}`);
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
      console.error(`wazuh-ctx skills-diff: git not found on PATH (${err.message})`);
      return { code: 2 };
    }
    throw error;
  }

  const kindByName = new Map(sources.repos.map((repo) => [repo.name, repo.kind]));
  const targets = fetchOutcome.fetched
    .map((f) => {
      const kind = kindByName.get(f.repo);
      return kind === undefined ? null : { repo: f.repo, repoKind: kind, dir: f.dir };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);

  const loaded = await loadSkills(targets);

  // `.claude/settings.json` sits beside `.claude/skills/`, not inside it
  // (`skills/load.ts`'s own docblock), so it is loaded separately, over the
  // SAME `targets` skills were loaded from — one fetch, two independent
  // reads of what it produced. A repository with no `settings.json` is
  // reported, never thrown and never silently dropped (`loadSettingsVariants`'s
  // own docblock).
  const loadedSettings = await loadSettingsVariants(targets);

  // `fetchRepos` reports non-fatal skips SEPARATELY from what it fetched
  // (e.g. `wazuh-dashboard-ml-commons`, skipped because it has no `5.0.0`
  // branch). Left out of `repos`, a skipped repository would simply vanish
  // from the artifact and the denominator — the exact "resolved and
  // contributed nothing" vs "could not be resolved" collapse
  // `repo-fetch`'s own requirement forbids ("A repository contributing no
  // facts is still reported"). Each skip becomes its own excluded
  // `RepoSelection`, with a reason distinct from "no .claude/skills", merged
  // in before building the artifact.
  const skippedRepos = fetchOutcome.skipped.map((s) => ({
    repo: s.repo,
    included: false,
    reason: `not fetched: ${s.reason}`,
  }));
  const allRepos = [...loaded.repos, ...skippedRepos];

  const skillsDiff = buildSkillsDiffJson({
    ref,
    generatedAt: frozenTime ?? new Date().toISOString(),
    tool: TOOL,
    repos: allRepos,
    variantsBySkill: loaded.variantsBySkill,
    singleRepoSkills: loaded.singleRepoSkills,
  });

  const target = join(outDir, ref);
  await mkdir(target, { recursive: true });
  await writeFile(
    join(target, "skills-diff.json"),
    `${JSON.stringify(skillsDiff, null, 2)}\n`,
    "utf8",
  );
  await writeFile(join(target, "SKILLS-DIFF.md"), renderSkillsDiffMarkdown(skillsDiff), "utf8");

  const included = skillsDiff.repos.filter((r) => r.included).length;
  const totalCounts = skillsDiff.skills.reduce(
    (sum, s) => ({
      common: sum.common + s.counts.common,
      override: sum.override + s.counts.override,
      sharedOverride: sum.sharedOverride + s.counts.sharedOverride,
      conflict: sum.conflict + s.counts.conflict,
    }),
    { common: 0, override: 0, sharedOverride: 0, conflict: 0 },
  );

  console.log(`ref              ${skillsDiff.ref}`);
  console.log(`repos included   ${included} of ${skillsDiff.repos.length}`);
  console.log(`skills           ${skillsDiff.skills.length}`);
  console.log(`single-repo      ${skillsDiff.singleRepoSkills.length} (reported, not diffed)`);
  console.log(`common           ${totalCounts.common}`);
  console.log(`override         ${totalCounts.override}`);
  console.log(`sharedOverride   ${totalCounts.sharedOverride}`);
  console.log(`CONFLICT         ${totalCounts.conflict}`);
  console.log(`written          ${join(target, "skills-diff.json")}`);
  console.log(`                 ${join(target, "SKILLS-DIFF.md")}`);
  console.log(`settings         ${loadedSettings.variants.length} of ${targets.length} repos carry .claude/settings.json`);
  for (const m of loadedSettings.missing) console.log(`                   ${m.repo}: ${m.reason}`);

  if (values.extract === true) {
    const extracted = skillsDiff.skills.map((skill) => extractSkill(skill));

    // Merged only when at least one repository actually carries
    // `.claude/settings.json` — merging zero variants would silently emit an
    // empty `core/.claude/settings.json` for a run that never saw the file
    // at all, which is exactly the "confident, plausible, wrong zero" this
    // change exists to avoid (see `skills/load.ts`'s own "no .claude/skills"
    // reporting for the same reasoning applied to skills).
    const mergedSettings: MergedSettings | undefined =
      loadedSettings.variants.length > 0 ? mergeSettings(loadedSettings.variants) : undefined;

    // `skill.name -> repo -> that repo's original flattened body` — the
    // ONLY place this exists, since `extractSkill`'s output does not retain
    // the inputs it was built from (the proof is that reconstruction
    // recovers them, not that they were kept around). Built from the same
    // `loaded.variantsBySkill` `skillsDiff` itself was built from, so this
    // never drifts from what was actually diffed.
    const originalsBySkill = new Map(
      skillsDiff.skills.map((skill) => {
        const variants = loaded.variantsBySkill.get(skill.skill) ?? [];
        const repoLines = new Map(
          variants.map((v) => [v.repo, v.skill.sections.flatMap((s) => s.lines)] as const),
        );
        return [skill.skill, repoLines] as const;
      }),
    );

    const { written, report } = await emitExtraction(target, extracted, originalsBySkill, mergedSettings);

    const distributable = extracted.filter((e) => e.distributable).length;
    console.log(`extracted        ${extracted.length} skills`);
    console.log(`distributable    ${distributable} of ${extracted.length}`);
    if (mergedSettings) {
      console.log(
        `settings merged  ${loadedSettings.variants.length} repos, ` +
          `${mergedSettings.conflicts.length} conflict(s)`,
      );
    }
    console.log(`core share       ${(report.overall.coreShare * 100).toFixed(1)}% of core+overrides (floor ${(report.overall.floor * 100).toFixed(0)}%)`);
    console.log(`conflicts share  ${(report.overall.conflictsShare * 100).toFixed(1)}% of core+overrides+conflicts (reported only, not gated)`);
    if (report.overall.reconstruction) {
      console.log(
        `reconstructed    ${report.overall.reconstruction.reconstructed} of ${report.overall.reconstruction.total} ` +
          `(${report.overall.reconstruction.lossy} lossy)`,
      );
    }
    for (const path of written) console.log(`written          ${path}`);

    // SPEC 2.4's companion to reconstruction: byte-identical reconstruction
    // alone is trivially satisfiable (an empty core, every file whole as
    // its own override) and proves nothing about whether the split means
    // anything. This is a HARD gate, independent of reconstruction success.
    if (!report.overall.meetsFloor) {
      console.error(
        `wazuh-ctx skills-diff --extract: core share ${(report.overall.coreShare * 100).toFixed(1)}% is ` +
          `below the ${(report.overall.floor * 100).toFixed(0)}% floor required by SPEC 2.4.`,
      );
      return { code: 1 };
    }
  }

  // A conflict is the expected output of an analysis, not a failure (SPEC 2.1.1).
  return { code: 0 };
}

/**
 * Fetches, diffs and extracts the corpus the SAME way `skills-diff --extract`
 * does — `sync` needs `ExtractedSkill[]` for `planSync`, and there is only
 * one place in this project that knows how to build one from real repos.
 * Returns a `CommandResult` (never throws) when any step of the pipeline
 * fails, so `runSync` can return that result directly without duplicating
 * `skills-diff`'s own error handling.
 */
async function loadExtractionForSync(
  values: Record<string, unknown>,
): Promise<{ readonly extracted: readonly ExtractedSkill[]; readonly mergedSettings: MergedSettings | undefined } | CommandResult> {
  const ref = (values.ref as string | undefined) ?? "5.0.0";

  let sources: Awaited<ReturnType<typeof loadSources>>;
  try {
    sources = await loadSources(process.cwd());
  } catch (error) {
    console.error(`wazuh-ctx sync: ${(error as Error).message}`);
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
      console.error(`wazuh-ctx sync: git not found on PATH (${err.message})`);
      return { code: 2 };
    }
    throw error;
  }

  const kindByName = new Map(sources.repos.map((repo) => [repo.name, repo.kind]));
  const targets = fetchOutcome.fetched
    .map((f) => {
      const kind = kindByName.get(f.repo);
      return kind === undefined ? null : { repo: f.repo, repoKind: kind, dir: f.dir };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);

  const loaded = await loadSkills(targets);
  const loadedSettings = await loadSettingsVariants(targets);
  const skippedRepos = fetchOutcome.skipped.map((s) => ({
    repo: s.repo,
    included: false,
    reason: `not fetched: ${s.reason}`,
  }));
  const allRepos = [...loaded.repos, ...skippedRepos];

  const skillsDiff = buildSkillsDiffJson({
    ref,
    generatedAt: new Date().toISOString(),
    tool: TOOL,
    repos: allRepos,
    variantsBySkill: loaded.variantsBySkill,
    singleRepoSkills: loaded.singleRepoSkills,
  });

  // Same "merge only when something was actually loaded" rule as
  // `skills-diff --extract` — see that call site's comment for why.
  const mergedSettings: MergedSettings | undefined =
    loadedSettings.variants.length > 0 ? mergeSettings(loadedSettings.variants) : undefined;

  return { extracted: skillsDiff.skills.map((skill) => extractSkill(skill)), mergedSettings };
}

function isExtractionFailure(
  outcome:
    | { readonly extracted: readonly ExtractedSkill[]; readonly mergedSettings: MergedSettings | undefined }
    | CommandResult,
): outcome is CommandResult {
  return !("extracted" in outcome);
}

/**
 * `sync` — SPEC 2.3. Plans before it writes (design decision 1): `planSync`
 * decides what would be distributed and what is blocked, `applySync`
 * performs exactly that. An anchor that has become ambiguous since
 * extraction is a FATAL error (SPEC 2.1.1), not a warning — it surfaces here
 * as a thrown `Error` from `planSync` (which resolves every override anchor
 * through `reconstructRepo`/`resolveAnchor` before anything is written), and
 * is reported with a non-zero exit distinct from "every skill blocked",
 * which is success (see below).
 */
async function runSync(values: Record<string, unknown>): Promise<CommandResult> {
  const repo = values.repo as string | undefined;
  const target = values.target as string | undefined;

  if (!repo) {
    console.error("wazuh-ctx sync: --repo <name> is required.");
    return { code: 64 };
  }
  if (!target) {
    console.error("wazuh-ctx sync: --target <dir> is required.");
    return { code: 64 };
  }

  const outcome = await loadExtractionForSync(values);
  if (isExtractionFailure(outcome)) return outcome;

  let plan: ReturnType<typeof planSync>;
  try {
    plan = planSync(outcome.extracted, repo, TOOL, outcome.mergedSettings);
  } catch (error) {
    console.error(`wazuh-ctx sync: ${(error as Error).message}`);
    return { code: 1 };
  }

  const { written } = await applySync(plan, target);

  console.log(renderSyncSummary(plan));
  console.log(`target           ${target}`);
  for (const path of written) console.log(`written          ${path}`);

  // "Every skill blocked" is the tool working as designed, not a failure
  // (SPEC: "sync with everything blocked is reported, not failed") — a
  // fatal anchor ambiguity above already returned non-zero, and that is the
  // only condition that does.
  return { code: 0 };
}

/**
 * `check` — SPEC 2.3/2.4. Three states, never a boolean (design decision 3):
 * `not-applicable` and `in-sync` both exit `0`, `drifted` exits non-zero —
 * the ONLY place in this project that exit-code mapping is decided, kept
 * out of the pure `verifyStandards` on purpose.
 */
async function runCheck(values: Record<string, unknown>): Promise<CommandResult> {
  const target = values.target as string | undefined;
  if (!target) {
    console.error("wazuh-ctx check: --target <dir> is required.");
    return { code: 64 };
  }

  const result = await checkStandards(target, TOOL);

  console.log(`target           ${target}`);
  console.log(`state            ${result.state}`);
  console.log(result.message);
  for (const drifted of result.drifted) {
    console.log(`drifted          ${drifted.path} (${drifted.reason})`);
  }

  return { code: result.state === "drifted" ? 1 : 0 };
}

/**
 * `mcp` — SPEC Phase 3. Wires the startup gate sequence (design "`schema`:
 * the refusal gates run in order") and connects the resulting server over
 * stdio.
 *
 * `mcp` is a long-running server, unlike every other command in this file:
 * once connected, it must keep serving until the client disconnects (stdin
 * closes) or the process is signalled, NOT the instant `server.connect`
 * resolves. `main()` unconditionally does `process.exit(await main())`, so
 * if this function returned right after `connect()`, the process would exit
 * the moment the transport started listening -- before it ever served a
 * request. So this function awaits the transport's own close instead
 * (chained after whatever `server.connect` itself already wired onto
 * `onclose`, never replacing it -- `McpServer` relies on that callback for
 * its own bookkeeping).
 */
async function runMcp(values: Record<string, unknown>): Promise<CommandResult> {
  const ref = (values.ref as string | undefined) ?? "5.0.0";
  const outDir = (values.out as string | undefined) ?? "out";
  const allowRefMismatch = values["allow-ref-mismatch"] === true;
  const telemetryEnabled = values["no-telemetry"] !== true;
  const runtimeUrl = values.runtime as string | undefined;

  let sources: Awaited<ReturnType<typeof loadSources>>;
  try {
    sources = await loadSources(process.cwd());
  } catch (error) {
    console.error(`wazuh-ctx mcp: ${(error as Error).message}`);
    return { code: 2 };
  }

  const dataset = await loadDataset(outDir, ref);
  if (!dataset.ok) {
    console.error(`wazuh-ctx mcp: ${dataset.message}`);
    return { code: 2 };
  }

  const clock = () => new Date().toISOString();

  const startup = await runStartup({
    git: createGitRunner(),
    cwd: process.cwd(),
    sources,
    matrix: dataset.matrix,
    allowRefMismatch,
    announce: (world) => {
      console.error(
        `wazuh-ctx mcp: cwd -> ${world.repoName ?? "(no repository recognised)"} -> world: ${world.world}`,
      );
    },
  });

  if (!startup.ok) {
    console.error(`wazuh-ctx mcp: ${startup.message}`);
    return { code: 2 };
  }

  const telemetry = createTelemetrySink({
    enabled: telemetryEnabled,
    path: join(resolve(process.cwd(), ".cache"), "mcp-telemetry.jsonl"),
    clock,
  });

  // Real global `fetch`, structurally compatible with `DocsFetchLike` /
  // `RuntimeFetchLike` (both narrowed subsets of WHATWG/Bun `fetch`) --
  // exactly `docs.integration.test.ts`'s own precedent for the same cast.
  const docsTransport: DocsFetchLike = (url, init) =>
    fetch(url, init as RequestInit) as unknown as Promise<DocsHttpResponseLike>;
  const runtimeTransport: RuntimeFetchLike = (url, init) =>
    fetch(url, init as RequestInit) as unknown as Promise<RuntimeHttpResponseLike>;

  // Never throws (runtime.ts's own docblock): "no instance configured" and
  // "instance unreachable" both resolve to `null` here, and `null` is what
  // makes `buildMcpServer` skip registering `runtime` entirely (SPEC
  // "`runtime` absent never blocks `docs` or `schema`").
  const runtimeSnapshot = await resolveRuntimeBackend(
    runtimeTransport,
    runtimeUrl !== undefined ? { url: runtimeUrl } : undefined,
  );

  const server = buildMcpServer({
    dataset,
    clock,
    sources,
    docsTransport,
    telemetry,
    runtimeSnapshot,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `wazuh-ctx mcp: serving ref ${dataset.matrix.ref} over stdio ` +
      `(runtime ${runtimeSnapshot === null ? "unavailable" : "available"}; ` +
      `telemetry ${telemetryEnabled ? "on" : "off"}).`,
  );

  await new Promise<void>((resolvePromise) => {
    const previousOnClose = transport.onclose;
    transport.onclose = () => {
      previousOnClose?.();
      resolvePromise();
    };
  });

  return { code: 0 };
}

/**
 * `wazuh-ctx serve` — the Phase 1.5 inspector (SPEC 1.5.1).
 *
 * Binds 127.0.0.1 only. This is an instrument for the person maintaining the
 * dataset, not a service: the agent consumes the dataset over MCP, and nothing
 * here is meant to be reachable from another machine.
 *
 * The API writes only `decisions.yml`, `annotations.yml` and
 * `decisions.local.yml`, through one allow-list chokepoint, and a save shows
 * its YAML diff before it writes anything. SPEC 1.5.1: the save button does not
 * mutate state, it produces a diff to commit.
 */
async function runServe(values: Record<string, unknown>): Promise<CommandResult> {
  const ref = (values.ref as string | undefined) ?? "5.0.0";
  const outDir = (values.out as string | undefined) ?? "out";
  const portValue = values.port as string | undefined;
  const port = portValue === undefined ? DEFAULT_SERVE_PORT : Number(portValue);

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`wazuh-ctx serve: --port must be an integer 0-65535, got '${portValue}'.`);
    return { code: 64 };
  }

  const root = process.cwd();
  const outRoot = resolve(root, outDir);

  // Fail here rather than on the first request: a dashboard that loads and then
  // reports "no dataset" has wasted the reader's attention to say what the
  // command already knew.
  const dataset = await loadDataset(outDir, ref);
  if (!dataset.ok) {
    console.error(`wazuh-ctx serve: ${dataset.message}`);
    return { code: 2 };
  }

  let server: ReturnType<typeof startServeServer>;
  try {
    server = startServeServer({
      outRoot,
      ref,
      root,
      port,
      clock: () => new Date().toISOString(),
      telemetryPath: join(resolve(root, ".cache"), "mcp-telemetry.jsonl"),
      fs: createNodeServeFs(),
    });
  } catch (error) {
    console.error(`wazuh-ctx serve: could not bind port ${port} — ${(error as Error).message}`);
    return { code: 2 };
  }

  console.log(`wazuh-ctx serve: inspector for ref ${dataset.matrix.ref} at ${server.url}`);
  console.log("  writes are limited to decisions.yml, annotations.yml and decisions.local.yml.");
  console.log("  Ctrl-C to stop.");

  await new Promise<void>((resolvePromise) => {
    const stop = (): void => {
      server.stop();
      resolvePromise();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });

  return { code: 0 };
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
        extract: { type: "boolean" },
        repo: { type: "string" },
        target: { type: "string" },
        indexer: { type: "string" },
        "indexer-skip-tls-verify": { type: "boolean" },
      port: { type: "string" },
        format: { type: "string" },
        "allow-ref-mismatch": { type: "boolean" },
        "no-telemetry": { type: "boolean" },
        runtime: { type: "string" },
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
      return (await runSkillsDiff(parsed.values)).code;
    case "sync":
      return (await runSync(parsed.values)).code;
    case "check":
      return (await runCheck(parsed.values)).code;
    case "serve":
      return (await runServe(parsed.values)).code;
    case "mcp":
      return (await runMcp(parsed.values)).code;
    default:
      console.error(`wazuh-ctx: unknown command '${command}'\n`);
      console.log(USAGE);
      return 64;
  }
}

process.exit(await main());

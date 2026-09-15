#!/usr/bin/env node
/**
 * wazuh-ctx — single binary for the whole kit (SPEC 1.1).
 *
 * Argument parsing uses node:util parseArgs. Six subcommands do not justify
 * commander or yargs.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { allFacts } from "../fixtures/facts.ts";
import { loadHumanLayers } from "./decisions/load.ts";
import { buildMatrix } from "./matrix/build.ts";
import { renderMatrixMarkdown } from "./matrix/render.ts";
import type { BuildInput } from "./matrix/types.ts";

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
  --strict              Exit non-zero when unknowns[] is non-empty
  --frozen-time <iso>   Pin meta.generatedAt for reproducible runs
  --out <dir>           Output directory (default: out)
  -h, --help            Show this message
  -v, --version         Show version
`;

interface CommandResult {
  code: number;
}

async function runMatrix(values: Record<string, unknown>): Promise<CommandResult> {
  const ref = (values.ref as string | undefined) ?? "5.0.0";
  const outDir = (values.out as string | undefined) ?? "out";
  const frozenTime = values["frozen-time"] as string | undefined;
  const useFixtures = values.fixtures === true;

  if (!useFixtures) {
    console.error(
      "wazuh-ctx matrix: fetch/ and parse/ are not implemented yet.\n" +
        "This is the documented build order (SPEC 7): matrix/ is built first\n" +
        "against fixtures, then the inspector, then fetch/parse.\n\n" +
        "Run with --fixtures to exercise the pure core today.",
    );
    return { code: 2 };
  }

  const layers = await loadHumanLayers(process.cwd());

  const now = new Date().toISOString();
  const input: BuildInput = {
    decisions: layers.decisions,
    annotations: layers.annotations,
    ref,
    facts: allFacts,
    // Synthetic until fetch/ lands; the shape is what matters here.
    resolvedRefs: Object.fromEntries(
      [...new Set(allFacts.map((f) => f.repo))].map((repo) => [
        repo,
        allFacts.find((f) => f.repo === repo)!.commit,
      ]),
    ),
    // resolvedAt describes when the SHAs were resolved, NOT when this ran.
    // --frozen-time pins generatedAt only (SPEC 1.6.1). Conflating the two
    // leaks wall-clock into the payload and breaks byte-identical MATRIX.md.
    // Fixture SHAs are constants, so their resolution instant is one too.
    resolvedAt: useFixtures ? FIXTURE_RESOLVED_AT : now,
    generatedAt: frozenTime ?? now,
    tool: TOOL,
    skipped: [{ repo: "wazuh-dashboard-ml-commons", reason: "no 5.0.0 branch" }],
  };

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
        strict: { type: "boolean" },
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
      return notImplemented("crosscheck", "1.8").code;
    case "skills-diff":
      return notImplemented("skills-diff", "2.1").code;
    case "sync":
      return notImplemented("sync", "2.3").code;
    case "check":
      return notImplemented("check", "2.3").code;
    case "serve":
      return notImplemented("serve", "Phase 1.5").code;
    case "mcp":
      return notImplemented("mcp", "Phase 3").code;
    default:
      console.error(`wazuh-ctx: unknown command '${command}'\n`);
      console.log(USAGE);
      return 64;
  }
}

process.exit(await main());

/**
 * Index reference recovery from plugin source (source-parse delta, tasks 3.x, 4.x).
 *
 * "Which index a plugin reads is a code fact, not a manifest fact" (SPEC 1.8).
 * There is no type checker available — `typescript@7.0.2` ships no JS-callable
 * compiler API — so recovery is syntactic: literals inside catalog modules, plus
 * the import edges that carry them, plus saved-object assets.
 *
 * What that cannot reach is not silence. Every unrecoverable mechanism is
 * reported as data, because a report saying "this index has no consumer" is
 * FALSE when a consumer reaches it through one.
 */

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { scanIndexReferences } from "./index-references.ts";
import type { ParseTarget } from "./types.ts";

const COMMIT = "d".repeat(40);

async function makeCheckout(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "wazuh-ctx-refs-"));
  for (const [path, body] of Object.entries(files)) {
    const absolute = join(root, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, body, "utf8");
  }
  return root;
}

function targetFor(dir: string): ParseTarget {
  return { repo: "wazuh-dashboard-plugins", repoKind: "dashboard", dir, commit: COMMIT };
}

describe("recovering literals from a catalog module", () => {
  test("reads both the one-line and the prettier-wrapped form", async () => {
    // In the real constants.ts, 166 of 300 literals are wrapped and 134 are
    // not. A reader that only handles one line recovers under half.
    const dir = await makeCheckout({
      "plugins/main/common/constants.ts": [
        "export const WAZUH_VULNERABILITIES_PATTERN = 'wazuh-states-vulnerabilities*';",
        "export const WAZUH_FIM_REGISTRY_KEYS_PATTERN =",
        "  'wazuh-states-fim-registry-keys*';",
      ].join("\n"),
    });

    try {
      const { references } = await scanIndexReferences(targetFor(dir));
      expect(references.map((r) => r.name).sort()).toEqual([
        "wazuh-states-fim-registry-keys*",
        "wazuh-states-vulnerabilities*",
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("records the file and line a name came from", async () => {
    const dir = await makeCheckout({
      "plugins/main/common/constants.ts": [
        "// a comment",
        "export const WAZUH_ALERTS_PATTERN = 'wazuh-alerts*';",
      ].join("\n"),
    });

    try {
      const { references } = await scanIndexReferences(targetFor(dir));
      expect(references[0]).toMatchObject({
        name: "wazuh-alerts*",
        file: "plugins/main/common/constants.ts",
        line: 2,
        identifier: "WAZUH_ALERTS_PATTERN",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("the dual-signal filter", () => {
  test("keeps a name only when BOTH the identifier and the value agree", async () => {
    // Measured against the real file: filtering by value alone yields 52 with
    // 5 wrong; by identifier alone 48 with 1 wrong; by both, 47 with none.
    const dir = await makeCheckout({
      "plugins/main/common/constants.ts": [
        // both signals -> kept
        "export const WAZUH_VULNERABILITIES_PATTERN = 'wazuh-states-vulnerabilities*';",
        // index-shaped value, no convention -> an operating-system user, not an index
        "export const PLUGIN_PLATFORM_INSTALLATION_USER = 'wazuh-dashboard';",
        // convention, non-index value -> a FIELD name
        "export const NOT_TIME_FIELD_NAME_INDEX_PATTERN = 'not_time_field_name_index_pattern';",
      ].join("\n"),
    });

    try {
      const { references } = await scanIndexReferences(targetFor(dir));
      expect(references.map((r) => r.name)).toEqual(["wazuh-states-vulnerabilities*"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a named exceptions list admits real indices that break the convention", async () => {
    // These two ARE indices — sample data gets indexed — and carry no _PATTERN
    // suffix. A heuristic that quietly discards two true positives is worse
    // than one that names them.
    const dir = await makeCheckout({
      "plugins/main/common/constants.ts": [
        "export const WAZUH_SAMPLE_INVENTORY_AGENT = 'wazuh-inventory-agent';",
        "export const WAZUH_SAMPLE_VULNERABILITIES = 'wazuh-vulnerabilities';",
      ].join("\n"),
    });

    try {
      const { references } = await scanIndexReferences(targetFor(dir));
      expect(references.map((r) => r.name).sort()).toEqual([
        "wazuh-inventory-agent",
        "wazuh-vulnerabilities",
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a dot-prefixed system index is index-shaped", async () => {
    // The indexer declares .opendistro-ism-config, .wazuh-settings* and
    // .wazuh-setup-status*. A value test that only accepts `wazuh-` misses them.
    const dir = await makeCheckout({
      "plugins/main/common/constants.ts":
        "export const WAZUH_ENGINE_SETTINGS_INDEX = '.wazuh-settings';",
    });

    try {
      const { references } = await scanIndexReferences(targetFor(dir));
      expect(references.map((r) => r.name)).toEqual([".wazuh-settings"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("following the import edge to a consumer", () => {
  test("a file importing the identifier is recorded as consuming that index", async () => {
    const dir = await makeCheckout({
      "plugins/main/common/constants.ts":
        "export const WAZUH_ALERTS_PATTERN = 'wazuh-alerts*';",
      "plugins/main/public/repository.ts": [
        "import { WAZUH_ALERTS_PATTERN } from '../common/constants';",
        "export const source = { pattern: WAZUH_ALERTS_PATTERN };",
      ].join("\n"),
    });

    try {
      const { references } = await scanIndexReferences(targetFor(dir));
      const consumers = references.filter((r) => r.via === "import");
      expect(consumers).toHaveLength(1);
      expect(consumers[0]).toMatchObject({
        name: "wazuh-alerts*",
        file: "plugins/main/public/repository.ts",
        identifier: "WAZUH_ALERTS_PATTERN",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("importing an identifier that is not an index records nothing", async () => {
    const dir = await makeCheckout({
      "plugins/main/common/constants.ts":
        "export const PLUGIN_PLATFORM_INSTALLATION_USER = 'wazuh-dashboard';",
      "plugins/main/server/setup.ts": [
        "import { PLUGIN_PLATFORM_INSTALLATION_USER } from '../common/constants';",
        "export const user = PLUGIN_PLATFORM_INSTALLATION_USER;",
      ].join("\n"),
    });

    try {
      const { references } = await scanIndexReferences(targetFor(dir));
      expect(references).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("saved-object assets", () => {
  test("recovers index names from references[], not from the object's own type", async () => {
    // The real shape, verified against the checkout: every line is a
    // `visualization` or a `dashboard`, and the index it reads sits inside its
    // `references` array. There are ZERO top-level index-pattern objects, so a
    // scanner checking the line's own `type` finds nothing.
    //
    // The first version of this fixture asserted the top-level shape and
    // passed, while the scanner recovered nothing at all from real data. A
    // test written from an assumption validates the assumption.
    const dir = await makeCheckout({
      "plugins/main/common/dashboards/vuln.ndjson": [
        JSON.stringify({
          type: "visualization",
          id: "some-uuid",
          references: [
            {
              name: "kibanaSavedObjectMeta.searchSourceJSON.index",
              type: "index-pattern",
              id: "wazuh-states-vulnerabilities*",
            },
          ],
        }),
        JSON.stringify({ type: "dashboard", id: "no-refs" }),
        JSON.stringify({
          type: "visualization",
          id: "another-uuid",
          references: [{ name: "x", type: "index-pattern", id: "wazuh-states-sca*" }],
        }),
      ].join("\n"),
    });

    try {
      const { references } = await scanIndexReferences(targetFor(dir));
      expect(references.map((r) => r.name).sort()).toEqual([
        "wazuh-states-sca*",
        "wazuh-states-vulnerabilities*",
      ]);
      expect(references.every((r) => r.via === "saved-object")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a malformed ndjson line is skipped without failing the scan", async () => {
    const dir = await makeCheckout({
      "plugins/main/common/dashboards/mixed.ndjson": [
        "{ not json",
        JSON.stringify({
          type: "visualization",
          references: [{ name: "x", type: "index-pattern", id: "wazuh-states-sca*" }],
        }),
      ].join("\n"),
    });

    try {
      const { references } = await scanIndexReferences(targetFor(dir));
      expect(references.map((r) => r.name)).toEqual(["wazuh-states-sca*"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("uncoverage is reported as data", () => {
  test("a regex allowlist is reported with file and line", async () => {
    // guardrails.ts:199 accepts indices by SHAPE. No name exists as a string,
    // so no scanner will ever find them — the honest move is to say so.
    const dir = await makeCheckout({
      "plugins/wazuh-ai-assistant/server/tools/guardrails.ts": [
        "export function checkIndexAllowlist(index: string) {",
        "  const INDEX_ALLOWLIST_RE = /^wazuh-(events-v5|states)[A-Za-z0-9._*-]*$/;",
        "  return INDEX_ALLOWLIST_RE.test(index);",
        "}",
      ].join("\n"),
    });

    try {
      const { uncovered } = await scanIndexReferences(targetFor(dir));
      expect(uncovered).toHaveLength(1);
      expect(uncovered[0]).toMatchObject({
        kind: "regex-allowlist",
        file: "plugins/wazuh-ai-assistant/server/tools/guardrails.ts",
        line: 2,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a runtime configuration lookup is reported", async () => {
    const dir = await makeCheckout({
      "plugins/main/server/controllers/wazuh-elastic.ts": [
        "async function build(context, item) {",
        "  const indexName = `${await context.wazuh_core.configuration.get(item.settingIndexPattern)}-sample`;",
        "  return indexName;",
        "}",
      ].join("\n"),
    });

    try {
      const { uncovered } = await scanIndexReferences(targetFor(dir));
      expect(uncovered.map((u) => u.kind)).toEqual(["runtime-configuration"]);
      expect(uncovered[0]!.line).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a computed expression in a catalog module is reported", async () => {
    // The .map() spreads at constants.ts:254-292. Recoverable only by
    // evaluating expressions, which needs a checker this project does not have.
    const dir = await makeCheckout({
      "plugins/main/common/constants.ts": [
        "export const WAZUH_ALERTS_PATTERN = 'wazuh-alerts*';",
        "export const SAMPLE_INDICES = CATEGORIES.map(c => `${c.prefix}-sample`);",
      ].join("\n"),
    });

    try {
      const { references, uncovered } = await scanIndexReferences(targetFor(dir));
      expect(references.map((r) => r.name)).toEqual(["wazuh-alerts*"]);
      expect(uncovered.map((u) => u.kind)).toEqual(["computed-expression"]);
      expect(uncovered[0]!.line).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a clean codebase reports no uncovered mechanisms", async () => {
    const dir = await makeCheckout({
      "plugins/main/common/constants.ts":
        "export const WAZUH_ALERTS_PATTERN = 'wazuh-alerts*';",
    });

    try {
      const { uncovered } = await scanIndexReferences(targetFor(dir));
      expect(uncovered).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("determinism", () => {
  test("two scans of the same tree produce identical output", async () => {
    const dir = await makeCheckout({
      "plugins/main/common/constants.ts": [
        "export const B_PATTERN = 'wazuh-b*';",
        "export const A_PATTERN = 'wazuh-a*';",
      ].join("\n"),
      "plugins/main/public/use.ts": "import { A_PATTERN } from '../common/constants';",
    });

    try {
      const first = await scanIndexReferences(targetFor(dir));
      const second = await scanIndexReferences(targetFor(dir));
      expect(second).toEqual(first);
      expect(first.references.map((r) => r.name)[0]).toBe("wazuh-a*");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/**
 * Opt-in: the recovered count against the real repository.
 *
 * This is the drift alarm from design D8. A refactor that reformats the
 * catalogs could silently drop recovery to zero, and a crosscheck over zero
 * references reports EVERY declared index as unconsumed — 40 confident false
 * findings. A pinned floor turns that into a failing test.
 *
 * It is a floor plus named names, not an equality: adding a legitimate new
 * pattern upstream must not break the build, but losing the ones we know about
 * must.
 */
describe("the recovered count, against the real repository", () => {
  const NETWORK_ENABLED = process.env.WAZUH_CTX_NETWORK === "1";
  const maybeTest = NETWORK_ENABLED ? test : test.skip;

  maybeTest(
    "recovers at least 40 distinct index names, including the ones we know",
    async () => {
      const { createFetchIo } = await import("../fetch/git-runner.ts");
      const { fetchRepos } = await import("../fetch/index.ts");

      const cacheRoot = await mkdtemp(join(tmpdir(), "wazuh-ctx-refs-real-"));
      try {
        const io = createFetchIo();
        const outcome = await fetchRepos({
          repos: [{ name: "wazuh-dashboard-plugins", kind: "dashboard" as const }],
          ref: "5.0.0",
          cacheRoot,
          refresh: false,
          io,
        });
        expect(outcome.fetched).toHaveLength(1);

        const { references } = await scanIndexReferences({
          repo: "wazuh-dashboard-plugins",
          repoKind: "dashboard",
          dir: outcome.fetched[0]!.dir,
          commit: outcome.fetched[0]!.commit,
        });

        const names = new Set(references.map((r) => r.name));

        // A floor, not an equality. Observed 49 on 2026-09-15.
        expect(names.size).toBeGreaterThanOrEqual(40);

        // And the specific ones this project already reasons about. If a
        // refactor hides these, the crosscheck's findings change meaning.
        for (const known of [
          "wazuh-states-vulnerabilities*",
          "wazuh-metrics-comms-v4*",
          "wazuh-agent-stats*",
          "wazuh-agent-config*",
        ]) {
          expect(names.has(known)).toBe(true);
        }

        // Every route must still be contributing. A zero here means a whole
        // recovery mechanism broke while the total stayed plausible.
        for (const via of ["catalog-literal", "import", "saved-object"] as const) {
          expect(references.some((r) => r.via === via)).toBe(true);
        }
      } finally {
        await rm(cacheRoot, { recursive: true, force: true });
      }
    },
    600_000,
  );
});

/**
 * Tests for src/parse/ (SPEC 1.2, 1.5.4, 6.1, D2, D5).
 *
 * Reads `fixtures/checkout/`, built from `import.meta.dir` so these tests are
 * cwd-independent. No network, no subprocess: parse/ only ever touches the
 * filesystem it is pointed at.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { buildMatrix } from "../matrix/build.ts";
import type { BuildInput } from "../matrix/types.ts";
import { parseIndexerArtifacts } from "./indexer.ts";
import { parseRepoManifests } from "./manifest.ts";
import { parseFetchedRepos, toParseTargets } from "./index.ts";
import type { ParseTarget } from "./types.ts";

const FIXTURES_ROOT = join(import.meta.dir, "..", "..", "fixtures", "checkout");
const DUMMY_COMMIT = "1".repeat(40);

function target(repo: string, repoKind: ParseTarget["repoKind"]): ParseTarget {
  return { repo, repoKind, dir: join(FIXTURES_ROOT, repo), commit: DUMMY_COMMIT };
}

const dashboardTarget = target("wazuh-dashboard-plugins", "dashboard");
const securityAnalyticsTarget = target("wazuh-dashboard-security-analytics", "dashboard");
const indexerTarget = target("wazuh-indexer-plugins", "indexer");

function baseBuildInput(overrides: Partial<BuildInput> = {}): BuildInput {
  return {
    ref: "5.0.0",
    facts: [],
    resolvedRefs: {},
    resolvedAt: "2026-09-14T00:00:00Z",
    generatedAt: "2026-09-14T00:00:00Z",
    tool: "wazuh-ctx@0.1.0",
    ...overrides,
  };
}

describe("parseRepoManifests — well-formed manifest", () => {
  test("emits manifest fields, packageVersion, and packageJsonPath for a normal plugin", async () => {
    const facts = await parseRepoManifests(dashboardTarget);
    const main = facts.find((f) => f.pluginDir === "plugins/main");

    expect(main).toBeDefined();
    expect(main?.manifest.id).toBe("wazuh");
    expect(main?.manifest.requiredPlugins).toEqual([
      "navigation",
      "opensearchDashboardsReact",
      "wazuhCore",
    ]);
    expect(main?.packageVersion).toBe("5.0.0");
    expect(main?.packageJsonPath).toBe("plugins/main/package.json");
    expect(main?.manifestPath).toBe("plugins/main/opensearch_dashboards.json");
  });

  test("finds all four real plugins plus broken and no-package", async () => {
    const facts = await parseRepoManifests(dashboardTarget);

    expect(facts).toHaveLength(6);
    const ids = facts.map((f) => f.manifest.id).filter((id): id is string => id !== undefined);
    expect(ids).toContain("wazuh");
    expect(ids).toContain("wazuhCore");
    expect(ids).toContain("wazuhCheckUpdates");
    expect(ids).toContain("wazuhAiAssistant");
  });

  test("root-manifest fork: pluginDir '.', versionScheme-triggering package.json", async () => {
    const facts = await parseRepoManifests(securityAnalyticsTarget);

    expect(facts).toHaveLength(1);
    expect(facts[0]?.pluginDir).toBe(".");
    expect(facts[0]?.manifestPath).toBe("opensearch_dashboards.json");
    expect(facts[0]?.packageJsonPath).toBe("package.json");
    expect(facts[0]?.packageVersion).toBe("3.6.0.0");
    expect(facts[0]?.manifest.id).toBe("securityAnalyticsDashboards");
  });
});

describe("parseRepoManifests — robust-empty on malformed manifest (D5)", () => {
  test("malformed manifest -> manifest: {}, no throw", async () => {
    const facts = await parseRepoManifests(dashboardTarget);
    const broken = facts.find((f) => f.pluginDir === "plugins/broken");

    expect(broken).toBeDefined();
    expect(broken?.manifest).toEqual({});
  });

  test("feeding the empty-manifest fact through buildMatrix yields unknown/unknown/[]", async () => {
    const facts = await parseRepoManifests(dashboardTarget);
    const broken = facts.find((f) => f.pluginDir === "plugins/broken");
    const matrix = buildMatrix(baseBuildInput({ facts: [broken!] }));
    const plugin = matrix.plugins[0]!;

    expect(plugin.pluginId).toBe("unknown");
    expect(plugin.world).toBe("unknown");
    expect(plugin.indexerAccess).toEqual([]);
  });
});

describe("parseRepoManifests — malformed package.json keeps the real path (D5)", () => {
  test("packageVersion null, packageJsonPath kept at the real path, never null", async () => {
    const facts = await parseRepoManifests(dashboardTarget);
    const broken = facts.find((f) => f.pluginDir === "plugins/broken");

    expect(broken?.packageVersion).toBeNull();
    expect(broken?.packageJsonPath).toBe("plugins/broken/package.json");
  });
});

describe("parseRepoManifests — package.json absent", () => {
  test("packageVersion null and packageJsonPath null", async () => {
    const facts = await parseRepoManifests(dashboardTarget);
    const noPackage = facts.find((f) => f.pluginDir === "plugins/no-package");

    expect(noPackage?.packageVersion).toBeNull();
    expect(noPackage?.packageJsonPath).toBeNull();
  });
});

describe("parseRepoManifests — exactOptionalPropertyTypes hazard", () => {
  test("omits absent manifest keys entirely rather than assigning undefined", async () => {
    const facts = await parseRepoManifests(dashboardTarget);
    const noPackage = facts.find((f) => f.pluginDir === "plugins/no-package")!;

    expect(Object.hasOwn(noPackage.manifest, "id")).toBe(true);
    expect(Object.hasOwn(noPackage.manifest, "configPath")).toBe(false);
    expect(Object.hasOwn(noPackage.manifest, "optionalPlugins")).toBe(false);
    expect(Object.hasOwn(noPackage.manifest, "opensearchDashboardsVersion")).toBe(false);
    expect(Object.hasOwn(noPackage.manifest, "requiredOSDataSourcePlugins")).toBe(false);
  });
});

describe("parseRepoManifests — POSIX path hazard (win32 dev machine, Linux CI)", () => {
  test("no backslash appears in any emitted pluginDir, manifestPath, or packageJsonPath", async () => {
    const facts = await parseRepoManifests(dashboardTarget);

    for (const fact of facts) {
      expect(fact.pluginDir).not.toContain("\\");
      expect(fact.manifestPath).not.toContain("\\");
      if (fact.packageJsonPath !== null) {
        expect(fact.packageJsonPath).not.toContain("\\");
      }
    }
  });

  test("facts are sorted by manifestPath for determinism", async () => {
    const facts = await parseRepoManifests(dashboardTarget);
    const paths = facts.map((f) => f.manifestPath);
    const sorted = [...paths].sort((a, b) => a.localeCompare(b));

    expect(paths).toEqual(sorted);
  });
});

describe("parseIndexerArtifacts — templates", () => {
  test("recursive listing of templates/states yields one IndexTemplate per file", async () => {
    const { templates } = await parseIndexerArtifacts(indexerTarget);

    expect(templates).toHaveLength(3);
    const names = templates.map((t) => t.name);
    expect(names).toContain("agent-config");
    expect(names).toContain("agent-stats");
    expect(names).toContain("malformed");
  });

  test("name is the filename stem, indexPatterns from index_patterns when present", async () => {
    const { templates } = await parseIndexerArtifacts(indexerTarget);
    const agentConfig = templates.find((t) => t.name === "agent-config");

    expect(agentConfig?.indexPatterns).toEqual(["wazuh-states-agent-config-*"]);
  });

  test("unparseable template yields indexPatterns: [] and no throw", async () => {
    const { templates } = await parseIndexerArtifacts(indexerTarget);
    const malformed = templates.find((t) => t.name === "malformed");

    expect(malformed).toBeDefined();
    expect(malformed?.indexPatterns).toEqual([]);
  });
});

describe("parseIndexerArtifacts — WCS modules", () => {
  test("one WcsModule per module, including a nested module name", async () => {
    const { wcsModules } = await parseIndexerArtifacts(indexerTarget);

    expect(wcsModules).toHaveLength(2);
    const names = wcsModules.map((m) => m.name);
    expect(names).toContain("network");
    expect(names).toContain("content/decoders");
  });

  test("fieldCount equals the data-row count from each fixture CSV", async () => {
    const { wcsModules } = await parseIndexerArtifacts(indexerTarget);
    const network = wcsModules.find((m) => m.name === "network");
    const decoders = wcsModules.find((m) => m.name === "content/decoders");

    expect(network?.fieldCount).toBe(2);
    expect(decoders?.fieldCount).toBe(3);
  });

  test("missing wcs directory yields an empty module list, not a throw", async () => {
    const { wcsModules } = await parseIndexerArtifacts(securityAnalyticsTarget);

    expect(wcsModules).toEqual([]);
  });
});

describe("parseIndexerArtifacts — determinism hazard", () => {
  test("no backslash in any emitted template path or WCS fieldsCsv path", async () => {
    const { templates, wcsModules } = await parseIndexerArtifacts(indexerTarget);

    for (const t of templates) expect(t.path).not.toContain("\\");
    for (const m of wcsModules) expect(m.fieldsCsv).not.toContain("\\");
  });

  test("templates sorted by path, wcsModules sorted by name", async () => {
    const { templates, wcsModules } = await parseIndexerArtifacts(indexerTarget);

    expect(templates.map((t) => t.path)).toEqual([...templates.map((t) => t.path)].sort((a, b) => a.localeCompare(b)));
    expect(wcsModules.map((m) => m.name)).toEqual(
      [...wcsModules.map((m) => m.name)].sort((a, b) => a.localeCompare(b)),
    );
  });
});

describe("parse/ emits final indexer shapes — pass-through identity (D2)", () => {
  test("buildMatrix passes templates/wcsModules straight through, unmodified", async () => {
    const { templates, wcsModules } = await parseIndexerArtifacts(indexerTarget);
    const matrix = buildMatrix(baseBuildInput({ templates, wcsModules }));

    expect(matrix.indexer.templates).toEqual(templates);
    expect(matrix.indexer.wcsModules).toEqual(wcsModules);
  });
});

describe("toParseTargets + parseFetchedRepos — dispatch by RepoKind", () => {
  test("dispatches manifest parsing for dashboard/platform, indexer parsing for indexer", async () => {
    const sources = {
      repos: [
        { name: "wazuh-dashboard-plugins", kind: "dashboard" as const },
        { name: "wazuh-indexer-plugins", kind: "indexer" as const },
      ],
    };
    const fetched = [
      { repo: "wazuh-dashboard-plugins", dir: join(FIXTURES_ROOT, "wazuh-dashboard-plugins"), commit: DUMMY_COMMIT },
      { repo: "wazuh-indexer-plugins", dir: join(FIXTURES_ROOT, "wazuh-indexer-plugins"), commit: DUMMY_COMMIT },
    ];

    const targets = toParseTargets(sources, fetched);
    const result = await parseFetchedRepos(targets);

    expect(result.facts.length).toBeGreaterThan(0);
    expect(result.templates.length).toBeGreaterThan(0);
    expect(result.wcsModules.length).toBeGreaterThan(0);
    expect(result.facts.every((f) => f.repo === "wazuh-dashboard-plugins")).toBe(true);
  });
});

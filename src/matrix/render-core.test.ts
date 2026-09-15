/**
 * Rendering tests for the core section and the unresolved report
 * (matrix-pipeline delta requirement 5; tasks 5.1–5.4).
 */

import { describe, expect, test } from "bun:test";
import { buildMatrix } from "./build.ts";
import { renderMatrixMarkdown } from "./render.ts";
import type { BuildInput, RawCoreRepo, RawManifest, RawPluginFacts } from "./types.ts";

const COMMIT = "a".repeat(40);
const CORE_COMMIT = "b".repeat(40);

function pluginFacts(pluginId: string, manifest: RawManifest = {}): RawPluginFacts {
  return {
    repo: "wazuh-dashboard-plugins",
    repoKind: "dashboard",
    pluginDir: `plugins/${pluginId}`,
    manifestPath: `plugins/${pluginId}/opensearch_dashboards.json`,
    packageJsonPath: `plugins/${pluginId}/package.json`,
    commit: COMMIT,
    manifest: { id: pluginId, ...manifest },
    packageVersion: "5.0.0",
  };
}

function coreRepo(ids: readonly string[]): RawCoreRepo {
  return {
    repo: "wazuh-dashboard",
    commit: CORE_COMMIT,
    version: "3.6.0",
    facts: ids.map((id) => ({
      pluginId: id,
      pluginDir: `src/plugins/${id}`,
      manifestPath: `src/plugins/${id}/opensearch_dashboards.json`,
      manifest: { id },
    })),
  };
}

function baseInput(overrides: Partial<BuildInput> = {}): BuildInput {
  return {
    ref: "5.0.0",
    facts: [],
    resolvedRefs: {},
    resolvedAt: "2026-01-01T00:00:00Z",
    generatedAt: "2026-01-01T00:00:00Z",
    tool: "wazuh-ctx@test",
    ...overrides,
  };
}

/** The `## Plugins` block, up to the next heading. */
function pluginsSection(markdown: string): string {
  const start = markdown.indexOf("## Plugins");
  const rest = markdown.slice(start + 1);
  const end = rest.indexOf("\n## ");
  return end === -1 ? rest : rest.slice(0, end);
}

describe("rendering the core section", () => {
  test("the existing plugin table is unchanged by the presence of core plugins", () => {
    const facts = [pluginFacts("wazuh", { requiredPlugins: ["navigation"] })];
    const without = renderMatrixMarkdown(buildMatrix(baseInput({ facts })));
    const with_ = renderMatrixMarkdown(
      buildMatrix(baseInput({ facts, coreRepos: [coreRepo(["navigation"])] })),
    );

    expect(pluginsSection(with_)).toBe(pluginsSection(without));
  });

  test("64 core plugins render as one summary row, not 64 rows", () => {
    const ids = Array.from({ length: 64 }, (_, i) => `core${String(i).padStart(2, "0")}`);
    const markdown = renderMatrixMarkdown(buildMatrix(baseInput({ coreRepos: [coreRepo(ids)] })));

    expect(markdown).toContain("## Core plugins");
    // One header row, one separator, one data row. Anything more means the
    // section grew a row per plugin.
    const coreLines = markdown
      .slice(markdown.indexOf("## Core plugins"))
      .split("\n")
      .filter((line) => line.startsWith("|"));
    expect(coreLines).toHaveLength(3);
    expect(markdown).toContain("wazuh-dashboard");
    expect(markdown).toContain("64");
  });

  test("the summary lists only the core plugins something actually depends on", () => {
    // A reader's question is "does the thing I depend on exist here". An
    // exhaustive list of 64 answers it worse than a filtered one.
    const markdown = renderMatrixMarkdown(
      buildMatrix(
        baseInput({
          facts: [pluginFacts("wazuh", { requiredPlugins: ["navigation"] })],
          coreRepos: [coreRepo(["navigation", "unusedOne", "unusedTwo"])],
        }),
      ),
    );

    const coreBlock = markdown.slice(markdown.indexOf("## Core plugins"));
    expect(coreBlock).toContain("navigation");
    expect(coreBlock).not.toContain("unusedOne");
    expect(coreBlock).not.toContain("unusedTwo");
  });

  test("the core section is omitted entirely when there are no platform repos", () => {
    const markdown = renderMatrixMarkdown(buildMatrix(baseInput({ facts: [pluginFacts("wazuh")] })));
    expect(markdown).not.toContain("## Core plugins");
  });
});

describe("rendering unresolved dependencies", () => {
  test("the section is omitted entirely when nothing is unresolved", () => {
    // An always-present "Unresolved: none" heading trains readers to skip the
    // region where the real signal will eventually appear.
    const markdown = renderMatrixMarkdown(
      buildMatrix(
        baseInput({
          facts: [pluginFacts("wazuh", { requiredPlugins: ["navigation"] })],
          coreRepos: [coreRepo(["navigation"])],
        }),
      ),
    );

    expect(markdown).not.toContain("Unresolved dependencies");
  });

  test("an unresolved edge is rendered with its plugin, repo, and field", () => {
    const markdown = renderMatrixMarkdown(
      buildMatrix(baseInput({ facts: [pluginFacts("wazuh", { requiredPlugins: ["ghost"] })] })),
    );

    expect(markdown).toContain("## Unresolved dependencies");
    expect(markdown).toContain("`wazuh`");
    expect(markdown).toContain("`ghost`");
    expect(markdown).toContain("requiredPlugins");
  });

  test("rendering stays byte-identical across two renders of the same matrix", () => {
    const matrix = buildMatrix(
      baseInput({
        facts: [pluginFacts("wazuh", { requiredPlugins: ["ghost", "navigation"] })],
        coreRepos: [coreRepo(["navigation"])],
      }),
    );
    expect(renderMatrixMarkdown(matrix)).toBe(renderMatrixMarkdown(matrix));
  });
});

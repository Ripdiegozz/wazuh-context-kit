/**
 * Rendering CROSSCHECK.md (crosscheck delta, requirement 2; tasks 6.1–6.4).
 */

import { describe, expect, test } from "bun:test";
import { buildCrosscheck } from "./build.ts";
import { renderCrosscheckMarkdown } from "./render.ts";
import type { CrosscheckInput } from "./types.ts";

function input(overrides: Partial<CrosscheckInput> = {}): CrosscheckInput {
  return {
    ref: "5.0.0",
    generatedAt: "2026-01-01T00:00:00Z",
    tool: "wazuh-ctx@test",
    declared: [],
    references: [],
    uncovered: [],
    wcsModules: [],
    scannedRepos: ["wazuh-dashboard-plugins"],
    ...overrides,
  };
}

const UNCOVERED = [
  {
    kind: "regex-allowlist" as const,
    file: "plugins/wazuh-ai-assistant/server/tools/guardrails.ts",
    line: 199,
    note: "indices are accepted by shape; no name exists here as a string",
  },
];

describe("rendering", () => {
  test("the coverage statement comes BEFORE any findings section", () => {
    // A reader who takes "no consumer found" as "no consumer exists" deletes a
    // live index. Leading with the limits is what makes that misreading hard.
    const markdown = renderCrosscheckMarkdown(
      buildCrosscheck(
        input({
          uncovered: UNCOVERED,
          declared: [{ pattern: "wazuh-orphan*", template: "t/orphan.json", group: "states" }],
        }),
      ),
    );

    const coverage = markdown.indexOf("## Coverage");
    const findings = markdown.indexOf("## Declared, never referenced");
    expect(coverage).toBeGreaterThan(-1);
    expect(findings).toBeGreaterThan(-1);
    expect(coverage).toBeLessThan(findings);
  });

  test("an uncovered mechanism is named with its file, line and kind", () => {
    const markdown = renderCrosscheckMarkdown(buildCrosscheck(input({ uncovered: UNCOVERED })));
    expect(markdown).toContain("regex-allowlist");
    expect(markdown).toContain("guardrails.ts");
    expect(markdown).toContain("199");
  });

  test("with nothing uncovered, the report still states its limits rather than claiming completeness", () => {
    const markdown = renderCrosscheckMarkdown(buildCrosscheck(input()));
    expect(markdown).toContain("## Coverage");
  });

  test("an empty findings section is omitted, not rendered as 'none'", () => {
    const markdown = renderCrosscheckMarkdown(buildCrosscheck(input()));
    expect(markdown).not.toContain("## Declared, never referenced");
    expect(markdown).not.toContain("## Referenced, never declared");
  });

  test("a referenced-undeclared finding carries its file and line", () => {
    const markdown = renderCrosscheckMarkdown(
      buildCrosscheck(
        input({
          references: [
            {
              name: "wazuh-agent-stats*",
              file: "plugins/main/common/constants.ts",
              line: 122,
              via: "catalog-literal",
            },
          ],
        }),
      ),
    );
    expect(markdown).toContain("## Referenced, never declared");
    expect(markdown).toContain("`wazuh-agent-stats*`");
    expect(markdown).toContain("plugins/main/common/constants.ts");
    expect(markdown).toContain("122");
  });

  test("competing catalogs render both files", () => {
    const markdown = renderCrosscheckMarkdown(
      buildCrosscheck(
        input({
          references: [
            { name: "wazuh-a*", file: "a/constants.ts", line: 1, via: "catalog-literal" },
            { name: "wazuh-a*", file: "b/state-families.ts", line: 2, via: "catalog-literal" },
          ],
        }),
      ),
    );
    expect(markdown).toContain("## Competing catalogs");
    expect(markdown).toContain("a/constants.ts");
    expect(markdown).toContain("b/state-families.ts");
  });

  test("generatedAt never appears, so the file is byte-identical across runs", () => {
    const a = renderCrosscheckMarkdown(buildCrosscheck(input({ generatedAt: "2026-01-01T00:00:00Z" })));
    const b = renderCrosscheckMarkdown(buildCrosscheck(input({ generatedAt: "2099-12-31T23:59:59Z" })));
    expect(b).toBe(a);
  });
});

/**
 * `renderLiveComparisonText` / `renderLiveComparisonJson` (SPEC 1.10).
 *
 * Pure, like every other renderer in this project (SPEC 6.1). The text form
 * never omits a population -- an empty one still gets its heading, because
 * "no drift here" is a claim the tool should make explicitly rather than by
 * silence, and silence is indistinguishable from "we forgot to check."
 */

import { describe, expect, test } from "bun:test";
import { renderLiveComparisonJson, renderLiveComparisonText } from "./render-live.ts";
import type { LiveComparison } from "./live-types.ts";

function comparison(overrides: Partial<LiveComparison> = {}): LiveComparison {
  return {
    declaredNotInstalled: [],
    installedNotDeclared: { wazuh: [], platformManaged: [] },
    templatesOnlyInCluster: [],
    sameSubjectMismatches: [],
    ...overrides,
  };
}

describe("renderLiveComparisonText", () => {
  test("every population that has entries renders a heading with a count", () => {
    const cc = comparison({
      declaredNotInstalled: [{ pattern: "wazuh-cve*", template: "templates/cve.json" }],
      installedNotDeclared: {
        wazuh: [{ name: "wazuh-mystery", kind: "index" }],
        platformManaged: [{ name: ".kibana_1", kind: "index" }],
      },
      templatesOnlyInCluster: [{ name: "mystery-template", indexPatterns: ["wazuh-x*"] }],
      sameSubjectMismatches: [
        {
          pattern: "wazuh-threatintel-filters",
          template: "templates/threatintel/filters.json",
          installedName: "wazuh-threatintel-filters-a",
          installedKind: "index",
        },
      ],
    });

    const text = renderLiveComparisonText(cc);

    expect(text).toContain("declared, not installed (1)");
    expect(text).toContain("wazuh-cve*");
    expect(text).toContain("installed, not declared");
    expect(text).toContain("Wazuh namespace (1)");
    expect(text).toContain("wazuh-mystery");
    expect(text).toContain("platform-managed (1)");
    expect(text).toContain(".kibana_1");
    expect(text).toContain("template-only in cluster (1)");
    expect(text).toContain("mystery-template");
    expect(text).toContain("same subject");
    expect(text).toContain("wazuh-threatintel-filters");
    expect(text).toContain("wazuh-threatintel-filters-a");
  });

  test("every non-empty population renders its actual rows, not just a heading and a count", () => {
    // Defect found against the real cluster: the JSON form carried a correct
    // `templatesOnlyInCluster` entry, but the text form printed only
    // "## template-only in cluster (1)" with nothing under it -- a heading
    // and a count with the row itself missing. A count alone proves nothing
    // about whether the row was rendered, so this asserts the row content
    // for every population, not merely that its name appears somewhere in
    // the whole document.
    const cc = comparison({
      declaredNotInstalled: [{ pattern: "wazuh-cve*", template: "templates/cve.json" }],
      installedNotDeclared: {
        wazuh: [{ name: "wazuh-mystery", kind: "index" }],
        platformManaged: [{ name: ".kibana_1", kind: "index" }],
      },
      templatesOnlyInCluster: [
        { name: ".opensearch-sap-detectors-queries-index-template", indexPatterns: [".opensearch-sap-*-detectors-queries*"] },
      ],
      sameSubjectMismatches: [
        {
          pattern: "wazuh-threatintel-filters",
          template: "templates/threatintel/filters.json",
          installedName: "wazuh-threatintel-filters-a",
          installedKind: "index",
        },
      ],
    });

    const text = renderLiveComparisonText(cc);
    const section = (heading: string): string => {
      const start = text.indexOf(heading);
      expect(start).toBeGreaterThanOrEqual(0);
      const nextHeadingIndex = text.indexOf("\n## ", start + heading.length);
      return text.slice(start, nextHeadingIndex === -1 ? undefined : nextHeadingIndex);
    };

    // Every non-empty section must NOT fall back to the empty-population
    // marker, and must contain the row-specific content a reader needs to
    // act on the finding -- not merely the heading and the count.
    const declaredNotInstalledSection = section("## declared, not installed (1)");
    expect(declaredNotInstalledSection).not.toContain("_none_");
    expect(declaredNotInstalledSection).toContain("wazuh-cve*");
    expect(declaredNotInstalledSection).toContain("templates/cve.json");

    const wazuhSection = section("### Wazuh namespace (1)");
    expect(wazuhSection).not.toContain("_none_");
    expect(wazuhSection).toContain("wazuh-mystery");

    const platformSection = section("### platform-managed (1)");
    expect(platformSection).not.toContain("_none_");
    expect(platformSection).toContain(".kibana_1");

    const templatesSection = section("## template-only in cluster (1)");
    expect(templatesSection).not.toContain("_none_");
    expect(templatesSection).toContain(".opensearch-sap-detectors-queries-index-template");
    expect(templatesSection).toContain(".opensearch-sap-*-detectors-queries*");

    const sameSubjectSection = section(
      "## same subject, declared and installed do not match (1)",
    );
    expect(sameSubjectSection).not.toContain("_none_");
    expect(sameSubjectSection).toContain("wazuh-threatintel-filters");
    expect(sameSubjectSection).toContain("wazuh-threatintel-filters-a");
  });

  test("an empty population renders as explicitly empty rather than being omitted", () => {
    const text = renderLiveComparisonText(comparison());

    expect(text).toContain("declared, not installed (0)");
    expect(text).toContain("Wazuh namespace (0)");
    expect(text).toContain("platform-managed (0)");
    expect(text).toContain("template-only in cluster (0)");
    expect(text).toContain("same subject");
  });
});

describe("renderLiveComparisonJson", () => {
  test("is the LiveComparison alone, with no wrapper and no timestamp", () => {
    const cc = comparison({
      declaredNotInstalled: [{ pattern: "wazuh-cve*", template: "templates/cve.json" }],
    });

    const json = renderLiveComparisonJson(cc);
    const parsed = JSON.parse(json);

    expect(parsed).toEqual(cc);
    expect(Object.keys(parsed).sort()).toEqual(
      [
        "declaredNotInstalled",
        "installedNotDeclared",
        "templatesOnlyInCluster",
        "sameSubjectMismatches",
      ].sort(),
    );
    expect(json).not.toContain("generatedAt");
    expect(json).not.toContain("meta");
  });

  test("two renders of the same value are byte-identical", () => {
    const cc = comparison({
      installedNotDeclared: {
        wazuh: [{ name: "wazuh-mystery", kind: "index" }],
        platformManaged: [],
      },
    });

    expect(renderLiveComparisonJson(cc)).toBe(renderLiveComparisonJson(cc));
  });
});

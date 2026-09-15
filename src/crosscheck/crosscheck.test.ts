/**
 * The crosscheck comparison (crosscheck delta; tasks 5.1–5.7).
 *
 * Pure: every input is a literal and nothing here touches fs, network or the
 * clock. SPEC 1.8 calls this report "el valor diferencial de la fase".
 */

import { describe, expect, test } from "bun:test";
import { buildCrosscheck } from "./build.ts";
import type { CrosscheckInput } from "./types.ts";

function declared(pattern: string, group = "states"): CrosscheckInput["declared"][number] {
  return {
    pattern,
    template: `plugins/setup/src/main/resources/templates/${group}/${pattern.replace("*", "")}.json`,
    group,
  };
}

function referenced(name: string, file = "plugins/main/common/constants.ts", line = 1) {
  return { name, file, line, via: "catalog-literal" as const };
}

function baseInput(overrides: Partial<CrosscheckInput> = {}): CrosscheckInput {
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

describe("the three populations", () => {
  test("a declared index nobody references", () => {
    const cc = buildCrosscheck(baseInput({ declared: [declared("wazuh-states-orphan*")] }));
    expect(cc.declaredUnreferenced.map((d) => d.pattern)).toEqual(["wazuh-states-orphan*"]);
    expect(cc.declaredUnreferenced[0]!.template).toContain("templates/states/");
  });

  test("a referenced index nobody declares, naming file and line", () => {
    const cc = buildCrosscheck(
      baseInput({ references: [referenced("wazuh-agent-stats*", "plugins/main/common/constants.ts", 122)] }),
    );
    expect(cc.referencedUndeclared).toHaveLength(1);
    expect(cc.referencedUndeclared[0]).toMatchObject({
      name: "wazuh-agent-stats*",
      file: "plugins/main/common/constants.ts",
      line: 122,
    });
  });

  test("a matched pair appears in neither population", () => {
    const cc = buildCrosscheck(
      baseInput({
        declared: [declared("wazuh-states-vulnerabilities*")],
        references: [referenced("wazuh-states-vulnerabilities*")],
      }),
    );
    expect(cc.declaredUnreferenced).toEqual([]);
    expect(cc.referencedUndeclared).toEqual([]);
  });

  test("a WCS module with no consumer is reported", () => {
    const cc = buildCrosscheck(baseInput({ wcsModules: [{ name: "network", indexPatterns: ["wazuh-net*"] }, { name: "decoders", indexPatterns: ["wazuh-dec*"] }] }));
    expect(cc.wcsWithoutConsumer).toEqual(["decoders", "network"]);
  });

  test("a WCS module named by a reference is not reported", () => {
    const cc = buildCrosscheck(
      baseInput({ wcsModules: [{ name: "network", indexPatterns: ["wazuh-net*"] }], references: [referenced("wazuh-net-events*")] }),
    );
    expect(cc.wcsWithoutConsumer).toEqual([]);
  });
});

describe("matching is by glob overlap, because both sides are globs", () => {
  test("a general declaration covers a specific reference", () => {
    // This test asserted the opposite until the running indexer settled it.
    // The repository declares `wazuh-findings-v5*`; the indexer expands that
    // into a template per category, so `wazuh-findings-v5-cloud-services*` is
    // declared. Under the old equality rule, sixteen live index families were
    // reported as undeclared.
    const cc = buildCrosscheck(
      baseInput({
        declared: [declared("wazuh-findings-v5*", "streams")],
        references: [referenced("wazuh-findings-v5-cloud-services*")],
      }),
    );

    expect(cc.referencedUndeclared).toEqual([]);
    expect(cc.declaredUnreferenced).toEqual([]);
  });

  test("a genuinely unrelated name is still reported", () => {
    const cc = buildCrosscheck(
      baseInput({
        declared: [declared("wazuh-states-sca*")],
        references: [referenced("wazuh-inventory-agent")],
      }),
    );

    expect(cc.referencedUndeclared.map((r) => r.name)).toEqual(["wazuh-inventory-agent"]);
    expect(cc.declaredUnreferenced.map((d) => d.pattern)).toEqual(["wazuh-states-sca*"]);
  });

  test("a trailing star is normalised on both sides, so the same index matches itself", () => {
    const cc = buildCrosscheck(
      baseInput({
        declared: [declared("wazuh-states-sca*")],
        references: [referenced("wazuh-states-sca")],
      }),
    );
    expect(cc.declaredUnreferenced).toEqual([]);
    expect(cc.referencedUndeclared).toEqual([]);
  });
});

describe("coverage travels with the result", () => {
  test("coverage is the first key of the object", () => {
    const cc = buildCrosscheck(baseInput());
    const keys = Object.keys(cc);
    expect(keys.indexOf("coverage")).toBeLessThan(keys.indexOf("declaredUnreferenced"));
    expect(keys.indexOf("coverage")).toBeLessThan(keys.indexOf("referencedUndeclared"));
  });

  test("uncovered mechanisms are carried through verbatim", () => {
    const uncovered = [
      {
        kind: "regex-allowlist" as const,
        file: "plugins/wazuh-ai-assistant/server/tools/guardrails.ts",
        line: 199,
        note: "accepted by shape",
      },
    ];
    const cc = buildCrosscheck(baseInput({ uncovered }));
    expect(cc.coverage.uncovered).toEqual(uncovered);
    expect(cc.coverage.scannedRepos).toEqual(["wazuh-dashboard-plugins"]);
  });

  test("recoveredNames counts distinct names, not references", () => {
    const cc = buildCrosscheck(
      baseInput({
        references: [
          referenced("wazuh-a*", "a.ts", 1),
          referenced("wazuh-a*", "b.ts", 2),
          referenced("wazuh-b*", "c.ts", 3),
        ],
      }),
    );
    expect(cc.coverage.recoveredNames).toBe(2);
  });
});

describe("competing catalogs", () => {
  test("two modules declaring the same name are reported, and the run still succeeds", () => {
    const cc = buildCrosscheck(
      baseInput({
        references: [
          referenced("wazuh-states-vulnerabilities*", "plugins/main/common/constants.ts", 51),
          referenced("wazuh-states-vulnerabilities*", "plugins/wazuh-ai-assistant/server/tools/state-families.ts", 345),
        ],
      }),
    );

    expect(cc.competingCatalogs).toEqual([
      {
        name: "wazuh-states-vulnerabilities*",
        files: [
          "plugins/main/common/constants.ts",
          "plugins/wazuh-ai-assistant/server/tools/state-families.ts",
        ],
      },
    ]);
  });

  test("the same name from one module twice is not a competition", () => {
    const cc = buildCrosscheck(
      baseInput({
        references: [
          referenced("wazuh-a*", "plugins/main/common/constants.ts", 1),
          referenced("wazuh-a*", "plugins/main/common/constants.ts", 2),
        ],
      }),
    );
    expect(cc.competingCatalogs).toEqual([]);
  });

  test("an import edge is not a competing declaration", () => {
    // Only catalog literals declare. An importer consumes.
    const cc = buildCrosscheck(
      baseInput({
        references: [
          { name: "wazuh-a*", file: "constants.ts", line: 1, via: "catalog-literal" },
          { name: "wazuh-a*", file: "consumer.ts", line: 9, via: "import" },
        ],
      }),
    );
    expect(cc.competingCatalogs).toEqual([]);
  });
});

describe("determinism", () => {
  test("every list is ordered and two builds are identical", () => {
    const input = baseInput({
      declared: [declared("wazuh-z*"), declared("wazuh-a*")],
      references: [referenced("wazuh-y*", "z.ts", 2), referenced("wazuh-x*", "a.ts", 1)],
      wcsModules: [{ name: "zeta", indexPatterns: ["wazuh-zz*"] }, { name: "alpha", indexPatterns: ["wazuh-aa*"] }],
    });

    const first = buildCrosscheck(input);
    const second = buildCrosscheck(input);
    expect(second).toEqual(first);

    expect(first.declaredUnreferenced.map((d) => d.pattern)).toEqual(["wazuh-a*", "wazuh-z*"]);
    expect(first.referencedUndeclared.map((r) => r.name)).toEqual(["wazuh-x*", "wazuh-y*"]);
    expect(first.wcsWithoutConsumer).toEqual(["alpha", "zeta"]);
  });
});

describe("the trailing star is the difference between a name and a family", () => {
  test("two distinct exact names do NOT match each other", () => {
    // Reported by review and reproduced: an earlier version prefix-matched
    // both directions, so `wazuh-a` declared and `wazuh-ab` referenced
    // cancelled each other and BOTH findings disappeared.
    const cc = buildCrosscheck(
      baseInput({
        declared: [declared("wazuh-a")],
        references: [referenced("wazuh-ab")],
      }),
    );

    expect(cc.declaredUnreferenced.map((d) => d.pattern)).toEqual(["wazuh-a"]);
    expect(cc.referencedUndeclared.map((r) => r.name)).toEqual(["wazuh-ab"]);
  });

  test("a declared glob covers a more specific reference", () => {
    const cc = buildCrosscheck(
      baseInput({
        declared: [declared("wazuh-findings-v5*", "streams")],
        references: [referenced("wazuh-findings-v5-cloud-services*")],
      }),
    );
    expect(cc.referencedUndeclared).toEqual([]);
    expect(cc.declaredUnreferenced).toEqual([]);
  });

  test("a referenced glob covers a more specific declaration", () => {
    // The dashboard queries `wazuh-states-fim*`; the indexer declares
    // `wazuh-states-fim-files*`. The query does reach that index.
    const cc = buildCrosscheck(
      baseInput({
        declared: [declared("wazuh-states-fim-files*")],
        references: [referenced("wazuh-states-fim*")],
      }),
    );
    expect(cc.referencedUndeclared).toEqual([]);
    expect(cc.declaredUnreferenced).toEqual([]);
  });

  test("an exact reference is not covered by a longer exact declaration", () => {
    const cc = buildCrosscheck(
      baseInput({
        declared: [declared("wazuh-states-sca-extra")],
        references: [referenced("wazuh-states-sca")],
      }),
    );
    expect(cc.referencedUndeclared.map((r) => r.name)).toEqual(["wazuh-states-sca"]);
  });
});

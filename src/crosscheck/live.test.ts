/**
 * `buildLiveComparison` (SPEC 1.10, crosscheck-live-indexer).
 *
 * Every input here is a literal `RawClusterState`, never a fixture file. The
 * previous cycle shipped a scanner that recovered zero real names while every
 * test passed, because the fixture encoded the same misunderstanding as the
 * implementation. A literal in the test file cannot drift from the code the
 * way a shared fixture can.
 */

import { describe, expect, test } from "bun:test";
import { covers } from "./build.ts";
import { buildLiveComparison, declaredFromWcsModules } from "./live.ts";
import type { RawClusterState } from "../indexer/types.ts";
import type { DeclaredIndex } from "../matrix/types.ts";

function state(overrides: Partial<RawClusterState> = {}): RawClusterState {
  return {
    indices: [],
    dataStreams: [],
    indexTemplates: [],
    ...overrides,
  };
}

function declared(pattern: string, template = "templates/x.json", group = ""): DeclaredIndex {
  return { pattern, template, group };
}

describe("the installed set — data streams resolve to their stream name", () => {
  test("a data stream with one backing index resolves to the stream name", () => {
    const cc = buildLiveComparison(
      state({
        indices: [{ name: ".ds-wazuh-foo-000001" }],
        dataStreams: [
          { name: "wazuh-foo", template: "t", backingIndices: [".ds-wazuh-foo-000001"] },
        ],
      }),
      [declared("wazuh-foo")],
    );

    expect(cc.declaredNotInstalled).toEqual([]);
    expect(cc.installedNotDeclared.wazuh).toEqual([]);
    expect(cc.installedNotDeclared.platformManaged).toEqual([]);
  });

  test("the backing index does not appear as a standalone installed index", () => {
    const cc = buildLiveComparison(
      state({
        indices: [{ name: ".ds-wazuh-foo-000001" }],
        dataStreams: [
          { name: "wazuh-foo", template: "t", backingIndices: [".ds-wazuh-foo-000001"] },
        ],
      }),
      [],
    );

    const allUndeclaredNames = [
      ...cc.installedNotDeclared.wazuh,
      ...cc.installedNotDeclared.platformManaged,
    ].map((entry) => entry.name);
    expect(allUndeclaredNames).not.toContain(".ds-wazuh-foo-000001");
    expect(allUndeclaredNames).toContain("wazuh-foo");
  });

  test("a plain index appears as itself", () => {
    const cc = buildLiveComparison(state({ indices: [{ name: "wazuh-plain" }] }), []);

    expect(cc.installedNotDeclared.wazuh).toEqual([{ name: "wazuh-plain", kind: "index" }]);
  });
});

describe("ownership comes from the cluster's own report, not a .ds- prefix guess", () => {
  test("a backing index whose name breaks convention still resolves via backingIndices", () => {
    const cc = buildLiveComparison(
      state({
        indices: [{ name: "totally-custom-name" }],
        dataStreams: [
          { name: "wazuh-custom", template: "t", backingIndices: ["totally-custom-name"] },
        ],
      }),
      [declared("wazuh-custom")],
    );

    expect(cc.declaredNotInstalled).toEqual([]);
    const allUndeclaredNames = [
      ...cc.installedNotDeclared.wazuh,
      ...cc.installedNotDeclared.platformManaged,
    ].map((entry) => entry.name);
    expect(allUndeclaredNames).not.toContain("totally-custom-name");
  });

  test("a plain index literally named with a .ds- prefix, claimed by no stream, is NOT swallowed", () => {
    const cc = buildLiveComparison(
      state({ indices: [{ name: ".ds-not-a-stream-000001" }], dataStreams: [] }),
      [],
    );

    expect(cc.installedNotDeclared.platformManaged).toEqual([
      { name: ".ds-not-a-stream-000001", kind: "index" },
    ]);
  });
});

describe("the three base populations", () => {
  test("declared-not-installed", () => {
    const cc = buildLiveComparison(state(), [declared("wazuh-cve*", "templates/cve.json")]);
    expect(cc.declaredNotInstalled).toEqual([
      { pattern: "wazuh-cve*", template: "templates/cve.json" },
    ]);
  });

  test("installed-not-declared", () => {
    const cc = buildLiveComparison(state({ indices: [{ name: "wazuh-mystery" }] }), []);
    expect(cc.installedNotDeclared.wazuh).toEqual([{ name: "wazuh-mystery", kind: "index" }]);
  });

  test("template-only-in-cluster", () => {
    const cc = buildLiveComparison(
      state({
        indexTemplates: [{ name: "mystery-template", indexPatterns: ["wazuh-unknown-thing*"] }],
      }),
      [],
    );
    expect(cc.templatesOnlyInCluster).toEqual([
      { name: "mystery-template", indexPatterns: ["wazuh-unknown-thing*"] },
    ]);
  });

  test("a template whose patterns are covered by a declared pattern is not reported", () => {
    const cc = buildLiveComparison(
      state({
        indexTemplates: [{ name: "known-template", indexPatterns: ["wazuh-states-sca-x"] }],
      }),
      [declared("wazuh-states-sca*")],
    );
    expect(cc.templatesOnlyInCluster).toEqual([]);
  });
});

describe("alias generation is covered by covers(), with no special-casing", () => {
  test("wazuh-threatintel-decoders-a is covered by declared wazuh-threatintel-decoders*", () => {
    const cc = buildLiveComparison(
      state({ indices: [{ name: "wazuh-threatintel-decoders-a" }] }),
      [declared("wazuh-threatintel-decoders*")],
    );
    expect(cc.declaredNotInstalled).toEqual([]);
    const allUndeclaredNames = [
      ...cc.installedNotDeclared.wazuh,
      ...cc.installedNotDeclared.platformManaged,
    ].map((entry) => entry.name);
    expect(allUndeclaredNames).not.toContain("wazuh-threatintel-decoders-a");
  });
});

describe("undeclared installed names are partitioned, never silently dropped", () => {
  test("Wazuh-namespace and platform names both reach the reader", () => {
    const cc = buildLiveComparison(
      state({
        indices: [
          { name: "wazuh-mystery" },
          { name: ".wazuh-hidden-mystery" },
          { name: ".opendistro-job-scheduler-lock" },
          { name: ".kibana_1" },
        ],
      }),
      [],
    );

    expect(cc.installedNotDeclared.wazuh.map((e) => e.name)).toEqual([
      ".wazuh-hidden-mystery",
      "wazuh-mystery",
    ]);
    expect(cc.installedNotDeclared.platformManaged.map((e) => e.name)).toEqual([
      ".kibana_1",
      ".opendistro-job-scheduler-lock",
    ]);
  });
});

describe("a pattern and an index that are the same subject are reported as one", () => {
  test("wazuh-threatintel-filters (no trailing *) and wazuh-threatintel-filters-a join into one finding", () => {
    const cc = buildLiveComparison(
      state({ indices: [{ name: "wazuh-threatintel-filters-a" }] }),
      [declared("wazuh-threatintel-filters", "templates/threatintel/filters.json")],
    );

    // Not two unrelated entries in two lists.
    expect(cc.declaredNotInstalled).toEqual([]);
    expect(cc.installedNotDeclared.wazuh).toEqual([]);
    expect(cc.installedNotDeclared.platformManaged).toEqual([]);

    // One joined finding instead.
    expect(cc.sameSubjectMismatches).toEqual([
      {
        pattern: "wazuh-threatintel-filters",
        template: "templates/threatintel/filters.json",
        installedName: "wazuh-threatintel-filters-a",
        installedKind: "index",
      },
    ]);
  });

  test("the matcher itself still treats the pair as not matching", () => {
    // covers() is imported, not reimplemented, and its answer for this exact
    // pair must stay false -- the join is a reporting decision layered on
    // top, never a loosened match.
    expect(covers("wazuh-threatintel-filters", "wazuh-threatintel-filters-a")).toBe(false);
  });
});

describe("the declared set fed to the live comparison includes WCS module patterns", () => {
  // Defect found against the real cluster: `src/cli.ts` built `declared` from
  // `parsed.templates` only. `.wazuh-internal-state` is declared, as
  // `.wazuh-internal-state*` in `wcs/internal-state/fields/template-settings.json`
  // -- a WCS module, not an indexer template -- so it was reported as
  // installed-not-declared: a false accusation about production state,
  // exactly the class design decision 8 exists to prevent, through a
  // different door. `.iocs_development_*iocs`, declared ONLY in a WCS
  // module, was invisible on the other side too: it never appeared in
  // `declaredNotInstalled` even though it genuinely is not installed.

  test("declaredFromWcsModules turns each module pattern into a DeclaredIndex naming that module's own template-settings.json", () => {
    const result = declaredFromWcsModules([
      { name: "internal-state", indexPatterns: [".wazuh-internal-state*"] },
      { name: "content/ioc", indexPatterns: [".iocs_development_*iocs"] },
      { name: "empty-module", indexPatterns: [] },
    ]);

    expect(result).toEqual([
      {
        pattern: ".wazuh-internal-state*",
        template: "wcs/internal-state/fields/template-settings.json",
        group: "",
      },
      {
        pattern: ".iocs_development_*iocs",
        template: "wcs/content/ioc/fields/template-settings.json",
        group: "",
      },
    ]);
  });

  test("a WCS-only declared pattern that IS installed does not appear as installed-not-declared", () => {
    const wcsDeclared = declaredFromWcsModules([
      { name: "internal-state", indexPatterns: [".wazuh-internal-state*"] },
    ]);

    const cc = buildLiveComparison(state({ indices: [{ name: ".wazuh-internal-state" }] }), wcsDeclared);

    expect(cc.installedNotDeclared.wazuh).toEqual([]);
    expect(cc.installedNotDeclared.platformManaged).toEqual([]);
  });

  test("a WCS-only declared pattern that is NOT installed appears in declaredNotInstalled, naming the WCS path", () => {
    const wcsDeclared = declaredFromWcsModules([
      { name: "content/ioc", indexPatterns: [".iocs_development_*iocs"] },
    ]);

    const cc = buildLiveComparison(state(), wcsDeclared);

    expect(cc.declaredNotInstalled).toEqual([
      { pattern: ".iocs_development_*iocs", template: "wcs/content/ioc/fields/template-settings.json" },
    ]);
  });
});

describe("determinism", () => {
  test("every list is sorted and two builds are identical", () => {
    const input: RawClusterState = state({
      indices: [{ name: "wazuh-z" }, { name: "wazuh-a" }],
      indexTemplates: [
        { name: "z-template", indexPatterns: ["wazuh-unrelated-z*"] },
        { name: "a-template", indexPatterns: ["wazuh-unrelated-a*"] },
      ],
    });
    const declaredList = [
      declared("wazuh-z-decl*", "z.json"),
      declared("wazuh-a-decl*", "a.json"),
    ];

    const first = buildLiveComparison(input, declaredList);
    const second = buildLiveComparison(input, declaredList);

    expect(second).toEqual(first);
    expect(first.declaredNotInstalled.map((d) => d.pattern)).toEqual([
      "wazuh-a-decl*",
      "wazuh-z-decl*",
    ]);
    expect(first.installedNotDeclared.wazuh.map((e) => e.name)).toEqual(["wazuh-a", "wazuh-z"]);
    expect(first.templatesOnlyInCluster.map((t) => t.name)).toEqual([
      "a-template",
      "z-template",
    ]);
  });
});

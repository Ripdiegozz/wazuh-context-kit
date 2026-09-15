/**
 * Template discovery across every group (source-parse delta, tasks 1.1–1.6).
 *
 * `parseIndexerArtifacts` used to read `templates/states/` only. The real tree
 * at 5.0.0 also has `streams/` (8), `content/` (8) and four JSON files directly
 * under `templates/` — so the product declared 20 of 40 index templates, half
 * the declared surface.
 *
 * The rule is the field, not the location: a JSON that parses and declares no
 * `index_patterns` is not a template. A directory-name allowlist is exactly the
 * failure this defect is.
 *
 * One deliberate exception: a JSON that FAILS to parse is kept with an empty
 * pattern list. Robust-empty must not become invisible — dropping a file we
 * could not read would hide the breakage.
 */

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseIndexerArtifacts } from "./indexer.ts";
import type { ParseTarget } from "./types.ts";

const COMMIT = "e".repeat(40);
const TEMPLATES = "plugins/setup/src/main/resources/templates";

async function makeCheckout(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "wazuh-ctx-templates-"));
  for (const [path, body] of Object.entries(files)) {
    const absolute = join(root, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, body, "utf8");
  }
  return root;
}

function targetFor(dir: string): ParseTarget {
  return { repo: "wazuh-indexer-plugins", repoKind: "indexer", dir, commit: COMMIT };
}

function template(pattern: string): string {
  return JSON.stringify({ index_patterns: [pattern], template: { mappings: {} } });
}

describe("index template discovery", () => {
  test("finds templates in every subdirectory, not only states/", async () => {
    const dir = await makeCheckout({
      [`${TEMPLATES}/states/vulnerabilities.json`]: template("wazuh-states-vulnerabilities*"),
      [`${TEMPLATES}/streams/events.json`]: template("wazuh-events-v5*"),
      [`${TEMPLATES}/content/ioc.json`]: template("wazuh-threatintel-enrichments*"),
    });

    try {
      const result = await parseIndexerArtifacts(targetFor(dir));
      expect(result.templates).toHaveLength(3);

      const byGroup = Object.fromEntries(result.templates.map((t) => [t.group, t.name]));
      expect(byGroup).toEqual({
        states: "vulnerabilities",
        streams: "events",
        content: "ioc",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("finds templates sitting directly under templates/, with no subdirectory", async () => {
    // Four real ones live here at 5.0.0: cve.json, ism-config.json,
    // settings.json, setup-status.json. A discovery rule that assumes a
    // subdirectory misses them entirely.
    const dir = await makeCheckout({
      [`${TEMPLATES}/cve.json`]: template("wazuh-cve*"),
      [`${TEMPLATES}/states/sca.json`]: template("wazuh-states-sca*"),
    });

    try {
      const result = await parseIndexerArtifacts(targetFor(dir));
      expect(result.templates.map((t) => [t.group, t.name])).toEqual([
        ["", "cve"],
        ["states", "sca"],
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a subdirectory the code has never heard of is discovered anyway", async () => {
    // No allowlist. A fourth group appearing upstream must become visible
    // without a code change -- that is precisely the failure being fixed.
    const dir = await makeCheckout({
      [`${TEMPLATES}/somethingNew/future.json`]: template("wazuh-future*"),
    });

    try {
      const result = await parseIndexerArtifacts(targetFor(dir));
      expect(result.templates).toHaveLength(1);
      expect(result.templates[0]!.group).toBe("somethingNew");
      expect(result.templates[0]!.indexPatterns).toEqual(["wazuh-future*"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a JSON without index_patterns is not a template", async () => {
    // The rule is the field, not the location.
    const dir = await makeCheckout({
      [`${TEMPLATES}/states/real.json`]: template("wazuh-states-real*"),
      [`${TEMPLATES}/states/mappings-only.json`]: JSON.stringify({ mappings: { properties: {} } }),
      [`${TEMPLATES}/states/empty-patterns.json`]: JSON.stringify({ index_patterns: [] }),
    });

    try {
      const result = await parseIndexerArtifacts(targetFor(dir));
      expect(result.templates.map((t) => t.name)).toEqual(["real"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a malformed JSON stays visible with empty patterns, rather than vanishing", async () => {
    // Robust-empty must not become invisible. A file we could not read is a
    // template we could not read -- dropping it would hide the breakage, and
    // the pre-existing contract in parse.test.ts says so.
    const dir = await makeCheckout({
      [`${TEMPLATES}/states/good.json`]: template("wazuh-states-good*"),
      [`${TEMPLATES}/states/broken.json`]: "{ not json",
    });

    try {
      const result = await parseIndexerArtifacts(targetFor(dir));
      expect(result.templates.map((t) => t.name)).toEqual(["broken", "good"]);
      expect(result.templates.find((t) => t.name === "broken")!.indexPatterns).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("ordering is deterministic by path", async () => {
    const dir = await makeCheckout({
      [`${TEMPLATES}/streams/zeta.json`]: template("wazuh-z*"),
      [`${TEMPLATES}/content/alpha.json`]: template("wazuh-a*"),
      [`${TEMPLATES}/states/mid.json`]: template("wazuh-m*"),
    });

    try {
      const first = await parseIndexerArtifacts(targetFor(dir));
      const second = await parseIndexerArtifacts(targetFor(dir));
      expect(second.templates).toEqual(first.templates);
      expect(first.templates.map((t) => t.path)).toEqual([
        `${TEMPLATES}/content/alpha.json`,
        `${TEMPLATES}/states/mid.json`,
        `${TEMPLATES}/streams/zeta.json`,
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("the states group keeps its existing shape, so this is additive", async () => {
    const dir = await makeCheckout({
      [`${TEMPLATES}/states/vulnerabilities.json`]: template("wazuh-states-vulnerabilities*"),
    });

    try {
      const result = await parseIndexerArtifacts(targetFor(dir));
      const t = result.templates[0]!;
      expect(t.name).toBe("vulnerabilities");
      expect(t.path).toBe(`${TEMPLATES}/states/vulnerabilities.json`);
      expect(t.indexPatterns).toEqual(["wazuh-states-vulnerabilities*"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("WCS modules carry the index they declare", () => {
  test("reads index_patterns from the module's own template-settings.json", async () => {
    // The link is declared, not inferred. Every one of the 39 real modules has
    // `fields/template-settings.json` with an `index_patterns` array.
    //
    // Inferring it from the path is hopeless and was measured as such: a
    // literal rule matches 2 of 39. `stateful/` becomes `states-`, `content/`
    // becomes `threatintel-`, `stateless/` disappears, and
    // `stateless/metrics/engine` ends up as `normalization`.
    const dir = await makeCheckout({
      "wcs/content/decoders/docs/fields.csv": "ECS_Version,Field\n9.1.0,offset\n",
      "wcs/content/decoders/fields/template-settings.json": JSON.stringify({
        index_patterns: ["wazuh-threatintel-decoders*"],
      }),
      "wcs/stateful/sca/docs/fields.csv": "ECS_Version,Field\n9.1.0,id\n",
      "wcs/stateful/sca/fields/template-settings.json": JSON.stringify({
        index_patterns: ["wazuh-states-sca*"],
      }),
    });

    try {
      const { wcsModules } = await parseIndexerArtifacts(targetFor(dir));
      expect(wcsModules.map((m) => [m.name, m.indexPatterns])).toEqual([
        ["content/decoders", ["wazuh-threatintel-decoders*"]],
        ["stateful/sca", ["wazuh-states-sca*"]],
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a module without template-settings.json yields an empty pattern list, not a crash", async () => {
    const dir = await makeCheckout({
      "wcs/orphan/docs/fields.csv": "ECS_Version,Field\n9.1.0,x\n",
    });

    try {
      const { wcsModules } = await parseIndexerArtifacts(targetFor(dir));
      expect(wcsModules).toHaveLength(1);
      expect(wcsModules[0]!.indexPatterns).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

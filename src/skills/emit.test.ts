/**
 * `emit.ts` — the one module in `src/skills/` allowed to touch a real
 * filesystem (SPEC 6.1's purity seam). These tests use real temp
 * directories on purpose: `anchor.test.ts`, `extract.test.ts` and
 * `reconstruct.test.ts` prove correctness with literals and no I/O; this
 * file proves the I/O boundary itself behaves — determinism (task 6.1) and
 * the no-timestamp rule (task 6.2) are properties of WRITTEN BYTES, which
 * only exist once something actually writes them.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diffSkill } from "./diff.ts";
import { extractSkill } from "./extract.ts";
import { emitExtraction } from "./emit.ts";
import type { SectionMarker, SkillVariant } from "./types.ts";

function variant(
  repo: string,
  sections: readonly { path: readonly string[]; lines: readonly string[]; markers?: readonly SectionMarker[] }[],
): SkillVariant {
  return {
    repo,
    skill: {
      frontmatter: { name: "a-skill", description: `${repo}'s description` },
      sections: sections.map((s) => ({ path: s.path, lines: s.lines, markers: s.markers ?? [] })),
    },
  };
}

function sampleExtraction() {
  const variants = [
    variant("wazuh-dashboard", [
      { path: ["Common"], lines: ["shared line"] },
      {
        path: ["Section"],
        lines: ["common line", "> **repo-specific (wazuh-dashboard):** dashboard-only line"],
        markers: [{ lineIndex: 1, repo: "wazuh-dashboard" }],
      },
      { path: ["Disputed"], lines: ["area"] },
    ]),
    variant("wazuh-dashboard-plugins", [
      { path: ["Common"], lines: ["shared line"] },
      { path: ["Section"], lines: ["common line"] },
      { path: ["Disputed"], lines: ["plugin(s)"] },
    ]),
  ];
  return extractSkill(diffSkill("a-skill", variants));
}

async function listFilesRecursively(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await listFilesRecursively(full)));
    } else {
      results.push(full);
    }
  }
  return results.sort();
}

describe("two frozen runs over unchanged inputs produce byte-identical output (task 6.1)", () => {
  test("core/, overrides/, conflicts/ and the report match exactly across two temp dirs", async () => {
    const extracted = [sampleExtraction()];

    const dirA = await mkdtemp(join(tmpdir(), "skills-core-emit-a-"));
    const dirB = await mkdtemp(join(tmpdir(), "skills-core-emit-b-"));
    try {
      await emitExtraction(dirA, extracted);
      // A fresh call, a fresh `ExtractedSkill` array with the SAME content
      // but rebuilt from scratch — not the same object reference — so this
      // actually exercises determinism rather than JS reference identity.
      await emitExtraction(dirB, [sampleExtraction()]);

      const filesA = (await listFilesRecursively(dirA)).map((f) => f.slice(dirA.length));
      const filesB = (await listFilesRecursively(dirB)).map((f) => f.slice(dirB.length));
      expect(filesA).toEqual(filesB);
      expect(filesA.length).toBeGreaterThan(0);

      for (let i = 0; i < filesA.length; i++) {
        const contentA = await readFile(join(dirA, filesA[i]!), "utf8");
        const contentB = await readFile(join(dirB, filesB[i]!), "utf8");
        expect(contentA).toBe(contentB);
      }
    } finally {
      await rm(dirA, { recursive: true, force: true });
      await rm(dirB, { recursive: true, force: true });
    }
  });
});

describe("no timestamp is written into any emitted tree (task 6.2)", () => {
  test("neither the core, the overrides, the conflicts, nor the report contain an ISO timestamp", async () => {
    const extracted = [sampleExtraction()];
    const dir = await mkdtemp(join(tmpdir(), "skills-core-emit-ts-"));
    try {
      await emitExtraction(dir, extracted);
      const files = await listFilesRecursively(dir);
      expect(files.length).toBeGreaterThan(0);

      const isoTimestamp = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
      for (const file of files) {
        const content = await readFile(file, "utf8");
        expect(content).not.toMatch(isoTimestamp);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("emitExtraction lays out the trees SPEC 2.1 describes", () => {
  test("core/skills/<skill>/SKILL.md, overrides/<repo>/<skill>.yml, conflicts/<skill>.yml", async () => {
    const extracted = [sampleExtraction()];
    const dir = await mkdtemp(join(tmpdir(), "skills-core-emit-layout-"));
    try {
      const result = await emitExtraction(dir, extracted);

      expect(result.written).toContain(join(dir, "core", "skills", "a-skill", "SKILL.md"));
      expect(result.written).toContain(join(dir, "overrides", "wazuh-dashboard", "a-skill.yml"));
      expect(result.written).toContain(join(dir, "conflicts", "a-skill.yml"));
      expect(result.written).toContain(join(dir, "extraction-report.json"));

      // wazuh-dashboard-plugins has no override op of its own in this
      // sample (its only divergence is the unmarked "Disputed" conflict),
      // so it must NOT get an overrides file — an empty file would be a
      // laundered conflict just as much as writing the op into it would be.
      expect(result.written).not.toContain(join(dir, "overrides", "wazuh-dashboard-plugins", "a-skill.yml"));

      const report = JSON.parse(await readFile(join(dir, "extraction-report.json"), "utf8"));
      expect(report.skills).toHaveLength(1);
      expect(report.skills[0].skill).toBe("a-skill");
      expect(report.skills[0].distributable).toBe(false);
      expect(report.skills[0].blockingConflicts.length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

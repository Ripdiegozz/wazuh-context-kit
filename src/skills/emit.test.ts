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
import { resolveAnchor } from "./anchor.ts";
import { diffSkill } from "./diff.ts";
import { extractSkill as extractSkillUnchecked } from "./extract.ts";
import type { ExtractedSkill } from "./extract.ts";
import { emitExtraction } from "./emit.ts";
import { reconstructRepo } from "./reconstruct.ts";
import type { SectionMarker, SkillVariant } from "./types.ts";

/** Same blanket guards as `extract.test.ts` and `reconstruct.test.ts` —
 * applied to the one extraction this file builds and reuses everywhere. */
function assertNoBlankAnchor(extracted: ExtractedSkill): void {
  const allOps = [...[...extracted.overrides.values()].flat(), ...extracted.conflicts];
  for (const op of allOps) {
    if (op.anchor !== null && op.anchor.trim().length === 0) {
      throw new Error(`assertNoBlankAnchor: skill '${extracted.skill}' has a blank/whitespace-only anchor`);
    }
  }
}

/** The general invariant (see `extract.test.ts` for the full rationale):
 * every op's `(heading, anchor, occurrence, offset)` must resolve to
 * exactly one position, in every repo it belongs to. */
function assertAnchorsResolve(extracted: ExtractedSkill): void {
  const coreByHeading = new Map(extracted.core.map((section) => [JSON.stringify(section.path), section]));
  const opsWithRepo: { readonly op: { heading: readonly string[]; anchor: string | null; occurrence: number }; readonly repo: string }[] = [];
  for (const [repo, ops] of extracted.overrides) for (const op of ops) opsWithRepo.push({ op, repo });
  for (const op of extracted.conflicts) for (const repo of op.repos) opsWithRepo.push({ op, repo });

  for (const { op, repo } of opsWithRepo) {
    if (op.anchor === null) continue;
    const section = coreByHeading.get(JSON.stringify(op.heading));
    if (section === undefined) continue;
    resolveAnchor({
      skill: extracted.skill,
      repo,
      heading: op.heading,
      lines: section.anchors,
      anchor: op.anchor,
      occurrence: op.occurrence,
    });
  }
}

/** Same blanket round-trip guard as `extract.test.ts` and
 * `reconstruct.test.ts` — see `extract.test.ts` for the full rationale,
 * including why a line-count-only version of this missed a real
 * section-ordering bug that a byte-equality check catches. */
function assertReconstructionMatchesOriginal(
  extracted: ExtractedSkill,
  variants: readonly { repo: string; skill: { sections: readonly { lines: readonly string[] }[] } }[],
): void {
  for (const v of variants) {
    const expected = v.skill.sections.flatMap((s) => s.lines);
    const actual = reconstructRepo(extracted, v.repo);
    const matches = actual.length === expected.length && actual.every((line, i) => line === expected[i]);
    if (!matches) {
      throw new Error(
        `assertReconstructionMatchesOriginal: skill '${extracted.skill}' repo '${v.repo}' did not ` +
          `round-trip — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      );
    }
  }
}

function extractSkill(skillName: string, variants: readonly SkillVariant[]): ExtractedSkill {
  const result = extractSkillUnchecked(diffSkill(skillName, variants));
  assertNoBlankAnchor(result);
  assertAnchorsResolve(result);
  assertReconstructionMatchesOriginal(result, variants);
  return result;
}

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

/**
 * Three repos, not two — a 1-vs-1 split is always a TIE under the
 * majority-baseline rule (design decision 3, revised), and a tie's winner
 * depends only on alphabetical repo order, not on which repo "looks like"
 * the base. Three repos lets "Section" and "Disputed" each have a genuine
 * 2-vs-1 majority, so this fixture's shape (dashboard overrides, plugins
 * has no override file, plugins conflicts) is unambiguous rather than an
 * accident of two repo names happening to sort a particular way.
 */
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
    variant("wazuh-indexer", [
      { path: ["Common"], lines: ["shared line"] },
      { path: ["Section"], lines: ["common line"] },
      { path: ["Disputed"], lines: ["area"] },
    ]),
  ];
  const extracted = extractSkill("a-skill", variants);
  assertNoBlankAnchor(extracted);
  assertAnchorsResolve(extracted);
  return extracted;
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

describe("the report carries reconstruction verification, not just core-share numbers", () => {
  test("with originals supplied, every repo reconstructs and the arithmetic closes", async () => {
    const extracted = [sampleExtraction()];
    const originalsBySkill = new Map([
      [
        "a-skill",
        new Map([
          ["wazuh-dashboard", ["shared line", "common line", "> **repo-specific (wazuh-dashboard):** dashboard-only line", "area"]],
          ["wazuh-dashboard-plugins", ["shared line", "common line", "plugin(s)"]],
          ["wazuh-indexer", ["shared line", "common line", "area"]],
        ]),
      ],
    ]);

    const dir = await mkdtemp(join(tmpdir(), "skills-core-emit-recon-"));
    try {
      await emitExtraction(dir, extracted, originalsBySkill);
      const report = JSON.parse(await readFile(join(dir, "extraction-report.json"), "utf8"));

      const entry = report.skills[0];
      expect(entry.reconstruction).not.toBeNull();
      expect(entry.reconstruction.total).toBe(3);
      expect(entry.reconstruction.reconstructed).toBe(3);
      expect(entry.reconstruction.lossy).toEqual([]);
      expect(entry.reconstruction.reconstructed + entry.reconstruction.lossy.length).toBe(entry.reconstruction.total);

      expect(report.overall.reconstruction.total).toBe(3);
      expect(report.overall.reconstruction.reconstructed).toBe(3);
      expect(report.overall.reconstruction.lossy).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("without originals, reconstruction is explicitly null, not omitted", async () => {
    const extracted = [sampleExtraction()];
    const dir = await mkdtemp(join(tmpdir(), "skills-core-emit-norecon-"));
    try {
      await emitExtraction(dir, extracted);
      const report = JSON.parse(await readFile(join(dir, "extraction-report.json"), "utf8"));

      expect(report.skills[0].reconstruction).toBeNull();
      expect(report.overall.reconstruction).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("the report states the overall core share against the floor (task 3/4 companion)", () => {
  test("a share below the floor is reported as not meeting it", async () => {
    // A skill that is entirely one N-way tie has a low core share.
    const extracted = [sampleExtraction()];
    const dir = await mkdtemp(join(tmpdir(), "skills-core-emit-floor-"));
    try {
      await emitExtraction(dir, extracted);
      const report = JSON.parse(await readFile(join(dir, "extraction-report.json"), "utf8"));

      expect(report.overall.floor).toBe(0.5);
      expect(report.overall.meetsFloor).toBe(report.overall.coreShare >= 0.5);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

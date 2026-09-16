/**
 * `emitExtraction` — writes `core/`, `overrides/`, `conflicts/` and a report
 * for one or more `ExtractedSkill`s. The ONLY module in `src/skills/` that
 * touches the filesystem (SPEC 6.1's purity seam) — `anchor.ts`, `extract.ts`
 * and `reconstruct.ts` are pure precisely so this module can stay a thin,
 * untested-by-round-trip shell around them: rendering and writing bytes,
 * nothing that decides what those bytes ARE.
 *
 * Determinism by construction (design decision 5): ordering is skill, then
 * repo, then heading path, then position index — every one a total order
 * over strings, none dependent on filesystem iteration or Map insertion
 * order. No `generatedAt` or any other clock value is written into any
 * emitted file (task 6.2) — unlike `SKILLS-DIFF.md`'s render, which carries
 * `meta.generatedAt` in its JSON sibling but never renders it, the
 * extraction report has nowhere that even needs the exception: nothing here
 * is time-sensitive, so nothing here mentions the time at all.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import type { CoreSection, ExtractedSkill, PatchOp } from "./extract.ts";

function headingLine(path: readonly string[]): string | null {
  if (path.length === 0) return null; // the preamble — content with no heading of its own
  return `${"#".repeat(path.length + 1)} ${path[path.length - 1]}`;
}

/**
 * Renders a skill's `core` sections into a standalone Markdown body — no
 * frontmatter, because `core/` is the shared BODY the seven repositories'
 * frontmatter (`name` shared, `description` legitimately per-repo) never
 * agreed to have one copy of. Assembling a full `SKILL.md` with frontmatter
 * is a `sync` concern, not this change's (tasks 1–6 stop at `core` +
 * `overrides` + `conflicts` plus the report).
 */
export function renderCoreMarkdown(core: readonly CoreSection[]): string {
  const parts: string[] = [];
  for (const section of core) {
    const heading = headingLine(section.path);
    if (heading !== null) parts.push(heading);
    parts.push(...section.lines);
  }
  return `${parts.join("\n")}\n`;
}

function opSortKey(op: PatchOp): string {
  return JSON.stringify([op.heading, op.anchor, op.content, op.attribution, [...op.repos].sort()]);
}

function serializeOp(op: PatchOp): Record<string, unknown> {
  const base: Record<string, unknown> = {
    op: op.anchor === null ? "insert-at-start" : "insert-after",
    heading: op.heading.join("/"),
  };
  if (op.anchor !== null) base.anchor = op.anchor;
  base.content = op.content;
  return base;
}

/** Renders one repo's or the conflicts layer's ops as YAML, sorted so the
 * output never depends on the order `extractSkill` happened to build them
 * in (design decision 5). */
export function renderOpsYaml(ops: readonly PatchOp[]): string {
  const sorted = [...ops].sort((a, b) => opSortKey(a).localeCompare(opSortKey(b)));
  return stringifyYaml(sorted.map(serializeOp));
}

export interface SkillReportEntry {
  readonly skill: string;
  readonly coreShare: number;
  readonly distributable: boolean;
  readonly blockingConflicts: readonly string[];
}

export interface ExtractionReport {
  readonly skills: readonly SkillReportEntry[];
}

/** Pure: builds the report object from already-computed `ExtractedSkill`s,
 * sorted by skill name for the same reason every other total order in this
 * module exists — a report that changes shape based on the order its inputs
 * arrived in is not actually deterministic, only usually consistent. */
export function buildExtractionReport(extracted: readonly ExtractedSkill[]): ExtractionReport {
  const skills = [...extracted]
    .map((e) => ({
      skill: e.skill,
      coreShare: e.coreShare,
      distributable: e.distributable,
      blockingConflicts: e.blockingConflicts,
    }))
    .sort((a, b) => a.skill.localeCompare(b.skill));
  return { skills };
}

export interface EmitResult {
  readonly written: readonly string[];
}

/**
 * Writes `core/skills/<skill>/SKILL.md`, `overrides/<repo>/<skill>.yml` for
 * every repo with at least one op, `conflicts/<skill>.yml` when non-empty,
 * and `extraction-report.json` — all under `outDir`. Returns every path
 * written, sorted, so a caller (the CLI) can report them without re-deriving
 * the layout.
 */
export async function emitExtraction(outDir: string, extracted: readonly ExtractedSkill[]): Promise<EmitResult> {
  const written: string[] = [];
  const sortedSkills = [...extracted].sort((a, b) => a.skill.localeCompare(b.skill));

  for (const skill of sortedSkills) {
    const coreDir = join(outDir, "core", "skills", skill.skill);
    await mkdir(coreDir, { recursive: true });
    const corePath = join(coreDir, "SKILL.md");
    await writeFile(corePath, renderCoreMarkdown(skill.core), "utf8");
    written.push(corePath);

    for (const repo of [...skill.overrides.keys()].sort((a, b) => a.localeCompare(b))) {
      const ops = skill.overrides.get(repo)!;
      if (ops.length === 0) continue;
      const repoDir = join(outDir, "overrides", repo);
      await mkdir(repoDir, { recursive: true });
      const overridePath = join(repoDir, `${skill.skill}.yml`);
      await writeFile(overridePath, renderOpsYaml(ops), "utf8");
      written.push(overridePath);
    }

    if (skill.conflicts.length > 0) {
      const conflictsDir = join(outDir, "conflicts");
      await mkdir(conflictsDir, { recursive: true });
      const conflictsPath = join(conflictsDir, `${skill.skill}.yml`);
      await writeFile(conflictsPath, renderOpsYaml(skill.conflicts), "utf8");
      written.push(conflictsPath);
    }
  }

  const report = buildExtractionReport(extracted);
  const reportPath = join(outDir, "extraction-report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  written.push(reportPath);

  return { written: written.sort((a, b) => a.localeCompare(b)) };
}

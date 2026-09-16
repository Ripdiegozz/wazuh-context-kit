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
import { coreShareCounts } from "./extract.ts";
import type { CoreSection, ExtractedSkill, PatchOp } from "./extract.ts";
import { reconstructAndVerify } from "./reconstruct.ts";
import type { LossyReport } from "./reconstruct.ts";

/** SPEC 2.4's floor: below this, the split proves nothing (the "empty core,
 * every file whole as its own override" trap `extract.ts`'s docblock and
 * `core-floor.test.ts` both name). Exported so the CLI checks the SAME
 * number this module reports, rather than a second copy that could drift. */
export const CORE_SHARE_FLOOR = 0.5;

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
    // The majority baseline before the first anchor, then each anchor
    // followed by ITS baseline — the same interleaving `reconstruct.ts`
    // replays per repo, here rendered for the shared, undeviated case.
    parts.push(...section.slots[0]!);
    section.anchors.forEach((anchorLine, index) => {
      parts.push(anchorLine);
      parts.push(...section.slots[index + 1]!);
    });
  }
  return `${parts.join("\n")}\n`;
}

function opSortKey(op: PatchOp): string {
  return JSON.stringify([op.heading, op.anchor, op.content, op.attribution, [...op.repos].sort()]);
}

function serializeOp(op: PatchOp): Record<string, unknown> {
  // "replace", not "insert": design decision 3 (revised) puts the MAJORITY
  // baseline in the core, so a repo's op REPLACES that baseline at this
  // position rather than adding alongside it. `content` is a line array,
  // not a joined string — `[]` (replace with nothing) and `[""]` (replace
  // with one blank line) are different original-file facts, and a joined
  // string cannot tell them apart once written back out.
  const base: Record<string, unknown> = {
    op: op.anchor === null ? "replace-at-start" : "replace-after",
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

/**
 * Reconstruction verification for one skill — the load-bearing claim of the
 * whole change ("the split lost nothing"), surfaced where a reader of the
 * ARTIFACT can actually see it. `null` when the caller supplied no
 * originals to check against (e.g. a run that only wants the core-share
 * numbers) — distinct from a verified run that happens to find zero repos,
 * which `total: 0` already expresses.
 */
export interface SkillReconstructionSummary {
  readonly total: number;
  readonly reconstructed: number;
  readonly lossy: readonly LossyReport[];
}

export interface SkillReportEntry {
  readonly skill: string;
  readonly coreShare: number;
  readonly distributable: boolean;
  readonly blockingConflicts: readonly string[];
  readonly tiedPositions: readonly string[];
  readonly reconstruction: SkillReconstructionSummary | null;
}

export interface OverallReport {
  /** Aggregated from raw line COUNTS across every skill, never averaged
   * per-skill ratios (`extract.ts`'s `coreShareCounts` docblock: averaging
   * ratios lets a tiny skill's 100 % cancel a large skill's 10 %). */
  readonly coreShare: number;
  readonly floor: number;
  /** `false` when `coreShare < floor` — SPEC 2.4's scenario: reconstruction
   * succeeding is NOT sufficient, this must independently hold. */
  readonly meetsFloor: boolean;
  readonly reconstruction: { readonly total: number; readonly reconstructed: number; readonly lossy: number } | null;
}

export interface ExtractionReport {
  readonly skills: readonly SkillReportEntry[];
  readonly overall: OverallReport;
}

/**
 * Pure: builds the report object from already-computed `ExtractedSkill`s,
 * sorted by skill name for the same reason every other total order in this
 * module exists — a report that changes shape based on the order its inputs
 * arrived in is not actually deterministic, only usually consistent.
 *
 * `originalsBySkill`, when supplied, is `skill -> repo -> that repo's
 * original flattened body` — the CLI's only source for it, since an
 * `ExtractedSkill` does not retain the inputs it was built from (design: the
 * proof is that `reconstruct` recovers them, not that they were kept
 * around). Without it, `reconstruction` is `null` per skill and `overall`
 * reports no reconstruction numbers — the report still says what it does
 * and does not know, rather than silently omitting the field.
 */
export function buildExtractionReport(
  extracted: readonly ExtractedSkill[],
  originalsBySkill?: ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>,
): ExtractionReport {
  const skills = [...extracted]
    .map((e) => {
      const originals = originalsBySkill?.get(e.skill);
      const reconstruction: SkillReconstructionSummary | null = originals
        ? { total: originals.size, ...reconstructAndVerify(e, originals) }
        : null;
      return {
        skill: e.skill,
        coreShare: e.coreShare,
        distributable: e.distributable,
        blockingConflicts: e.blockingConflicts,
        tiedPositions: e.tiedPositions,
        reconstruction,
      };
    })
    .sort((a, b) => a.skill.localeCompare(b.skill));

  const totals = extracted.reduce(
    (sum, e) => {
      const counts = coreShareCounts(e);
      return { coreLines: sum.coreLines + counts.coreLines, totalLines: sum.totalLines + counts.totalLines };
    },
    { coreLines: 0, totalLines: 0 },
  );
  const overallCoreShare = totals.totalLines === 0 ? 1 : totals.coreLines / totals.totalLines;

  const haveAnyOriginals = originalsBySkill !== undefined;
  const reconstructionTotals = haveAnyOriginals
    ? skills.reduce(
        (sum, s) => ({
          total: sum.total + (s.reconstruction?.total ?? 0),
          reconstructed: sum.reconstructed + (s.reconstruction?.reconstructed ?? 0),
          lossy: sum.lossy + (s.reconstruction?.lossy.length ?? 0),
        }),
        { total: 0, reconstructed: 0, lossy: 0 },
      )
    : null;

  return {
    skills,
    overall: {
      coreShare: overallCoreShare,
      floor: CORE_SHARE_FLOOR,
      meetsFloor: overallCoreShare >= CORE_SHARE_FLOOR,
      reconstruction: reconstructionTotals,
    },
  };
}

export interface EmitResult {
  readonly written: readonly string[];
  /** The exact report written to `extraction-report.json` — returned so a
   * caller (the CLI, deciding whether to exit non-zero on the floor) reads
   * the SAME computed report rather than calling `buildExtractionReport`
   * a second time and risking the two disagree. */
  readonly report: ExtractionReport;
}

/**
 * Writes `core/skills/<skill>/SKILL.md`, `overrides/<repo>/<skill>.yml` for
 * every repo with at least one op, `conflicts/<skill>.yml` when non-empty,
 * and `extraction-report.json` — all under `outDir`. Returns every path
 * written, sorted, so a caller (the CLI) can report them without re-deriving
 * the layout.
 *
 * `originalsBySkill` is forwarded to `buildExtractionReport` unchanged — see
 * that function's docblock for what it is and why this module cannot derive
 * it itself.
 */
export async function emitExtraction(
  outDir: string,
  extracted: readonly ExtractedSkill[],
  originalsBySkill?: ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>,
): Promise<EmitResult> {
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

  const report = buildExtractionReport(extracted, originalsBySkill);
  const reportPath = join(outDir, "extraction-report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  written.push(reportPath);

  return { written: written.sort((a, b) => a.localeCompare(b)), report };
}

/**
 * `loadSkills` — the only module in `src/skills/` that touches the
 * filesystem (SPEC 2.1; mirrors the `src/parse/` boundary, SPEC 6.1).
 *
 * Presence of `.claude/skills/` on disk is necessary but NOT sufficient for a
 * repository to be included, and `sources.yml`'s `kind` field plays no part
 * in selection either way (SPEC 2.1.0). A skill enters the cross-repository
 * diff only when it appears in TWO OR MORE repositories — the real run found
 * that "has `.claude/skills/`" alone pulled `wazuh-indexer-plugins` into the
 * same comparison as the six dashboard skills, merging two families SPEC 2.2
 * and `exploration.md` finding 2 both say must stay separate. The threshold is
 * arithmetic over data already loaded, not a repository or skill name: this
 * project has been burned once by a discovered set that got hardcoded instead
 * (`repo-fetch`'s first requirement exists because of it), and a hardcoded
 * exclusion here would silently outlive the day the indexer team adopts a
 * shared skill of their own.
 *
 * A skill that fails the threshold is not dropped — it is reported in
 * `singleRepoSkills`, naming the skill and its one repository, which is
 * exactly the process-overlap report SPEC 2.2 asks for.
 *
 * `.claude/settings.json` is never opened HERE. It sits beside
 * `.claude/skills/`, not inside it, and this loader only ever descends into
 * `.claude/skills/<name>/SKILL.md` — the exclusion is structural, not a
 * filter applied after the fact. `.claude/settings.json` has its own loader,
 * `src/settings/load.ts`'s `loadSettingsVariants`, run over the same
 * `LoadTarget`s from the same call site in `cli.ts` — one fetch, two
 * independent reads of what it produced.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RepoKind } from "../matrix/types.ts";
import { parseSkill } from "./parse.ts";
import type { RepoSelection, SingleRepoSkill, SkillVariant } from "./types.ts";

/** A skill is diffed only once at least this many repositories carry it
 * (design "a skill is diffed when it is shared"). */
const MIN_REPOS_TO_DIFF = 2;

/** Deliberately narrower than `ParseTarget`: this loader needs nothing about
 * commits or fetch outcomes, only where to look. */
export interface LoadTarget {
  readonly repo: string;
  readonly repoKind: RepoKind;
  readonly dir: string;
}

export interface LoadedSkills {
  readonly repos: readonly RepoSelection[];
  /** Only skills carried by `MIN_REPOS_TO_DIFF` or more repositories. */
  readonly variantsBySkill: ReadonlyMap<string, readonly SkillVariant[]>;
  readonly singleRepoSkills: readonly SingleRepoSkill[];
}

async function skillDirNames(skillsDir: string): Promise<string[] | null> {
  let entries;
  try {
    entries = await readdir(skillsDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

/** Reasons a repository was skipped, distinct from "found nothing" — a
 * repository that carries only single-repo skills is a different situation
 * from one with no `.claude/skills/` at all, and the report says so. */
type NoSkillsReason = "no .claude/skills directory" | "no .claude/skills entries" | "no .claude/skills entries carry a SKILL.md";

export async function loadSkills(targets: readonly LoadTarget[]): Promise<LoadedSkills> {
  // Pass 1: read every repository's skills, unfiltered. Which skills clear
  // the two-or-more bar can only be known once every repository has been
  // read, so no per-repo inclusion decision is final until this pass ends.
  const rawVariantsBySkill = new Map<string, SkillVariant[]>();
  const skillNamesByRepo = new Map<string, string[]>();
  const noSkillsReasonByRepo = new Map<string, NoSkillsReason>();

  for (const target of targets) {
    const skillsDir = join(target.dir, ".claude", "skills");
    const names = await skillDirNames(skillsDir);

    if (names === null || names.length === 0) {
      noSkillsReasonByRepo.set(
        target.repo,
        names === null ? "no .claude/skills directory" : "no .claude/skills entries",
      );
      continue;
    }

    const foundNames: string[] = [];
    for (const name of names) {
      const skillMdPath = join(skillsDir, name, "SKILL.md");
      let raw: string;
      try {
        raw = await readFile(skillMdPath, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; // a directory with no SKILL.md is not a skill
        throw error;
      }

      const parsed = parseSkill(raw);
      const bucket = rawVariantsBySkill.get(name) ?? [];
      bucket.push({ repo: target.repo, skill: parsed });
      rawVariantsBySkill.set(name, bucket);
      foundNames.push(name);
    }

    if (foundNames.length === 0) {
      noSkillsReasonByRepo.set(target.repo, "no .claude/skills entries carry a SKILL.md");
    } else {
      skillNamesByRepo.set(target.repo, foundNames);
    }
  }

  // Pass 2: apply the two-or-more threshold. Purely arithmetic over the map
  // just built — no repository or skill name is ever compared against a
  // literal here.
  const variantsBySkill = new Map<string, readonly SkillVariant[]>();
  const singleRepoSkills: SingleRepoSkill[] = [];

  for (const [name, variants] of rawVariantsBySkill) {
    if (variants.length >= MIN_REPOS_TO_DIFF) {
      variantsBySkill.set(
        name,
        [...variants].sort((a, b) => a.repo.localeCompare(b.repo)),
      );
    } else {
      for (const variant of variants) {
        singleRepoSkills.push({ skill: name, repo: variant.repo, description: variant.skill.frontmatter.description });
      }
    }
  }
  singleRepoSkills.sort((a, b) => a.skill.localeCompare(b.skill) || a.repo.localeCompare(b.repo));

  const diffedSkillNames = new Set(variantsBySkill.keys());

  const repos: RepoSelection[] = targets.map((target) => {
    const noSkillsReason = noSkillsReasonByRepo.get(target.repo);
    if (noSkillsReason !== undefined) {
      return { repo: target.repo, included: false, reason: noSkillsReason };
    }

    const names = skillNamesByRepo.get(target.repo) ?? [];
    const qualifying = names.filter((name) => diffedSkillNames.has(name));
    if (qualifying.length > 0) {
      return { repo: target.repo, included: true, reason: `${qualifying.length} of ${names.length} skill(s) shared with another repository` };
    }
    return {
      repo: target.repo,
      included: false,
      reason: `${names.length} skill(s) found, but none shared with ${MIN_REPOS_TO_DIFF} or more repositories`,
    };
  });

  return { repos, variantsBySkill, singleRepoSkills };
}

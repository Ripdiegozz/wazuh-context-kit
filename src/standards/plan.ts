/**
 * `planSync` — `ExtractedSkill[] -> SyncPlan` for one target repository
 * (SPEC 2.3). Pure: no fs, no network, no clock.
 *
 * `sync` plans before it writes (design decision 1). This module decides
 * WHAT would be materialised and WHAT is blocked, and returns a value that
 * both the "0 of 6 distributed" report and the actual write in `apply.ts`
 * are built from — the same value driving both means the summary and the
 * disk cannot disagree, the failure this project has repeatedly built
 * guardrails against in the sibling `src/skills/` package.
 *
 * A skill blocked by its own conflicts must not block a clean one (SPEC:
 * "sync never distributes a skill carrying conflicts", "distribute skills
 * independently of one another"). `planSync` partitions every skill into
 * `distributed` and `blocked` — a FILTER, never a guard clause that stops at
 * the first blocked skill (design decision 4): with six blocked skills, all
 * six reasons are reported, not just the first.
 *
 * The materialised content is THIS REPOSITORY'S OWN reconstruction —
 * `core` + this repo's `overrides` replayed by `reconstructRepo` — not a
 * generic repo-agnostic "core only" copy. `reconstructRepo` already resolves
 * every override anchor through `resolveAnchor` (`anchor.ts`), so an anchor
 * that has become ambiguous is fatal here, at PLANNING time, before any byte
 * reaches disk (SPEC 2.1.1, and the reason `applySync` never needs its own
 * anchor-resolution logic: there is only one resolver in this project, and
 * `sync` uses the same one `reconstruct.ts` already proved correct).
 *
 * A skill the target repository has no copy of is reported as `blocked` too
 * — not silently dropped, and not "distributed" with invented content. It is
 * not a conflict, but it is still a reason nothing was written for that
 * skill, and SPEC's "0 of 6, and what blocks each" promises a reason for
 * every skill that did not ship, not only the conflict ones.
 */

import { createHash } from "node:crypto";
import type { ExtractedSkill } from "../skills/extract.ts";
import { reconstructRepo } from "../skills/reconstruct.ts";

/** SHA-256 of the exact bytes given, hex-encoded and prefixed the same way
 * `src/matrix/hash.ts` prefixes a payload hash — one hashing convention
 * across the project. Exact bytes, no normalisation: a trailing-newline
 * difference must change this hash, because normalising is how a real edit
 * gets hidden (design's "what could go wrong"). */
export function hashContent(content: string): string {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

export interface DistributedFile {
  readonly skill: string;
  /** Relative to `.claude/standards/` — never an absolute path, so the plan
   * stays independent of where `apply.ts` eventually roots it. */
  readonly path: string;
  readonly content: string;
  readonly hash: string;
}

export interface BlockedSkill {
  readonly skill: string;
  /** Never empty — a skill is only `blocked`, never merely absent, and
   * every entry here is something a person can act on. */
  readonly reasons: readonly string[];
}

export interface ManifestFile {
  readonly path: string;
  readonly hash: string;
}

/**
 * The contract between `sync` and `check` (design decision 2). `tool` and
 * `payloadHash` let `check` say WHICH of "edited locally" or "a different
 * version was synced" happened, instead of collapsing both into one
 * accusation.
 */
export interface SyncManifest {
  readonly tool: string;
  readonly payloadHash: string;
  readonly files: readonly ManifestFile[];
}

export interface SyncPlan {
  readonly repo: string;
  readonly distributed: readonly DistributedFile[];
  readonly blocked: readonly BlockedSkill[];
  readonly manifest: SyncManifest;
}

function standardPath(skill: string): string {
  return `skills/${skill}/SKILL.md`;
}

/**
 * Builds `SyncPlan` for `repo` from `extracted` — every `ExtractedSkill` the
 * caller wants considered, typically every skill a `skills-diff --extract`
 * run produced. Deterministic ordering (skill name) so two runs over
 * identical inputs produce byte-identical manifests, matching the
 * determinism-by-construction discipline `emit.ts` established for the
 * sibling package.
 */
export function planSync(extracted: readonly ExtractedSkill[], repo: string, tool: string): SyncPlan {
  const distributed: DistributedFile[] = [];
  const blocked: BlockedSkill[] = [];

  const sorted = [...extracted].sort((a, b) => a.skill.localeCompare(b.skill));

  for (const skill of sorted) {
    if (!skill.repos.includes(repo)) {
      blocked.push({ skill: skill.skill, reasons: [`repository '${repo}' has no copy of this skill`] });
      continue;
    }

    if (!skill.distributable) {
      blocked.push({ skill: skill.skill, reasons: skill.blockingConflicts });
      continue;
    }

    // Distributable means `skill.conflicts` is empty (extract.ts), so this
    // is exactly `core` replayed with `repo`'s own overrides applied — never
    // a conflict op, since there are none to apply.
    const lines = reconstructRepo(skill, repo);
    const content = `${lines.join("\n")}\n`;
    const path = standardPath(skill.skill);
    distributed.push({ skill: skill.skill, path, content, hash: hashContent(content) });
  }

  const files: ManifestFile[] = distributed
    .map((d) => ({ path: d.path, hash: d.hash }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const payloadHash = hashContent(JSON.stringify(files));

  return {
    repo,
    distributed,
    blocked,
    manifest: { tool, payloadHash, files },
  };
}

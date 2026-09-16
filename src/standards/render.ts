/**
 * `renderSyncSummary` — `SyncPlan -> string`, the readable stdout report for
 * `sync` (SPEC 2.3). Pure: no fs, no network, no clock — the same purity
 * seam every other renderer in this project keeps (`src/skills/render.ts`,
 * `src/crosscheck/render-live.ts`).
 *
 * SPEC's own reasoning for `sync` exiting `0` when everything is blocked is
 * that the OUTPUT is the mitigation: "exit 0 reads as success... the output
 * MUST be explicit." A message nobody can read mitigates nothing. The first
 * cut of this summary printed every blocking reason on one
 * semicolon-joined line per skill — for a skill with a dozen conflicts
 * spread across several headings, that line ran past a thousand characters,
 * repeating each conflict's disputed CONTENT (already sitting in
 * `conflicts/<skill>.yml`) instead of telling a person WHERE to look.
 *
 * This renderer reports, per blocked skill: how many conflicts total, and a
 * handful of the HEADING PATHS they cluster at (grouped and counted, never
 * the conflicting text itself), truncated with a pointer to the YAML file
 * that holds the rest. `plan.ts`'s `groupConflictsByHeading` does the
 * grouping; this module only formats what it already computed — the same
 * "decide once, format elsewhere" split every renderer in this project
 * follows.
 */

import type { BlockedSkill, SyncPlan } from "./plan.ts";

/** How many heading groups to name before falling back to "N more — see
 * the YAML file". A handful, not an enumeration — the whole point is that a
 * skill with a dozen scattered conflicts stays scannable. */
const MAX_HEADINGS_SHOWN = 3;

function renderBlockedSkill(blocked: BlockedSkill): string[] {
  const lines: string[] = [];

  if (blocked.conflictHeadings.length === 0) {
    // Blocked for a reason that is not a conflict (e.g. the target
    // repository has no copy of this skill) — there is no count to report,
    // only the reason itself.
    lines.push(`blocked          ${blocked.skill}`);
    for (const reason of blocked.reasons) lines.push(`                   ${reason}`);
    return lines;
  }

  const total = blocked.conflictHeadings.reduce((sum, h) => sum + h.count, 0);
  lines.push(`blocked          ${blocked.skill}  ${total} conflict${total === 1 ? "" : "s"}`);

  const shown = blocked.conflictHeadings.slice(0, MAX_HEADINGS_SHOWN);
  for (const group of shown) {
    const suffix = group.count > 1 ? ` (${group.count})` : "";
    lines.push(`                   ${group.heading}${suffix}`);
  }

  const remaining = blocked.conflictHeadings.length - shown.length;
  if (remaining > 0) {
    lines.push(`                   ... ${remaining} more — see conflicts/${blocked.skill}.yml`);
  }

  return lines;
}

/**
 * Renders the full `sync` summary: the load-bearing "N of M distributed"
 * line first (kept exactly as `cli.ts` printed it before this renderer
 * existed — the string every CLI test asserts against), then one scannable
 * block per blocked skill.
 */
export function renderSyncSummary(plan: SyncPlan): string {
  const total = plan.distributed.length + plan.blocked.length;
  const lines: string[] = [
    `repo             ${plan.repo}`,
    `distributed      ${plan.distributed.length} of ${total} distributed`,
  ];

  const sortedBlocked = [...plan.blocked].sort((a, b) => a.skill.localeCompare(b.skill));
  if (sortedBlocked.length > 0) {
    lines.push("");
    for (const blocked of sortedBlocked) lines.push(...renderBlockedSkill(blocked));
  }

  return lines.join("\n");
}

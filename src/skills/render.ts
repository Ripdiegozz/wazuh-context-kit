/**
 * `SkillsDiffJson` -> `SKILLS-DIFF.md` (SPEC 2.1). A pure function.
 *
 * `meta.generatedAt` is never rendered, the same rule `MATRIX.md` and
 * `CROSSCHECK.md` follow, so the file stays byte-identical across runs.
 *
 * Unlike the crosscheck's render, an empty category is never omitted here —
 * it renders its heading and an explicit "(0)" (task 3.1). The crosscheck
 * omits empty sections because most runs have SOME findings in most
 * categories; a `skills-diff` category being empty ("no conflicts in this
 * skill") is itself the headline result for that skill, and omitting it would
 * make "we found none" indistinguishable from "we didn't look."
 *
 * A divergent BLOCK reports its own DIFFERING LINES and a magnitude scoped
 * against its section's total, never the group's whole section body — see
 * design decision 1. A section can hold several independent blocks (SPEC
 * 2.4's own unit is "todo bloque divergente", the block, not the section): an
 * independent oracle run found a real section carrying both a declared
 * override and a separate, unmarked disagreement a few lines apart, and one
 * section-wide label could only report one of the two truths. Dumping a
 * whole section body to announce a small divergence is the earlier defect
 * this render already fixed once — it gives a one-line difference the same
 * visual weight as a real policy disagreement.
 */

import type { DivergentBlock, SectionGroup, SkillDiff, SkillsDiffJson } from "./types.ts";

function cell(value: string): string {
  return value.replaceAll("|", "\\|");
}

/**
 * Wraps `value` in a Markdown inline code span using a backtick run LONGER
 * than any run already inside it — CommonMark's own rule for nesting a
 * backtick inside a code span.
 *
 * These reports render literal `SKILL.md` lines verbatim, and those lines
 * are themselves full of inline code spans (`` `gh pr create` ``,
 * `` `check-standards` ``). A fixed single backtick delimiter breaks the
 * instant the wrapped value contains one of its own: the value's OWN closing
 * backtick closes the outer span early, and everything after it leaks as raw
 * markdown into the table or list it was rendered into. The finding is still
 * legible in the JSON either way; only the report a human actually opens was
 * mangled.
 */
function codeSpan(value: string): string {
  const runs = value.match(/`+/g) ?? [];
  const longestRun = runs.reduce((max, run) => Math.max(max, run.length), 0);
  const fence = "`".repeat(longestRun + 1);
  // CommonMark: a code span whose content starts or ends with a backtick
  // needs a padding space on that side, or the fence visually merges into it.
  const leadingSpace = value.startsWith("`") ? " " : "";
  const trailingSpace = value.endsWith("`") ? " " : "";
  return `${fence}${leadingSpace}${value}${trailingSpace}${fence}`;
}

function pathLabel(path: readonly string[]): string {
  return path.length === 0 ? "(preamble)" : path.join(" > ");
}

function renderGroup(g: SectionGroup): string[] {
  const lines: string[] = [];
  const repos = g.repos.map((r) => codeSpan(cell(r))).join(", ");
  const markerNote = g.marker === "named" ? " (named marker)" : g.marker === "unnamed" ? " (unnamed marker)" : "";
  if (g.body === null) {
    lines.push(`    - ${repos}: section absent${markerNote}`);
    return lines;
  }
  lines.push(`    - ${repos}${markerNote}:`);
  if (g.diffLines.length === 0) {
    lines.push("      - (no lines unique to this group)");
  } else {
    for (const line of g.diffLines) {
      lines.push(`      - ${codeSpan(cell(line))}`);
    }
  }
  return lines;
}

/** One finding within a section — `path` is repeated on every block that
 * shares it, since several independent blocks can share one heading path. */
function renderBlock(path: readonly string[], block: DivergentBlock): string[] {
  const lines: string[] = [];
  const { magnitude } = block;
  lines.push(`- **${pathLabel(path)}** — ${magnitude.differing} of ${magnitude.total} lines differ`);
  for (const group of block.groups) {
    lines.push(...renderGroup(group));
  }
  return lines;
}

function renderCategory(
  title: string,
  entries: readonly { readonly path: readonly string[]; readonly block: DivergentBlock }[],
): string[] {
  const lines: string[] = [];
  lines.push(`#### ${title} (${entries.length})`);
  lines.push("");
  if (entries.length === 0) {
    lines.push("(none)");
  } else {
    for (const entry of entries) {
      lines.push(...renderBlock(entry.path, entry.block));
    }
  }
  lines.push("");
  return lines;
}

function renderSkill(skill: SkillDiff): string[] {
  const lines: string[] = [];
  lines.push(`### ${codeSpan(cell(skill.skill))}`);
  lines.push("");

  if (skill.descriptions.length > 0) {
    lines.push("| repo | description |");
    lines.push("|---|---|");
    for (const d of skill.descriptions) {
      lines.push(`| ${codeSpan(cell(d.repo))} | ${cell(d.description)} |`);
    }
    lines.push("");
  }

  const commonSections = skill.sections.filter((s) => s.blocks.length === 0);
  const byCategory = (category: DivergentBlock["category"]) =>
    skill.sections.flatMap((s) => s.blocks.filter((b) => b.category === category).map((block) => ({ path: s.path, block })));

  lines.push(`#### Common (${commonSections.length})`);
  lines.push("");
  if (commonSections.length === 0) {
    lines.push("(none)");
  } else {
    for (const section of commonSections) {
      lines.push(`- **${pathLabel(section.path)}**`);
    }
  }
  lines.push("");

  lines.push(...renderCategory("Overrides", byCategory("override")));
  lines.push(...renderCategory("Shared overrides", byCategory("sharedOverride")));
  lines.push(...renderCategory("Conflicts", byCategory("conflict")));

  return lines;
}

export function renderSkillsDiffMarkdown(diff: SkillsDiffJson): string {
  const lines: string[] = [];

  lines.push(`# Skills diff — \`${diff.ref}\``);
  lines.push("");
  lines.push("> Generated from `skills-diff.json`. Never edit by hand.");
  lines.push("");

  lines.push("## Repositories");
  lines.push("");
  lines.push("| repo | included | reason |");
  lines.push("|---|---|---|");
  for (const r of diff.repos) {
    lines.push(`| ${codeSpan(cell(r.repo))} | ${r.included ? "yes" : "no"} | ${cell(r.reason)} |`);
  }
  lines.push("");

  lines.push(`## Skills present in only one repository (${diff.singleRepoSkills.length})`);
  lines.push("");
  lines.push(
    "> No diff is possible with a single variant. Listed, not dropped — SPEC 2.2's " +
      "process-overlap report: these are a different family from the shared skills below, " +
      "not a smaller version of them.",
  );
  lines.push("");
  if (diff.singleRepoSkills.length === 0) {
    lines.push("(none)");
  } else {
    lines.push("| skill | repo | description |");
    lines.push("|---|---|---|");
    for (const s of diff.singleRepoSkills) {
      lines.push(`| ${codeSpan(cell(s.skill))} | ${codeSpan(cell(s.repo))} | ${cell(s.description)} |`);
    }
  }
  lines.push("");

  lines.push("## Out of scope");
  lines.push("");
  for (const item of diff.outOfScope) {
    lines.push(`- ${codeSpan(cell(item.path))} — ${cell(item.reason)}. Open criterion: ${cell(item.openCriterion)}.`);
  }
  lines.push("");

  lines.push("## Divergence profile");
  lines.push("");
  lines.push("| skill | total | common | override | sharedOverride | conflict |");
  lines.push("|---|---|---|---|---|---|");
  for (const skill of diff.skills) {
    const c = skill.counts;
    lines.push(`| ${codeSpan(cell(skill.skill))} | ${c.total} | ${c.common} | ${c.override} | ${c.sharedOverride} | ${c.conflict} |`);
  }
  lines.push("");

  lines.push("## Skills");
  lines.push("");
  for (const skill of diff.skills) {
    lines.push(...renderSkill(skill));
  }

  lines.push("---");
  lines.push("");
  lines.push(`- ref: \`${diff.ref}\``);
  lines.push("");

  return lines.join("\n");
}

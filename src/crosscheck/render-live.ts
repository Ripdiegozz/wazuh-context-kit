/**
 * `LiveComparison` -> text and -> JSON. Pure functions (SPEC 6.1).
 *
 * Unlike `render.ts`, an empty population is never omitted here: this report
 * exists to say "we checked, here is what disagrees," and a heading that
 * silently disappears when a population is empty is indistinguishable from a
 * heading that was never checked. Every section is explicit either way.
 *
 * The JSON form is `JSON.stringify(cc)` with nothing added -- no wrapper
 * object, no `generatedAt`. A timestamp here would make two runs of the same
 * cluster state differ in their piped output for no reason, defeating the
 * one property `--format json` exists to give a script: a stable diff.
 */

import type { LiveComparison } from "./live-types.ts";

function cell(value: string): string {
  return value.replaceAll("|", "\\|");
}

export function renderLiveComparisonText(cc: LiveComparison): string {
  const lines: string[] = [];

  lines.push("# Live comparison — repository vs. running indexer");
  lines.push("");

  lines.push(`## declared, not installed (${cc.declaredNotInstalled.length})`);
  lines.push("");
  if (cc.declaredNotInstalled.length === 0) {
    lines.push("_none_");
  } else {
    lines.push("| pattern | template |");
    lines.push("|---|---|");
    for (const d of cc.declaredNotInstalled) {
      lines.push(`| \`${cell(d.pattern)}\` | \`${cell(d.template)}\` |`);
    }
  }
  lines.push("");

  lines.push("## installed, not declared");
  lines.push("");
  lines.push(`### Wazuh namespace (${cc.installedNotDeclared.wazuh.length})`);
  lines.push("");
  if (cc.installedNotDeclared.wazuh.length === 0) {
    lines.push("_none_");
  } else {
    for (const entry of cc.installedNotDeclared.wazuh) {
      lines.push(`- \`${cell(entry.name)}\` (${entry.kind})`);
    }
  }
  lines.push("");
  lines.push(`### platform-managed (${cc.installedNotDeclared.platformManaged.length})`);
  lines.push("");
  if (cc.installedNotDeclared.platformManaged.length === 0) {
    lines.push("_none_");
  } else {
    for (const entry of cc.installedNotDeclared.platformManaged) {
      lines.push(`- \`${cell(entry.name)}\` (${entry.kind})`);
    }
  }
  lines.push("");

  lines.push(`## template-only in cluster (${cc.templatesOnlyInCluster.length})`);
  lines.push("");
  if (cc.templatesOnlyInCluster.length === 0) {
    lines.push("_none_");
  } else {
    for (const t of cc.templatesOnlyInCluster) {
      lines.push(`- \`${cell(t.name)}\` — ${t.indexPatterns.map((p) => `\`${cell(p)}\``).join(", ")}`);
    }
  }
  lines.push("");

  lines.push(`## same subject, declared and installed do not match (${cc.sameSubjectMismatches.length})`);
  lines.push("");
  if (cc.sameSubjectMismatches.length === 0) {
    lines.push("_none_");
  } else {
    for (const m of cc.sameSubjectMismatches) {
      lines.push(
        `- \`${cell(m.pattern)}\` (${cell(m.template)}) vs. installed \`${cell(m.installedName)}\` ` +
          `(${m.installedKind}) — same subject, declaration does not match it`,
      );
    }
  }
  lines.push("");

  return lines.join("\n");
}

export function renderLiveComparisonJson(cc: LiveComparison): string {
  return JSON.stringify(cc, null, 2);
}

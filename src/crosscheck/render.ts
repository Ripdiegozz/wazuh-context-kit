/**
 * CrosscheckJson -> CROSSCHECK.md. A pure function (SPEC 6.1).
 *
 * `meta.generatedAt` is never rendered, which is what keeps the file
 * byte-identical across runs — the same rule MATRIX.md follows.
 */

import type { CrosscheckJson } from "../matrix/types.ts";

function cell(value: string): string {
  return value.replaceAll("|", "\\|");
}

export function renderCrosscheckMarkdown(cc: CrosscheckJson): string {
  const lines: string[] = [];

  lines.push(`# Index crosscheck — \`${cc.ref}\``);
  lines.push("");
  lines.push("> Generated from `crosscheck.json`. Never edit by hand.");
  lines.push("");

  // Coverage FIRST, always. A reader who takes "no consumer found" as "no
  // consumer exists" deletes a live index; leading with the limits is what
  // makes that misreading hard. This section is never omitted, even when
  // nothing is uncovered -- "we looked, here is how far we see" is the claim,
  // and it is true either way.
  lines.push("## Coverage");
  lines.push("");
  lines.push(
    "**This report is not a completeness claim.** It lists indices whose references " +
      "a static scan could recover. Where a name is assembled at runtime, or accepted " +
      "by shape rather than written down, no scanner can see it — so *declared, never " +
      "referenced* means **no reference was found**, not that none exists.",
  );
  lines.push("");
  lines.push(`- Distinct index names recovered: **${cc.coverage.recoveredNames}**`);
  lines.push(`- Repositories scanned: ${cc.coverage.scannedRepos.map((r) => `\`${r}\``).join(", ")}`);
  lines.push("");

  if (cc.coverage.uncovered.length > 0) {
    lines.push(`### Mechanisms this scan cannot see (${cc.coverage.uncovered.length})`);
    lines.push("");
    lines.push("| kind | where | why |");
    lines.push("|---|---|---|");
    for (const u of cc.coverage.uncovered) {
      lines.push(`| \`${u.kind}\` | \`${cell(u.file)}:${u.line}\` | ${cell(u.note)} |`);
    }
    lines.push("");
  }

  if (cc.declaredUnreferenced.length > 0) {
    lines.push(`## Declared, never referenced (${cc.declaredUnreferenced.length})`);
    lines.push("");
    lines.push("| index pattern | template | group |");
    lines.push("|---|---|---|");
    for (const d of cc.declaredUnreferenced) {
      lines.push(`| \`${cell(d.pattern)}\` | \`${cell(d.template)}\` | ${d.group || "—"} |`);
    }
    lines.push("");
  }

  if (cc.referencedUndeclared.length > 0) {
    lines.push(`## Referenced, never declared (${cc.referencedUndeclared.length})`);
    lines.push("");
    lines.push("> The dashboard reaches for an index the indexer declares no template for.");
    lines.push("");
    lines.push("| index pattern | referenced at | via |");
    lines.push("|---|---|---|");
    for (const r of cc.referencedUndeclared) {
      lines.push(`| \`${cell(r.name)}\` | \`${cell(r.file)}:${r.line}\` | ${r.via} |`);
    }
    lines.push("");
  }

  if (cc.wcsWithoutConsumer.length > 0) {
    lines.push(`## WCS modules with no known consumer (${cc.wcsWithoutConsumer.length})`);
    lines.push("");
    for (const module of cc.wcsWithoutConsumer) {
      lines.push(`- \`${cell(module)}\``);
    }
    lines.push("");
  }

  if (cc.competingCatalogs.length > 0) {
    lines.push(`## Competing catalogs (${cc.competingCatalogs.length})`);
    lines.push("");
    lines.push(
      "> More than one module declares this name as a literal. Neither is wrong; " +
        "the two can drift apart without anything failing.",
    );
    lines.push("");
    for (const c of cc.competingCatalogs) {
      lines.push(`- \`${cell(c.name)}\` — ${c.files.map((f) => `\`${cell(f)}\``).join(", ")}`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push(`- ref: \`${cc.ref}\``);
  lines.push("");

  return lines.join("\n");
}

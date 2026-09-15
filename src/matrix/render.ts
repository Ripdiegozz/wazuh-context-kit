/**
 * MatrixJson -> MATRIX.md. A pure function (SPEC 6.1).
 *
 * The footer renders ref, payloadHash and resolvedRefs. NEVER generatedAt --
 * that is what keeps MATRIX.md byte-identical across runs (SPEC 1.6.1).
 */

import type { MatrixJson } from "./types.ts";

function cell(value: string): string {
  return value.replaceAll("|", "\\|");
}

function list(values: string[]): string {
  return values.length === 0 ? "—" : values.map((v) => `\`${v}\``).join(", ");
}

export function renderMatrixMarkdown(matrix: MatrixJson): string {
  const lines: string[] = [];

  lines.push(`# Wazuh context matrix — \`${matrix.ref}\``);
  lines.push("");
  lines.push("> Generated from `matrix.json`. Never edit by hand.");
  lines.push("");

  lines.push("## Plugins");
  lines.push("");
  lines.push(
    "| plugin | repo | world | version | server API | indexer access | evidence |",
  );
  lines.push("|---|---|---|---|---|---|---|");

  for (const plugin of matrix.plugins) {
    const evidence =
      plugin.evidence.kind === "derived"
        ? `\`${plugin.evidence.commit.slice(0, 8)}\``
        : `_${plugin.evidence.source}_`;

    // † marks a cell resolved by a human decision rather than derived.
    const mark = (field: string, value: string): string =>
      plugin.assertions[field] ? `${value} †` : value;

    lines.push(
      `| \`${cell(plugin.pluginId)}\` | ${cell(plugin.repo)} | ` +
        `${mark("world", plugin.world)} | ` +
        `${mark("versionScheme", plugin.versionScheme)} | ` +
        `${mark("serverApiAccess", plugin.serverApiAccess)} | ` +
        `${mark("indexerAccess", list(plugin.indexerAccess))} | ${evidence} |`,
    );
  }

  const asserted = matrix.plugins.flatMap((plugin) =>
    Object.entries(plugin.assertions).map(([field, evidence]) => ({
      plugin: plugin.pluginId,
      field,
      evidence,
    })),
  );

  if (asserted.length > 0) {
    lines.push("");
    lines.push("† Human assertions — not derivable, decided by a person");
    lines.push("");
    for (const entry of asserted) {
      lines.push(
        `- \`${cell(entry.plugin)}.${entry.field}\` — ${entry.evidence.author}, ` +
          `${entry.evidence.date} (\`${entry.evidence.source}\`)`,
      );
      lines.push(`  > ${cell(entry.evidence.reason).replaceAll("\n", " ")}`);
    }
  }

  if (matrix.unknowns.length > 0) {
    lines.push("");
    lines.push("## Unknowns — pending human decision");
    lines.push("");
    lines.push("| plugin | field | reason |");
    lines.push("|---|---|---|");
    for (const unknown of matrix.unknowns) {
      lines.push(
        `| \`${cell(unknown.plugin)}\` | \`${unknown.field}\` | ${cell(unknown.reason)} |`,
      );
    }
  }

  const conflicts = matrix.reconciliation.filter((entry) => entry.conflict === true);
  if (conflicts.length > 0) {
    lines.push("");
    lines.push("## Conflicts — a rule or a decision is wrong");
    lines.push("");
    for (const entry of conflicts) {
      lines.push(
        `- \`${cell(entry.plugin)}.${entry.field}\` — decided ` +
          `\`${JSON.stringify(entry.decidedValue)}\`, derived ` +
          `\`${JSON.stringify(entry.derivedValue)}\``,
      );
    }
  }

  const annotated = matrix.plugins.filter((plugin) => plugin.annotations.length > 0);
  if (annotated.length > 0) {
    lines.push("");
    lines.push("## Annotations");
    lines.push("");
    for (const plugin of annotated) {
      for (const annotation of plugin.annotations) {
        lines.push(
          `- **${annotation.kind}** \`${cell(plugin.pluginId)}\` — ` +
            `${cell(annotation.text).replaceAll("\n", " ")} ` +
            `_(${annotation.author}, ${annotation.date})_`,
        );
      }
    }
  }

  if (matrix.skipped.length > 0) {
    lines.push("");
    lines.push("## Skipped");
    lines.push("");
    for (const skipped of matrix.skipped) {
      lines.push(`- \`${skipped.repo}\` — ${skipped.reason}`);
    }
  }

  if (matrix.core.length > 0) {
    lines.push("");
    lines.push("## Core plugins");
    lines.push("");
    lines.push("| repo | version | plugins | depended on |");
    lines.push("|---|---|---|---|");

    // Only the core plugins something actually depends on. A reader's question
    // is "does the thing I depend on exist here", and an exhaustive list of 64
    // answers it worse than a filtered one (design D7).
    const dependedOn = new Set<string>();
    for (const plugin of matrix.plugins) {
      for (const id of plugin.requiredPlugins) dependedOn.add(id);
      for (const id of plugin.requiredBundles) dependedOn.add(id);
    }

    for (const repo of matrix.core) {
      const provided = repo.plugins
        .map((plugin) => plugin.pluginId)
        .filter((id) => dependedOn.has(id));
      lines.push(
        `| ${cell(repo.repo)} | ${repo.version === null ? "—" : `\`${cell(repo.version)}\``} | ` +
          `${repo.plugins.length} | ${list(provided)} |`,
      );
    }
  }

  // Omitted entirely when empty. An always-present "none" heading trains a
  // reader to skip the region where the real signal will eventually appear.
  if (matrix.unresolvedDependencies.length > 0) {
    lines.push("");
    lines.push("## Unresolved dependencies");
    lines.push("");
    lines.push("> A declared dependency with no destination in this matrix.");
    lines.push("");
    lines.push("| plugin | repo | dependency | field |");
    lines.push("|---|---|---|---|");
    for (const entry of matrix.unresolvedDependencies) {
      lines.push(
        `| \`${cell(entry.plugin)}\` | ${cell(entry.repo)} | ` +
          `\`${cell(entry.dependency)}\` | \`${entry.field}\` |`,
      );
    }
  }

  if (matrix.indexer.templates.length > 0) {
    lines.push("");
    lines.push(`## Index templates (${matrix.indexer.templates.length})`);
    lines.push("");
    for (const template of matrix.indexer.templates) {
      lines.push(`- \`${template.name}\` — ${list(template.indexPatterns)}`);
    }
  }

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(`- ref: \`${matrix.ref}\``);
  lines.push(`- payloadHash: \`${matrix.payloadHash}\``);
  lines.push(`- resolvedAt: \`${matrix.resolvedAt}\``);
  lines.push("- resolvedRefs:");
  for (const repo of Object.keys(matrix.resolvedRefs).sort()) {
    lines.push(`  - \`${repo}\` → \`${matrix.resolvedRefs[repo]}\``);
  }
  lines.push("");

  return lines.join("\n");
}

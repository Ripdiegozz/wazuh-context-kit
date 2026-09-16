/**
 * `parseSkill` — string -> `ParsedSkill` (SPEC 2.1; design "the anchor is the
 * heading").
 *
 * Pure: no fs, no network, no clock. A `SKILL.md` is frontmatter followed by a
 * sequence of heading-delimited sections, and the unit of comparison across
 * the seven repositories is the SECTION, keyed by its heading path — not the
 * line, and not the whole file. `## Workflow` then `### 2. Prettier` yields
 * `["Workflow", "2. Prettier"]`; content before the first heading is its own
 * section with an empty path, because it is real content and dropping it
 * would lose it silently.
 *
 * Two traps this parser exists to close, both named in design.md:
 *
 * - A `> **repo-specific` marker inside a fenced code block is text, not a
 *   marker — the same class of bug as the inline-literal context gate in
 *   `../parse/index-references.ts`, which took a review cycle to get right
 *   there. Fence state is tracked line by line and gates BOTH heading
 *   detection and marker detection, so an example fence cannot forge either.
 *   Both CommonMark fence characters are recognised, backtick AND tilde —
 *   an earlier version matched only backticks, which is worse than matching
 *   neither: the backtick case passing every test suggested the whole class
 *   was covered, when a `~~~` block was not gated at all. A fence closes
 *   only with the SAME character, at least as long as the opener, matching
 *   CommonMark's own rule.
 * - A heading path appearing twice in one file is a loud failure, not a
 *   silent overwrite. A merged section would still parse, still diff, and
 *   still produce a classification — just a wrong one, indistinguishable from
 *   a right one until a human happens to read the source.
 */

import { parse as parseYaml } from "yaml";
import type { ParsedSection, ParsedSkill, SectionMarker } from "./types.ts";

const FENCE_LINE = /^\s*(`{3,}|~{3,})/;
const HEADING_LINE = /^(#{1,6})\s+(.*)$/;
const MARKER_LINE = /^>\s*\*\*repo-specific(?:\s*\(([^)]*)\))?:\*\*/;

function pathKey(path: readonly string[]): string {
  return JSON.stringify(path);
}

function pathLabel(path: readonly string[]): string {
  return path.length === 0 ? "(preamble)" : path.join(" > ");
}

/** Splits the leading `---`-delimited YAML block from the rest of the body. */
function splitFrontmatter(text: string): { frontmatterYaml: string; rest: string[] } {
  const lines = text.split("\n");
  if (lines[0] !== "---") {
    throw new Error("parseSkill: file must start with a '---' frontmatter block");
  }

  const end = lines.indexOf("---", 1);
  if (end === -1) {
    throw new Error("parseSkill: frontmatter block has no closing '---'");
  }

  return { frontmatterYaml: lines.slice(1, end).join("\n"), rest: lines.slice(end + 1) };
}

function readFrontmatter(yamlText: string): { name: string; description: string } {
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlText);
  } catch (error) {
    throw new Error(`parseSkill: invalid frontmatter YAML — ${(error as Error).message}`);
  }

  const record = parsed as Record<string, unknown> | null;
  const name = record?.name;
  const description = record?.description;
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("parseSkill: frontmatter is missing a non-empty 'name'");
  }
  if (typeof description !== "string" || description.length === 0) {
    throw new Error("parseSkill: frontmatter is missing a non-empty 'description'");
  }

  return { name, description };
}

export function parseSkill(text: string): ParsedSkill {
  const { frontmatterYaml, rest } = splitFrontmatter(text);
  const frontmatter = readFrontmatter(frontmatterYaml);

  const sections: ParsedSection[] = [];
  const seenPaths = new Set<string>();

  // A stack of {level, text}, not a flat array indexed by markdown level: a
  // document can start at `##` with no `#` at all (every literal in this
  // suite does), so the raw heading number cannot be used as an array index —
  // depth is relative to what has actually been seen, not to the `#` count.
  let stack: Array<{ level: number; text: string }> = [];
  let currentPath: string[] = [];
  let currentLines: string[] = [];
  let currentMarkers: SectionMarker[] = [];
  // The open fence's character and length, or null when not inside one. A
  // fence only closes with the SAME character and a run at least as long as
  // the opener (CommonMark), so a `~~~` line can never close a backtick
  // fence or vice versa.
  let openFence: { readonly char: string; readonly length: number } | null = null;

  function commitSection(): void {
    const key = pathKey(currentPath);
    if (seenPaths.has(key)) {
      throw new Error(`parseSkill: duplicate heading path: ${pathLabel(currentPath)}`);
    }
    seenPaths.add(key);
    sections.push({ path: currentPath, lines: currentLines, markers: currentMarkers });
    currentLines = [];
    currentMarkers = [];
  }

  for (const line of rest) {
    const fenceMatch = FENCE_LINE.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1]!;
      if (openFence === null) {
        openFence = { char: marker[0]!, length: marker.length };
      } else if (marker[0] === openFence.char && marker.length >= openFence.length) {
        openFence = null;
      }
      // A fence-looking line that does not close the open fence (wrong
      // character, or too short) is still just content inside it.
      currentLines.push(line);
      continue;
    }

    if (openFence === null) {
      const heading = HEADING_LINE.exec(line);
      if (heading) {
        commitSection();
        const level = heading[1]!.length;
        const headingText = heading[2]!.trim();
        while (stack.length > 0 && stack[stack.length - 1]!.level >= level) {
          stack.pop();
        }
        stack.push({ level, text: headingText });
        currentPath = stack.map((s) => s.text);
        continue;
      }

      const marker = MARKER_LINE.exec(line);
      if (marker) {
        const repo = marker[1]?.trim();
        currentMarkers.push({ lineIndex: currentLines.length, repo: repo && repo.length > 0 ? repo : null });
      }
    }

    currentLines.push(line);
  }
  commitSection();

  return { frontmatter, sections };
}

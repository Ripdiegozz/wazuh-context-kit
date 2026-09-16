/**
 * `parseSkill` — string -> `ParsedSkill` (tasks 1.1–1.6).
 *
 * Every input here is a string literal written for this file. Standing rule,
 * earned four times: no fixture file may encode the same understanding as the
 * code it tests — a fixture author and a parser author sharing one blind spot
 * is how this project shipped a scanner that read zero skills from real data
 * while every test stayed green.
 */

import { describe, expect, test } from "bun:test";
import { parseSkill } from "./parse.ts";

describe("frontmatter and sections (task 1.1)", () => {
  test("a SKILL.md literal with frontmatter and three headings parses into sections keyed by heading path", () => {
    const text = [
      "---",
      "name: check-standards",
      "description: Run the standard checks.",
      "---",
      "",
      "# Check standards",
      "",
      "Intro paragraph.",
      "",
      "## Workflow",
      "",
      "Do the workflow.",
      "",
      "## Rollback",
      "",
      "Undo it.",
      "",
    ].join("\n");

    const parsed = parseSkill(text);

    expect(parsed.frontmatter).toEqual({
      name: "check-standards",
      description: "Run the standard checks.",
    });
    expect(parsed.sections.map((s) => s.path)).toEqual([
      [],
      ["Check standards"],
      ["Check standards", "Workflow"],
      ["Check standards", "Rollback"],
    ]);
  });
});

describe("nested headings (task 1.2)", () => {
  test("## then ### yields a two-element path, not a flat name", () => {
    const text = [
      "---",
      "name: x",
      "description: y",
      "---",
      "## Workflow",
      "intro",
      "### 2. Prettier",
      "run prettier",
    ].join("\n");

    const parsed = parseSkill(text);
    const paths = parsed.sections.map((s) => s.path);

    expect(paths).toContainEqual(["Workflow"]);
    expect(paths).toContainEqual(["Workflow", "2. Prettier"]);
  });
});

describe("the preamble is real content (task 1.3)", () => {
  test("content before the first heading is its own section with an empty path", () => {
    const text = ["---", "name: x", "description: y", "---", "This is the preamble.", "# Title", "body"].join("\n");

    const parsed = parseSkill(text);
    const preamble = parsed.sections.find((s) => s.path.length === 0);

    expect(preamble).toBeDefined();
    expect(preamble!.lines.join("\n")).toContain("This is the preamble.");
  });

  test("an empty preamble is still emitted, not dropped", () => {
    const text = ["---", "name: x", "description: y", "---", "# Title", "body"].join("\n");

    const parsed = parseSkill(text);
    expect(parsed.sections[0]!.path).toEqual([]);
  });
});

describe("the repo-specific marker, both forms (task 1.4)", () => {
  test("a named marker is recognised and attributed", () => {
    const text = [
      "---",
      "name: x",
      "description: y",
      "---",
      "## Base",
      "> **repo-specific (wazuh-dashboard):** live bases include main and 5.0.0.",
    ].join("\n");

    const parsed = parseSkill(text);
    const section = parsed.sections.find((s) => s.path.length > 0)!;

    expect(section.markers).toEqual([{ lineIndex: 0, repo: "wazuh-dashboard" }]);
  });

  test("an unnamed marker is recognised and NOT attributed", () => {
    const text = [
      "---",
      "name: x",
      "description: y",
      "---",
      "## Base",
      "> **repo-specific:** true of several repos at once.",
    ].join("\n");

    const parsed = parseSkill(text);
    const section = parsed.sections.find((s) => s.path.length > 0)!;

    expect(section.markers).toEqual([{ lineIndex: 0, repo: null }]);
  });
});

describe("a marker inside a fenced code block is text, not a marker (task 1.5)", () => {
  test("fence state is tracked across the whole section", () => {
    const text = [
      "---",
      "name: x",
      "description: y",
      "---",
      "## Example",
      "```",
      "> **repo-specific (wazuh-dashboard):** this is example text, not a real marker.",
      "```",
      "> **repo-specific (wazuh-dashboard):** this one IS real, outside the fence.",
    ].join("\n");

    const parsed = parseSkill(text);
    const section = parsed.sections.find((s) => s.path.length > 0)!;

    // Only the marker outside the fence counts.
    expect(section.markers).toHaveLength(1);
    expect(section.markers[0]!.repo).toBe("wazuh-dashboard");
  });

  test("an unclosed fence does not leak into a later heading's marker detection", () => {
    // Regression shape for the fence-state class of bug: a stray heading-like
    // or marker-like line inside an open fence must not be read as structure,
    // and once the fence closes, normal detection must resume.
    const text = [
      "---",
      "name: x",
      "description: y",
      "---",
      "## First",
      "```",
      "## Not a real heading",
      "> **repo-specific (wazuh-dashboard):** not a real marker either.",
      "```",
      "## Second",
      "> **repo-specific:** this one is real.",
    ].join("\n");

    const parsed = parseSkill(text);
    const paths = parsed.sections.map((s) => s.path);

    expect(paths).toContainEqual(["First"]);
    expect(paths).toContainEqual(["Second"]);
    expect(paths).not.toContainEqual(["First", "Not a real heading"]);

    const second = parsed.sections.find((s) => s.path.length === 1 && s.path[0] === "Second")!;
    expect(second.markers).toEqual([{ lineIndex: 0, repo: null }]);
  });

  test("a ~~~ fence is recognised too, not just backticks (CodeRabbit PR #16 finding b)", () => {
    // Half-handled is worse than not handled: a backtick-only fence gate
    // passing every test suggests the whole class of "markers inside a fence
    // are text" is covered, when a `~~~` fence — equally valid Markdown —
    // was not gated at all.
    const text = [
      "---",
      "name: x",
      "description: y",
      "---",
      "## Example",
      "~~~",
      "> **repo-specific (wazuh-dashboard):** this is example text, not a real marker.",
      "~~~",
      "> **repo-specific (wazuh-dashboard):** this one IS real, outside the fence.",
    ].join("\n");

    const parsed = parseSkill(text);
    const section = parsed.sections.find((s) => s.path.length > 0)!;

    expect(section.markers).toHaveLength(1);
    expect(section.markers[0]!.repo).toBe("wazuh-dashboard");
  });

  test("a fence only closes with the SAME character, at least as long as the opener", () => {
    // A `~~~` line inside a backtick fence does not close it (and vice
    // versa) — CommonMark's own rule, and the one that makes a stray tilde
    // line inside an example backtick block impossible to misread as a real
    // close.
    const text = [
      "---",
      "name: x",
      "description: y",
      "---",
      "## Example",
      "```",
      "~~~",
      "> **repo-specific (wazuh-dashboard):** still inside the backtick fence.",
      "```",
      "> **repo-specific:** this one is real, after the real close.",
    ].join("\n");

    const parsed = parseSkill(text);
    const section = parsed.sections.find((s) => s.path.length > 0)!;

    expect(section.markers).toEqual([{ lineIndex: 4, repo: null }]);
  });
});

describe("a duplicate heading path fails loudly (task 1.6)", () => {
  test("the same heading twice under the same parent throws instead of silently merging", () => {
    const text = [
      "---",
      "name: x",
      "description: y",
      "---",
      "## Workflow",
      "first copy",
      "## Workflow",
      "second copy",
    ].join("\n");

    expect(() => parseSkill(text)).toThrow(/duplicate heading path/i);
  });

  test("the duplicate path itself is named in the error", () => {
    // "A" is committed once; only the nested "A > B" repeats, via a sibling
    // "C" in between — proving the check is on the full path, not the parent.
    const text = ["---", "name: x", "description: y", "---", "## A", "### B", "x", "### C", "### B", "y"].join("\n");

    expect(() => parseSkill(text)).toThrow(/A > B/);
  });
});

describe("malformed frontmatter", () => {
  test("a missing closing --- is a hard failure, not a guess", () => {
    const text = ["---", "name: x", "description: y", "## Title"].join("\n");
    expect(() => parseSkill(text)).toThrow();
  });

  test("a missing name or description is a hard failure", () => {
    const text = ["---", "name: x", "---", "## Title"].join("\n");
    expect(() => parseSkill(text)).toThrow(/description/i);
  });
});

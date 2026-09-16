/**
 * `renderSkillsDiffMarkdown` — `SkillsDiffJson` -> `SKILLS-DIFF.md` (tasks
 * 3.1–3.6). A pure function: no fs, no network, no clock. `meta.generatedAt`
 * is never rendered, the same rule `CROSSCHECK.md` and `MATRIX.md` follow, so
 * the file stays byte-identical across runs over unchanged inputs.
 */

import { describe, expect, test } from "bun:test";
import { renderSkillsDiffMarkdown } from "./render.ts";
import type { SkillsDiffJson } from "./types.ts";

function baseJson(overrides: Partial<SkillsDiffJson> = {}): SkillsDiffJson {
  return {
    meta: { generatedAt: "2026-09-16T00:00:00Z", tool: "wazuh-ctx@test" },
    ref: "5.0.0",
    repos: [
      { repo: "wazuh-dashboard", included: true, reason: "has .claude/skills" },
      { repo: "wazuh-indexer-plugins", included: false, reason: "no .claude/skills" },
    ],
    skills: [],
    singleRepoSkills: [],
    outOfScope: [
      {
        path: ".claude/settings.json",
        reason: "JSON, not markdown with a text-anchored override model",
        openCriterion: "SPEC 2.4 known-conflicts criterion naming settings.json",
      },
    ],
    ...overrides,
  };
}

describe("every category renders explicitly, even when empty (task 3.1)", () => {
  test("a skill with zero sections in a category still shows its heading and a zero count", () => {
    const json = baseJson({
      skills: [
        {
          skill: "analyze-dashboard-vuln",
          repos: ["wazuh-dashboard"],
          descriptions: [{ repo: "wazuh-dashboard", description: "d" }],
          sections: [],
          counts: { total: 0, common: 0, override: 0, sharedOverride: 0, conflict: 0 },
        },
      ],
    });

    const md = renderSkillsDiffMarkdown(json);

    expect(md).toContain("Common (0)");
    expect(md).toContain("Overrides (0)");
    expect(md).toContain("Shared overrides (0)");
    expect(md).toContain("Conflicts (0)");
    expect(md).toContain("none");
  });
});

describe("a non-empty category renders its rows, not just the count (task 3.2)", () => {
  test("a conflict shows its differing lines, magnitude, and repos — not the whole section body", () => {
    const json = baseJson({
      skills: [
        {
          skill: "check-standards",
          repos: ["wazuh-dashboard", "wazuh-dashboard-plugins"],
          descriptions: [],
          sections: [
            {
              path: ["Workflow", "3. Typecheck"],
              blocks: [
                {
                  category: "conflict",
                  magnitude: { total: 2, common: 1, differing: 1 },
                  groups: [
                    { repos: ["wazuh-dashboard"], body: "run\ntypecheck: yes", diffLines: ["typecheck: yes"], marker: "none" },
                    {
                      repos: ["wazuh-dashboard-plugins"],
                      body: "run\ntypecheck: no",
                      diffLines: ["typecheck: no"],
                      marker: "none",
                    },
                  ],
                },
              ],
            },
          ],
          counts: { total: 1, common: 0, override: 0, sharedOverride: 0, conflict: 1 },
        },
      ],
    });

    const md = renderSkillsDiffMarkdown(json);

    expect(md).toContain("Workflow > 3. Typecheck");
    expect(md).toContain("1 of 2 lines differ");
    expect(md).toContain("typecheck: yes");
    expect(md).toContain("typecheck: no");
    expect(md).toContain("wazuh-dashboard-plugins");
    // The whole two-line body must not be dumped verbatim.
    expect(md).not.toContain("run\ntypecheck: yes");
  });

  test("an override names the attributed repository", () => {
    const json = baseJson({
      skills: [
        {
          skill: "create-pr",
          repos: ["wazuh-dashboard"],
          descriptions: [],
          sections: [
            {
              path: ["Issue source"],
              blocks: [
                {
                  category: "override",
                  magnitude: { total: 3, common: 2, differing: 1 },
                  groups: [
                    { repos: ["wazuh-dashboard-plugins"], body: "a\nb\nc", diffLines: [], marker: "none" },
                    {
                      repos: ["wazuh-dashboard"],
                      body: "a\nb\n> **repo-specific (wazuh-dashboard):** internal repo note",
                      diffLines: ["> **repo-specific (wazuh-dashboard):** internal repo note"],
                      marker: "named",
                    },
                  ],
                },
              ],
            },
          ],
          counts: { total: 1, common: 0, override: 1, sharedOverride: 0, conflict: 0 },
        },
      ],
    });

    const md = renderSkillsDiffMarkdown(json);
    expect(md).toContain("wazuh-dashboard");
    expect(md).toContain("internal repo note");
  });

  test("a section holding BOTH a declared override and a separate conflict renders both, under Overrides AND Conflicts", () => {
    // The develop-issue defect: one section, two independent findings. A
    // section-wide label could only report one; this asserts both survive
    // into the render, each under its own category heading.
    const json = baseJson({
      skills: [
        {
          skill: "develop-issue",
          repos: ["wazuh-dashboard", "wazuh-dashboard-plugins"],
          descriptions: [],
          sections: [
            {
              path: ["Workflow", "1. Plan"],
              blocks: [
                {
                  category: "conflict",
                  magnitude: { total: 7, common: 6, differing: 1 },
                  groups: [
                    { repos: ["wazuh-dashboard"], body: "affected area", diffLines: ["affected area"], marker: "none" },
                    {
                      repos: ["wazuh-dashboard-plugins"],
                      body: "affected plugin(s)",
                      diffLines: ["affected plugin(s)"],
                      marker: "none",
                    },
                  ],
                },
                {
                  category: "override",
                  magnitude: { total: 7, common: 6, differing: 1 },
                  groups: [
                    { repos: ["wazuh-dashboard-plugins"], body: null, diffLines: [], marker: "none" },
                    {
                      repos: ["wazuh-dashboard"],
                      body: "> **repo-specific (wazuh-dashboard):** know where you are working",
                      diffLines: ["> **repo-specific (wazuh-dashboard):** know where you are working"],
                      marker: "named",
                    },
                  ],
                },
              ],
            },
          ],
          counts: { total: 2, common: 0, override: 1, sharedOverride: 0, conflict: 1 },
        },
      ],
    });

    const md = renderSkillsDiffMarkdown(json);
    const overridesSection = md.slice(md.indexOf("Overrides ("), md.indexOf("Shared overrides ("));
    const conflictsSection = md.slice(md.indexOf("Conflicts ("));

    expect(overridesSection).toContain("Workflow > 1. Plan");
    expect(overridesSection).toContain("know where you are working");
    expect(conflictsSection).toContain("Workflow > 1. Plan");
    expect(conflictsSection).toContain("affected area");
    expect(conflictsSection).toContain("affected plugin(s)");
  });
});

describe("a diff line containing a backtick renders with a safe delimiter (CodeRabbit PR #16 finding c)", () => {
  test("a diffLine with an inline code span does not break the markdown code span it is wrapped in", () => {
    // SKILL.md prose is full of its own inline code spans — `gh pr create`,
    // `check-standards` — so a fixed single backtick around the whole line
    // breaks the moment the line contains one of its own. The finding is
    // legible in the JSON either way; only the rendered report a human
    // actually opens was mangled.
    const lineWithBacktick = "run `gh pr create` as a draft";
    const json = baseJson({
      skills: [
        {
          skill: "create-pr",
          repos: ["wazuh-dashboard", "wazuh-dashboard-plugins"],
          descriptions: [],
          sections: [
            {
              path: ["Workflow"],
              blocks: [
                {
                  category: "conflict",
                  magnitude: { total: 2, common: 1, differing: 1 },
                  groups: [
                    { repos: ["wazuh-dashboard"], body: lineWithBacktick, diffLines: [lineWithBacktick], marker: "none" },
                    { repos: ["wazuh-dashboard-plugins"], body: "run it directly", diffLines: ["run it directly"], marker: "none" },
                  ],
                },
              ],
            },
          ],
          counts: { total: 1, common: 0, override: 0, sharedOverride: 0, conflict: 1 },
        },
      ],
    });

    const md = renderSkillsDiffMarkdown(json);

    // A single backtick immediately after the value's own backtick would
    // close the span early, leaking `` create` as a draft` `` as raw
    // markdown. The whole line must appear delimited by a LONGER backtick
    // run than any run inside it, not split apart.
    expect(md).toContain("``run `gh pr create` as a draft``");
  });

  test("a diffLine consisting entirely of a double-backtick span still gets a longer fence", () => {
    const doubleBacktick = "use ``inline code`` here";
    const json = baseJson({
      skills: [
        {
          skill: "create-pr",
          repos: ["wazuh-dashboard", "wazuh-dashboard-plugins"],
          descriptions: [],
          sections: [
            {
              path: ["Workflow"],
              blocks: [
                {
                  category: "conflict",
                  magnitude: { total: 2, common: 1, differing: 1 },
                  groups: [
                    { repos: ["wazuh-dashboard"], body: doubleBacktick, diffLines: [doubleBacktick], marker: "none" },
                    { repos: ["wazuh-dashboard-plugins"], body: "plain line", diffLines: ["plain line"], marker: "none" },
                  ],
                },
              ],
            },
          ],
          counts: { total: 1, common: 0, override: 0, sharedOverride: 0, conflict: 1 },
        },
      ],
    });

    const md = renderSkillsDiffMarkdown(json);
    expect(md).toContain("```use ``inline code`` here```");
  });
});

describe("the divergence profile is a per-skill table (task 3.3)", () => {
  test("counts appear as a table a reader can scan without opening files", () => {
    const json = baseJson({
      skills: [
        {
          skill: "analyze-dashboard-vuln",
          repos: ["wazuh-dashboard"],
          descriptions: [],
          sections: [],
          counts: { total: 20, common: 18, override: 1, sharedOverride: 0, conflict: 1 },
        },
        {
          skill: "check-standards",
          repos: ["wazuh-dashboard"],
          descriptions: [],
          sections: [],
          counts: { total: 10, common: 4, override: 2, sharedOverride: 1, conflict: 3 },
        },
      ],
    });

    const md = renderSkillsDiffMarkdown(json);
    const profileSection = md.slice(md.indexOf("Divergence profile"));

    expect(profileSection).toContain("analyze-dashboard-vuln");
    expect(profileSection).toContain("check-standards");
    expect(profileSection).toContain("18");
    expect(profileSection).toContain("20");
  });
});

describe("determinism (task 3.4)", () => {
  test("generatedAt never appears in the rendered markdown", () => {
    const md = renderSkillsDiffMarkdown(baseJson());
    expect(md).not.toContain("2026-09-16T00:00:00Z");
  });

  test("rendering the same input twice is byte-identical", () => {
    const json = baseJson();
    expect(renderSkillsDiffMarkdown(json)).toBe(renderSkillsDiffMarkdown(json));
  });
});

describe("settings.json is named as out of scope (task 3.5)", () => {
  test("the open SPEC 2.4 criterion is named", () => {
    const md = renderSkillsDiffMarkdown(baseJson());
    expect(md).toContain(".claude/settings.json");
    expect(md).toContain("SPEC 2.4");
  });
});

describe("repository selection is reported (SPEC 2.1: absence is not silent)", () => {
  test("both included and excluded repositories appear, with reasons", () => {
    const md = renderSkillsDiffMarkdown(baseJson());
    expect(md).toContain("wazuh-dashboard");
    expect(md).toContain("wazuh-indexer-plugins");
    expect(md).toContain("no .claude/skills");
  });
});

describe("a skill present in only one repository is reported, not diffed (SPEC: a skill is diffed when it is shared)", () => {
  test("it is listed by name and repository, in its own section", () => {
    const md = renderSkillsDiffMarkdown(
      baseJson({
        singleRepoSkills: [
          { skill: "docs-review", repo: "wazuh-indexer-plugins", description: "Review the docs." },
          { skill: "perf-tuning", repo: "wazuh-indexer-plugins", description: "Tune performance." },
        ],
      }),
    );

    expect(md).toContain("only one repository");
    expect(md).toContain("docs-review");
    expect(md).toContain("perf-tuning");
    expect(md).toContain("wazuh-indexer-plugins");
  });

  test("an empty list still renders the section explicitly, not omitted", () => {
    const md = renderSkillsDiffMarkdown(baseJson({ singleRepoSkills: [] }));
    expect(md).toContain("only one repository");
    expect(md).toContain("(0)");
  });
});

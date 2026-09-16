/**
 * `reconstructRepo` — `ExtractedSkill` + repo -> that repo's original lines
 * (SPEC 2.1's reconstruction requirement; design decision 4). Pure: no fs,
 * no network, no clock.
 *
 * Task 3.1 is the load-bearing test of the whole change: for every literal
 * input, `reconstruct(extract(x)) == x`, byte for byte. This is not a
 * property a hand-written fixture can agree with by accident, which is the
 * point — `extract.ts` and `reconstruct.ts` are two INDEPENDENT
 * transformations (one groups and classifies, the other resolves anchors and
 * replays ops), and their composing to the identity is the actual proof the
 * split lost nothing. A fixture written from the same understanding as the
 * code can be wrong in exactly the way the code is wrong; this assertion
 * cannot, because it does not encode what "right" looks like anywhere except
 * in `x` itself.
 *
 * No fixture files — every `x` is a literal `SkillVariant[]` in this file,
 * matching `diff.test.ts` and `extract.test.ts`'s own style, so this suite
 * cannot drift from what those two already exercise.
 */

import { describe, expect, test } from "bun:test";
import { resolveAnchor } from "./anchor.ts";
import { diffSkill } from "./diff.ts";
import { extractSkill as extractSkillUnchecked } from "./extract.ts";
import type { ExtractedSkill } from "./extract.ts";
import { reconstructAndVerify, reconstructRepo } from "./reconstruct.ts";
import type { SectionMarker, SkillVariant } from "./types.ts";

/** Same blanket guards as `extract.test.ts` — this file builds its own
 * extractions directly rather than importing that file's wrapper, so it
 * needs its own copy to get the same protection on every call here. */
function assertNoBlankAnchor(extracted: ExtractedSkill): void {
  const allOps = [...[...extracted.overrides.values()].flat(), ...extracted.conflicts];
  for (const op of allOps) {
    if (op.anchor !== null && op.anchor.trim().length === 0) {
      throw new Error(
        `assertNoBlankAnchor: skill '${extracted.skill}' has an op at heading ` +
          `${JSON.stringify(op.heading)} anchored to a blank/whitespace-only line ` +
          `(${JSON.stringify(op.anchor)})`,
      );
    }
  }
}

/** The general invariant (see `extract.test.ts` for the full rationale):
 * every op's `(heading, anchor, occurrence, offset)` must resolve to
 * exactly one position, in every repo it belongs to — the same
 * `resolveAnchor` reconstruction itself calls. */
function assertAnchorsResolve(extracted: ExtractedSkill): void {
  const coreByHeading = new Map(extracted.core.map((section) => [JSON.stringify(section.path), section]));
  const opsWithRepo: { readonly op: { heading: readonly string[]; anchor: string | null; occurrence: number }; readonly repo: string }[] = [];
  for (const [repo, ops] of extracted.overrides) for (const op of ops) opsWithRepo.push({ op, repo });
  for (const op of extracted.conflicts) for (const repo of op.repos) opsWithRepo.push({ op, repo });

  for (const { op, repo } of opsWithRepo) {
    if (op.anchor === null) continue;
    const section = coreByHeading.get(JSON.stringify(op.heading));
    if (section === undefined) continue;
    resolveAnchor({
      skill: extracted.skill,
      repo,
      heading: op.heading,
      lines: section.anchors,
      anchor: op.anchor,
      occurrence: op.occurrence,
    });
  }
}

/** Same weaker, cheaper companion guard as `extract.test.ts` — see that
 * file for the full rationale. */
function assertReconstructionPreservesLineCount(
  extracted: ExtractedSkill,
  variants: readonly { repo: string; skill: { sections: readonly { lines: readonly string[] }[] } }[],
): void {
  for (const v of variants) {
    const expectedLength = v.skill.sections.reduce((sum, s) => sum + s.lines.length, 0);
    const actualLength = reconstructRepo(extracted, v.repo).length;
    if (actualLength !== expectedLength) {
      throw new Error(
        `assertReconstructionPreservesLineCount: skill '${extracted.skill}' repo '${v.repo}' ` +
          `reconstructed ${actualLength} lines, expected ${expectedLength} — a line was dropped or duplicated`,
      );
    }
  }
}

function extractSkill(skillName: string, variants: readonly SkillVariant[]): ExtractedSkill {
  const result = extractSkillUnchecked(diffSkill(skillName, variants));
  assertNoBlankAnchor(result);
  assertAnchorsResolve(result);
  assertReconstructionPreservesLineCount(result, variants);
  return result;
}

function variant(
  repo: string,
  sections: readonly { path: readonly string[]; lines: readonly string[]; markers?: readonly SectionMarker[] }[],
): SkillVariant {
  return {
    repo,
    skill: {
      frontmatter: { name: "a-skill", description: `${repo}'s description` },
      sections: sections.map((s) => ({ path: s.path, lines: s.lines, markers: s.markers ?? [] })),
    },
  };
}

/** Every repo's ORIGINAL flattened body, section by section, skipping a
 * section the repo does not have — exactly what `reconstructRepo` is
 * supposed to rebuild from `core` + `overrides` + `conflicts`. */
function originalBody(v: SkillVariant): readonly string[] {
  return v.skill.sections.flatMap((s) => s.lines);
}

describe("the round trip: reconstruct(extract(x)) == x, byte for byte (task 3.1)", () => {
  test("a skill mixing a common section, a named override, an unnamed shared override, a conflict, and an absent section", () => {
    // Blank lines throughout, on purpose — real `SKILL.md` files are full of
    // them (around headings, between list items, as paragraph breaks), and
    // this is the shape that crashed the first real-corpus run: a blank
    // line sitting where a naive implementation would nominate it as the
    // anchor for the divergent line right after it.
    const variants: SkillVariant[] = [
      variant("wazuh-dashboard", [
        { path: ["Common"], lines: ["Run the standard checks.", "", "Ship it."] },
        {
          path: ["Workflow", "1. Plan"],
          lines: [
            "Confirm the branch.",
            "",
            "> **repo-specific (wazuh-dashboard):** notify the release channel.",
          ],
          markers: [{ lineIndex: 2, repo: "wazuh-dashboard" }],
        },
        {
          path: ["Shared bit"],
          lines: ["Base line.", "", "> **repo-specific:** applies to two of three."],
          markers: [{ lineIndex: 2, repo: null }],
        },
        { path: ["Disputed"], lines: ["area"] },
        { path: ["Only here"], lines: ["wazuh-dashboard-only content"] },
      ]),
      variant("wazuh-dashboard-plugins", [
        { path: ["Common"], lines: ["Run the standard checks.", "", "Ship it."] },
        { path: ["Workflow", "1. Plan"], lines: ["Confirm the branch.", "", "Push when ready."] },
        {
          path: ["Shared bit"],
          lines: ["Base line.", "", "> **repo-specific:** applies to two of three."],
          markers: [{ lineIndex: 2, repo: null }],
        },
        { path: ["Disputed"], lines: ["plugin(s)"] },
      ]),
      variant("wazuh-indexer", [
        { path: ["Common"], lines: ["Run the standard checks.", "", "Ship it."] },
        { path: ["Workflow", "1. Plan"], lines: ["Confirm the branch.", "", "Push when ready."] },
        { path: ["Shared bit"], lines: ["Base line."] },
        { path: ["Disputed"], lines: ["area"] },
      ]),
    ];

    const extracted = extractSkill("a-skill", variants);

    for (const v of variants) {
      const actual = reconstructRepo(extracted, v.repo);
      expect(actual).toEqual(originalBody(v));
    }
  });

  test("a fully common skill with no divergence at all", () => {
    const lines = ["one shared body", "nothing repo-specific"];
    const variants = ["a", "b", "c"].map((repo) => variant(repo, [{ path: ["Section"], lines }]));

    const extracted = extractSkill("a-skill", variants);

    for (const v of variants) {
      expect(reconstructRepo(extracted, v.repo)).toEqual(originalBody(v));
    }
  });

  test("a skill that is entirely one divergent block per repo (no common anchor at all)", () => {
    const variants = [
      variant("a", [{ path: ["Section"], lines: ["only a has this, wall to wall"] }]),
      variant("b", [{ path: ["Section"], lines: ["only b has this, wall to wall"] }]),
      variant("c", [{ path: ["Section"], lines: ["only c has this, wall to wall"] }]),
    ];

    const extracted = extractSkill("a-skill", variants);

    for (const v of variants) {
      expect(reconstructRepo(extracted, v.repo)).toEqual(originalBody(v));
    }
  });

  test("REGRESSION: a divergent position preceded by blank lines never nominates a blank anchor", () => {
    // Real `SKILL.md` files are full of exactly this shape — a blank line
    // before a heading, blank lines between list items. Two blank anchors
    // in the SAME section (at indices 1 and 3) reproduce the crash the
    // coordinator hit on `analyze-dashboard-vuln`: `resolveAnchor` called
    // with anchor `""`, matching every blank line in the section instead of
    // exactly one. Without `nominateAnchor` walking back to "Middle line."
    // this test fails with "ambiguous anchor ... matched 2 positions",
    // the same shape as the real crash's "matched 6 positions".
    const majorityTail = ["Intro line.", "", "Middle line.", "", "Majority tail."];
    const minorityTail = [
      "Intro line.",
      "",
      "Middle line.",
      "",
      "> **repo-specific (wazuh-dashboard):** minority tail.",
    ];

    const variants = [
      variant("wazuh-dashboard", [
        { path: ["Section"], lines: minorityTail, markers: [{ lineIndex: 4, repo: "wazuh-dashboard" }] },
      ]),
      variant("wazuh-dashboard-plugins", [{ path: ["Section"], lines: majorityTail }]),
      variant("wazuh-indexer", [{ path: ["Section"], lines: majorityTail }]),
    ];

    const extracted = extractSkill("a-skill", variants);

    for (const v of variants) {
      expect(reconstructRepo(extracted, v.repo)).toEqual(originalBody(v));
    }

    // The override op exists (wazuh-dashboard is the minority) and its
    // anchor is never blank — the fix, made an explicit assertion, not just
    // an absence of a thrown error.
    const op = extracted.overrides.get("wazuh-dashboard")!.find((o) => o.attribution === "override");
    expect(op).toBeDefined();
    expect(op!.anchor).not.toBeNull();
    expect(op!.anchor!.trim().length).toBeGreaterThan(0);
  });

  test("REGRESSION: the same non-blank line twice in one section, each preceding a different divergence", () => {
    // The `check-standards` crash: a code fence line (` ``` `) appearing
    // TWICE within one heading — `resolveAnchor` reported "matched 2
    // positions" because both divergent positions naively anchored to the
    // literal text `"```"` with no way to tell them apart. Design decision
    // 1's third anchor component, `occurrence`, is exactly the fix: each
    // op now names WHICH match of `"```"` it means.
    const majorityTail = ["```", "shared block one", "```", "shared block two"];
    const minorityTail = [
      "```",
      "> **repo-specific (wazuh-dashboard):** first override",
      "```",
      "> **repo-specific (wazuh-dashboard):** second override",
    ];

    const variants = [
      variant("wazuh-dashboard", [
        {
          path: ["Workflow", "6. Report"],
          lines: minorityTail,
          markers: [
            { lineIndex: 1, repo: "wazuh-dashboard" },
            { lineIndex: 3, repo: "wazuh-dashboard" },
          ],
        },
      ]),
      variant("wazuh-dashboard-plugins", [{ path: ["Workflow", "6. Report"], lines: majorityTail }]),
      variant("wazuh-indexer", [{ path: ["Workflow", "6. Report"], lines: majorityTail }]),
    ];

    const extracted = extractSkill("check-standards", variants);

    // Two distinct override ops, both anchored to the literal same text,
    // distinguished only by occurrence.
    const ops = extracted.overrides.get("wazuh-dashboard")!.filter((o) => o.attribution === "override");
    expect(ops).toHaveLength(2);
    expect(ops.every((o) => o.anchor === "```")).toBe(true);
    expect([...ops.map((o) => o.occurrence)].sort()).toEqual([1, 2]);

    for (const v of variants) {
      expect(reconstructRepo(extracted, v.repo)).toEqual(originalBody(v));
    }
  });

  test("REGRESSION: two consecutive blank lines collapse to one when a minority mutates only one of them", () => {
    // Root cause, found on the real corpus: `bodyKey`/`slotContentKey` in
    // `diff.ts` encoded a line array via `.join("\n")`, which is not
    // injective — `[].join("\n")` and `[""].join("\n")` are BOTH `""`. Two
    // majority repos with two consecutive blank lines and one minority repo
    // that replaces only the FIRST of the pair have a DIFFERENT total blank
    // count, which shifts `commonAcrossGroups`' per-repo greedy anchor
    // consumption differently per repo — the majority's second blank lands
    // as ordinary slot content, the minority's surviving blank gets
    // consumed AS the anchor itself. Fixed by encoding with
    // `JSON.stringify` instead of a join, which distinguishes `[]` from
    // `[""]`.
    const majority = ["```", "", "", "```", "Tail."];
    const minority = ["```", "> **repo-specific (a):** override", "", "```", "Tail."];

    const variants = [
      variant("a", [{ path: ["Section"], lines: minority, markers: [{ lineIndex: 1, repo: "a" }] }]),
      variant("b", [{ path: ["Section"], lines: majority }]),
      variant("c", [{ path: ["Section"], lines: majority }]),
    ];

    const extracted = extractSkill("a-skill", variants);

    for (const v of variants) {
      expect(reconstructRepo(extracted, v.repo)).toEqual(originalBody(v));
    }
  });

  test("REGRESSION: a trailing blank line at the end of a section is not dropped", () => {
    // Same root cause, at the END of a section: two majority repos end with
    // two blank lines, the minority replaces only the FIRST of the two,
    // leaving a single trailing blank. Before the `JSON.stringify` fix,
    // the majority's own trailing blank was silently dropped.
    const majority = ["Body.", "Tail.", "", ""];
    const minority = ["Body.", "Tail.", "> **repo-specific (a):** override", ""];

    const variants = [
      variant("a", [{ path: ["Section"], lines: minority, markers: [{ lineIndex: 2, repo: "a" }] }]),
      variant("b", [{ path: ["Section"], lines: majority }]),
      variant("c", [{ path: ["Section"], lines: majority }]),
    ];

    const extracted = extractSkill("a-skill", variants);

    for (const v of variants) {
      expect(reconstructRepo(extracted, v.repo)).toEqual(originalBody(v));
    }
  });
});

describe("ops applied in shuffled order still reconstruct the same result (task 3.2)", () => {
  test("swapping the Map insertion order of overrides changes nothing observable", () => {
    const variants = [
      variant("a", [
        {
          path: ["Section"],
          lines: ["common line", "> **repo-specific (a):** a's own line"],
          markers: [{ lineIndex: 1, repo: "a" }],
        },
      ]),
      variant("b", [
        {
          path: ["Section"],
          lines: ["common line", "> **repo-specific (b):** b's own line"],
          markers: [{ lineIndex: 1, repo: "b" }],
        },
      ]),
      variant("c", [{ path: ["Section"], lines: ["common line"] }]),
    ];

    const extracted = extractSkill("a-skill", variants);

    const forward = ["a", "b", "c"].map((repo) => reconstructRepo(extracted, repo));

    // Rebuild the SAME extraction with its overrides Map populated in the
    // reverse order — reconstruction must not depend on iteration order.
    const shuffledOverrides = new Map(
      [...extracted.overrides.entries()].sort((x, y) => y[0].localeCompare(x[0])),
    );
    const shuffled = { ...extracted, overrides: shuffledOverrides };
    const backward = ["a", "b", "c"].map((repo) => reconstructRepo(shuffled, repo));

    expect(backward).toEqual(forward);
  });
});

describe("a file that cannot be reconstructed lands in lossy[] with the exact diff (task 3.3)", () => {
  test("a deliberately corrupted extraction is reported lossy, not silently wrong", () => {
    // "b" and "c" share the plain baseline (the majority); "a" is the
    // unambiguous minority, so it is the one guaranteed to carry an op —
    // no tie-break involved, unlike a 1-vs-1 split.
    const variants = [
      variant("a", [
        {
          path: ["Section"],
          lines: ["common line", "> **repo-specific (a):** a's own line"],
          markers: [{ lineIndex: 1, repo: "a" }],
        },
      ]),
      variant("b", [{ path: ["Section"], lines: ["common line"] }]),
      variant("c", [{ path: ["Section"], lines: ["common line"] }]),
    ];

    const extracted = extractSkill("a-skill", variants);

    // Corrupt repo "a"'s override content — simulates a bug that would
    // otherwise silently ship a wrong reconstruction.
    const corruptedOverrides = new Map(extracted.overrides);
    corruptedOverrides.set(
      "a",
      corruptedOverrides.get("a")!.map((op) => ({ ...op, content: ["WRONG CONTENT"] })),
    );
    const corrupted = { ...extracted, overrides: corruptedOverrides };

    const originals = new Map(variants.map((v) => [v.repo, originalBody(v)]));
    const summary = reconstructAndVerify(corrupted, originals);

    expect(summary.reconstructed).toBe(2); // "b" and "c" still reconstruct
    expect(summary.lossy).toHaveLength(1);
    expect(summary.lossy[0]!.repo).toBe("a");
    expect(summary.lossy[0]!.expected).toEqual(originals.get("a")!);
    expect(summary.lossy[0]!.actual).not.toEqual(originals.get("a")!);
  });
});

describe("reconstructed + lossy == input count, as arithmetic over the whole corpus (task 3.4)", () => {
  test("holds across several independent skills and repos summed together", () => {
    const skills = [
      {
        name: "skill-one",
        variants: [
          variant("a", [{ path: ["S"], lines: ["x"] }]),
          variant("b", [{ path: ["S"], lines: ["x"] }]),
        ],
      },
      {
        name: "skill-two",
        variants: [
          variant("a", [{ path: ["S"], lines: ["> **repo-specific (a):** a-only"] }], ) ,
          variant("b", [{ path: ["S"], lines: ["b-only, no marker"] }]),
        ],
      },
    ];

    let totalReconstructed = 0;
    let totalLossy = 0;
    let totalInputs = 0;

    for (const s of skills) {
      const withMarkers = s.variants.map((v) =>
        v.repo === "a" && v.skill.sections[0]!.lines[0]!.startsWith(">")
          ? {
              ...v,
              skill: {
                ...v.skill,
                sections: [{ ...v.skill.sections[0]!, markers: [{ lineIndex: 0, repo: "a" }] }],
              },
            }
          : v,
      );
      const extracted = extractSkill(s.name, withMarkers);
      const originals = new Map(withMarkers.map((v) => [v.repo, originalBody(v)]));
      const summary = reconstructAndVerify(extracted, originals);
      totalReconstructed += summary.reconstructed;
      totalLossy += summary.lossy.length;
      totalInputs += originals.size;
    }

    expect(totalReconstructed + totalLossy).toBe(totalInputs);
    expect(totalLossy).toBe(0); // nothing deliberately corrupted this time
  });
});

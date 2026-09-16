/**
 * `resolveAnchor` — SPEC 2.1.1's fatal-vs-silent line, tested in isolation
 * from extraction and reconstruction.
 *
 * Design decision 1: the anchor is `(headingPath, line, occurrence)`, and the
 * occurrence component is not needed by today's corpus — after heading
 * scoping, zero of the 409 real patch blocks are ambiguous. What IS needed,
 * always, is that the resolver COUNTS every match within the section it is
 * given rather than returning the first one it finds: a resolver that stops
 * at the first match cannot tell "exactly one" from "several," and SPEC
 * 2.1.1 requires the second case to be fatal, not silently resolved to
 * whichever occurrence happened to be scanned first.
 *
 * Every test here calls `resolveAnchor` with `lines` already scoped to ONE
 * heading section — the caller's job (extract.ts, reconstruct.ts), never
 * this function's. That is the measured fix from exploration.md finding 3:
 * scoping to the heading is what turns 29 of 409 ambiguous-file-wide anchors
 * into unique ones, and `resolveAnchor` only ever sees the scoped slice.
 */

import { describe, expect, test } from "bun:test";
import { resolveAnchor } from "./anchor.ts";

describe("an anchor unique inside its heading resolves (task 1.1)", () => {
  test("resolves even when the same line occurs elsewhere in the file", () => {
    // The measured shape: "Push when ready." appears in two different
    // headings' bodies, but only once inside THIS heading's lines — the
    // caller passes only this heading's slice, so the other occurrence
    // never enters the count.
    const thisHeadingLines = ["Open a PR.", "Push when ready.", "Done."];

    const index = resolveAnchor({
      skill: "create-pr",
      repo: "wazuh-dashboard",
      heading: ["Workflow", "2. Push"],
      lines: thisHeadingLines,
      anchor: "Push when ready.",
    });

    expect(index).toBe(1);
  });

  test("resolves the sole occurrence even when it is the only line", () => {
    const index = resolveAnchor({
      skill: "resolve-cve",
      repo: "wazuh-indexer",
      heading: ["Version bases"],
      lines: ["Match how CI computes them:"],
      anchor: "Match how CI computes them:",
    });

    expect(index).toBe(0);
  });
});

describe("an anchor occurring twice inside its own heading is fatal (task 1.2)", () => {
  test("throws naming skill, repo, anchor, and match count — not a warning", () => {
    const lines = ["Step one.", "Repeat.", "Step two.", "Repeat."];

    expect(() =>
      resolveAnchor({
        skill: "develop-issue",
        repo: "wazuh-dashboard-plugins",
        heading: ["Workflow", "1. Plan"],
        lines,
        anchor: "Repeat.",
      }),
    ).toThrow(/develop-issue/);

    try {
      resolveAnchor({
        skill: "develop-issue",
        repo: "wazuh-dashboard-plugins",
        heading: ["Workflow", "1. Plan"],
        lines,
        anchor: "Repeat.",
      });
      throw new Error("expected resolveAnchor to throw");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("develop-issue");
      expect(message).toContain("wazuh-dashboard-plugins");
      expect(message).toContain("Workflow > 1. Plan");
      expect(message).toContain("Repeat.");
      expect(message).toContain("2");
    }
  });
});

describe("an anchor matching nothing is fatal (task 1.3)", () => {
  test("throws rather than silently skipping the operation", () => {
    expect(() =>
      resolveAnchor({
        skill: "check-standards",
        repo: "wazuh-dashboard",
        heading: ["Workflow", "3. Typecheck"],
        lines: ["run", "typecheck: yes"],
        anchor: "this line does not exist anywhere in the section",
      }),
    ).toThrow(/0 positions|matched 0/);
  });
});

describe("the resolver counts every match rather than short-circuiting (task 1.4)", () => {
  test("a three-way ambiguity is reported as 3, not 2 or 'more than one'", () => {
    // A resolver that stops scanning after finding a second match cannot
    // report an accurate count, and the count is what SPEC 2.1.1's error
    // message must name.
    const lines = ["dup", "middle", "dup", "middle", "dup"];

    try {
      resolveAnchor({
        skill: "issue-creation",
        repo: "wazuh-qa",
        heading: ["Preamble"],
        lines,
        anchor: "dup",
      });
      throw new Error("expected resolveAnchor to throw");
    } catch (error) {
      expect((error as Error).message).toContain("3");
    }
  });
});

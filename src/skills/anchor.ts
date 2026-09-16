/**
 * `resolveAnchor` — the single place `skills-core`'s override ops resolve a
 * text anchor to a line position. Pure: no fs, no network, no clock.
 *
 * Design decision 1: an anchor is `(headingPath, line, occurrence)`. An
 * earlier version of this module treated `occurrence` as "not needed by
 * today's corpus," on the reasoning that heading scoping alone dissolved
 * every file-wide ambiguity measured against the 42 real files. That
 * reasoning was wrong, and the real corpus proved it on the SECOND skill it
 * was run against: a code fence line (` ``` `) appearing twice within one
 * heading — `check-standards`'s `Workflow > 6. Report` — the same class of
 * bug as a blank line, just a different line shape. Heading scoping fixes
 * ambiguity ACROSS sections; it does nothing for a line that legitimately
 * repeats WITHIN one section, and any sufficiently long real document has
 * some of those — code fences, `---` separators, table pipes, bare list
 * bullets, closing parens. Patching each line shape as it surfaces is
 * exactly the failure shape this project has paid for repeatedly: a
 * sequence of locally-plausible fixes to a problem that stays open. The
 * general fix is the THIRD component of the anchor design already named:
 * `occurrence` picks a specific match by ordinal, so no line is ever
 * unusable as an anchor.
 *
 * What the resolver must still do, unconditionally, is COUNT every match
 * within the section it is given. SPEC 2.1.1 is explicit that both zero
 * matches and "more matches than requested" are fatal `sync` errors, not
 * warnings:
 *
 * - No `occurrence` given: the anchor must be unique — exactly one match,
 *   or the run fails naming the match count (the original, still-correct
 *   behavior for the common case, where no ordinal is needed at all).
 * - `occurrence` given: that specific ordinal match must exist — fewer
 *   matches than the requested ordinal (including zero) is fatal. What
 *   stops being fatal is "this line matched more than once" — an ordinal
 *   answers exactly that question, on purpose.
 *
 * Scoping `lines` to one heading section is the CALLER's job (`extract.ts`
 * when it records an anchor, `reconstruct.ts` when it resolves one back).
 * This function never sees a whole file — that boundary is what turns the
 * measured 21-of-42 file-wide reconstruction rate into 42 of 42.
 */

export interface ResolveAnchorInput {
  /** For the error message only — this function does no I/O and looks
   * nothing up by these values. */
  readonly skill: string;
  readonly repo: string;
  readonly heading: readonly string[];
  /** Already scoped to the ONE heading section the anchor belongs to. */
  readonly lines: readonly string[];
  readonly anchor: string;
  /**
   * 1-based ordinal: "the Nth match of `anchor` within `lines`." Omit when
   * the anchor is expected to be unique on its own — the common case, where
   * naming an ordinal would be noise. When given, it MUST be a positive
   * integer no greater than the actual match count, or the run fails.
   */
  readonly occurrence?: number;
}

function headingLabel(heading: readonly string[]): string {
  return heading.length === 0 ? "(preamble)" : heading.join(" > ");
}

/**
 * Resolves `input.anchor` to a line index within `input.lines`.
 *
 * Without `occurrence`: the anchor must match exactly once — zero (task
 * 1.3) or two-or-more (task 1.2) are both fatal, and the message names
 * skill, repo, heading, anchor, and match count so a person can act on it
 * without re-deriving which of the seven repositories broke.
 *
 * With `occurrence`: returns that specific 1-based match. Fewer matches
 * than requested (including zero) is fatal, naming the requested ordinal
 * and the actual count. The resolver COUNTS every match rather than
 * stopping at the first, in both modes — a resolver that short-circuits
 * cannot enforce either fatal condition, and cannot report an accurate
 * count in its error message either.
 */
export function resolveAnchor(input: ResolveAnchorInput): number {
  const matches: number[] = [];
  input.lines.forEach((line, index) => {
    if (line === input.anchor) matches.push(index);
  });

  if (input.occurrence === undefined) {
    if (matches.length === 1) {
      return matches[0]!;
    }
    throw new Error(
      `resolveAnchor: ambiguous anchor — skill '${input.skill}', repo '${input.repo}', ` +
        `heading '${headingLabel(input.heading)}', anchor ${JSON.stringify(input.anchor)} ` +
        `matched ${matches.length} positions (expected exactly 1)`,
    );
  }

  if (!Number.isInteger(input.occurrence) || input.occurrence < 1) {
    throw new Error(
      `resolveAnchor: invalid occurrence ${input.occurrence} — skill '${input.skill}', ` +
        `repo '${input.repo}', heading '${headingLabel(input.heading)}' — occurrence must be a ` +
        "positive integer",
    );
  }

  if (matches.length < input.occurrence) {
    throw new Error(
      `resolveAnchor: occurrence out of range — skill '${input.skill}', repo '${input.repo}', ` +
        `heading '${headingLabel(input.heading)}', anchor ${JSON.stringify(input.anchor)} requested ` +
        `occurrence ${input.occurrence} but matched only ${matches.length} position(s)`,
    );
  }

  return matches[input.occurrence - 1]!;
}

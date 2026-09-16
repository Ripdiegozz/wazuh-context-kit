/**
 * `resolveAnchor` — the single place `skills-core`'s override ops resolve a
 * text anchor to a line position. Pure: no fs, no network, no clock.
 *
 * Design decision 1: an anchor is `(headingPath, line, occurrence)`. The
 * `occurrence` component is not needed by today's corpus — measured over the
 * 42 real files, heading scoping alone dissolves all 29 file-wide
 * ambiguities, so every real anchor is unique once scoped to its heading.
 * What the resolver must still do, unconditionally, is COUNT every match
 * within the section it is given and refuse anything other than exactly
 * one. SPEC 2.1.1 is explicit that both zero matches and several are fatal
 * `sync` errors, not warnings — a resolver that returns the first match it
 * finds cannot tell "exactly one" from "several," and would silently pick a
 * position nobody verified is the right one.
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
}

function headingLabel(heading: readonly string[]): string {
  return heading.length === 0 ? "(preamble)" : heading.join(" > ");
}

/**
 * Resolves `input.anchor` to its unique index within `input.lines`.
 *
 * Throws when the match count is anything other than exactly one — zero
 * (task 1.3) or two-or-more (task 1.2) are both fatal, and the message
 * names skill, repo, heading, anchor, and match count so a person can act on
 * it without re-deriving which of the seven repositories broke.
 */
export function resolveAnchor(input: ResolveAnchorInput): number {
  const matches: number[] = [];
  input.lines.forEach((line, index) => {
    if (line === input.anchor) matches.push(index);
  });

  if (matches.length === 1) {
    return matches[0]!;
  }

  throw new Error(
    `resolveAnchor: ambiguous anchor — skill '${input.skill}', repo '${input.repo}', ` +
      `heading '${headingLabel(input.heading)}', anchor ${JSON.stringify(input.anchor)} ` +
      `matched ${matches.length} positions (expected exactly 1)`,
  );
}

/**
 * `assertAllowedWrite` — the ONE chokepoint every write in `src/serve/` must
 * pass through (SPEC 1.5.3 criterion 1: "La UI no escribe fuera de
 * decisions.yml, annotations.yml y decisions.local.yml").
 *
 * This is not a coding convention -- it is the single function that decides
 * whether a write is allowed, and every write site in this module (the
 * decisions/annotations preview-and-commit handlers) calls it before ever
 * touching a filesystem. Nothing else in `src/serve/` opens a file for
 * writing.
 *
 * Compared AFTER normalization (`node:path`'s `resolve`), never before: a
 * check against the raw string would miss a path-traversal attempt spelled
 * with `..` segments, or one that happens to end in an allowed filename after
 * enough of them. `resolve(root, target)` collapses `..` before the
 * allowlist membership check ever runs, so a traversal is refused by the same
 * equality test as any other disallowed path -- there is no separate
 * "contains .." heuristic to bypass.
 */

import { resolve } from "node:path";

const ALLOWED_FILENAMES = ["decisions.yml", "annotations.yml", "decisions.local.yml"] as const;

export type AllowedWriteFile = (typeof ALLOWED_FILENAMES)[number];

export class WriteRefused extends Error {
  readonly requestedPath: string;
  readonly resolvedPath: string;

  constructor(requestedPath: string, resolvedPath: string) {
    super(
      `refusing to write outside decisions.yml, annotations.yml, decisions.local.yml: ` +
        `requested "${requestedPath}" resolved to "${resolvedPath}"`,
    );
    this.name = "WriteRefused";
    this.requestedPath = requestedPath;
    this.resolvedPath = resolvedPath;
  }
}

/**
 * Resolves `targetPath` against `root` and throws `WriteRefused` unless the
 * result is EXACTLY one of the three allowed files, directly under `root`.
 *
 * `targetPath` may be relative (joined to `root`) or absolute (compared as
 * given, still after normalization) -- either way the only path that survives
 * is one of `root/decisions.yml`, `root/annotations.yml`,
 * `root/decisions.local.yml`.
 *
 * Returns the resolved, allowed path, so a caller never has to re-derive it
 * (and can never accidentally write to the un-normalized `targetPath`
 * instead).
 */
export function assertAllowedWrite(root: string, targetPath: string): string {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(root, targetPath);

  const allowed = new Set(ALLOWED_FILENAMES.map((name) => resolve(resolvedRoot, name)));

  if (!allowed.has(resolvedTarget)) {
    throw new WriteRefused(targetPath, resolvedTarget);
  }

  return resolvedTarget;
}

/**
 * Loading sources.yml — the explicit repo list (SPEC 1.3).
 *
 * This is our own config, not `wazuh/*` content: a malformed or missing file
 * is fatal, the opposite of parse/'s robust-empty rule (D5 boundary). Mirrors
 * src/decisions/load.ts's I/O style: read, parse YAML, validate with zod,
 * fail with a message naming the file and field.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { RepoKind } from "./matrix/types.ts";

export interface RepoSource {
  readonly name: string;
  readonly kind: RepoKind;
}

const repoKindSchema = z.enum(["platform", "dashboard", "indexer"]);

/**
 * `.strict()` on purpose (SPEC: "credentials come from the environment,
 * never from committed configuration"). `sources.yml` is committed; a plain
 * `z.object()` here would silently STRIP an unknown `username` or `password`
 * field and validate anyway, which quietly honours exactly the shape this
 * requirement forbids. Rejecting it outright is the only way a stray
 * credential field in a committed file gets noticed instead of ignored.
 */
const repoSourceSchema = z
  .object({
    name: z.string().min(1),
    kind: repoKindSchema,
  })
  .strict();

// NOT `.strict()` at this level: the real `sources.yml` carries a hand-
// maintained `docsVersionMap` block (SPEC 3.1) this loader does not read.
// The credential boundary is per-repo-entry, not "no unknown top-level key".
const sourcesFileSchema = z.object({
  refs: z.array(z.string().min(1)).min(1),
  repos: z.array(repoSourceSchema).min(1),
});

export interface Sources {
  readonly refs: string[];
  readonly repos: RepoSource[];
}

/** Fatal on a missing or schema-invalid file — see module doc. */
export async function loadSources(root: string): Promise<Sources> {
  const path = join(root, "sources.yml");

  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`sources.yml not found at ${path}`);
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (error) {
    throw new Error(`${path}: invalid YAML — ${(error as Error).message}`);
  }

  const result = sourcesFileSchema.safeParse(parsed);
  if (!result.success) {
    const first = result.error.issues[0];
    const where = first?.path.join(".") ?? "?";
    throw new Error(`${path}: invalid entry at ${where} — ${first?.message ?? "unknown"}`);
  }

  return { refs: result.data.refs, repos: result.data.repos };
}

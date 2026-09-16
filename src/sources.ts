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
// maintained `docsVersionMap` block (SPEC 3.1) this loader does not read, and
// rejecting every unrecognised top-level key would break that legitimate
// block. The credential boundary here is narrower and explicit instead: see
// `rejectTopLevelCredentialFields` below.
const sourcesFileSchema = z.object({
  refs: z.array(z.string().min(1)).min(1),
  repos: z.array(repoSourceSchema).min(1),
});

/**
 * `username`/`password` at the TOP LEVEL of `sources.yml`, rejected
 * explicitly.
 *
 * CodeRabbit finding (PR #14): `sourcesFileSchema` above is deliberately
 * NOT `.strict()` -- the real file's `docsVersionMap` block depends on
 * that -- but a plain `z.object()` does not just tolerate an unrecognised
 * key, it silently STRIPS it and reports success. A `username` or
 * `password` field at this level therefore validated fine and vanished with
 * no trace, which is a credential-in-git risk quietly waved through, not
 * caught. This check runs on the raw parsed value, before schema
 * validation, so stripping never gets the chance to happen.
 */
const TOP_LEVEL_CREDENTIAL_FIELDS = ["username", "password"] as const;

function rejectTopLevelCredentialFields(path: string, parsed: unknown): void {
  if (typeof parsed !== "object" || parsed === null) return;
  for (const field of TOP_LEVEL_CREDENTIAL_FIELDS) {
    if (field in (parsed as Record<string, unknown>)) {
      throw new Error(
        `${path}: invalid entry at ${field} — credentials come from ` +
          "WAZUH_CTX_INDEXER_USERNAME/WAZUH_CTX_INDEXER_PASSWORD, never from sources.yml",
      );
    }
  }
}

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

  rejectTopLevelCredentialFields(path, parsed);

  const result = sourcesFileSchema.safeParse(parsed);
  if (!result.success) {
    const first = result.error.issues[0];
    const where = first?.path.join(".") ?? "?";
    throw new Error(`${path}: invalid entry at ${where} — ${first?.message ?? "unknown"}`);
  }

  return { refs: result.data.refs, repos: result.data.repos };
}

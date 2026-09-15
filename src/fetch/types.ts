/**
 * Types for src/fetch/ — the only module touching network and git (SPEC 6.1).
 *
 * Every git call is an argv array, never a shell string, and `cwd` is always
 * explicit. `exactOptionalPropertyTypes` is on: no optional-undefined members
 * anywhere in this file.
 */

import type { RepoSource } from "../sources.ts";
import type { Skipped } from "../matrix/types.ts";

export type { Skipped };

export interface GitCommand {
  readonly argv: readonly string[];
  readonly cwd: string;
}

export interface GitResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type GitRunner = (command: GitCommand) => Promise<GitResult>;

/**
 * The whole I/O surface of fetch/. One object, one fake.
 *
 * `ensureDir` resolves open question A1: `git clone` creates leading
 * directories for its *destination*, but `child_process.spawn` still needs an
 * existing working directory for the process itself, and `.cache/` may not
 * exist yet on a fresh checkout. Routing it through `FetchIo` (instead of a
 * raw `fs.mkdir` call in `index.ts`) keeps every fs/git touch behind the one
 * injected seam, so fake-`io` unit tests never create a real directory.
 */
export interface FetchIo {
  readonly run: GitRunner;
  readonly now: () => string; // ISO-8601
  readonly readStamp: (path: string) => Promise<string | null>; // null on ENOENT
  readonly writeStamp: (path: string, body: string) => Promise<void>;
  readonly ensureDir: (path: string) => Promise<void>;
}

export interface FetchedRepo {
  readonly repo: string;
  readonly dir: string;
  readonly commit: string;
}

export interface FetchOutcome {
  readonly fetched: FetchedRepo[];
  readonly skipped: Skipped[];
}

export type RemoteRef =
  | { readonly found: true; readonly sha: string }
  | { readonly found: false; readonly reason: "absent" | "unavailable"; readonly detail: string };

export interface FetchOptions {
  readonly repos: readonly RepoSource[];
  readonly ref: string;
  readonly cacheRoot: string; // absolute, resolved once
  readonly refresh: boolean;
  readonly io: FetchIo;
}

/** Shape of the sibling `.fetch.json` cache stamp. */
export interface FetchStamp {
  readonly ref: string;
  readonly commit: string;
  readonly resolvedAt: string;
}

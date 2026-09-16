/**
 * `applySync` / `checkStandards` — the ONLY module under `src/standards/`
 * that touches the filesystem (SPEC 6.1's purity seam). `plan.ts` decides
 * what would be written, `verify.ts` decides what observed bytes mean; this
 * module performs the write and gathers the bytes to observe, deciding
 * nothing itself.
 *
 * `applySync` writes NOTHING — not even an empty manifest — when
 * `plan.distributed` is empty (SPEC: "when every skill is blocked ... write
 * nothing"). An empty manifest would still be a materialised artifact on
 * disk, and the scenario says nothing is written, not "an empty package is
 * written".
 *
 * `checkStandards` hashes the EXACT bytes read off disk — the same hashing
 * function `plan.ts` uses to hash what it would write — so a byte-for-byte
 * match at sync time reproduces as a byte-for-byte match at check time, with
 * no normalisation anywhere in between (design's "what could go wrong": a
 * formatter's trailing-newline touch must count as drift, not be hashed
 * away).
 */

import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { hashContent } from "./plan.ts";
import type { SyncPlan } from "./plan.ts";
import { verifyStandards } from "./verify.ts";
import type { CheckResult, ObservedFile, SyncManifest } from "./verify.ts";

/** Relative to a target repository's root — never absolute, so a caller can
 * point `applySync`/`checkStandards` at any directory, including a fixture
 * this project owns. */
export const STANDARDS_DIR = ".claude/standards";
export const MANIFEST_FILE = "manifest.json";

export interface ApplyResult {
  /** Absolute paths written, sorted — empty when `plan.distributed` was
   * empty, matching SPEC's "nothing is written" exactly rather than writing
   * a manifest that lists zero files. */
  readonly written: readonly string[];
}

/**
 * Materialises `plan.distributed` under `<targetDir>/.claude/standards/`,
 * then writes `manifest.json` alongside it — but only when there is
 * something to distribute. `targetDir` is never inspected beyond writing
 * into it: this function does not read the target first, does not merge
 * with whatever might already be there, and does not delete anything a
 * previous sync (or a human) left behind outside the paths it writes.
 * Detecting what changed since the last sync is `check`'s job, not `sync`'s.
 */
export async function applySync(plan: SyncPlan, targetDir: string): Promise<ApplyResult> {
  if (plan.distributed.length === 0) {
    return { written: [] };
  }

  const standardsDir = join(targetDir, STANDARDS_DIR);
  const written: string[] = [];

  for (const file of plan.distributed) {
    const fullPath = join(standardsDir, file.path);
    await mkdir(join(fullPath, ".."), { recursive: true });
    await writeFile(fullPath, file.content, "utf8");
    written.push(fullPath);
  }

  const manifestPath = join(standardsDir, MANIFEST_FILE);
  await writeFile(manifestPath, `${JSON.stringify(plan.manifest, null, 2)}\n`, "utf8");
  written.push(manifestPath);

  return { written: written.sort((a, b) => a.localeCompare(b)) };
}

/** Every regular file under `dir` (recursively), path relative to `root` and
 * using `/` regardless of platform — a manifest built on one OS must compare
 * equal to files observed on another. */
async function collectFiles(root: string, dir: string, out: ObservedFile[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(root, fullPath, out);
    } else if (entry.isFile()) {
      const bytes = await readFile(fullPath, "utf8");
      const relPath = relative(root, fullPath).split(sep).join("/");
      out.push({ path: relPath, hash: hashContent(bytes) });
    }
  }
}

async function directoryExists(dir: string): Promise<boolean> {
  try {
    const info = await stat(dir);
    return info.isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/**
 * Gathers `<targetDir>/.claude/standards/`'s real state and hands it to the
 * pure `verifyStandards` for classification. This function's only
 * responsibility is I/O: whether the directory exists, what `manifest.json`
 * says (or that it is missing/unreadable), and what every other file
 * actually hashes to.
 */
export async function checkStandards(targetDir: string, currentTool: string): Promise<CheckResult> {
  const standardsDir = join(targetDir, STANDARDS_DIR);

  if (!(await directoryExists(standardsDir))) {
    return verifyStandards({ targetExists: false, manifest: null, observed: [], currentTool });
  }

  let manifest: SyncManifest | null = null;
  try {
    const raw = await readFile(join(standardsDir, MANIFEST_FILE), "utf8");
    manifest = JSON.parse(raw) as SyncManifest;
  } catch {
    manifest = null;
  }

  const observed: ObservedFile[] = [];
  await collectFiles(standardsDir, standardsDir, observed);
  const withoutManifest = observed.filter((f) => f.path !== MANIFEST_FILE);

  return verifyStandards({ targetExists: true, manifest, observed: withoutManifest, currentTool });
}

/** Exported for the fixture demonstration and for tests asserting "nothing
 * outside the target was touched" without reimplementing `rm`. */
export async function removeStandards(targetDir: string): Promise<void> {
  await rm(join(targetDir, STANDARDS_DIR), { recursive: true, force: true });
}

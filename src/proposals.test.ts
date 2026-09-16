/**
 * The CI workflow is proposed, never installed (SPEC 2.3, task 6.2).
 *
 * Nothing in this phase requires permissions over the organisation: the
 * workflow that would run `check` in CI is delivered as a file under
 * `proposals/`, and this project never writes a `.github/workflows/` file —
 * neither its own nor a cached clone's.
 */

import { describe, expect, test } from "bun:test";
import { access, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe("the proposed workflow exists under proposals/, never installed", () => {
  test("proposals/check-standards.yml exists", async () => {
    const path = join(REPO_ROOT, "proposals", "check-standards.yml");
    expect(await exists(path)).toBe(true);
  });

  test("this project's own .github/workflows/ carries no check-standards workflow", async () => {
    const workflowsDir = join(REPO_ROOT, ".github", "workflows");
    if (!(await exists(workflowsDir))) {
      // No workflows directory at all is trivially "not installed".
      return;
    }
    const entries = await readdir(workflowsDir);
    expect(entries).not.toContain("check-standards.yml");
  });

  test("no cached clone under .cache/ carries a .github/workflows/ file this change added", async () => {
    const cacheRoot = join(REPO_ROOT, ".cache");
    if (!(await exists(cacheRoot))) return;

    const entries = await readdir(cacheRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const workflowPath = join(cacheRoot, entry.name, ".github", "workflows", "check-standards.yml");
      expect(await exists(workflowPath)).toBe(false);
    }
  });
});

describe("the proposed workflow names the command it would gate (sanity, not a parser)", () => {
  test("its `run:` step invokes wazuh-ctx check, never wazuh-ctx sync", async () => {
    const path = join(REPO_ROOT, "proposals", "check-standards.yml");
    const content = await Bun.file(path).text();
    const runLines = content
      .split("\n")
      .filter((line) => line.trim().startsWith("run:"))
      .join("\n");

    expect(runLines).toContain("wazuh-ctx check");
    expect(runLines).not.toContain("wazuh-ctx sync");
  });
});

// Confirms `proposals/` itself is a real, ordinary directory — not something
// this test suite has to special-case.
describe("proposals/ is an ordinary directory", () => {
  test("stat succeeds", async () => {
    const info = await stat(join(REPO_ROOT, "proposals"));
    expect(info.isDirectory()).toBe(true);
  });
});

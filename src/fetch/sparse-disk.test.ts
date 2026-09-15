/**
 * On-disk proof that the sparse checkout is actually sparse (SPEC 1.2, task 12.1).
 *
 * `fetch.test.ts` proves *argv intent*: that `sparse-checkout set <paths>` is
 * issued with the right path set. It cannot prove what git put on disk,
 * because its runner is a fake. This file closes that gap by running the real
 * `createGitRunner()` against a real git binary and then walking the resulting
 * working tree.
 *
 * No network: the remote is a `file://` URL pointing at a throwaway repository
 * built in `tmpdir()`, with `uploadpack.allowFilter` enabled so the production
 * `--filter=blob:none` argument is exercised rather than sidestepped. That
 * keeps the default `bun test` run hermetic while still testing real git.
 *
 * Note on cone mode: `sparse-checkout init --cone` always materialises the
 * top-level files of the repository, in addition to the directories passed to
 * `sparse-checkout set`. That is git behaviour, not ours, and it is what makes
 * a root `package.json` or manifest reachable for a repo whose declared path
 * set is empty. The assertions below encode that boundary explicitly: declared
 * subtrees plus root files are allowed, every other subtree must be absent.
 */

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { cacheDirFor, cloneRepo, sparsePathsFor } from "./clone.ts";
import { createGitRunner } from "./git-runner.ts";
import type { GitRunner } from "./types.ts";

const REF = "5.0.0";

/**
 * Files laid down in the throwaway origin. The shape mirrors the real
 * `wazuh-indexer-plugins` layout closely enough for the SPEC 1.2 path set to
 * mean the same thing here as it does there.
 */
const ORIGIN_FILES: Readonly<Record<string, string>> = {
  // Inside the declared indexer path set.
  "plugins/setup/src/main/resources/templates/states/agent-config.json": "{}\n",
  "plugins/content-manager/src/main/resources/mappings/alerts.json": "{}\n",
  "wcs/network/docs/fields.csv": "name,type\n",
  // Inside the declared platform path set.
  "src/plugins/navigation/opensearch_dashboards.json": '{"id":"navigation"}\n',
  "src/plugins/data/opensearch_dashboards.json": '{"id":"data"}\n',
  // Outside it: full plugin source, docs, and an unrelated plugin subtree.
  "plugins/setup/src/main/java/Setup.java": "class Setup {}\n",
  "docs/README.md": "docs\n",
  "plugins/unrelated/source.ts": "export const x = 1;\n",
  "plugins/main/opensearch_dashboards.json": '{"id":"wazuh"}\n',
  "src/core/server/index.ts": "export const core = 1;\n",
  // Single-plugin shape: code at the root, no plugins/ directory.
  "server/routes/index.ts": "export const routes = [];\n",
  "public/components/app.tsx": "export const App = () => null;\n",
  "common/constants.ts": "export const X = 'wazuh-x*';\n",
  // Top-level files: cone mode always checks these out.
  "build.gradle": "// root\n",
  "package.json": '{"name":"origin"}\n',
};

/** Subtrees that must never appear on disk for the indexer path set. */
const FORBIDDEN_SUBTREES = ["docs", "plugins/unrelated", "plugins/setup/src/main/java"] as const;

async function runOrThrow(run: GitRunner, argv: readonly string[], cwd: string): Promise<void> {
  const result = await run({ argv, cwd });
  if (result.code !== 0) {
    throw new Error(`git ${argv.join(" ")} failed (${result.code}): ${result.stderr.trim()}`);
  }
}

/** Builds a local origin repository with `REF` as its only branch. */
async function createOrigin(run: GitRunner, root: string): Promise<string> {
  const origin = join(root, "origin");
  await mkdir(origin, { recursive: true });

  await runOrThrow(run, ["init", "--quiet", "--initial-branch", REF, "."], origin);
  await runOrThrow(run, ["config", "user.email", "test@example.invalid"], origin);
  await runOrThrow(run, ["config", "user.name", "wazuh-ctx test"], origin);
  // Without this, a `--filter=blob:none` clone over file:// is silently
  // downgraded to a full clone, and the test would stop exercising the real
  // production argv.
  await runOrThrow(run, ["config", "uploadpack.allowFilter", "true"], origin);

  for (const [path, body] of Object.entries(ORIGIN_FILES)) {
    const absolute = join(origin, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, body, "utf8");
  }

  await runOrThrow(run, ["add", "--all"], origin);
  await runOrThrow(run, ["commit", "--quiet", "--message", "fixture"], origin);

  return origin;
}

/** Every file present in the working tree, `.git/` excluded, as `/`-joined paths. */
async function filesOnDisk(root: string): Promise<string[]> {
  const found: string[] = [];

  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
      } else {
        found.push(relative(root, absolute).split(sep).join("/"));
      }
    }
  }

  await walk(root);
  return found.sort();
}

/** True when `path` is a top-level file — cone mode always checks those out. */
function isRootFile(path: string): boolean {
  return !path.includes("/");
}

describe("sparse checkout, verified on disk (SPEC 1.2)", () => {
  test(
    "an indexer clone materialises the declared paths and nothing outside them",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "wazuh-ctx-sparse-"));
      const run = createGitRunner();

      try {
        const origin = await createOrigin(run, root);
        const cacheRoot = join(root, "cache");
        await mkdir(cacheRoot, { recursive: true });

        const sparsePaths = sparsePathsFor("indexer");
        const dir = cacheDirFor(cacheRoot, "wazuh-indexer-plugins", REF);

        const outcome = await cloneRepo(run, cacheRoot, dir, `file://${origin}`, REF, sparsePaths);
        expect(outcome.ok).toBe(true);

        const onDisk = await filesOnDisk(dir);

        // The declared paths did land — otherwise "nothing outside them" would
        // be trivially satisfied by an empty checkout.
        expect(onDisk).toContain(
          "plugins/setup/src/main/resources/templates/states/agent-config.json",
        );
        expect(onDisk).toContain("plugins/content-manager/src/main/resources/mappings/alerts.json");
        expect(onDisk).toContain("wcs/network/docs/fields.csv");

        // Nothing outside the declared subtrees, root files aside.
        const unexpected = onDisk.filter(
          (path) => !isRootFile(path) && !sparsePaths.some((allowed) => path.startsWith(`${allowed}/`)),
        );
        expect(unexpected).toEqual([]);

        for (const subtree of FORBIDDEN_SUBTREES) {
          expect(onDisk.some((path) => path.startsWith(`${subtree}/`))).toBe(false);
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    60_000,
  );

  test(
    "a platform clone materialises src/plugins and nothing outside it",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "wazuh-ctx-sparse-platform-"));
      const run = createGitRunner();

      try {
        const origin = await createOrigin(run, root);
        const cacheRoot = join(root, "cache");
        await mkdir(cacheRoot, { recursive: true });

        const sparsePaths = sparsePathsFor("platform");
        expect(sparsePaths).toEqual(["src/plugins"]);

        const dir = cacheDirFor(cacheRoot, "wazuh-dashboard", REF);
        const outcome = await cloneRepo(run, cacheRoot, dir, `file://${origin}`, REF, sparsePaths);
        expect(outcome.ok).toBe(true);

        const onDisk = await filesOnDisk(dir);

        // The core plugin manifests are the whole point: without them every
        // wazuh-native dependency edge into the core has no destination.
        expect(onDisk).toContain("src/plugins/navigation/opensearch_dashboards.json");
        expect(onDisk).toContain("src/plugins/data/opensearch_dashboards.json");

        // `src/core` is inside `src/` but outside the declared set, so it
        // proves the path set is `src/plugins` and not `src`.
        expect(onDisk.some((path) => path.startsWith("src/core/"))).toBe(false);

        const unexpected = onDisk.filter(
          (path) => !isRootFile(path) && !sparsePaths.some((allowed) => path.startsWith(`${allowed}/`)),
        );
        expect(unexpected).toEqual([]);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    60_000,
  );
});

describe("dashboard checkouts cover both repository shapes (SPEC 1.2)", () => {
  test(
    "a single-plugin repo lands server/ and public/, not just root files",
    async () => {
      // This is the gap being closed. `sparsePathsFor("dashboard")` used to be
      // ["plugins"], which the five single-plugin forks do not have — so cone
      // mode left them ~20 root files and no source at all, and a declared path
      // matching nothing looked exactly like a repository containing nothing.
      const root = await mkdtemp(join(tmpdir(), "wazuh-ctx-sparse-dash-"));
      const run = createGitRunner();

      try {
        const origin = await createOrigin(run, root);
        const cacheRoot = join(root, "cache");
        await mkdir(cacheRoot, { recursive: true });

        const sparsePaths = sparsePathsFor("dashboard");
        const dir = cacheDirFor(cacheRoot, "wazuh-dashboard-alerting", REF);

        const outcome = await cloneRepo(run, cacheRoot, dir, `file://${origin}`, REF, sparsePaths);
        expect(outcome.ok).toBe(true);

        const onDisk = await filesOnDisk(dir);
        expect(onDisk).toContain("server/routes/index.ts");
        expect(onDisk).toContain("public/components/app.tsx");
        expect(onDisk).toContain("common/constants.ts");

        // And the monorepo path still works from the same set.
        expect(onDisk).toContain("plugins/main/opensearch_dashboards.json");

        // Still nothing outside the declared set, root files aside.
        const unexpected = onDisk.filter(
          (path) => !isRootFile(path) && !sparsePaths.some((allowed) => path.startsWith(`${allowed}/`)),
        );
        expect(unexpected).toEqual([]);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    60_000,
  );

  test(
    "a declared path the repository does not have is simply absent, not an error",
    async () => {
      // Cone mode ignores a path a repo lacks. That is what lets one path set
      // serve both shapes — and it is also how the original gap stayed hidden,
      // so it is pinned rather than assumed.
      const root = await mkdtemp(join(tmpdir(), "wazuh-ctx-sparse-absent-"));
      const run = createGitRunner();

      try {
        const origin = await createOrigin(run, root);
        const cacheRoot = join(root, "cache");
        await mkdir(cacheRoot, { recursive: true });

        const dir = cacheDirFor(cacheRoot, "declares-nothing", REF);
        const outcome = await cloneRepo(run, cacheRoot, dir, `file://${origin}`, REF, [
          "does-not-exist",
          "server",
        ]);

        expect(outcome.ok).toBe(true);
        const onDisk = await filesOnDisk(dir);
        expect(onDisk).toContain("server/routes/index.ts");
        expect(onDisk.some((p) => p.startsWith("does-not-exist/"))).toBe(false);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    60_000,
  );
});

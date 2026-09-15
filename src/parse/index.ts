/**
 * `toParseTargets` + `parseFetchedRepos` — dispatches manifest vs indexer
 * parsing by `RepoKind`, and is the composition point for parse/, symmetric
 * with `fetch/index.ts` (design decision: kept out of `cli.ts`).
 */

import type { FetchedRepo } from "../fetch/types.ts";
import type { IndexTemplate, RawCoreRepo, RawPluginFacts, WcsModule } from "../matrix/types.ts";
import type { RepoSource } from "../sources.ts";
import { parsePlatformRepo } from "./core-plugins.ts";
import { parseIndexerArtifacts } from "./indexer.ts";
import { parseRepoManifests } from "./manifest.ts";
import type { ParsedRepo, ParseTarget } from "./types.ts";

export function toParseTargets(
  sources: { readonly repos: readonly RepoSource[] },
  fetched: readonly FetchedRepo[],
): ParseTarget[] {
  const kindByName = new Map(sources.repos.map((repo) => [repo.name, repo.kind]));

  const targets: ParseTarget[] = [];
  for (const entry of fetched) {
    const kind = kindByName.get(entry.repo);
    if (kind === undefined) continue; // defensive: fetched only ever names a repo sources.yml lists
    targets.push({ repo: entry.repo, repoKind: kind, dir: entry.dir, commit: entry.commit });
  }
  return targets;
}

export async function parseFetchedRepos(targets: readonly ParseTarget[]): Promise<ParsedRepo> {
  const facts: RawPluginFacts[] = [];
  const coreRepos: RawCoreRepo[] = [];
  let templates: IndexTemplate[] = [];
  let wcsModules: WcsModule[] = [];

  for (const target of targets) {
    if (target.repoKind === "indexer") {
      const result = await parseIndexerArtifacts(target);
      templates = templates.concat(result.templates);
      wcsModules = wcsModules.concat(result.wcsModules);
    } else if (target.repoKind === "platform") {
      // A platform repo carries no root manifest, so parseRepoManifests would
      // legitimately find nothing. Its content is the core plugin tree.
      coreRepos.push(await parsePlatformRepo(target));
    } else {
      facts.push(...(await parseRepoManifests(target)));
    }
  }

  facts.sort((a, b) => a.manifestPath.localeCompare(b.manifestPath));
  coreRepos.sort((a, b) => a.repo.localeCompare(b.repo));
  templates.sort((a, b) => a.path.localeCompare(b.path));
  wcsModules.sort((a, b) => a.name.localeCompare(b.name));

  return { facts, coreRepos, templates, wcsModules };
}

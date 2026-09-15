/**
 * `toParseTargets` + `parseFetchedRepos` — dispatches manifest vs indexer
 * parsing by `RepoKind`, and is the composition point for parse/, symmetric
 * with `fetch/index.ts` (design decision: kept out of `cli.ts`).
 */

import type { FetchedRepo } from "../fetch/types.ts";
import type { IndexTemplate, RawPluginFacts, WcsModule } from "../matrix/types.ts";
import type { RepoSource } from "../sources.ts";
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
  let templates: IndexTemplate[] = [];
  let wcsModules: WcsModule[] = [];

  for (const target of targets) {
    if (target.repoKind === "indexer") {
      const result = await parseIndexerArtifacts(target);
      templates = templates.concat(result.templates);
      wcsModules = wcsModules.concat(result.wcsModules);
    } else {
      facts.push(...(await parseRepoManifests(target)));
    }
  }

  facts.sort((a, b) => a.manifestPath.localeCompare(b.manifestPath));
  templates.sort((a, b) => a.path.localeCompare(b.path));
  wcsModules.sort((a, b) => a.name.localeCompare(b.name));

  return { facts, templates, wcsModules };
}

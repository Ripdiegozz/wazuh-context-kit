/**
 * Types for src/parse/ — the only module touching the filesystem for
 * `wazuh/*` repository content (SPEC 6.1).
 */

import type {
  IndexTemplate,
  RawCoreRepo,
  RawPluginFacts,
  RepoKind,
  WcsModule,
} from "../matrix/types.ts";

export interface ParseTarget {
  readonly repo: string;
  readonly repoKind: RepoKind;
  readonly dir: string;
  readonly commit: string;
}

export interface ParsedRepo {
  facts: RawPluginFacts[];
  /** One entry per `platform` repository. Empty when none is declared. */
  coreRepos: RawCoreRepo[];
  templates: IndexTemplate[];
  wcsModules: WcsModule[];
}

/**
 * The ref gate and startup sequencing (design "`schema`: the refusal gates
 * run in order", steps 3-5): resolve the world, compare refs, announce.
 *
 * Steps 1-2 (load, verify) live in `dataset.ts`; this module picks up from
 * step 3 with an already-loaded, already-verified `MatrixJson`. Step 6
 * (resource registration) is unit 6's `server.ts`.
 *
 * Three distinct outcomes fall out of comparing the dataset's `ref` against
 * the working tree's branch (design table), and collapsing any two of them is
 * exactly the bug this module exists to not have:
 *
 * | Situation                        | Behaviour                              |
 * | --------------------------------- | --------------------------------------- |
 * | branch !== dataset ref             | refuse, name both                       |
 * | detached HEAD, no branch           | refuse, say the branch is undeterminable |
 * | `cwd` outside any known repo       | serve, world reported unknown           |
 *
 * The third case serves because the ref check is about the *consumer's*
 * position, and a consumer outside the corpus has no position to contradict
 * -- but it must never be told a world it does not have (`resolveWorld`
 * already reports `"unknown"` for it).
 */

import type { GitRunner } from "../fetch/types.ts";
import type { MatrixJson } from "../matrix/types.ts";
import type { Sources } from "../sources.ts";
import { resolveWorld, type WorldResolution } from "./world.ts";

export interface RefMismatch {
  readonly ok: false;
  readonly reason: "ref-mismatch";
  readonly datasetRef: string;
  readonly branch: string;
  readonly message: string;
}

export interface BranchUndeterminable {
  readonly ok: false;
  readonly reason: "branch-undeterminable";
  readonly message: string;
}

export type RefGateRefusal = RefMismatch | BranchUndeterminable;

export interface StartupServed {
  readonly ok: true;
  readonly world: WorldResolution;
}

export type StartupResult = StartupServed | RefGateRefusal;

/** Called with the resolved world exactly once, only on a served startup. */
export type WorldAnnouncer = (world: WorldResolution) => void;

export interface StartupOptions {
  readonly git: GitRunner;
  readonly cwd: string;
  readonly sources: Sources;
  readonly matrix: MatrixJson;
  readonly allowRefMismatch: boolean;
  /**
   * Injected so tests can observe *when* it runs relative to everything
   * else, rather than asserting on a return value (SPEC "The server
   * announces the world before the first query is answered").
   */
  readonly announce: WorldAnnouncer;
}

/**
 * Steps 3-5 of the startup sequence (design), plus the announce call.
 *
 * `announce` runs synchronously, inside this function, before the returned
 * promise resolves with a served result -- so by the time a caller is
 * holding `{ ok: true }` the world has already been announced. It never runs
 * on a refusal: there is nothing to serve, so there is nothing to announce
 * ahead of.
 */
export async function runStartup(options: StartupOptions): Promise<StartupResult> {
  const world = await resolveWorld(options.git, options.cwd, options.sources, options.matrix);

  if (world.recognised) {
    const branch = world.branch;

    if (branch === null || branch.kind === "detached") {
      return {
        ok: false,
        reason: "branch-undeterminable",
        message:
          "the working tree's branch could not be determined (detached HEAD) -- cannot compare it to the dataset's ref",
      };
    }

    if (branch.branch !== options.matrix.ref && !options.allowRefMismatch) {
      return {
        ok: false,
        reason: "ref-mismatch",
        datasetRef: options.matrix.ref,
        branch: branch.branch,
        message:
          `dataset ref ${options.matrix.ref} does not match working-tree branch ${branch.branch} ` +
          "-- pass --allow-ref-mismatch to serve it anyway",
      };
    }
  }

  options.announce(world);
  return { ok: true, world };
}

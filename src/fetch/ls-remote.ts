/**
 * `git ls-remote --heads` — the pre-clone ref check (SPEC 1.4).
 *
 * Deliberately standalone so a future SPEC 5.4 regeneration cycle can import
 * `resolveRemoteRef` alone, without pulling in the rest of fetch/.
 */

import type { GitRunner, RemoteRef } from "./types.ts";

function firstLine(text: string): string {
  return text.split("\n")[0]?.trim() ?? "";
}

export async function resolveRemoteRef(
  run: GitRunner,
  url: string,
  ref: string,
  cwd: string,
): Promise<RemoteRef> {
  const result = await run({ argv: ["ls-remote", "--heads", url, ref], cwd });

  if (result.code !== 0) {
    const detail = firstLine(result.stderr) || `git ls-remote exited with code ${result.code}`;
    return { found: false, reason: "unavailable", detail };
  }

  const line = result.stdout.trim();
  if (line.length === 0) {
    return { found: false, reason: "absent", detail: `no branch matching '${ref}'` };
  }

  const sha = line.split(/\s+/)[0];
  if (!sha) {
    return { found: false, reason: "absent", detail: `no branch matching '${ref}'` };
  }

  return { found: true, sha };
}

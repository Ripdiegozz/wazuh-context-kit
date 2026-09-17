/**
 * Thin fetch client for the local `wazuh-ctx serve` API only (127.0.0.1,
 * proxied through `/api` in dev by vite.config.ts). No other network target
 * exists in this app.
 */
import type {
  MatrixResponseBody,
  UnknownsResponseBody,
  CrosscheckView,
  PostDecisionsRequest,
  PostAnnotationsRequest,
  SaveResponseBody,
  Decision,
  Annotation,
  DecisionsTarget,
  DecisionsResponseBody,
  AnnotationsResponseBody,
  RefusedBody,
} from "./types";

export class ApiError extends Error {
  readonly status: number;
  readonly body: RefusedBody;
  constructor(status: number, body: RefusedBody) {
    super(body.message ?? `request failed with status ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  const body = await res.json();
  if (res.status !== 200) throw new ApiError(res.status, body as RefusedBody);
  return body as T;
}

async function postJson<Req, Res>(path: string, payload: Req): Promise<Res> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (res.status !== 200) throw new ApiError(res.status, body as RefusedBody);
  return body as Res;
}

export const api = {
  getMatrix: () => getJson<MatrixResponseBody>("/api/matrix"),
  getUnknowns: () => getJson<UnknownsResponseBody>("/api/unknowns"),
  getCrosscheck: () => getJson<CrosscheckView>("/api/crosscheck"),
  getDecisions: (target: DecisionsTarget) =>
    getJson<DecisionsResponseBody>(`/api/decisions?target=${encodeURIComponent(target)}`),
  getAnnotations: () => getJson<AnnotationsResponseBody>("/api/annotations"),
  postDecisions: (req: PostDecisionsRequest) =>
    postJson<PostDecisionsRequest, SaveResponseBody<Decision>>("/api/decisions", req),
  postAnnotations: (req: PostAnnotationsRequest) =>
    postJson<PostAnnotationsRequest, SaveResponseBody<Annotation>>("/api/annotations", req),
};

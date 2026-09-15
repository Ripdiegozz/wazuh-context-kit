/**
 * `fetchClusterState` (SPEC 1.10, "the comparison reaches the cluster
 * read-only").
 *
 * Every test injects a fake `FetchLike`, modelled on the same discipline
 * `src/fetch/types.ts` uses for `GitRunner`: the transport is the one seam
 * through which this module reaches the network, and a fake here means "zero
 * network invocations" is something a test can actually assert, not just
 * claim in a docblock.
 */

import { describe, expect, test } from "bun:test";
import { fetchClusterState } from "./client.ts";
import { IndexerError } from "./types.ts";
import type { FetchLike, HttpResponseLike, RecordedRequest } from "./types.ts";

const URL = "https://indexer.example.internal:9200";

function jsonResponse(status: number, body: unknown): HttpResponseLike {
  return { status, json: async () => body };
}

function recordingTransport(
  responder: (url: string) => HttpResponseLike,
): { transport: FetchLike; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const transport: FetchLike = async (url, init) => {
    requests.push({ method: init.method, url });
    return responder(url);
  };
  return { transport, requests };
}

const CAT_INDICES_BODY = [{ index: "wazuh-alerts-4.x-2026.01.01" }, { index: ".kibana_1" }];
const DATA_STREAM_BODY = {
  data_streams: [
    {
      name: "wazuh-states-vulnerabilities",
      template: "wazuh-states-vulnerabilities",
      indices: [{ index_name: ".ds-wazuh-states-vulnerabilities-000001" }],
    },
  ],
};
const INDEX_TEMPLATE_BODY = {
  index_templates: [
    { name: "wazuh-alerts", index_template: { index_patterns: ["wazuh-alerts-4.x-*"] } },
  ],
};

function respondToKnownEndpoints(url: string): HttpResponseLike {
  if (url.includes("_cat/indices")) return jsonResponse(200, CAT_INDICES_BODY);
  if (url.includes("_data_stream")) return jsonResponse(200, DATA_STREAM_BODY);
  if (url.includes("_index_template")) return jsonResponse(200, INDEX_TEMPLATE_BODY);
  throw new Error(`unexpected URL in test transport: ${url}`);
}

describe("fetchClusterState — the three endpoints, read-only", () => {
  test("requests exactly the three declared endpoints, all GET", async () => {
    const { transport, requests } = recordingTransport(respondToKnownEndpoints);

    await fetchClusterState(transport, URL, undefined, { skipTlsVerify: false });

    expect(requests).toHaveLength(3);
    expect(requests.every((r) => r.method === "GET")).toBe(true);
    expect(requests.some((r) => r.url.includes("_cat/indices"))).toBe(true);
    expect(requests.some((r) => r.url.includes("_data_stream"))).toBe(true);
    expect(requests.some((r) => r.url.includes("_index_template"))).toBe(true);
  });

  test("no recorded request ever uses a state-changing method", async () => {
    const { transport, requests } = recordingTransport(respondToKnownEndpoints);

    await fetchClusterState(transport, URL, undefined, { skipTlsVerify: false });

    for (const request of requests) {
      expect(["POST", "PUT", "DELETE", "PATCH"]).not.toContain(request.method);
    }
  });

  test("the returned RawClusterState carries the raw shapes unchanged", async () => {
    const { transport } = recordingTransport(respondToKnownEndpoints);

    const state = await fetchClusterState(transport, URL, undefined, { skipTlsVerify: false });

    expect(state.indices).toEqual([
      { name: "wazuh-alerts-4.x-2026.01.01" },
      { name: ".kibana_1" },
    ]);
    expect(state.dataStreams).toEqual([
      {
        name: "wazuh-states-vulnerabilities",
        template: "wazuh-states-vulnerabilities",
        backingIndices: [".ds-wazuh-states-vulnerabilities-000001"],
      },
    ]);
    expect(state.indexTemplates).toEqual([
      { name: "wazuh-alerts", indexPatterns: ["wazuh-alerts-4.x-*"] },
    ]);
  });

  test("expand_wildcards=all is requested for _cat/indices, and not for _data_stream", async () => {
    const { transport, requests } = recordingTransport(respondToKnownEndpoints);

    await fetchClusterState(transport, URL, undefined, { skipTlsVerify: false });

    const catIndicesRequest = requests.find((r) => r.url.includes("_cat/indices"));
    const dataStreamRequest = requests.find((r) => r.url.includes("_data_stream"));

    expect(catIndicesRequest?.url).toContain("expand_wildcards=all");
    expect(dataStreamRequest?.url).not.toContain("expand_wildcards");
  });
});

describe("fetchClusterState — failure taxonomy", () => {
  test("a 401 surfaces as an auth error naming both env vars, and no credential value", async () => {
    const transport: FetchLike = async () => jsonResponse(401, {});

    const promise = fetchClusterState(
      transport,
      URL,
      { username: "admin", password: "super-secret-value" },
      { skipTlsVerify: false },
    );

    await expect(promise).rejects.toThrow(IndexerError);
    try {
      await fetchClusterState(
        transport,
        URL,
        { username: "admin", password: "super-secret-value" },
        { skipTlsVerify: false },
      );
      throw new Error("expected fetchClusterState to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(IndexerError);
      expect((error as IndexerError).code).toBe("auth");
      expect((error as IndexerError).message).toContain("WAZUH_CTX_INDEXER_USERNAME");
      expect((error as IndexerError).message).toContain("WAZUH_CTX_INDEXER_PASSWORD");
      expect((error as IndexerError).message).not.toContain("super-secret-value");
    }
  });

  test("a TLS verification code surfaces as a certificate error naming the flag", async () => {
    const transport: FetchLike = async () => {
      const error = new TypeError("unable to verify the first certificate");
      (error as NodeJS.ErrnoException).code = "UNABLE_TO_VERIFY_LEAF_SIGNATURE";
      throw error;
    };

    try {
      await fetchClusterState(transport, URL, undefined, { skipTlsVerify: false });
      throw new Error("expected fetchClusterState to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(IndexerError);
      expect((error as IndexerError).code).toBe("certificate");
      expect((error as IndexerError).message).toContain("--indexer-skip-tls-verify");
    }
  });

  test("a refused connection surfaces distinguishably as unreachable, naming the URL", async () => {
    const transport: FetchLike = async () => {
      const error = new Error("connect ECONNREFUSED");
      (error as NodeJS.ErrnoException).code = "ECONNREFUSED";
      throw error;
    };

    try {
      await fetchClusterState(transport, URL, undefined, { skipTlsVerify: false });
      throw new Error("expected fetchClusterState to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(IndexerError);
      expect((error as IndexerError).code).toBe("unreachable");
      expect((error as IndexerError).message).toContain(URL);
    }
  });

  test("a timeout surfaces distinguishably from a refused connection", async () => {
    const transport: FetchLike = async () => {
      const error = new DOMException("The operation timed out.", "TimeoutError");
      throw error;
    };

    try {
      await fetchClusterState(transport, URL, undefined, { skipTlsVerify: false });
      throw new Error("expected fetchClusterState to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(IndexerError);
      expect((error as IndexerError).code).toBe("timeout");
    }
  });
});

describe("IndexerError messages carry no prefix of their own", () => {
  // Defect found against the real cluster: `wazuh-ctx crosscheck: wazuh-ctx:
  // certificate verification failed for ...` -- doubled. `src/cli.ts` already
  // prefixes every printed error with `wazuh-ctx crosscheck: `; the client
  // must not also prefix its own message with `wazuh-ctx:`, or every failure
  // reads twice-labelled.
  test("neither the auth nor the certificate message starts with wazuh-ctx:", async () => {
    const authTransport: FetchLike = async () => jsonResponse(401, {});
    const certTransport: FetchLike = async () => {
      const error = new TypeError("unable to verify the first certificate");
      (error as NodeJS.ErrnoException).code = "UNABLE_TO_VERIFY_LEAF_SIGNATURE";
      throw error;
    };

    for (const transport of [authTransport, certTransport]) {
      try {
        await fetchClusterState(transport, URL, undefined, { skipTlsVerify: false });
        throw new Error("expected fetchClusterState to reject");
      } catch (error) {
        expect((error as IndexerError).message.startsWith("wazuh-ctx:")).toBe(false);
      }
    }
  });
});

describe("fetchClusterState — TLS override is scoped, never process-global", () => {
  test("NODE_TLS_REJECT_UNAUTHORIZED is never set by the client, either way", async () => {
    const before = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    const { transport } = recordingTransport(respondToKnownEndpoints);

    await fetchClusterState(transport, URL, undefined, { skipTlsVerify: true });
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBe(before);

    await fetchClusterState(transport, URL, undefined, { skipTlsVerify: false });
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBe(before);
  });

  test("the per-request tls override is present only when skipTlsVerify is set", async () => {
    const seenTlsFlags: (boolean | undefined)[] = [];
    const transport: FetchLike = async (url, init) => {
      seenTlsFlags.push(init.tls?.rejectUnauthorized);
      return respondToKnownEndpoints(url);
    };

    await fetchClusterState(transport, URL, undefined, { skipTlsVerify: true });
    expect(seenTlsFlags.every((flag) => flag === false)).toBe(true);

    seenTlsFlags.length = 0;
    await fetchClusterState(transport, URL, undefined, { skipTlsVerify: false });
    expect(seenTlsFlags.every((flag) => flag === undefined)).toBe(true);
  });
});

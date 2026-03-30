import { describe, expect, test } from "bun:test";

import { buildPublishHeaders, publishState } from "./avax-fuji-bootstrap.mjs";

function normalizeHeaders(headers: unknown): Record<string, string> {
  if (headers instanceof Headers) {
    return Object.fromEntries(Array.from(headers.entries()));
  }
  if (headers && typeof headers === "object") {
    return headers as Record<string, string>;
  }
  return {};
}

describe("avax fuji bootstrap publish behavior", () => {
  test("adds arena write key only when provided", () => {
    const keyed = buildPublishHeaders("secret");
    const unkeyed = buildPublishHeaders();

    expect(keyed["content-type"]).toBe("application/json");
    expect(keyed["x-arena-write-key"]).toBe("secret");
    expect(unkeyed).not.toHaveProperty("x-arena-write-key");
    expect(unkeyed["content-type"]).toBe("application/json");
  });

  test("sends publish headers in publishState request", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const previousFetch = globalThis.fetch;

    globalThis.fetch = ((url: string, init: RequestInit = {}) => {
      calls.push({ url, headers: normalizeHeaders(init.headers) });
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }) as typeof fetch;

    try {
      await publishState(
        {
          keeperUrl: "http://127.0.0.1:5555",
          publishKey: "header-token",
        },
        "test-duel",
        "0xabc",
      );
      await publishState(
        {
          keeperUrl: "http://127.0.0.1:5555",
          publishKey: undefined,
        },
        "test-duel",
        "0xdef",
      );
    } finally {
      globalThis.fetch = previousFetch;
    }

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe("http://127.0.0.1:5555/api/streaming/state/publish");
    expect(calls[1].url).toBe("http://127.0.0.1:5555/api/streaming/state/publish");
    expect(calls[0].headers["x-arena-write-key"]).toBe("header-token");
    expect(calls[1].headers["x-arena-write-key"]).toBeUndefined();
    expect(calls[1].headers["content-type"]).toBe("application/json");
  });
});

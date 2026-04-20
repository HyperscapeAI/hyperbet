import { describe, expect, test } from "bun:test";
import { resolveResultCatchupBearerToken } from "./resultCatchupAuth";

describe("resolveResultCatchupBearerToken", () => {
  test("prefers the dedicated Hyperscape result lookup token", () => {
    expect(
      resolveResultCatchupBearerToken({
        NODE_ENV: "production",
        HYPERSCAPES_RESULT_LOOKUP_BEARER_TOKEN: " result-secret ",
        STREAMING_ORACLE_PROOF_TOKEN: "oracle-secret",
        BETTING_FEED_ACCESS_TOKEN: "feed-secret",
      }),
    ).toEqual({
      token: "result-secret",
      source: "hyperscapes-result",
    });
  });

  test("accepts the provider-side oracle proof alias", () => {
    expect(
      resolveResultCatchupBearerToken({
        NODE_ENV: "production",
        STREAMING_ORACLE_PROOF_TOKEN: "oracle-secret",
        BETTING_FEED_ACCESS_TOKEN: "feed-secret",
      }),
    ).toEqual({
      token: "oracle-secret",
      source: "oracle-proof-alias",
    });
  });

  test("does not fall back to broad feed tokens in production", () => {
    expect(
      resolveResultCatchupBearerToken({
        NODE_ENV: "production",
        BETTING_FEED_ACCESS_TOKEN: "feed-secret",
        STREAM_STATE_SOURCE_BEARER_TOKEN: "stream-secret",
      }),
    ).toEqual({
      token: null,
      source: null,
    });
  });

  test("keeps broad-token fallbacks outside production for local migration", () => {
    expect(
      resolveResultCatchupBearerToken({
        NODE_ENV: "development",
        BETTING_FEED_ACCESS_TOKEN: "feed-secret",
        STREAM_STATE_SOURCE_BEARER_TOKEN: "stream-secret",
      }),
    ).toEqual({
      token: "feed-secret",
      source: "betting-feed",
    });

    expect(
      resolveResultCatchupBearerToken({
        NODE_ENV: "test",
        STREAM_STATE_SOURCE_BEARER_TOKEN: "stream-secret",
      }),
    ).toEqual({
      token: "stream-secret",
      source: "stream-state",
    });
  });
});

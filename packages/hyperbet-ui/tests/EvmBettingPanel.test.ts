import { describe, expect, test } from "bun:test";

import { shouldSkipEvmRpcRefresh } from "../src/components/EvmBettingPanel";

describe("EvmBettingPanel RPC refresh backoff", () => {
  test("skips all RPC reads while the backoff window is active", () => {
    expect(shouldSkipEvmRpcRefresh(2_000, 1_999)).toBe(true);
    expect(shouldSkipEvmRpcRefresh(2_000, 2_000)).toBe(false);
    expect(shouldSkipEvmRpcRefresh(2_000, 2_001)).toBe(false);
  });
});

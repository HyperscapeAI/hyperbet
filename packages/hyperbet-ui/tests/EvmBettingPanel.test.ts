import { describe, expect, test } from "bun:test";

import {
  deriveEvmPanelBaseStatus,
  shouldApplyEvmPanelBaseStatus,
  shouldSkipEvmRpcRefresh,
} from "../src/components/EvmBettingPanel";

describe("EvmBettingPanel RPC refresh backoff", () => {
  test("skips all RPC reads while the backoff window is active", () => {
    expect(shouldSkipEvmRpcRefresh(2_000, 1_999)).toBe(true);
    expect(shouldSkipEvmRpcRefresh(2_000, 2_000)).toBe(false);
    expect(shouldSkipEvmRpcRefresh(2_000, 2_001)).toBe(false);
  });

  test("derives base status from parity before lifecycle before fallback", () => {
    expect(
      deriveEvmPanelBaseStatus({
        parityStatusLabel: "Betting open",
        lifecycleStatusLabel: "Open on chain",
        fallback: "Waiting",
      }),
    ).toBe("Betting open");
    expect(
      deriveEvmPanelBaseStatus({
        parityStatusLabel: null,
        lifecycleStatusLabel: "Open on chain",
        fallback: "Waiting",
      }),
    ).toBe("Open on chain");
    expect(
      deriveEvmPanelBaseStatus({
        parityStatusLabel: null,
        lifecycleStatusLabel: null,
        fallback: "Waiting",
      }),
    ).toBe("Waiting");
  });

  test("applies local base status during backoff without clobbering transient status", () => {
    expect(shouldApplyEvmPanelBaseStatus("base")).toBe(true);
    expect(shouldApplyEvmPanelBaseStatus("transient")).toBe(false);
    expect(shouldApplyEvmPanelBaseStatus("transient", true)).toBe(true);
  });
});

import { describe, expect, test } from "bun:test";

import {
  MAX_LAUNCH_TRADE_FEE_BPS,
  MAX_LAUNCH_WINNINGS_FEE_BPS,
  resolveApprovedLaunchFeePolicy,
  resolveLaunchFeePolicy,
} from "./feePolicy";

describe("SOL launch fee policy", () => {
  test("uses the documented launch defaults", () => {
    expect(resolveLaunchFeePolicy({})).toEqual({
      tradeTreasuryFeeBps: 100,
      tradeMarketMakerFeeBps: 100,
      winningsMarketMakerFeeBps: 200,
    });
  });

  test("accepts the fairness guardrails at their boundaries", () => {
    expect(
      resolveLaunchFeePolicy({
        tradeTreasuryFeeBps: 1,
        tradeMarketMakerFeeBps: MAX_LAUNCH_TRADE_FEE_BPS - 1,
        winningsMarketMakerFeeBps: MAX_LAUNCH_WINNINGS_FEE_BPS,
      }),
    ).toEqual({
      tradeTreasuryFeeBps: 1,
      tradeMarketMakerFeeBps: MAX_LAUNCH_TRADE_FEE_BPS - 1,
      winningsMarketMakerFeeBps: MAX_LAUNCH_WINNINGS_FEE_BPS,
    });
  });

  test.each([
    [{ tradeTreasuryFeeBps: 0 }, "greater than zero"],
    [{ tradeTreasuryFeeBps: -1 }, "non-negative integer"],
    [{ tradeTreasuryFeeBps: 1.5 }, "non-negative integer"],
    [
      {
        tradeTreasuryFeeBps: MAX_LAUNCH_TRADE_FEE_BPS,
        tradeMarketMakerFeeBps: 1,
      },
      "Combined trade fees",
    ],
    [
      { winningsMarketMakerFeeBps: MAX_LAUNCH_WINNINGS_FEE_BPS + 1 },
      "Winnings fees",
    ],
  ])("rejects unsafe policy %#", (input, message) => {
    expect(() => resolveLaunchFeePolicy(input)).toThrow(message);
  });

  test("requires explicit approved fee values for mainnet", () => {
    expect(() =>
      resolveApprovedLaunchFeePolicy({
        approval: undefined,
        tradeTreasuryFeeBps: "100",
        tradeMarketMakerFeeBps: "0",
        winningsMarketMakerFeeBps: "0",
      }),
    ).toThrow("must be exactly 'true'");
    expect(() =>
      resolveApprovedLaunchFeePolicy({
        approval: "true",
        tradeTreasuryFeeBps: "100",
        tradeMarketMakerFeeBps: undefined,
        winningsMarketMakerFeeBps: "0",
      }),
    ).toThrow("TRADE_MARKET_MAKER_FEE_BPS must be explicitly configured");
    expect(
      resolveApprovedLaunchFeePolicy({
        approval: "true",
        tradeTreasuryFeeBps: "100",
        tradeMarketMakerFeeBps: "0",
        winningsMarketMakerFeeBps: "0",
      }),
    ).toEqual({
      tradeTreasuryFeeBps: 100,
      tradeMarketMakerFeeBps: 0,
      winningsMarketMakerFeeBps: 0,
    });
  });
});

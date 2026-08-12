import "./setup";
import { describe, expect, it } from "bun:test";

import {
  normalizeSolanaPredictionMarketDuelKeyHex,
  normalizeSolanaPredictionMarketLifecycleRecord,
} from "../src/lib/solanaLifecycle";
import { parsePredictionMarketsResponse } from "../src/lib/solanaPredictionMarkets";

describe("Solana-only prediction market lifecycle", () => {
  it("normalizes Solana CLOB records and canonical duel keys", () => {
    const duelKey = "ab".repeat(32);
    const record = normalizeSolanaPredictionMarketLifecycleRecord({
      chainKey: "SOL",
      marketType: "clob",
      duelKey: `0x${duelKey.toUpperCase()}`,
      duelId: "duel-1",
      marketId: "market-1",
      marketRef: "market-pda",
      lifecycleStatus: "OPEN",
      winner: "NONE",
      betCloseTime: 123,
      programId: "program-id",
      syncedAt: 456,
    });

    expect(record).toMatchObject({
      chainKey: "solana",
      marketType: "clob",
      duelKey,
      lifecycleStatus: "OPEN",
      winner: "NONE",
    });
    expect(
      normalizeSolanaPredictionMarketDuelKeyHex(duelKey, { prefix: true }),
    ).toBe(`0x${duelKey}`);
  });

  it("fails closed for non-Solana chains and excluded market types", () => {
    expect(
      normalizeSolanaPredictionMarketLifecycleRecord({
        chainKey: "unsupported",
        lifecycleStatus: "OPEN",
      }),
    ).toBeNull();
    expect(
      normalizeSolanaPredictionMarketLifecycleRecord({
        chainKey: "solana",
        marketType: "unsupported-market",
        lifecycleStatus: "OPEN",
      }),
    ).toBeNull();
  });

  it("filters excluded records from keeper lifecycle responses", () => {
    const duelKey = "cd".repeat(32);
    const parsed = parsePredictionMarketsResponse({
      duel: {
        duelKey,
        duelId: "duel-2",
        phase: "ANNOUNCEMENT",
        winner: "NONE",
        betCloseTime: 999,
      },
      markets: [
        {
          chainKey: "solana",
          marketType: "clob",
          duelKey,
          duelId: "duel-2",
          marketId: "sol-market",
          marketRef: "sol-market",
          lifecycleStatus: "OPEN",
          winner: "NONE",
          betCloseTime: 999,
          programId: "program-id",
          syncedAt: 1,
        },
        {
          chainKey: "unsupported",
          marketType: "clob",
          duelKey,
          lifecycleStatus: "OPEN",
        },
        {
          chainKey: "solana",
          marketType: "unsupported-market",
          duelKey,
          lifecycleStatus: "OPEN",
        },
      ],
      updatedAt: 2,
    });

    expect(parsed?.markets).toHaveLength(1);
    expect(parsed?.markets[0]?.marketRef).toBe("sol-market");
  });
});

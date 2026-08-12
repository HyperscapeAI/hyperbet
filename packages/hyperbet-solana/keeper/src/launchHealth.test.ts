import { describe, expect, test } from "bun:test";

import {
  mergePredictionMarketsWithHealth,
  type KeeperBotHealthSnapshot,
} from "./launchHealth";
import type { PredictionMarketLifecycleRecord } from "./solanaLifecycle";

function lifecycleRecord(): PredictionMarketLifecycleRecord {
  return {
    chainKey: "solana",
    duelKey: "duel-key",
    duelId: "duel-1",
    marketId: "market-1",
    marketRef: "market-1",
    lifecycleStatus: "OPEN",
    winner: "NONE",
    betCloseTime: null,
    contractAddress: null,
    programId: "program-1",
    txRef: null,
    syncedAt: 1,
  };
}

function health(): KeeperBotHealthSnapshot {
  return {
    chainKey: "solana",
    updatedAtMs: 1_000,
    bootedAtMs: 100,
    running: true,
    processId: 123,
    lastSuccessfulRpcAtMs: 999,
    recovery: [],
    markets: [
      {
        chainKey: "solana",
        duelId: "duel-1",
        duelKey: "duel-key",
        marketRef: "market-1",
        lifecycleStatus: "OPEN",
        winner: "NONE",
        fairValue: 500,
        bidPrice: 490,
        askPrice: 510,
        bidUnits: 50,
        askUnits: 50,
        openOrderCount: 2,
        inventoryYes: 10,
        inventoryNo: 5,
        openYes: 40,
        openNo: 40,
        netExposure: 5,
        grossExposure: 95,
        drawdownBps: 0,
        quoteAgeMs: 1_000,
        lastStreamAtMs: 900,
        lastOracleAtMs: 901,
        lastRpcAtMs: 902,
        circuitBreakerReason: null,
        lastResolvedAtMs: null,
        lastClaimAtMs: null,
        recovery: [],
      },
    ],
  };
}

describe("SOL launch health projection", () => {
  test("merges by canonical market reference", () => {
    const result = mergePredictionMarketsWithHealth(
      [lifecycleRecord()],
      health(),
    );
    expect(result[0].health?.marketRef).toBe("market-1");
    expect(result[0].health?.openOrderCount).toBe(2);
  });

  test("falls back to the canonical duel key and never invents health", () => {
    const record = lifecycleRecord();
    record.marketRef = "reindexed-market";
    expect(
      mergePredictionMarketsWithHealth([record], health())[0].health?.duelKey,
    ).toBe("duel-key");
    expect(
      mergePredictionMarketsWithHealth([record], null)[0].health,
    ).toBeNull();
  });
});

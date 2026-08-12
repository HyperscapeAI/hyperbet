import { describe, expect, test } from "bun:test";
import type { KeeperBotHealthSnapshot } from "./launchHealth";

import {
  evaluateKeeperReadiness,
  isAuthoritativeStreamSnapshot,
  parseKeeperBotHealthSnapshot,
  type KeeperReadinessInput,
} from "./readiness";

const NOW = 1_700_000_000_000;

function healthyBot(): KeeperBotHealthSnapshot {
  return {
    chainKey: "solana",
    updatedAtMs: NOW - 1_000,
    bootedAtMs: NOW - 60_000,
    running: true,
    processId: 123,
    lastSuccessfulRpcAtMs: NOW - 500,
    recovery: [],
    markets: [],
  };
}

function healthyInput(): KeeperReadinessInput {
  return {
    nowMs: NOW,
    requireStreamSource: true,
    streamMaxAgeMs: 15_000,
    botMaxAgeMs: 30_000,
    parserMaxAgeMs: 30_000,
    stream: {
      sourceConfigured: true,
      authoritative: true,
      lastUpdatedAt: NOW - 1_000,
      lastSourceError: null,
    },
    bot: healthyBot(),
    parser: {
      enabled: true,
      lastSuccessAt: NOW - 1_000,
      lastError: null,
    },
    database: { ok: true, error: null },
  };
}

describe("keeper service readiness", () => {
  test("accepts a fresh authoritative idle frame before the first cycle", () => {
    expect(isAuthoritativeStreamSnapshot("", "IDLE")).toBe(true);
    expect(isAuthoritativeStreamSnapshot(null, "IDLE")).toBe(true);
    expect(isAuthoritativeStreamSnapshot("cycle-1", "ANNOUNCEMENT")).toBe(true);
    expect(isAuthoritativeStreamSnapshot("boot-cycle", "IDLE")).toBe(false);
    expect(isAuthoritativeStreamSnapshot("", "ANNOUNCEMENT")).toBe(false);
  });

  test("rejects malformed or partial persisted bot-health snapshots", () => {
    expect(parseKeeperBotHealthSnapshot(null)).toBeNull();
    expect(
      parseKeeperBotHealthSnapshot({
        ...healthyBot(),
        markets: [{ lifecycleStatus: "OPEN" }],
      }),
    ).toBeNull();
    expect(parseKeeperBotHealthSnapshot(healthyBot())).toEqual(healthyBot());
  });

  test("is ready only when every launch dependency is current and healthy", () => {
    expect(evaluateKeeperReadiness(healthyInput())).toEqual({
      ready: true,
      reasons: [],
      agesMs: { stream: 1_000, bot: 1_000, botRpc: 500, parser: 1_000 },
    });
  });

  test("fails closed on stale stream, bot, or parser state", () => {
    const input = healthyInput();
    input.stream.lastUpdatedAt = NOW - 15_001;
    input.bot!.updatedAtMs = NOW - 30_001;
    input.bot!.lastSuccessfulRpcAtMs = NOW - 30_001;
    input.parser.lastSuccessAt = NOW - 30_001;
    expect(evaluateKeeperReadiness(input).reasons).toEqual([
      "stream-state-stale",
      "bot-health-stale",
      "bot-rpc-stale",
      "solana-parser-stale",
    ]);
  });

  test("fails closed on source, bot recovery, market, parser, and database errors", () => {
    const input = healthyInput();
    input.stream.lastSourceError = "upstream unavailable";
    input.bot!.recovery = [
      {
        code: "terminal-manual-review",
        active: true,
        sinceMs: NOW,
        untilMs: null,
        details: "one operation",
      },
    ];
    input.bot!.markets = [
      {
        chainKey: "solana",
        duelId: "duel-1",
        duelKey: null,
        marketRef: "market-1",
        lifecycleStatus: "CHALLENGED",
        winner: "NONE",
        fairValue: null,
        bidPrice: null,
        askPrice: null,
        bidUnits: 0,
        askUnits: 0,
        openOrderCount: 0,
        inventoryYes: 0,
        inventoryNo: 0,
        openYes: 0,
        openNo: 0,
        netExposure: 0,
        grossExposure: 0,
        drawdownBps: 0,
        quoteAgeMs: null,
        lastStreamAtMs: NOW,
        lastOracleAtMs: NOW,
        lastRpcAtMs: NOW,
        circuitBreakerReason: "stale stream",
        lastResolvedAtMs: null,
        lastClaimAtMs: null,
        recovery: ["position-reconcile-pending"],
      },
    ];
    input.parser.lastError = "RPC failed";
    input.database = { ok: false, error: "disk I/O" };

    expect(evaluateKeeperReadiness(input).reasons).toEqual([
      "stream-source-error",
      "bot-recovery:terminal-manual-review",
      "market-circuit-breaker",
      "market-result-challenged",
      "market-recovery-active",
      "solana-parser-error",
      "database-unhealthy",
    ]);
  });

  test("requires the production stream source and bot snapshot", () => {
    const input = healthyInput();
    input.stream.sourceConfigured = false;
    input.stream.authoritative = false;
    input.bot = null;
    expect(evaluateKeeperReadiness(input).reasons).toEqual([
      "stream-source-missing",
      "stream-state-unverified",
      "bot-health-missing",
    ]);
  });

  test("does not treat expected terminal market markers as active circuit breakers", () => {
    const input = healthyInput();
    input.bot!.markets = [
      {
        chainKey: "solana",
        duelId: "duel-cancelled",
        duelKey: "ab".repeat(32),
        marketRef: "market-cancelled",
        lifecycleStatus: "CANCELLED",
        winner: "NONE",
        fairValue: 500,
        bidPrice: null,
        askPrice: null,
        bidUnits: 0,
        askUnits: 0,
        openOrderCount: 0,
        inventoryYes: 0,
        inventoryNo: 0,
        openYes: 0,
        openNo: 0,
        netExposure: 0,
        grossExposure: 0,
        drawdownBps: 0,
        quoteAgeMs: null,
        lastStreamAtMs: NOW,
        lastOracleAtMs: NOW,
        lastRpcAtMs: NOW,
        circuitBreakerReason: "market:cancelled",
        lastResolvedAtMs: NOW,
        lastClaimAtMs: null,
        recovery: [],
      },
    ];

    expect(evaluateKeeperReadiness(input)).toEqual({
      ready: true,
      reasons: [],
      agesMs: { stream: 1_000, bot: 1_000, botRpc: 500, parser: 1_000 },
    });
  });
});

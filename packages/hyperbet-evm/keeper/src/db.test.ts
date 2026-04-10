import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function sleepMs(durationMs: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, durationMs);
}

function cleanupTempDir(tempDir: string): void {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      rmSync(tempDir, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return;
      }
      if (!["EBUSY", "EPERM", "ENOTEMPTY"].includes(code ?? "")) {
        throw error;
      }
      if (attempt === 5) {
        return;
      }
      sleepMs(25 * (attempt + 1));
    }
  }
}

function seedDuplicateBets(dbPath: string): void {
  const seedDb = new Database(dbPath, { create: true });
  seedDb.run(`CREATE TABLE IF NOT EXISTS bets (
    id TEXT PRIMARY KEY,
    bettor_wallet TEXT NOT NULL,
    chain TEXT NOT NULL,
    source_asset TEXT NOT NULL,
    source_amount REAL NOT NULL DEFAULT 0,
    gold_amount REAL NOT NULL DEFAULT 0,
    fee_bps INTEGER NOT NULL DEFAULT 0,
    tx_signature TEXT NOT NULL DEFAULT '',
    market_pda TEXT,
    duel_key TEXT,
    duel_id TEXT,
    invite_code TEXT,
    external_bet_ref TEXT,
    recorded_at INTEGER NOT NULL
  )`);
  const insertBet = seedDb.prepare(
    `INSERT INTO bets (
      id,
      bettor_wallet,
      chain,
      source_asset,
      source_amount,
      gold_amount,
      fee_bps,
      tx_signature,
      market_pda,
      duel_key,
      duel_id,
      invite_code,
      external_bet_ref,
      recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertBet.run(
    "bet-1",
    "wallet-1",
    "bsc",
    "BNB",
    1,
    1,
    25,
    "tx-1",
    null,
    "duel-key-1",
    "duel-1",
    null,
    "ext-1",
    10,
  );
  insertBet.run(
    "bet-2",
    "wallet-2",
    "bsc",
    "BNB",
    2,
    2,
    25,
    "tx-1",
    null,
    "duel-key-1",
    "duel-1",
    null,
    "ext-2",
    20,
  );
  insertBet.run(
    "bet-3",
    "wallet-3",
    "bsc",
    "BNB",
    3,
    3,
    25,
    "tx-3",
    null,
    "duel-key-2",
    "duel-2",
    null,
    "ext-shared",
    30,
  );
  insertBet.run(
    "bet-4",
    "wallet-4",
    "bsc",
    "BNB",
    4,
    4,
    25,
    "tx-4",
    null,
    "duel-key-2",
    "duel-2",
    null,
    "ext-shared",
    40,
  );
  seedDb.close(false);
}

describe("keeper db persistence", () => {
  let tempDir = "";
  let loadedModules: Array<typeof import("./db.ts")> = [];

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "keeper-db-"));
    process.env.KEEPER_DB_PATH = path.join(tempDir, "keeper.sqlite");
    loadedModules = [];
  });

  afterEach(() => {
    delete process.env.KEEPER_DB_PATH;
    for (const module of loadedModules) {
      module.closeDb();
    }
    cleanupTempDir(tempDir);
  });

  test("round-trips agent ratings through SQLite", async () => {
    const db = (await import(
      `./db.ts?case=${Date.now()}-ratings`
    )) as typeof import("./db.ts");
    loadedModules.push(db);

    db.saveAgentRating("gpt-4.1", {
      mu: 1125,
      sigma: 74,
      gamesPlayed: 19,
    });

    expect(db.loadAgentRatings()).toEqual({
      "gpt-4.1": {
        mu: 1125,
        sigma: 74,
        gamesPlayed: 19,
      },
    });
  });

  test("stores oracle snapshots for later history queries", async () => {
    const db = (await import(
      `./db.ts?case=${Date.now()}-snapshots`
    )) as typeof import("./db.ts");
    loadedModules.push(db);

    db.savePerpsOracleSnapshot({
      agentId: "claude-sonnet",
      marketId: 42,
      spotIndex: 118.25,
      conservativeSkill: 1011,
      mu: 1200,
      sigma: 63,
      recordedAt: 1_700_000_000_000,
    });

    expect(db.loadPerpsOracleSnapshots("claude-sonnet", 10)).toEqual([
      {
        agentId: "claude-sonnet",
        marketId: 42,
        spotIndex: 118.25,
        conservativeSkill: 1011,
        mu: 1200,
        sigma: 63,
        recordedAt: 1_700_000_000_000,
      },
    ]);
  });

  test("stores canonical perps market registry rows", async () => {
    const db = (await import(
      `./db.ts?case=${Date.now()}-markets`
    )) as typeof import("./db.ts");
    loadedModules.push(db);

    db.savePerpsMarket({
      agentId: "gpt-4.1",
      marketId: 42,
      rank: 1,
      name: "GPT 4.1",
      provider: "OpenAI",
      model: "gpt-4.1",
      wins: 12,
      losses: 3,
      winRate: 80,
      combatLevel: 99,
      currentStreak: 4,
      status: "ACTIVE",
      lastSeenAt: 1_700_000_000_000,
      deprecatedAt: null,
      updatedAt: 1_700_000_000_500,
    });

    expect(db.loadPerpsMarkets()).toEqual([
      {
        agentId: "gpt-4.1",
        marketId: 42,
        rank: 1,
        name: "GPT 4.1",
        provider: "OpenAI",
        model: "gpt-4.1",
        wins: 12,
        losses: 3,
        winRate: 80,
        combatLevel: 99,
        currentStreak: 4,
        status: "ACTIVE",
        lastSeenAt: 1_700_000_000_000,
        deprecatedAt: null,
        updatedAt: 1_700_000_000_500,
      },
    ]);
  });

  test("stores chain-scoped public perps rows separately by chain", async () => {
    const db = (await import(
      `./db.ts?case=${Date.now()}-chain-scoped-perps`
    )) as typeof import("./db.ts");
    loadedModules.push(db);

    db.saveChainScopedPerpsOracleSnapshot({
      chainKey: "bsc",
      agentId: "gpt-4.1",
      marketId: 42,
      spotIndex: 118.25,
      conservativeSkill: 1011,
      mu: 1200,
      sigma: 63,
      recordedAt: 1_700_000_000_000,
    });
    db.saveChainScopedPerpsOracleSnapshot({
      chainKey: "base",
      agentId: "gpt-4.1",
      marketId: 42,
      spotIndex: 119.25,
      conservativeSkill: 1012,
      mu: 1201,
      sigma: 62,
      recordedAt: 1_700_000_000_100,
    });
    db.saveChainScopedPerpsMarket({
      chainKey: "bsc",
      agentId: "gpt-4.1",
      marketId: 42,
      rank: 1,
      name: "GPT 4.1",
      provider: "OpenAI",
      model: "gpt-4.1",
      wins: 12,
      losses: 3,
      winRate: 80,
      combatLevel: 99,
      currentStreak: 4,
      status: "ACTIVE",
      lastSeenAt: 1_700_000_000_000,
      deprecatedAt: null,
      updatedAt: 1_700_000_000_500,
    });
    db.saveChainScopedPerpsMarket({
      chainKey: "base",
      agentId: "gpt-4.1",
      marketId: 42,
      rank: 1,
      name: "GPT 4.1",
      provider: "OpenAI",
      model: "gpt-4.1",
      wins: 14,
      losses: 2,
      winRate: 87.5,
      combatLevel: 101,
      currentStreak: 6,
      status: "ACTIVE",
      lastSeenAt: 1_700_000_000_250,
      deprecatedAt: null,
      updatedAt: 1_700_000_000_750,
    });

    expect(db.loadChainScopedPerpsOracleSnapshots("bsc", "gpt-4.1", 10)).toEqual([
      {
        chainKey: "bsc",
        agentId: "gpt-4.1",
        marketId: 42,
        spotIndex: 118.25,
        conservativeSkill: 1011,
        mu: 1200,
        sigma: 63,
        recordedAt: 1_700_000_000_000,
      },
    ]);
    expect(db.loadChainScopedPerpsOracleSnapshots("base", "gpt-4.1", 10)).toEqual([
      {
        chainKey: "base",
        agentId: "gpt-4.1",
        marketId: 42,
        spotIndex: 119.25,
        conservativeSkill: 1012,
        mu: 1201,
        sigma: 62,
        recordedAt: 1_700_000_000_100,
      },
    ]);
    expect(db.loadChainScopedPerpsMarkets("bsc")).toEqual([
      {
        chainKey: "bsc",
        agentId: "gpt-4.1",
        marketId: 42,
        rank: 1,
        name: "GPT 4.1",
        provider: "OpenAI",
        model: "gpt-4.1",
        wins: 12,
        losses: 3,
        winRate: 80,
        combatLevel: 99,
        currentStreak: 4,
        status: "ACTIVE",
        lastSeenAt: 1_700_000_000_000,
        deprecatedAt: null,
        updatedAt: 1_700_000_000_500,
      },
    ]);
    expect(db.loadChainScopedPerpsMarkets("base")).toEqual([
      {
        chainKey: "base",
        agentId: "gpt-4.1",
        marketId: 42,
        rank: 1,
        name: "GPT 4.1",
        provider: "OpenAI",
        model: "gpt-4.1",
        wins: 14,
        losses: 2,
        winRate: 87.5,
        combatLevel: 101,
        currentStreak: 6,
        status: "ACTIVE",
        lastSeenAt: 1_700_000_000_250,
        deprecatedAt: null,
        updatedAt: 1_700_000_000_750,
      },
    ]);
  });

  test("quarantines duplicate recorded bets before enforcing uniqueness", async () => {
    seedDuplicateBets(process.env.KEEPER_DB_PATH!);

    const db = (await import(
      `./db.ts?case=${Date.now()}-duplicate-bets`
    )) as typeof import("./db.ts");
    loadedModules.push(db);

    const state = db.loadAll();
    expect(state.bets.map((bet) => bet.id).sort()).toEqual(["bet-1", "bet-3"]);

    const inspectDb = new Database(process.env.KEEPER_DB_PATH!);
    try {
      const conflicts = inspectDb
        .prepare(
          `SELECT original_id AS originalId, reason
             FROM bets_duplicate_conflicts
            ORDER BY original_id ASC`,
        )
        .all() as Array<{ originalId: string; reason: string }>;
      expect(conflicts.map((row) => row.originalId)).toEqual(["bet-2", "bet-4"]);
      expect(conflicts[0]?.reason).toContain("duplicate chain+tx_signature");
      expect(conflicts[1]?.reason).toContain("duplicate external_bet_ref");
    } finally {
      inspectDb.close(false);
    }
  });

  test("persists bet-sync checkpoint and overview state", async () => {
    const db = (await import(
      `./db.ts?case=${Date.now()}-bet-sync`
    )) as typeof import("./db.ts");
    loadedModules.push(db);

    db.saveBetSyncCheckpoint({
      sourceEpoch: 7,
      lastSeenSeq: 101,
      lastAppliedSeq: 99,
      replayMode: "replay",
      degradedReason: "consumer lag",
      updatedAt: 1_700_000_100_000,
    });
    db.savePredictionMarketsOverviewState({
      liveJson: JSON.stringify({ duel: { duelId: "duel-live" } }),
      recentSettlementJson: JSON.stringify({ duel: { duelId: "duel-old" } }),
      updatedAt: 1_700_000_100_500,
    });

    expect(db.loadBetSyncCheckpoint()).toEqual({
      sourceEpoch: 7,
      lastSeenSeq: 101,
      lastAppliedSeq: 99,
      replayMode: "replay",
      degradedReason: "consumer lag",
      updatedAt: 1_700_000_100_000,
    });
    expect(db.loadPredictionMarketsOverviewState()).toEqual({
      liveJson: JSON.stringify({ duel: { duelId: "duel-live" } }),
      recentSettlementJson: JSON.stringify({ duel: { duelId: "duel-old" } }),
      updatedAt: 1_700_000_100_500,
    });
    expect(
      db.appendBetSyncApplyLogEntry({
        sourceEpoch: 7,
        seq: 101,
        eventType: "state",
        duelKey: "aa".repeat(32),
        duelId: "duel-live",
        phase: "COUNTDOWN",
        phaseVersion: 2,
        emittedAt: 1_700_000_100_100,
        payloadJson: JSON.stringify({ seq: 101 }),
        receivedAt: 1_700_000_100_200,
        appliedAt: 1_700_000_100_300,
      }),
    ).toBe(true);
    expect(
      db.appendBetSyncApplyLogEntry({
        sourceEpoch: 7,
        seq: 101,
        eventType: "state",
        duelKey: "aa".repeat(32),
        duelId: "duel-live",
        phase: "COUNTDOWN",
        phaseVersion: 2,
        emittedAt: 1_700_000_100_100,
        payloadJson: JSON.stringify({ seq: 101 }),
        receivedAt: 1_700_000_100_200,
        appliedAt: 1_700_000_100_300,
      }),
    ).toBe(false);
  });

  test("commits stream snapshot, checkpoint, overview, and apply-log atomically", async () => {
    const db = (await import(
      `./db.ts?case=${Date.now()}-projection-state`
    )) as typeof import("./db.ts");
    loadedModules.push(db);

    const firstCommit = db.commitBetSyncProjectionState({
      streamState: {
        stateJson: JSON.stringify({
          type: "STREAMING_STATE_UPDATE",
          cycle: { duelId: "duel-1", phase: "COUNTDOWN" },
          leaderboard: [],
          cameraTarget: null,
          seq: 17,
          emittedAt: 1_700_000_200_000,
        }),
        updatedAt: 1_700_000_200_000,
      },
      checkpoint: {
        sourceEpoch: 9,
        lastSeenSeq: 17,
        lastAppliedSeq: 17,
        replayMode: "live",
        degradedReason: null,
        updatedAt: 1_700_000_200_010,
      },
      overview: {
        liveJson: JSON.stringify({ duel: { duelId: "duel-1" } }),
        recentSettlementJson: JSON.stringify({ duel: { duelId: "duel-0" } }),
        updatedAt: 1_700_000_200_020,
      },
      applyLogEntry: {
        sourceEpoch: 9,
        seq: 17,
        eventType: "state",
        duelKey: "bb".repeat(32),
        duelId: "duel-1",
        phase: "COUNTDOWN",
        phaseVersion: 3,
        emittedAt: 1_700_000_200_000,
        payloadJson: JSON.stringify({ seq: 17 }),
        receivedAt: 1_700_000_200_030,
        appliedAt: 1_700_000_200_040,
      },
    });

    expect(firstCommit).toBe(true);
    expect(db.loadBetSyncStreamStateSnapshot()).toEqual({
      stateJson: JSON.stringify({
        type: "STREAMING_STATE_UPDATE",
        cycle: { duelId: "duel-1", phase: "COUNTDOWN" },
        leaderboard: [],
        cameraTarget: null,
        seq: 17,
        emittedAt: 1_700_000_200_000,
      }),
      updatedAt: 1_700_000_200_000,
    });
    expect(db.loadBetSyncCheckpoint()).toEqual({
      sourceEpoch: 9,
      lastSeenSeq: 17,
      lastAppliedSeq: 17,
      replayMode: "live",
      degradedReason: null,
      updatedAt: 1_700_000_200_010,
    });
    expect(db.loadPredictionMarketsOverviewState()).toEqual({
      liveJson: JSON.stringify({ duel: { duelId: "duel-1" } }),
      recentSettlementJson: JSON.stringify({ duel: { duelId: "duel-0" } }),
      updatedAt: 1_700_000_200_020,
    });

    const duplicateCommit = db.commitBetSyncProjectionState({
      streamState: {
        stateJson: JSON.stringify({
          type: "STREAMING_STATE_UPDATE",
          cycle: { duelId: "duel-2", phase: "FIGHTING" },
          leaderboard: [],
          cameraTarget: "agent-2",
          seq: 18,
          emittedAt: 1_700_000_201_000,
        }),
        updatedAt: 1_700_000_201_000,
      },
      checkpoint: {
        sourceEpoch: 9,
        lastSeenSeq: 18,
        lastAppliedSeq: 18,
        replayMode: "live",
        degradedReason: null,
        updatedAt: 1_700_000_201_010,
      },
      overview: {
        liveJson: JSON.stringify({ duel: { duelId: "duel-2" } }),
        recentSettlementJson: JSON.stringify({ duel: { duelId: "duel-1" } }),
        updatedAt: 1_700_000_201_020,
      },
      applyLogEntry: {
        sourceEpoch: 9,
        seq: 17,
        eventType: "state",
        duelKey: "bb".repeat(32),
        duelId: "duel-1",
        phase: "COUNTDOWN",
        phaseVersion: 3,
        emittedAt: 1_700_000_200_000,
        payloadJson: JSON.stringify({ seq: 17 }),
        receivedAt: 1_700_000_201_030,
        appliedAt: 1_700_000_201_040,
      },
    });

    expect(duplicateCommit).toBe(false);
    expect(db.loadBetSyncStreamStateSnapshot()).toEqual({
      stateJson: JSON.stringify({
        type: "STREAMING_STATE_UPDATE",
        cycle: { duelId: "duel-1", phase: "COUNTDOWN" },
        leaderboard: [],
        cameraTarget: null,
        seq: 17,
        emittedAt: 1_700_000_200_000,
      }),
      updatedAt: 1_700_000_200_000,
    });
    expect(db.loadBetSyncCheckpoint()?.lastAppliedSeq).toBe(17);
    expect(
      db.loadPredictionMarketsOverviewState()?.liveJson,
    ).toBe(JSON.stringify({ duel: { duelId: "duel-1" } }));
  });
});

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
    "avax",
    "AVAX",
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
    "avax",
    "AVAX",
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
    "avax",
    "AVAX",
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
    "avax",
    "AVAX",
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
});

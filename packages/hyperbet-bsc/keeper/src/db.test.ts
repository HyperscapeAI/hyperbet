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
});

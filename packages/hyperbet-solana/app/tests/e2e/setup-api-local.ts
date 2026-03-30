import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  savePerpsMarket,
  savePerpsOracleSnapshot,
  saveWalletDisplay,
  saveWalletGoldState,
} from "../../../keeper/src/db";
import { modelMarketIdFromCharacterId } from "../../../../hyperbet-ui/src/lib/modelMarkets";

type E2eState = {
  solanaTraderPublicKey?: string;
  perpsCharacterId?: string;
  perpsMarketId?: number;
  perpsModelName?: string;
  perpsOracleSpotIndex?: number;
};

function normalizeWallet(wallet: string): string {
  return wallet.trim().toLowerCase();
}

function assertString(value: string | undefined, label: string): string {
  const trimmed = value?.trim() || "";
  if (!trimmed) {
    throw new Error(`Missing ${label} in e2e state`);
  }
  return trimmed;
}

async function main(): Promise<void> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const statePath = path.resolve(__dirname, "./state.json");
  const raw = await fs.readFile(statePath, "utf8");
  const state = JSON.parse(raw) as E2eState;

  const primaryWallet = assertString(
    state.solanaTraderPublicKey,
    "solanaTraderPublicKey",
  );
  const characterId = assertString(state.perpsCharacterId, "perpsCharacterId");
  const marketId =
    Number(state.perpsMarketId) || modelMarketIdFromCharacterId(characterId);
  const modelName = state.perpsModelName?.trim() || "E2E Model Alpha";
  const perpsOracleSpotIndex =
    typeof state.perpsOracleSpotIndex === "number" &&
    Number.isFinite(state.perpsOracleSpotIndex)
      ? state.perpsOracleSpotIndex
      : 100;
  const now = Date.now();

  const seededWallets = [
    primaryWallet,
    "SeedReferrer11111111111111111111111111111111",
    "SeedLeader1111111111111111111111111111111",
    "SeedInvitee111111111111111111111111111111",
  ];

  for (const wallet of seededWallets) {
    saveWalletDisplay(normalizeWallet(wallet), wallet);
  }

  saveWalletGoldState(normalizeWallet(primaryWallet), {
    goldBalance: 125_000,
    goldHoldDays: 14,
    updatedAt: now,
  });
  saveWalletGoldState("seedleader1111111111111111111111111111111", {
    goldBalance: 5_000,
    goldHoldDays: 1,
    updatedAt: now,
  });

  savePerpsMarket({
    agentId: characterId,
    marketId,
    rank: 1,
    name: modelName,
    provider: "Hyperscape",
    model: "alpha-local",
    wins: 12,
    losses: 4,
    winRate: 75,
    combatLevel: 88,
    currentStreak: 4,
    status: "ACTIVE",
    lastSeenAt: now,
    deprecatedAt: null,
    updatedAt: now,
  });

  const oracleSnapshots = [
    {
      spotIndex: Math.max(80, perpsOracleSpotIndex - 2),
      mu: 27.2,
      sigma: 4.6,
      recordedAt: now - 60 * 60 * 1000,
    },
    {
      spotIndex: Math.max(80, perpsOracleSpotIndex - 1),
      mu: 27.6,
      sigma: 4.4,
      recordedAt: now - 45 * 60 * 1000,
    },
    {
      spotIndex: perpsOracleSpotIndex,
      mu: 27.9,
      sigma: 4.3,
      recordedAt: now - 30 * 60 * 1000,
    },
    {
      spotIndex: perpsOracleSpotIndex,
      mu: 28.0,
      sigma: 4.1,
      recordedAt: now - 15 * 60 * 1000,
    },
    { spotIndex: perpsOracleSpotIndex, mu: 28.0, sigma: 4.0, recordedAt: now },
  ];

  for (const snapshot of oracleSnapshots) {
    savePerpsOracleSnapshot({
      agentId: characterId,
      marketId,
      spotIndex: snapshot.spotIndex,
      conservativeSkill: snapshot.mu - snapshot.sigma * 3,
      mu: snapshot.mu,
      sigma: snapshot.sigma,
      recordedAt: snapshot.recordedAt,
    });
  }

  console.log(
    JSON.stringify(
      {
        keeperDbPath:
          process.env.KEEPER_DB_PATH ||
          process.env.E2E_KEEPER_DB_PATH ||
          "default",
        primaryWallet,
        marketId,
        characterId,
        oracleSnapshots: oracleSnapshots.length,
      },
      null,
      2,
    ),
  );
}

void main();

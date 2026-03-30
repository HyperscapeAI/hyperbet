import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type E2eState = {
  solanaTraderPublicKey?: string;
  perpsCharacterId?: string;
  perpsModelName?: string;
  currentDuelId?: string;
  currentDuelKeyHex?: string;
  currentDuelSource?: "synthetic_publish" | "real_hyperscapes";
};

async function readState(): Promise<E2eState> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const statePath = path.resolve(__dirname, "./state.json");
  return JSON.parse(await fs.readFile(statePath, "utf8")) as E2eState;
}

function requireString(value: string | undefined, label: string): string {
  const trimmed = value?.trim() || "";
  if (!trimmed) throw new Error(`Missing ${label} in e2e state`);
  return trimmed;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const writeKey =
    process.env.E2E_ARENA_WRITE_KEY?.trim() ||
    process.env.ARENA_EXTERNAL_BET_WRITE_KEY?.trim() ||
    process.env.VITE_ARENA_WRITE_KEY?.trim() ||
    "";
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(writeKey ? { "x-arena-write-key": writeKey } : {}),
      ...(init?.headers || {}),
    },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${body}`);
  }
  return JSON.parse(body) as T;
}

async function main(): Promise<void> {
  const state = await readState();
  const gameApiUrl = (process.env.E2E_GAME_API_URL || "http://127.0.0.1:5555")
    .trim()
    .replace(/\/$/, "");
  const primaryWallet = requireString(
    state.solanaTraderPublicKey,
    "solanaTraderPublicKey",
  );
  const perpsCharacterId = requireString(
    state.perpsCharacterId,
    "perpsCharacterId",
  );
  const currentDuelId = requireString(state.currentDuelId, "currentDuelId");
  const currentDuelKeyHex = requireString(
    state.currentDuelKeyHex,
    "currentDuelKeyHex",
  );
  const duelSource =
    process.env.E2E_DUEL_SOURCE?.trim().toLowerCase() ||
    state.currentDuelSource ||
    "synthetic_publish";
  const perpsModelName = state.perpsModelName?.trim() || "E2E Model Alpha";
  const uplineWallet = "SeedReferrer11111111111111111111111111111111";
  const leaderboardWallet = "SeedLeader1111111111111111111111111111111";
  const inviteeWallet = "SeedInvitee111111111111111111111111111111";
  const now = Date.now();

  const uplineInvite = await requestJson<{ inviteCode: string }>(
    `${gameApiUrl}/api/arena/invite/${encodeURIComponent(uplineWallet)}?platform=solana`,
  );
  await requestJson(`${gameApiUrl}/api/arena/invite/redeem`, {
    method: "POST",
    body: JSON.stringify({
      wallet: primaryWallet,
      inviteCode: uplineInvite.inviteCode,
    }),
  });

  const primaryInvite = await requestJson<{ inviteCode: string }>(
    `${gameApiUrl}/api/arena/invite/${encodeURIComponent(primaryWallet)}?platform=solana`,
  );
  await requestJson(`${gameApiUrl}/api/arena/invite/redeem`, {
    method: "POST",
    body: JSON.stringify({
      wallet: inviteeWallet,
      inviteCode: primaryInvite.inviteCode,
    }),
  });

  await requestJson(`${gameApiUrl}/api/arena/bet/record-external`, {
    method: "POST",
    body: JSON.stringify({
      bettorWallet: primaryWallet,
      chain: "SOLANA",
      sourceAsset: "GOLD",
      sourceAmount: 120,
      goldAmount: 120,
      feeBps: 200,
      txSignature: "seed-primary-bet",
      externalBetRef: "seed-primary-bet",
    }),
  });

  await requestJson(`${gameApiUrl}/api/arena/bet/record-external`, {
    method: "POST",
    body: JSON.stringify({
      bettorWallet: inviteeWallet,
      chain: "SOLANA",
      sourceAsset: "GOLD",
      sourceAmount: 60,
      goldAmount: 60,
      feeBps: 200,
      inviteCode: primaryInvite.inviteCode,
      txSignature: "seed-invitee-bet",
      externalBetRef: "seed-invitee-bet",
    }),
  });

  await requestJson(`${gameApiUrl}/api/arena/bet/record-external`, {
    method: "POST",
    body: JSON.stringify({
      bettorWallet: leaderboardWallet,
      chain: "SOLANA",
      sourceAsset: "GOLD",
      sourceAmount: 500,
      goldAmount: 500,
      feeBps: 200,
      txSignature: "seed-leader-bet",
      externalBetRef: "seed-leader-bet",
    }),
  });

  const publishedState =
    duelSource === "real_hyperscapes"
      ? null
      : await requestJson<{ seq: number }>(
          `${gameApiUrl}/api/streaming/state/publish`,
          {
            method: "POST",
            body: JSON.stringify({
              cycle: {
                cycleId: "e2e-cycle-active",
                duelId: currentDuelId,
                duelKeyHex: currentDuelKeyHex,
                phase: "ANNOUNCEMENT",
                cycleStartTime: now - 90_000,
                phaseStartTime: now - 15_000,
                phaseEndTime: now + 300_000,
                betOpenTime: now - 15_000,
                betCloseTime: now + 300_000,
                fightStartTime: now + 360_000,
                duelEndTime: null,
                countdown: 300,
                timeRemaining: 300_000,
                winnerId: null,
                winnerName: null,
                winReason: null,
                agent1: {
                  id: perpsCharacterId,
                  name: perpsModelName,
                  provider: "Hyperscape",
                  model: "alpha-local",
                  hp: 68,
                  maxHp: 100,
                  combatLevel: 88,
                  wins: 12,
                  losses: 4,
                  damageDealtThisFight: 148,
                  inventory: [
                    { slot: 0, itemId: "dragon_scimitar", quantity: 1 },
                    { slot: 1, itemId: "shark", quantity: 2 },
                  ],
                  monologues: [
                    {
                      id: "mono-alpha-1",
                      type: "thought",
                      content: "Pressure the midpoint and deny the comeback window.",
                      timestamp: now - 12_000,
                    },
                    {
                      id: "mono-alpha-2",
                      type: "action",
                      content: "Heavy swing lands cleanly on the left flank.",
                      timestamp: now - 7_000,
                    },
                  ],
                },
                agent2: {
                  id: "e2e-rival-beta",
                  name: "Rival Beta",
                  provider: "OpenRouter",
                  model: "beta-local",
                  hp: 41,
                  maxHp: 100,
                  combatLevel: 84,
                  wins: 9,
                  losses: 6,
                  damageDealtThisFight: 97,
                  inventory: [
                    { slot: 0, itemId: "abyssal_whip", quantity: 1 },
                    { slot: 1, itemId: "anglerfish", quantity: 1 },
                  ],
                  monologues: [
                    {
                      id: "mono-beta-1",
                      type: "thought",
                      content:
                        "Need one clean punish to get back into price discovery.",
                      timestamp: now - 10_000,
                    },
                    {
                      id: "mono-beta-2",
                      type: "action",
                      content: "Retreating toward the pillar to reset the exchange.",
                      timestamp: now - 4_000,
                    },
                  ],
                },
              },
              leaderboard: [
                {
                  rank: 1,
                  name: perpsModelName,
                  provider: "Hyperscape",
                  model: "alpha-local",
                  wins: 12,
                  losses: 4,
                  winRate: 75,
                  currentStreak: 4,
                },
                {
                  rank: 2,
                  name: "Rival Beta",
                  provider: "OpenRouter",
                  model: "beta-local",
                  wins: 9,
                  losses: 6,
                  winRate: 60,
                  currentStreak: 2,
                },
                {
                  rank: 3,
                  name: "Gamma Spec",
                  provider: "Anthropic",
                  model: "gamma-local",
                  wins: 7,
                  losses: 8,
                  winRate: 46.7,
                  currentStreak: 1,
                },
              ],
              cameraTarget: null,
            }),
          },
        );

  const points = await requestJson<{ totalPoints: number }>(
    `${gameApiUrl}/api/arena/points/${encodeURIComponent(primaryWallet)}?scope=wallet`,
    { method: "GET" },
  );

  console.log(
    JSON.stringify(
      {
        gameApiUrl,
        primaryWallet,
        uplineInviteCode: uplineInvite.inviteCode,
        primaryInviteCode: primaryInvite.inviteCode,
        publishedSeq: publishedState?.seq ?? null,
        primaryWalletPoints: points.totalPoints,
        duelSource,
      },
      null,
      2,
    ),
  );
}

void main();

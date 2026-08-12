import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Keypair, PublicKey } from "@solana/web3.js";

import {
  normalizeSolanaV1Cluster,
  resolveSolanaV1Deployment,
} from "../../../deployments/v1";

type PublicCluster = "devnet" | "testnet";

type StreamingStateResponse = {
  cycle?: {
    duelId?: string | number | null;
    duelKeyHex?: string | null;
    phase?: string | null;
    betOpenTime?: number | null;
    betCloseTime?: number | null;
    fightStartTime?: number | null;
  } | null;
};

type PredictionMarketsResponse = {
  markets?: Array<{
    chainKey?: string | null;
    duelId?: string | null;
    duelKey?: string | null;
    marketRef?: string | null;
    programId?: string | null;
    lifecycleStatus?: string | null;
  }>;
};

function requireValue(value: string | undefined, label: string): string {
  const normalized = value?.trim() || "";
  if (!normalized) throw new Error(`${label} must be explicitly configured`);
  return normalized;
}

function resolveCluster(): PublicCluster {
  const clusterArgumentIndex = process.argv.indexOf("--cluster");
  const requested =
    clusterArgumentIndex >= 0
      ? process.argv[clusterArgumentIndex + 1]
      : process.env.E2E_CLUSTER;
  const cluster = normalizeSolanaV1Cluster(requested);
  if (cluster !== "devnet" && cluster !== "testnet") {
    throw new Error(
      `Public browser acceptance is limited to devnet/testnet; received ${cluster}`,
    );
  }
  return cluster;
}

function deriveWsUrl(rpcUrl: string): string {
  const parsed = new URL(rpcUrl);
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  return parsed.toString();
}

function normalizeDuelKey(value: string | null | undefined): string {
  const normalized = value?.trim().replace(/^0x/i, "").toLowerCase() || "";
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("Live keeper state is missing a valid 32-byte duel key");
  }
  return normalized;
}

function requirePublicKey(
  value: string | null | undefined,
  label: string,
): string {
  try {
    return new PublicKey(requireValue(value ?? undefined, label)).toBase58();
  } catch {
    throw new Error(`${label} must be a valid Solana public key`);
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { "cache-control": "no-store", pragma: "no-cache" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(
      `${url} returned ${response.status} ${response.statusText}`,
    );
  }
  return (await response.json()) as T;
}

async function main(): Promise<void> {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  const appDir = path.resolve(dirname, "../..");
  const statePath = path.resolve(dirname, "./state.json");
  const envPath = path.resolve(appDir, ".env.e2e");
  const cluster = resolveCluster();
  const deployment = resolveSolanaV1Deployment(cluster);
  const keeperUrl = requireValue(
    process.env.E2E_GAME_API_URL ??
      process.env.HYPERBET_SOLANA_KEEPER_TESTNET_URL,
    "E2E_GAME_API_URL",
  ).replace(/\/$/, "");
  const rpcUrl = requireValue(process.env.SOLANA_RPC_URL, "SOLANA_RPC_URL");
  const rpcWsUrl = process.env.SOLANA_RPC_WS_URL?.trim() || deriveWsUrl(rpcUrl);
  const fightOracleProgramId = requirePublicKey(
    process.env.FIGHT_ORACLE_PROGRAM_ID ?? deployment.fightOracleProgramId,
    "FIGHT_ORACLE_PROGRAM_ID",
  );
  const duelMarketProgramId = requirePublicKey(
    process.env.DUEL_MARKET_PROGRAM_ID ?? deployment.duelMarketProgramId,
    "DUEL_MARKET_PROGRAM_ID",
  );

  const [streamState, predictionMarkets] = await Promise.all([
    fetchJson<StreamingStateResponse>(`${keeperUrl}/api/streaming/state`),
    fetchJson<PredictionMarketsResponse>(
      `${keeperUrl}/api/arena/prediction-markets/active`,
    ),
  ]);
  const cycle = streamState.cycle;
  const duelId = requireValue(
    cycle?.duelId == null ? undefined : String(cycle.duelId),
    "live duel id",
  );
  const duelKeyHex = normalizeDuelKey(cycle?.duelKeyHex);
  const market = predictionMarkets.markets?.find(
    (candidate) => candidate.chainKey?.trim().toLowerCase() === "solana",
  );
  if (!market) throw new Error("Keeper has no active Solana duel market");
  const marketState = requirePublicKey(market.marketRef, "active market ref");
  if (
    market.duelId !== duelId ||
    normalizeDuelKey(market.duelKey) !== duelKeyHex
  ) {
    throw new Error(
      "Keeper stream and active Solana market identify different duels",
    );
  }
  if (
    requirePublicKey(market.programId, "active market program") !==
    duelMarketProgramId
  ) {
    throw new Error(
      "Active market program does not match the Solana v1 registry",
    );
  }

  // Public acceptance is read-only. This fresh local-only identity lets the UI
  // exercise wallet-gated read surfaces without loading or exposing a funded key.
  const browserIdentity = Keypair.generate();
  const currentMatchId = Number.parseInt(duelId, 10);
  const envBody = [
    `VITE_SOLANA_CLUSTER=${cluster}`,
    `VITE_SOLANA_RPC_URL=${rpcUrl}`,
    `VITE_SOLANA_WS_URL=${rpcWsUrl}`,
    `VITE_GAME_API_URL=${keeperUrl}`,
    "VITE_USE_GAME_RPC_PROXY=false",
    "VITE_USE_LOCAL_SOLANA_RPC_PROXY=false",
    `VITE_FIGHT_ORACLE_PROGRAM_ID=${fightOracleProgramId}`,
    `VITE_DUEL_MARKET_PROGRAM_ID=${duelMarketProgramId}`,
    `VITE_ACTIVE_MATCH_ID=${Number.isSafeInteger(currentMatchId) ? currentMatchId : Date.now()}`,
    `VITE_HEADLESS_WALLET_SECRET_KEY=${Array.from(browserIdentity.secretKey).join(",")}`,
    "VITE_HEADLESS_WALLET_NAME=Read-only Acceptance Wallet",
    "VITE_HEADLESS_WALLET_AUTO_CONNECT=true",
  ].join("\n");

  await fs.writeFile(envPath, `${envBody}\n`, "utf8");
  await fs.writeFile(
    statePath,
    `${JSON.stringify(
      {
        mode: "public-read-only",
        cluster,
        solanaRpcUrl: rpcUrl,
        solanaWsUrl: rpcWsUrl,
        solanaTraderPublicKey: browserIdentity.publicKey.toBase58(),
        currentMatchId: Number.isSafeInteger(currentMatchId)
          ? currentMatchId
          : Date.now(),
        currentDuelId: duelId,
        currentDuelKeyHex: duelKeyHex,
        currentBetOpenTimeMs: cycle?.betOpenTime ?? null,
        currentBetCloseTimeMs: cycle?.betCloseTime ?? null,
        currentFightStartTimeMs: cycle?.fightStartTime ?? null,
        currentPhase: cycle?.phase ?? null,
        currentDuelSource: "real_hyperia",
        clobMarketState: marketState,
        expectedSeedSuccess: false,
        canStartNewRound: false,
        placeBetPayAsset: "SOL",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log(
    JSON.stringify({
      mode: "public-read-only",
      cluster,
      keeperUrl,
      duelId,
      duelKeyHex,
      marketState,
      lifecycleStatus: market.lifecycleStatus ?? null,
    }),
  );
}

void main();

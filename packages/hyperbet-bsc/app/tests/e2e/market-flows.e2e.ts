import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BorshAccountsCoder } from "@coral-xyz/anchor/dist/cjs/coder/borsh/index.js";
import type { Idl } from "@coral-xyz/anchor";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  createPublicClient,
  createWalletClient,
  fallback,
  http,
  keccak256,
  parseUnits,
  stringToHex,
  webSocket,
  type Address,
  type Hash,
} from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";

import { GOLD_CLOB_ABI } from "../../src/lib/goldClobAbi";

type E2eState = {
  solanaRpcUrl?: string;
  clobUserBalance?: string;
  solanaTraderPublicKey?: string;
  perpsCharacterId?: string;
  perpsMarketId?: number;
  evmRpcUrl?: string;
  evmChainId?: number;
  evmHeadlessAddress?: string;
  evmGoldClobAddress?: string;
  evmMatchId?: number;
  evmDuelId?: string;
  evmDuelKeyHex?: string;
  evmMarketKey?: string;
  evmBetCloseTimeMs?: number | null;
  evmLifecycleStatus?: string;
  evmDuelSource?: string;
  evmOracleAddress?: string;
  evmCanaryPrivateKey?: string;
  evmMatcherPrivateKey?: string;
  evmReporterPrivateKey?: string;
  evmMarketOperatorPrivateKey?: string;
  evmAdminPrivateKey?: string;
  evmPauserPrivateKey?: string;
  evmFinalizerPrivateKey?: string;
};

type EvmPrivateKeyField =
  | "evmCanaryPrivateKey"
  | "evmMatcherPrivateKey"
  | "evmReporterPrivateKey"
  | "evmMarketOperatorPrivateKey"
  | "evmAdminPrivateKey"
  | "evmPauserPrivateKey"
  | "evmFinalizerPrivateKey";

type PageDiagnostics = {
  consoleMessages: string[];
  pageErrors: string[];
  requestFailures: string[];
};

type PredictionMarketsResponse = {
  duel: {
    duelKey: string | null;
    duelId: string | null;
    phase: string | null;
    winner: string;
    betCloseTime: number | null;
  };
  markets: Array<{
    chainKey: string;
    duelKey: string | null;
    duelId: string | null;
    marketId: string | null;
    marketRef: string | null;
    lifecycleStatus: string;
    winner: string;
    betCloseTime: number | null;
    contractAddress: string | null;
    programId: string | null;
    txRef: string | null;
    syncedAt: number | null;
  }>;
  updatedAt: number | null;
};
type StreamStateResponse = {
  cycle?: {
    duelId?: string | number | null;
    duelKeyHex?: string | null;
    betOpenTime?: number | null;
    betCloseTime?: number | null;
    fightStartTime?: number | null;
    agent1?: { id?: string | null } | null;
    agent2?: { id?: string | null } | null;
  } | null;
};

type KeeperBotHealthResponse = {
  ok: boolean;
  running: boolean;
  health: {
    chainKey: string;
    updatedAtMs: number;
    running: boolean;
    recovery: string[];
    markets: Array<{
      lifecycleStatus: string;
      marketRef: string | null;
    }>;
  } | null;
};

type HarnessControl = {
  controlPath: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const statePath = path.resolve(__dirname, "./state.json");
const controlPath = path.resolve(__dirname, "./control.json");
const processControlScriptPath = path.resolve(
  __dirname,
  "../../../../../scripts/e2e-process-control.sh",
);
const GAME_API_URL = (process.env.E2E_GAME_API_URL || "http://127.0.0.1:5555")
  .trim()
  .replace(/\/$/, "");
const E2E_ARENA_WRITE_KEY =
  process.env.E2E_ARENA_WRITE_KEY?.trim() ||
  process.env.ARENA_EXTERNAL_BET_WRITE_KEY?.trim() ||
  process.env.VITE_ARENA_WRITE_KEY?.trim() ||
  "";
const E2E_DUEL_SOURCE =
  process.env.E2E_DUEL_SOURCE?.trim().toLowerCase() || "synthetic_publish";
const EXPECT_KEEPER_BOT =
  (process.env.E2E_EXPECT_KEEPER_BOT?.trim().toLowerCase() ?? "true") !==
  "false";
const anchorIdlDir = path.resolve(
  __dirname,
  "../../../../hyperbet-solana/anchor/target/idl",
);
const evmArtifactsDir = path.resolve(
  __dirname,
  "../../../../evm-contracts/artifacts/contracts",
);
const evmFoundryOutDir = path.resolve(__dirname, "../../../../evm-contracts/out");

function readFirstExistingJson(candidatePaths: string[]): unknown {
  for (const candidatePath of candidatePaths) {
    if (!fs.existsSync(candidatePath)) continue;
    return JSON.parse(fs.readFileSync(candidatePath, "utf8")) as unknown;
  }
  throw new Error(`Missing artifact. Checked: ${candidatePaths.join(", ")}`);
}

const goldPerpsIdl = JSON.parse(
  fs.readFileSync(path.join(anchorIdlDir, "gold_perps_market.json"), "utf8"),
) as Idl;
const duelOutcomeOracleArtifact = readFirstExistingJson(
  [
    path.join(
      evmArtifactsDir,
      "DuelOutcomeOracle.sol",
      "DuelOutcomeOracle.json",
    ),
    path.join(
      evmFoundryOutDir,
      "DuelOutcomeOracle.sol",
      "DuelOutcomeOracle.json",
    ),
  ],
) as { abi: readonly unknown[] };
const goldClobArtifact = readFirstExistingJson(
  [
    path.join(evmArtifactsDir, "GoldClob.sol", "GoldClob.json"),
    path.join(evmFoundryOutDir, "GoldClob.sol", "GoldClob.json"),
  ],
) as { abi: readonly unknown[] };
const _perpsCoder = new BorshAccountsCoder(goldPerpsIdl);
const perpsProgramId = new PublicKey(
  (goldPerpsIdl as Idl & { address: string }).address,
);
const MARKET_KIND_DUEL_WINNER = 0;
const BUY_SIDE = 1;
const DUEL_STATUS_BETTING_OPEN = 2;
const DUEL_STATUS_LOCKED = 3;
const ORDER_FLAG_GTC = 0x01;
const DISPUTE_WINDOW_SECONDS = 3_600;
const E2E_BET_WINDOW_SECONDS = 3_600n;
const E2E_DUEL_START_DELAY_SECONDS = 60n;
const E2E_PREDICTION_AMOUNT = "0.005";
const E2E_LIGHT_PREDICTION_AMOUNT = "0.001";
const E2E_LIGHT_SEED_SELL_AMOUNT = "0.0005";
const E2E_CANCEL_PREDICTION_AMOUNT = "0.00025";
const ACTIVE_MARKET_UI = /open|live/i;
const LIVE_DUEL_MIN_OPEN_WINDOW_MS = parsePositiveInteger(
  process.env.E2E_LIVE_DUEL_TRADE_WINDOW_MS,
  175_000,
);
const PREPARED_LIVE_DUEL_MIN_OPEN_WINDOW_MS = 60_000;
const LIVE_DUEL_FRESH_WAIT_MS = 480_000;
const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000";
const DEFAULT_ANVIL_MNEMONIC =
  "test test test test test test test test test test test junk";
const SELL_SIDE = 2;
const reservedRealEvmDuelIds = new Set<string>();
let preparedRealEvmFixtureConsumed = false;

type PreparedRealEvmFixture = {
  duelId: string;
  duelKey: Hash;
  marketKey: Hash;
  betCloseTimeMs: number | null;
  lifecycleStatus: string | null;
};

function parsePositiveInteger(
  value: string | null | undefined,
  fallback: number,
): number {
  const parsed = Number(value?.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.trunc(parsed);
}

function loadState(): E2eState {
  return JSON.parse(fs.readFileSync(statePath, "utf8")) as E2eState;
}

function requireStatePrivateKey(
  state: E2eState,
  field: EvmPrivateKeyField,
): `0x${string}` {
  const value = state[field];
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value.trim())) {
    throw new Error(
      `Missing ${field} in e2e state (${statePath}); rerun local setup to refresh EVM role keys.`,
    );
  }
  return value.trim() as `0x${string}`;
}

function loadControl(): HarnessControl {
  return JSON.parse(fs.readFileSync(controlPath, "utf8")) as HarnessControl;
}

function consumePreparedRealEvmFixture(): PreparedRealEvmFixture | null {
  if (preparedRealEvmFixtureConsumed || E2E_DUEL_SOURCE !== "real_hyperscapes") {
    return null;
  }
  const state = loadState();
  const fixtureDuelId =
    typeof state.evmDuelId === "string" && state.evmDuelId.trim().length > 0
      ? state.evmDuelId.trim()
      : state.evmMatchId != null
        ? String(state.evmMatchId)
        : "";
  if (!fixtureDuelId) {
    return null;
  }
  preparedRealEvmFixtureConsumed = true;
  return {
    duelId: fixtureDuelId,
    duelKey: normalizeHex32(state.evmDuelKeyHex, "prepared evm duel key"),
    marketKey: normalizeHex32(state.evmMarketKey, "prepared evm market key"),
    betCloseTimeMs:
      typeof state.evmBetCloseTimeMs === "number"
        ? state.evmBetCloseTimeMs
        : null,
    lifecycleStatus:
      typeof state.evmLifecycleStatus === "string"
        ? state.evmLifecycleStatus
        : null,
  };
}

function runProcessControl(
  control: HarnessControl,
  action: "restart",
  service: "keeper" | "anvil" | "hyperscapes" | "hyperscapesClient",
): void {
  execFileSync(
    "bash",
    [processControlScriptPath, action, control.controlPath, service],
    {
      stdio: "inherit",
    },
  );
}

function encodeMarketId(marketId: number): Buffer {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(marketId), 0);
  return bytes;
}

function _derivePerpsPositionPda(owner: PublicKey, marketId: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), owner.toBuffer(), encodeMarketId(marketId)],
    perpsProgramId,
  )[0];
}

function _bnLikeToBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (value && typeof value === "object" && "toString" in value) {
    return BigInt((value as { toString: () => string }).toString());
  }
  return 0n;
}

function normalizeHex32(value: string | undefined, label: string): Hash {
  const normalized = value?.trim().toLowerCase().replace(/^0x/, "") || "";
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`Missing or invalid ${label} in e2e state`);
  }
  return `0x${normalized}`;
}

async function fetchJson<T>(
  request: APIRequestContext,
  pathname: string,
): Promise<T> {
  const response = await request.get(`${GAME_API_URL}${pathname}`);
  expect(response.ok(), `GET ${pathname} should succeed`).toBeTruthy();
  return (await response.json()) as T;
}

async function postJson<T>(
  request: APIRequestContext,
  pathname: string,
  body: unknown,
): Promise<T> {
  const response = await request.post(`${GAME_API_URL}${pathname}`, {
    data: body,
    headers: E2E_ARENA_WRITE_KEY
      ? { "x-arena-write-key": E2E_ARENA_WRITE_KEY }
      : undefined,
  });
  expect(response.ok(), `POST ${pathname} should succeed`).toBeTruthy();
  return (await response.json()) as T;
}

async function fetchPredictionMarkets(
  request: APIRequestContext,
): Promise<PredictionMarketsResponse> {
  return fetchJson<PredictionMarketsResponse>(
    request,
    "/api/arena/prediction-markets/active",
  );
}

async function _fetchStreamState(
  request: APIRequestContext,
): Promise<StreamStateResponse> {
  return fetchJson<StreamStateResponse>(request, "/api/streaming/state");
}

async function fetchBotHealth(
  request: APIRequestContext,
): Promise<KeeperBotHealthResponse> {
  return fetchJson<KeeperBotHealthResponse>(request, "/api/keeper/bot-health");
}

async function waitForKeeperBotHealth(
  request: APIRequestContext,
  _chainKey: string,
  _marketRef: string | null,
): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          const payload = await fetchBotHealth(request);
          return {
            ok: payload.ok,
            running: payload.running,
            hasChainKey:
              typeof payload.health?.chainKey === "string" &&
              payload.health.chainKey.length > 0,
            hasRecovery: Array.isArray(payload.health?.recovery),
            hasSnapshot: payload.health != null,
          };
        } catch {
          return {
            ok: false,
            running: false,
            hasChainKey: false,
            hasRecovery: false,
            hasSnapshot: false,
          };
        }
      },
      {
        timeout: 90_000,
        intervals: [1_000, 2_000, 5_000],
      },
    )
    .toEqual({
      ok: true,
      running: EXPECT_KEEPER_BOT,
      hasChainKey: true,
      hasRecovery: true,
      hasSnapshot: true,
    });
}

async function waitForPredictionMarketState(
  request: APIRequestContext,
  chainKey: "bsc" | "avax",
  duelKey: Hash,
  marketRef: string | null,
  lifecycleStatus: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const predictionMarkets = await fetchPredictionMarkets(request);
        const evmMarket = findPredictionMarket(predictionMarkets, chainKey, {
          duelKey,
          marketRef,
        });
        return {
          duelKey: evmMarket?.duelKey ?? predictionMarkets.duel.duelKey,
          marketRef: evmMarket?.marketRef ?? null,
          lifecycleStatus: evmMarket?.lifecycleStatus ?? null,
        };
      },
      {
        timeout: 60_000,
        intervals: [500, 1_000, 2_000, 5_000],
      },
    )
    .toEqual({
      duelKey: duelKey.slice(2),
      marketRef,
      lifecycleStatus,
    });
}

async function publishEvmCycleState(
  request: APIRequestContext,
  chainKey: "bsc" | "avax",
  duelKey: Hash,
  duelId: string,
  cycleId: string,
): Promise<void> {
  if (E2E_DUEL_SOURCE !== "synthetic_publish") {
    throw new Error(
      `publishEvmCycleState requires synthetic_publish duel source, got ${E2E_DUEL_SOURCE}`,
    );
  }
  await postJson<{ ok: boolean; seq: number }>(
    request,
    "/api/streaming/state/publish",
    {
      cycle: {
        cycleId,
        phase: "FIGHTING",
        duelId,
        duelKeyHex: duelKey.slice(2),
        cycleStartTime: Date.now() - 90_000,
        phaseStartTime: Date.now() - 30_000,
        phaseEndTime: Date.now() + 30_000,
        betOpenTime: Date.now() - 15_000,
        betCloseTime: Date.now() + 300_000,
        fightStartTime: Date.now() + 60_000,
        duelEndTime: null,
        countdown: 30,
        timeRemaining: 30_000,
        winnerId: null,
        winnerName: null,
        winReason: null,
        seed: null,
        replayHash: null,
        agent1: {
          id: `${chainKey}-fresh-agent-a`,
          name: "Agent A",
          provider: "Hyperscape",
          model: "alpha-local",
          hp: 80,
          maxHp: 100,
          combatLevel: 88,
          wins: 12,
          losses: 4,
          damageDealtThisFight: 148,
          inventory: [],
          monologues: [],
        },
        agent2: {
          id: `${chainKey}-fresh-agent-b`,
          name: "Agent B",
          provider: "OpenRouter",
          model: "beta-local",
          hp: 76,
          maxHp: 100,
          combatLevel: 84,
          wins: 10,
          losses: 5,
          damageDealtThisFight: 131,
          inventory: [],
          monologues: [],
        },
      },
      leaderboard: [],
      cameraTarget: null,
    },
  );
}

function findPredictionMarket(
  payload: PredictionMarketsResponse,
  chainKey: string,
  expected?: {
    duelKey?: Hash | string | null;
    marketRef?: string | null;
  },
) {
  const normalizedDuelKey = expected?.duelKey?.toLowerCase().replace(/^0x/, "") ?? null;
  const normalizedMarketRef =
    expected?.marketRef?.toLowerCase().replace(/^0x/, "") ?? null;

  return (
    payload.markets.find((market) => {
      if (market.chainKey !== chainKey) return false;
      if (normalizedDuelKey && market.duelKey?.toLowerCase() !== normalizedDuelKey) return false;
      if (
        normalizedMarketRef &&
        market.marketRef?.toLowerCase().replace(/^0x/, "") !== normalizedMarketRef
      ) {
        return false;
      }
      return true;
    }) ??
    payload.markets.find((market) => market.chainKey === chainKey) ??
    null
  );
}

function hashLabel(label: string): Hash {
  return keccak256(stringToHex(label));
}

function quoteCost(side: number, price: number, amount: bigint): bigint {
  const component = BigInt(side === 1 ? price : 1000 - price);
  return (amount * component) / 1000n;
}

function supportsTimeTravelRpc(rpcUrl: string): boolean {
  return (
    rpcUrl.startsWith("http://127.0.0.1") || rpcUrl.startsWith("http://localhost")
  );
}

function deriveAlchemyWsUrl(rpcUrl: string): string | null {
  if (!rpcUrl.includes(".alchemy.com/")) return null;
  if (rpcUrl.startsWith("https://")) {
    return `wss://${rpcUrl.slice("https://".length)}`;
  }
  if (rpcUrl.startsWith("http://")) {
    return `ws://${rpcUrl.slice("http://".length)}`;
  }
  return null;
}

function createEvmTransport(rpcUrl: string) {
  const httpTransport = http(rpcUrl, {
    retryCount: 8,
    retryDelay: 250,
    timeout: 20_000,
  });
  if (process.env.E2E_ENABLE_DIRECT_EVM_WS === "true") {
    const wsUrl = deriveAlchemyWsUrl(rpcUrl);
    if (wsUrl) {
      return fallback([webSocket(wsUrl), httpTransport], { rank: false });
    }
  }
  return httpTransport;
}

async function sendEvmRpc(
  publicClient: ReturnType<typeof createPublicClient>,
  method: string,
  params: unknown[] = [],
): Promise<void> {
  const requestRpc = publicClient.request as (request: {
    method: string;
    params?: unknown[];
  }) => Promise<unknown>;
  await requestRpc({ method, params });
}

async function advanceEvmTime(
  publicClient: ReturnType<typeof createPublicClient>,
  seconds: number,
): Promise<void> {
  await sendEvmRpc(publicClient, "evm_increaseTime", [seconds]);
  await sendEvmRpc(publicClient, "evm_mine");
}

async function resolveEvmWinner(
  publicClient: ReturnType<typeof createPublicClient>,
  adminWalletClient: ReturnType<typeof createWalletClient>,
  finalizerWalletClient: ReturnType<typeof createWalletClient>,
  oracleAddress: Address,
  contractAddress: Address,
  duelKey: Hash,
  metadataPrefix: string,
): Promise<void> {
  const duel = (await publicClient.readContract({
    address: oracleAddress,
    abi: duelOutcomeOracleArtifact.abi,
    functionName: "getDuel",
    args: [duelKey],
  })) as {
    participantAHash: Hash;
    participantBHash: Hash;
    betOpenTs: bigint;
    betCloseTs: bigint;
    duelStartTs: bigint;
  };

  const lockTs = duel.betCloseTs + 1n;
  await sendEvmRpc(publicClient, "evm_setNextBlockTimestamp", [Number(lockTs)]);
  await sendEvmRpc(publicClient, "evm_mine");

  const lockTx = await adminWalletClient.writeContract({
    address: oracleAddress,
    abi: duelOutcomeOracleArtifact.abi,
    functionName: "upsertDuel",
    args: [
      duelKey,
      duel.participantAHash,
      duel.participantBHash,
      duel.betOpenTs,
      duel.betCloseTs,
      duel.duelStartTs,
      `${metadataPrefix}/locked`,
      DUEL_STATUS_LOCKED,
    ],
  });
  await waitForEvmReceipt(publicClient, lockTx);

  const proposalTx = await adminWalletClient.writeContract({
    address: oracleAddress,
    abi: duelOutcomeOracleArtifact.abi,
    functionName: "proposeResult",
    args: [
      duelKey,
      1,
      42n,
      hashLabel(`${metadataPrefix}-replay`),
      hashLabel(`${metadataPrefix}-result`),
      lockTs + 60n,
      `${metadataPrefix}/proposal`,
    ],
  });
  await waitForEvmReceipt(publicClient, proposalTx);

  await advanceEvmTime(publicClient, DISPUTE_WINDOW_SECONDS);

  const finalizeTx = await finalizerWalletClient.writeContract({
    address: oracleAddress,
    abi: duelOutcomeOracleArtifact.abi,
    functionName: "finalizeResult",
    args: [duelKey, `${metadataPrefix}/final`],
  });
  await waitForEvmReceipt(publicClient, finalizeTx);

  const syncTx = await adminWalletClient.writeContract({
    address: contractAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "syncMarketFromOracle",
    args: [duelKey, MARKET_KIND_DUEL_WINNER],
  });
  await waitForEvmReceipt(publicClient, syncTx);
}

async function createFreshEvmOpenMarket(
  request: APIRequestContext,
  publicClient: ReturnType<typeof createPublicClient>,
  reporterWalletClient: ReturnType<typeof createWalletClient>,
  marketOperatorWalletClient: ReturnType<typeof createWalletClient>,
  makerWalletClient: ReturnType<typeof createWalletClient>,
  oracleAddress: Address,
  contractAddress: Address,
  chainKey: "bsc" | "avax",
  options?: {
    seedBuyOrder?: boolean;
    seedSellAmount?: string;
    seedBuyAmount?: string;
  },
): Promise<{ duelKey: Hash; duelId: string; marketKey: Hash }> {
  const uniqueKey = `${chainKey}-gate10-${Date.now()}`;
  let duelKey = keccak256(stringToHex(uniqueKey));
  let duelId = `${Date.now()}`;
  const reporterAddress =
    reporterWalletClient.account?.address as Address | undefined;
  const marketOperatorAddress =
    marketOperatorWalletClient.account?.address as Address | undefined;
  const makerAddress = makerWalletClient.account?.address as Address | undefined;
  if (!reporterAddress || !marketOperatorAddress || !makerAddress) {
    throw new Error("Missing wallet client account for EVM market setup");
  }

  if (E2E_DUEL_SOURCE === "real_hyperscapes") {
    const liveMarket = await waitForPreparedOrFreshRealEvmMarket(
      request,
      publicClient,
      oracleAddress,
      contractAddress,
      chainKey,
    );
    duelKey = liveMarket.duelKey;
    duelId = liveMarket.duelId;
    await ensureEvmSeedLiquidity(
      publicClient,
      makerWalletClient,
      contractAddress,
      duelKey,
      options,
    );
    await waitForPredictionMarketState(
      request,
      chainKey,
      duelKey,
      liveMarket.marketKey,
      "OPEN",
    );
    return { duelKey, duelId, marketKey: liveMarket.marketKey };
  }

  let nextReporterNonce = await publicClient.getTransactionCount({
    address: reporterAddress,
    blockTag: "pending",
  });
  let nextMarketOperatorNonce = await publicClient.getTransactionCount({
    address: marketOperatorAddress,
    blockTag: "pending",
  });
  const sharedReporterAndOperatorNonce =
    reporterAddress.toLowerCase() === marketOperatorAddress.toLowerCase()
      ? nextReporterNonce
      : null;
  const consumeReporterNonce = (): number => {
    if (sharedReporterAndOperatorNonce !== null) {
      nextReporterNonce += 1;
      nextMarketOperatorNonce = nextReporterNonce;
      return nextReporterNonce - 1;
    }
    const nonce = nextReporterNonce;
    nextReporterNonce += 1;
    return nonce;
  };
  const consumeMarketOperatorNonce = (): number => {
    if (sharedReporterAndOperatorNonce !== null) {
      const nonce = nextReporterNonce;
      nextReporterNonce += 1;
      nextMarketOperatorNonce = nextReporterNonce;
      return nonce;
    }
    const nonce = nextMarketOperatorNonce;
    nextMarketOperatorNonce += 1;
    return nonce;
  };
  const latestBlock = await publicClient.getBlock({ blockTag: "latest" });
  const betOpenTs = latestBlock.timestamp - 15n;
  const betCloseTs = betOpenTs + E2E_BET_WINDOW_SECONDS;
  const duelStartTs = betCloseTs + E2E_DUEL_START_DELAY_SECONDS;
  const participantALabel = `${chainKey}-fresh-agent-a`;
  const participantBLabel = `${chainKey}-fresh-agent-b`;

  const upsertTx = await reporterWalletClient.writeContract({
    address: oracleAddress,
    abi: duelOutcomeOracleArtifact.abi,
    functionName: "upsertDuel",
    args: [
      duelKey,
      hashLabel(participantALabel),
      hashLabel(participantBLabel),
      betOpenTs,
      betCloseTs,
      duelStartTs,
      `${uniqueKey}-open`,
      DUEL_STATUS_BETTING_OPEN,
    ],
    nonce: consumeReporterNonce(),
  });
  await waitForEvmReceipt(publicClient, upsertTx);

  const existingMarket = (await publicClient.readContract({
    address: contractAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "getMarket",
    args: [duelKey, MARKET_KIND_DUEL_WINNER],
  })) as { exists?: boolean };
  if (!existingMarket?.exists) {
    const createMarketTx = await marketOperatorWalletClient.writeContract({
      address: contractAddress,
      abi: goldClobArtifact.abi,
      functionName: "createMarketForDuel",
      args: [duelKey, MARKET_KIND_DUEL_WINNER],
      nonce: consumeMarketOperatorNonce(),
    });
    await waitForEvmReceipt(publicClient, createMarketTx);
  }

  await ensureEvmSeedLiquidity(
    publicClient,
    makerWalletClient,
    contractAddress,
    duelKey,
    options,
  );

  const marketKey = (await publicClient.readContract({
    address: contractAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "marketKey",
    args: [duelKey, MARKET_KIND_DUEL_WINNER],
  })) as Hash;

  if (E2E_DUEL_SOURCE === "synthetic_publish") {
    await publishEvmCycleState(
      request,
      chainKey,
      duelKey,
      duelId,
      `${uniqueKey}-cycle`,
    );
  }
  await waitForPredictionMarketState(
    request,
    chainKey,
    duelKey,
    marketKey,
    "OPEN",
  );

  if (!marketKey) {
    throw new Error(`Missing market key for ${chainKey} duel ${duelId}`);
  }

  return { duelKey, duelId, marketKey };
}

function buildMockEvmPredictionMarketsResponse(
  state: E2eState,
  chainKey: "bsc" | "avax",
  lifecycleStatus: string,
  winner: string,
): PredictionMarketsResponse {
  const duelKey = normalizeHex32(state.evmDuelKeyHex, "evmDuelKeyHex").slice(2);
  const duelId = state.evmMatchId != null ? String(state.evmMatchId) : null;
  const phase =
    lifecycleStatus === "OPEN"
      ? "ANNOUNCEMENT"
      : lifecycleStatus === "LOCKED"
        ? "COUNTDOWN"
        : "RESOLUTION";

  return {
    duel: {
      duelKey,
      duelId,
      phase,
      winner,
      betCloseTime: Date.now(),
    },
    markets: [
      {
        chainKey,
        duelKey,
        duelId,
        marketId: state.evmMarketKey ?? null,
        marketRef: state.evmMarketKey ?? null,
        lifecycleStatus,
        winner,
        betCloseTime: Date.now(),
        contractAddress: state.evmGoldClobAddress ?? null,
        programId: null,
        txRef: null,
        syncedAt: Date.now(),
      },
    ],
    updatedAt: Date.now(),
  };
}

async function readText(page: Page, testId: string): Promise<string> {
  const locator = page.getByTestId(testId).first();
  const count = await locator.count().catch(() => 0);
  if (count === 0) return "";
  return ((await locator.textContent().catch(() => "")) || "").trim();
}

async function readTxSignature(page: Page, testId: string): Promise<string> {
  const text = await readText(page, testId);
  if (!text) return "";
  const delimiterIndex = text.indexOf(":");
  if (delimiterIndex >= 0) {
    return text.slice(delimiterIndex + 1).trim();
  }
  return text;
}

function getPageDiagnostics(page: Page): PageDiagnostics {
  const instrumentedPage = page as Page & {
    __hyperbetDiagnostics?: PageDiagnostics;
  };
  if (instrumentedPage.__hyperbetDiagnostics) {
    return instrumentedPage.__hyperbetDiagnostics;
  }

  const diagnostics: PageDiagnostics = {
    consoleMessages: [],
    pageErrors: [],
    requestFailures: [],
  };
  const append = (entries: string[], value: string, limit = 12) => {
    entries.push(value);
    if (entries.length > limit) {
      entries.splice(0, entries.length - limit);
    }
  };

  page.on("console", (message) => {
    const text = `[${message.type()}] ${message.text()}`.trim();
    append(diagnostics.consoleMessages, text);
  });
  page.on("pageerror", (error) => {
    append(
      diagnostics.pageErrors,
      error instanceof Error ? error.stack || error.message : String(error),
    );
  });
  page.on("requestfailed", (request) => {
    append(
      diagnostics.requestFailures,
      `${request.method()} ${request.url()} :: ${request.failure()?.errorText || "unknown"}`,
    );
  });

  instrumentedPage.__hyperbetDiagnostics = diagnostics;
  return diagnostics;
}

async function gotoApp(
  page: Page,
  options: {
    e2eEvmDuelKey?: string | null;
    e2eEvmDuelId?: string | null;
  } = {},
): Promise<void> {
  const diagnostics = getPageDiagnostics(page);
  const params = new URLSearchParams({ debug: "1" });
  if (options.e2eEvmDuelKey) {
    params.set(
      "e2eEvmDuelKey",
      options.e2eEvmDuelKey.replace(/^0x/i, ""),
    );
  }
  if (options.e2eEvmDuelId) {
    params.set("e2eEvmDuelId", options.e2eEvmDuelId);
  }
  const appUrl = `/?${params.toString()}`;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(appUrl, { waitUntil: "domcontentloaded" });
    try {
      await expect
        .poll(
          async () => {
            const bodyText = (
              (await page
                .locator("body")
                .textContent()
                .catch(() => "")) || ""
            )
              .trim()
              .toUpperCase();
            if (
              bodyText.includes("HYPERSCAPE DUEL ARENA") ||
              bodyText.includes("ULTRA SIMPLE FIGHT BET")
            ) {
              return bodyText;
            }
            return "";
          },
          {
            timeout: 60_000,
            intervals: [500, 1_000, 2_000, 5_000],
          },
        )
        .not.toBe("");
      return;
    } catch (error) {
      if (attempt === 2) {
        const [url, title, bodyHtml] = await Promise.all([
          Promise.resolve(page.url()),
          page.title().catch(() => ""),
          page
            .locator("body")
            .evaluate((element) => element.innerHTML.slice(0, 2_000))
            .catch(() => ""),
        ]);
        const diagnosticLines = [
          `url=${url || "-"}`,
          `title=${title || "-"}`,
          bodyHtml ? `body=${bodyHtml}` : "body=-",
        ];
        if (diagnostics.pageErrors.length > 0) {
          diagnosticLines.push(
            `pageErrors=${diagnostics.pageErrors.join(" | ")}`,
          );
        }
        if (diagnostics.requestFailures.length > 0) {
          diagnosticLines.push(
            `requestFailures=${diagnostics.requestFailures.join(" | ")}`,
          );
        }
        if (diagnostics.consoleMessages.length > 0) {
          diagnosticLines.push(
            `console=${diagnostics.consoleMessages.join(" | ")}`,
          );
        }

        throw new Error(
          `[gotoApp] app shell did not render. ${diagnosticLines.join("\n")}`,
          { cause: error },
        );
      }
      await page.goto("about:blank");
    }
  }
}

async function waitForNewText(
  page: Page,
  testId: string,
  previousValue = "",
  timeoutMs = 180_000,
): Promise<string> {
  let matched = "";
  await expect
    .poll(
      async () => {
        const next = await readText(page, testId);
        if (!next || next === "-" || next === previousValue) {
          return "";
        }
        matched = next;
        return next;
      },
      {
        timeout: timeoutMs,
        intervals: [1_000, 2_000, 5_000],
      },
    )
    .not.toBe("");
  return matched;
}

async function waitForNewEvmTxText(
  page: Page,
  txTestId: string,
  previousValue: string,
  label: string,
  timeoutMs = 60_000,
): Promise<string> {
  const startedAt = Date.now();
  let lastStatus = "";
  let lastTx = "";

  while (Date.now() - startedAt < timeoutMs) {
    lastTx = await readText(page, txTestId);
    lastStatus = await readText(page, "evm-status");
    console.log(
      `[e2e][evm] ${label} status=${lastStatus || "-"} tx=${lastTx || "-"}`,
    );
    if (lastTx && lastTx !== "-" && lastTx !== previousValue) {
      return lastTx;
    }
    await page.waitForTimeout(1_000);
  }

  const debugSnapshot = await attachEvmFailureDiagnostics(page, label);

  throw new Error(
    `[e2e][evm] ${label} failed after submit click but before tx emission. status=${lastStatus || "-"} tx=${lastTx || "-"} wallet=${debugSnapshot.wallet || "-"} lifecycle=${debugSnapshot.lifecycle || "-"} lastOrderTx=${debugSnapshot.lastOrderTx || "-"} lastClaimTx=${debugSnapshot.lastClaimTx || "-"}`,
  );
}

async function waitForEvmPanelReady(
  page: Page,
  timeoutMs = 120_000,
): Promise<void> {
  const refreshButton = page.getByTestId("refresh-market").first();
  if (await refreshButton.isVisible().catch(() => false)) {
    await clickRefreshMarket(page).catch(() => undefined);
  }

  await expect
    .poll(
      async () => {
        const debug = await readText(page, "evm-lifecycle-debug");
        if (!debug) return "";
        return debug.includes("refreshErr=-") ? "ready" : debug;
      },
      {
        timeout: timeoutMs,
        intervals: [1_000, 2_000, 5_000],
      },
    )
    .toBe("ready");
}

async function clickRefreshMarket(page: Page): Promise<void> {
  const refreshButton = page.getByTestId("refresh-market").first();
  await expect(refreshButton).toBeVisible({ timeout: 30_000 });
  try {
    await refreshButton.click({ timeout: 10_000 });
  } catch {
    try {
      await refreshButton.click({ timeout: 10_000, force: true });
    } catch {
      await refreshButton.evaluate((button: HTMLButtonElement) => button.click());
    }
  }
}

async function attachEvmFailureDiagnostics(
  page: Page,
  label: string,
): Promise<{
  wallet: string;
  lifecycle: string;
  status: string;
  lastOrderTx: string;
  lastClaimTx: string;
}> {
  const snapshot = {
    wallet: await readText(page, "evm-wallet-debug"),
    lifecycle: await readText(page, "evm-lifecycle-debug"),
    status: await readText(page, "evm-status"),
    lastOrderTx: await readText(page, "evm-last-order-tx"),
    lastClaimTx: await readText(page, "evm-last-claim-tx"),
  };
  const attachments: Array<[string, string]> = [
    ["evm-wallet-debug", snapshot.wallet || "-"],
    ["evm-lifecycle-debug", snapshot.lifecycle || "-"],
    ["evm-status", snapshot.status || "-"],
    ["evm-last-order-tx", snapshot.lastOrderTx || "-"],
    ["evm-last-claim-tx", snapshot.lastClaimTx || "-"],
  ];
  for (const [name, value] of attachments) {
    await test.info().attach(`${label}-${name}`, {
      body: value,
      contentType: "text/plain",
    });
  }
  return snapshot;
}

async function ensureEvmPanelReadyOrThrow(
  page: Page,
  label: string,
): Promise<void> {
  try {
    await waitForEvmPanelReady(page);
  } catch (error) {
    const debugSnapshot = await attachEvmFailureDiagnostics(page, label);
    throw new Error(
      `[e2e][evm] ${label} failed before panel ready. status=${debugSnapshot.status || "-"} wallet=${debugSnapshot.wallet || "-"} lifecycle=${debugSnapshot.lifecycle || "-"}`,
      { cause: error },
    );
  }
}

async function waitForEvmPositionComponentOrThrow(
  page: Page,
  publicClient: ReturnType<typeof createPublicClient>,
  contractAddress: Address,
  marketKey: Hash,
  userAddress: Address,
  index: 0 | 1,
  label: string,
): Promise<void> {
  try {
    await expect
      .poll(async () => {
        const result = await readEvmPosition(
          publicClient,
          contractAddress,
          marketKey,
          userAddress,
        );
        return result[index];
      })
      .toBeGreaterThan(0n);
  } catch (error) {
    const debugSnapshot = await attachEvmFailureDiagnostics(page, label);
    throw new Error(
      `[e2e][evm] ${label} emitted a tx but no on-chain position delta followed. status=${debugSnapshot.status || "-"} lastOrderTx=${debugSnapshot.lastOrderTx || "-"} lifecycle=${debugSnapshot.lifecycle || "-"}`,
      { cause: error },
    );
  }
}

async function _waitForNewTxSignature(
  page: Page,
  testId: string,
  previousSignature = "",
  timeoutMs = 180_000,
): Promise<string> {
  let matched = "";
  await expect
    .poll(
      async () => {
        const next = await readTxSignature(page, testId);
        if (next && next !== "-" && next !== previousSignature) {
          matched = next;
          return next;
        }
        return "";
      },
      {
        timeout: timeoutMs,
        intervals: [1_000, 2_000, 5_000],
      },
    )
    .not.toBe("");
  return matched;
}

async function _ensureWalletConnected(page: Page): Promise<void> {
  const hasConnectedSolanaWallet = async (): Promise<boolean> => {
    const desktopWalletChip = page
      .getByRole("button", { name: /^SOL\s+[A-Za-z0-9].*/i })
      .first();
    if (await desktopWalletChip.isVisible().catch(() => false)) return true;

    const mobileWalletChip = page
      .getByRole("button", { name: /^◎\s*[A-Za-z0-9].*/i })
      .first();
    if (await mobileWalletChip.isVisible().catch(() => false)) return true;

    return false;
  };

  const selectHeadlessWallet = async (): Promise<boolean> => {
    const walletOption = page
      .getByRole("button", { name: /E2E Trader/i })
      .first();
    if (!(await walletOption.isVisible().catch(() => false))) return false;
    await walletOption.click({ force: true });
    await expect(
      page.getByRole("dialog", {
        name: /Connect a wallet on Solana to continue/i,
      }),
    )
      .toBeHidden({ timeout: 30_000 })
      .catch(() => undefined);
    return true;
  };

  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (await hasConnectedSolanaWallet()) return;

    if (await selectHeadlessWallet()) {
      await page.waitForTimeout(1_500);
      continue;
    }

    const connectButton = page
      .getByRole("button", {
        name: /connect wallet|select wallet|connect|add sol wallet|connect sol/i,
      })
      .first();
    if (await connectButton.isVisible().catch(() => false)) {
      await connectButton.click();
    }
    await selectHeadlessWallet();
    await page.waitForTimeout(1_500);
  }

  await expect.poll(hasConnectedSolanaWallet, { timeout: 60_000 }).toBe(true);
}

async function selectChain(
  page: Page,
  chain: "solana" | "bsc" | "base",
): Promise<void> {
  const normalizedChain = chain.toLowerCase();
  const debugSelector = page.getByTestId("e2e-chain-select").first();
  const primarySelector = page.locator("#chain-selector").first();

  let selectorReady = false;
  for (let attempt = 0; attempt < 3 && !selectorReady; attempt += 1) {
    await page.waitForLoadState("domcontentloaded");
    try {
      await expect
        .poll(
          async () => {
            if (await debugSelector.isVisible().catch(() => false))
              return "debug";
            if (await primarySelector.isVisible().catch(() => false))
              return "primary";
            return "";
          },
          {
            timeout: 20_000,
            intervals: [500, 1_000, 2_000, 5_000],
          },
        )
        .not.toBe("");
      selectorReady = true;
    } catch (error) {
      if (attempt === 2) throw error;
      await page.reload({ waitUntil: "domcontentloaded" });
    }
  }

  if (await debugSelector.isVisible().catch(() => false)) {
    await debugSelector.selectOption(normalizedChain);
    await expect(page.getByTestId("e2e-active-chain")).toHaveText(
      normalizedChain,
    );
    return;
  }

  if (await primarySelector.isVisible().catch(() => false)) {
    await primarySelector.selectOption(normalizedChain);
    await expect(primarySelector).toHaveValue(normalizedChain);
    return;
  }

  const fallbackComboboxes = page.getByRole("combobox");
  const comboboxCount = await fallbackComboboxes.count();
  for (let index = 0; index < comboboxCount; index += 1) {
    const selector = fallbackComboboxes.nth(index);
    if (!(await selector.isVisible().catch(() => false))) continue;

    const options = await selector
      .locator("option")
      .evaluateAll((nodes) =>
        nodes.map((node) => ({
          value: node.getAttribute("value") || "",
          label: (node.textContent || "").trim().toLowerCase(),
        })),
      )
      .catch(() => []);
    const matchingOption = options.find((option) =>
      `${option.value} ${option.label}`.includes(
        normalizedChain === "solana" ? "sol" : normalizedChain,
      ),
    );
    if (!matchingOption) continue;

    await selector.selectOption(matchingOption.value || normalizedChain);
    await expect
      .poll(async () => {
        const value = (
          await selector.inputValue().catch(() => "")
        ).toLowerCase();
        const selectedLabel = (
          (await selector
            .locator("option:checked")
            .textContent()
            .catch(() => "")) || ""
        ).toLowerCase();
        return `${value} ${selectedLabel}`;
      })
      .toContain(normalizedChain === "solana" ? "sol" : normalizedChain);
    return;
  }

  throw new Error(`Unable to locate a visible chain selector for ${chain}`);
}

async function _openSolanaAdminPanel(page: Page): Promise<void> {
  const adminPanel = page.getByTestId("solana-clob-admin-panel");
  if (await adminPanel.isVisible().catch(() => false)) return;

  const adminToggle = page.getByTestId("solana-clob-admin-toggle").first();
  if (!(await adminToggle.isVisible().catch(() => false))) return;

  await adminToggle.click({ force: true });
  await expect(adminPanel).toBeVisible();
}

async function _expectSolanaTxSuccess(
  connection: Connection,
  signature: string,
  label: string,
): Promise<void> {
  expect(signature, `${label} signature missing`).not.toBe("");
  expect(signature, `${label} signature missing`).not.toBe("-");

  const readStatus = async () => {
    try {
      const statuses = await connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      });
      return statuses.value[0] ?? null;
    } catch {
      return null;
    }
  };

  await expect
    .poll(
      async () => {
        const status = await readStatus();
        if (!status) return "missing";
        if (status.err) return "failed";
        return status.confirmationStatus || "confirmed";
      },
      {
        timeout: 180_000,
        intervals: [1_000, 2_000, 5_000],
      },
    )
    .not.toBe("missing");

  const status = await readStatus();
  expect(status?.err ?? null, `${label} failed on-chain`).toBeNull();
}

async function _fetchDecodedAccount<T>(
  connection: Connection,
  coder: BorshAccountsCoder,
  accountName: "UserBalance" | "PositionState",
  address: PublicKey,
): Promise<T | null> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const accountInfo = await connection.getAccountInfo(address, "confirmed");
      if (!accountInfo?.data) return null;
      return coder.decode(accountName, accountInfo.data) as T;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  return null;
}

async function waitForEvmReceipt(
  publicClient: ReturnType<typeof createPublicClient>,
  hash: Hash,
): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      expect(receipt.status).toBe("success");
      return;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const retriable =
        /ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|fetch failed|ConnectionRefused|timeout/i
          .test(message);
      if (!retriable || attempt === 4) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function sleepMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function readEvmPriceLevelTotalOpen(
  publicClient: ReturnType<typeof createPublicClient>,
  contractAddress: Address,
  duelKey: Hash,
  side: number,
  price: number,
): Promise<bigint> {
  const priceLevel = (await publicClient.readContract({
    address: contractAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "getPriceLevel",
    args: [duelKey, MARKET_KIND_DUEL_WINNER, side, price],
  })) as [bigint, bigint, bigint];
  return BigInt(priceLevel[2] ?? 0n);
}

async function ensureEvmSeedLiquidity(
  publicClient: ReturnType<typeof createPublicClient>,
  makerWalletClient: ReturnType<typeof createWalletClient>,
  contractAddress: Address,
  duelKey: Hash,
  options?: {
    seedBuyOrder?: boolean;
    seedSellAmount?: string;
    seedBuyAmount?: string;
  },
): Promise<void> {
  const makerAddress = makerWalletClient.account?.address as Address | undefined;
  if (!makerAddress) {
    throw new Error("Missing matcher wallet account for EVM seed liquidity");
  }

  const seededSellAmount = parseUnits(
    options?.seedSellAmount ?? E2E_PREDICTION_AMOUNT,
    18,
  );
  const seededBuyAmount = options?.seedBuyAmount
    ? parseUnits(options.seedBuyAmount, 18)
    : seededSellAmount / 2n;
  let nextMakerNonce = await publicClient.getTransactionCount({
    address: makerAddress,
    blockTag: "pending",
  });
  const consumeMakerNonce = () => nextMakerNonce++;

  const existingSellOpen = await readEvmPriceLevelTotalOpen(
    publicClient,
    contractAddress,
    duelKey,
    SELL_SIDE,
    600,
  );
  if (existingSellOpen < seededSellAmount) {
    const seededSellCost = quoteCost(SELL_SIDE, 600, seededSellAmount);
    const seededSellFee = seededSellCost / 100n;
    const seededSellOrderTx = await makerWalletClient.writeContract({
      address: contractAddress,
      abi: GOLD_CLOB_ABI,
      functionName: "placeOrder",
      args: [
        duelKey,
        MARKET_KIND_DUEL_WINNER,
        SELL_SIDE,
        600,
        seededSellAmount,
        ORDER_FLAG_GTC,
      ],
      value: seededSellCost + seededSellFee + seededSellFee,
      nonce: consumeMakerNonce(),
    });
    await waitForEvmReceipt(publicClient, seededSellOrderTx);
  }

  if (options?.seedBuyOrder !== false) {
    const existingBuyOpen = await readEvmPriceLevelTotalOpen(
      publicClient,
      contractAddress,
      duelKey,
      BUY_SIDE,
      400,
    );
    if (existingBuyOpen < seededBuyAmount) {
      const seededBuyCost = quoteCost(BUY_SIDE, 400, seededBuyAmount);
      const seededBuyFee = seededBuyCost / 100n;
      const seededBuyOrderTx = await makerWalletClient.writeContract({
        address: contractAddress,
        abi: GOLD_CLOB_ABI,
        functionName: "placeOrder",
        args: [
          duelKey,
          MARKET_KIND_DUEL_WINNER,
          BUY_SIDE,
          400,
          seededBuyAmount,
          ORDER_FLAG_GTC,
        ],
        value: seededBuyCost + seededBuyFee + seededBuyFee,
        nonce: consumeMakerNonce(),
      });
      await waitForEvmReceipt(publicClient, seededBuyOrderTx);
    }
  }
}

async function waitForPreparedOrFreshRealEvmMarket(
  request: APIRequestContext,
  publicClient: ReturnType<typeof createPublicClient>,
  oracleAddress: Address,
  contractAddress: Address,
  chainKey: "bsc" | "avax",
): Promise<{ duelKey: Hash; duelId: string; marketKey: Hash }> {
  let preparedFixture = consumePreparedRealEvmFixture();
  const deadline = Date.now() + LIVE_DUEL_FRESH_WAIT_MS;
  let liveError = preparedFixture
    ? `prepared ${chainKey} duel ${preparedFixture.duelId} is not ready`
    : "live duel not available";

  while (Date.now() < deadline) {
    try {
      const predictionMarkets = await fetchPredictionMarkets(request);
      const currentChainMarket = findPredictionMarket(predictionMarkets, chainKey);
      let duelId = preparedFixture?.duelId ?? "";
      let duelKey = preparedFixture?.duelKey;
      let marketKey = preparedFixture?.marketKey;
      const activeMarket =
        duelKey && marketKey
          ? findPredictionMarket(predictionMarkets, chainKey, {
              duelKey,
              marketRef: marketKey,
            })
          : currentChainMarket;

      if (preparedFixture) {
        const currentLiveDuelId =
          currentChainMarket?.duelId == null
            ? ""
            : String(currentChainMarket.duelId).trim();
        if (currentLiveDuelId && currentLiveDuelId !== duelId) {
          liveError = `prepared ${chainKey} duel ${duelId} drifted to ${currentLiveDuelId}`;
          preparedFixture = null;
          await sleepMs(1_000);
          continue;
        }
      }

      if (!preparedFixture) {
        const duelIdCandidate =
          activeMarket?.duelId == null ? "" : String(activeMarket.duelId).trim();
        const duelKeyCandidate =
          typeof activeMarket?.duelKey === "string"
            ? activeMarket.duelKey.trim()
            : "";
        const marketRefCandidate = activeMarket?.marketRef?.trim() || "";
        if (!duelIdCandidate || !duelKeyCandidate || !marketRefCandidate) {
          liveError = `active ${chainKey} market is missing duel identity or market ref`;
          await sleepMs(1_000);
          continue;
        }
        if (reservedRealEvmDuelIds.has(duelIdCandidate)) {
          liveError = `live duel ${duelIdCandidate} already reserved by this browser run`;
          await sleepMs(1_000);
          continue;
        }
        duelId = duelIdCandidate;
        duelKey = normalizeHex32(
          duelKeyCandidate.startsWith("0x")
            ? duelKeyCandidate
            : `0x${duelKeyCandidate}`,
          "active duel key",
        );
        marketKey = normalizeHex32(marketRefCandidate, "active market ref");
      }

      if (!duelKey || !marketKey) {
        liveError = `${preparedFixture ? "prepared" : "active"} ${chainKey} market is missing duel identity or market ref`;
        await sleepMs(1_000);
        continue;
      }

      if (!activeMarket) {
        liveError = preparedFixture
          ? `prepared ${chainKey} duel ${duelId} is not present in active prediction markets`
          : `active ${chainKey} market not found`;
        await sleepMs(1_000);
        continue;
      }
      if (activeMarket.lifecycleStatus !== "OPEN") {
        liveError = `${preparedFixture ? "prepared" : "active"} ${chainKey} market ${duelId} is ${activeMarket.lifecycleStatus ?? "missing lifecycle"}`;
        await sleepMs(1_000);
        continue;
      }
      const betCloseTimeMs =
        typeof activeMarket.betCloseTime === "number"
          ? activeMarket.betCloseTime
          : preparedFixture?.betCloseTimeMs ?? null;
      const minimumRemainingMs = preparedFixture
        ? PREPARED_LIVE_DUEL_MIN_OPEN_WINDOW_MS
        : LIVE_DUEL_MIN_OPEN_WINDOW_MS;
      if (
        betCloseTimeMs != null &&
        betCloseTimeMs - Date.now() < minimumRemainingMs
      ) {
        liveError = `${preparedFixture ? "prepared" : "live"} duel ${duelId} has less than ${minimumRemainingMs}ms left in the betting window`;
        await sleepMs(1_000);
        continue;
      }
      const existingOracleDuel = (await publicClient.readContract({
        address: oracleAddress,
        abi: duelOutcomeOracleArtifact.abi,
        functionName: "getDuel",
        args: [duelKey],
      })) as {
        participantAHash?: Hash;
        participantBHash?: Hash;
      };
      const hasOracleDuel =
        (existingOracleDuel.participantAHash &&
          existingOracleDuel.participantAHash !== ZERO_HASH) ||
        (existingOracleDuel.participantBHash &&
          existingOracleDuel.participantBHash !== ZERO_HASH);
      if (!hasOracleDuel) {
        liveError = `${preparedFixture ? "prepared" : "active"} ${chainKey} duel ${duelId} is not materialized in the oracle yet`;
        await sleepMs(1_000);
        continue;
      }
      const existingMarket = (await publicClient.readContract({
        address: contractAddress,
        abi: GOLD_CLOB_ABI,
        functionName: "getMarket",
        args: [duelKey, MARKET_KIND_DUEL_WINNER],
      })) as { exists?: boolean };
      if (!existingMarket?.exists) {
        liveError = `${preparedFixture ? "prepared" : "active"} ${chainKey} duel ${duelId} has no on-chain market yet`;
        await sleepMs(1_000);
        continue;
      }

      reservedRealEvmDuelIds.add(duelId);
      return { duelKey, duelId, marketKey };
    } catch (error) {
      liveError = error instanceof Error ? error.message : String(error);
      await sleepMs(1_000);
    }
  }

  throw new Error(
    `Timed out waiting for a fresh open live Hyperscapes duel on ${chainKey}: ${liveError}`,
  );
}

async function readEvmPosition(
  publicClient: ReturnType<typeof createPublicClient>,
  contractAddress: Address,
  marketKey: Hash,
  userAddress: Address,
): Promise<[bigint, bigint, bigint, bigint]> {
  return (await publicClient.readContract({
    address: contractAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "positions",
    args: [marketKey, userAddress],
  })) as [bigint, bigint, bigint, bigint];
}

async function _waitForSolanaUiPosition(
  page: Page,
  side: "YES" | "NO",
): Promise<void> {
  const pattern =
    side === "YES"
      ? /Position YES\s+([0-9]+(?:\.[0-9]+)?)/i
      : /\|\s*NO\s+([0-9]+(?:\.[0-9]+)?)/i;

  await expect
    .poll(
      async () => {
        const panelText =
          (await page.getByTestId("solana-clob-admin-panel").textContent()) ||
          "";
        const match = panelText.match(pattern);
        return match ? Number(match[1]) : 0;
      },
      {
        timeout: 60_000,
        intervals: [1_000, 2_000, 5_000],
      },
    )
    .toBeGreaterThan(0);
}

async function _submitModelsTrade(
  page: Page,
  tradeButtonTestId:
    | "models-market-open-long"
    | "models-market-open-short"
    | "models-market-close-position",
): Promise<string> {
  const statusTestId = "models-market-last-trade-status";
  const previousStatus = await readText(page, statusTestId);

  const button = page.getByTestId(tradeButtonTestId);
  await button.click({ force: true });

  let nextStatus: string;
  try {
    nextStatus = await waitForNewText(
      page,
      statusTestId,
      previousStatus,
      5_000,
    );
  } catch {
    await button.dispatchEvent("click");
    nextStatus = await waitForNewText(
      page,
      statusTestId,
      previousStatus,
      5_000,
    );
  }

  await expect
    .poll(async () => await readText(page, statusTestId), {
      timeout: 30_000,
      intervals: [500, 1_000, 2_000],
    })
    .not.toMatch(/^(Submitting|Closing)\b/i);

  return (await readText(page, statusTestId)) || nextStatus;
}

test.describe("market flows", () => {
  test.setTimeout(600_000);

  test("evm lifecycle shell and claim CTA follow the normalized lifecycle API", async ({
    page,
    request,
  }) => {
    const state = loadState();
    const rpcUrl = state.evmRpcUrl || "http://127.0.0.1:8545";
    const chainId = Number(state.evmChainId || 97);
    const canaryPrivateKey = requireStatePrivateKey(state, "evmCanaryPrivateKey");
    const reporterPrivateKey = requireStatePrivateKey(
      state,
      "evmReporterPrivateKey",
    );
    const marketOperatorPrivateKey = requireStatePrivateKey(
      state,
      "evmMarketOperatorPrivateKey",
    );
    const matcherPrivateKey = requireStatePrivateKey(state, "evmMatcherPrivateKey");
    const contractAddress = state.evmGoldClobAddress as Address;
    const oracleAddress = state.evmOracleAddress as Address;
    let lifecycleStatus = "OPEN";
    let lifecycleWinner = "NONE";
    const transport = createEvmTransport(rpcUrl);

    const publicClient = createPublicClient({
      chain: {
        id: chainId,
        name: "e2e-local-evm",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: {
          default: { http: [rpcUrl] },
          public: { http: [rpcUrl] },
        },
      },
      transport,
    });
    const userAccount = privateKeyToAccount(canaryPrivateKey);
    const reporterAccount = privateKeyToAccount(reporterPrivateKey);
    const marketOperatorAccount = privateKeyToAccount(marketOperatorPrivateKey);
    const makerAccount = privateKeyToAccount(matcherPrivateKey);
    const userWalletClient = createWalletClient({
      account: userAccount,
      chain: {
        id: chainId,
        name: "e2e-local-evm",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: {
          default: { http: [rpcUrl] },
          public: { http: [rpcUrl] },
        },
      },
      transport,
    });
    const reporterWalletClient = createWalletClient({
      account: reporterAccount,
      chain: {
        id: chainId,
        name: "e2e-local-evm",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: {
          default: { http: [rpcUrl] },
          public: { http: [rpcUrl] },
        },
      },
      transport,
    });
    const marketOperatorWalletClient = createWalletClient({
      account: marketOperatorAccount,
      chain: {
        id: chainId,
        name: "e2e-local-evm",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: {
          default: { http: [rpcUrl] },
          public: { http: [rpcUrl] },
        },
      },
      transport,
    });
    const makerWalletClient = createWalletClient({
      account: makerAccount,
      chain: {
        id: chainId,
        name: "e2e-local-evm",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: {
          default: { http: [rpcUrl] },
          public: { http: [rpcUrl] },
        },
      },
      transport,
    });
    const { duelKey, duelId, marketKey } = await createFreshEvmOpenMarket(
      request,
      publicClient,
      reporterWalletClient,
      marketOperatorWalletClient,
      makerWalletClient,
      oracleAddress,
      contractAddress,
      "bsc",
      {
        seedBuyOrder: false,
        seedSellAmount: E2E_LIGHT_PREDICTION_AMOUNT,
      },
    );
    const mockState: E2eState = {
      ...state,
      evmMatchId: duelId,
      evmDuelId: duelId,
      evmDuelKeyHex: duelKey,
      evmMarketKey: marketKey,
    };
    const userAddress = userAccount.address;

    await page.route("**/api/arena/prediction-markets/active", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          buildMockEvmPredictionMarketsResponse(
            mockState,
            "bsc",
            lifecycleStatus,
            lifecycleWinner,
          ),
        ),
      });
    });

    await gotoApp(page, {
      e2eEvmDuelKey: duelKey,
      e2eEvmDuelId: duelId,
    });
    await selectChain(page, "bsc");

    const evmPanel = page.getByTestId("evm-panel").first();
    const submitButton = evmPanel.getByTestId("prediction-submit");
    const claimButton = evmPanel.getByTestId("evm-claim-payout");

    await expect(evmPanel).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("market-status")).toContainText(/open/i, {
      timeout: 30_000,
    });
    await expect(submitButton).toBeEnabled({ timeout: 30_000 });
    await expect(claimButton).toHaveCount(0);

    lifecycleStatus = "LOCKED";
    await expect(page.getByTestId("market-status")).toContainText(/locked/i, {
      timeout: 15_000,
    });
    await expect(submitButton).toBeDisabled({ timeout: 15_000 });
    await expect(claimButton).toHaveCount(0);

    lifecycleStatus = "OPEN";
    await expect(page.getByTestId("market-status")).toContainText(/open/i, {
      timeout: 15_000,
    });
    await expect(submitButton).toBeEnabled({ timeout: 15_000 });
    await waitForEvmPanelReady(page);

    await evmPanel
      .getByTestId("prediction-amount-input")
      .fill(E2E_LIGHT_PREDICTION_AMOUNT);
    await evmPanel.getByTestId("evm-price-input").fill("600");
    await evmPanel.getByTestId("prediction-select-yes").click();
    const orderAmount = parseUnits(E2E_LIGHT_PREDICTION_AMOUNT, 18);
    const orderCost = quoteCost(BUY_SIDE, 600, orderAmount);
    const orderFee = orderCost / 100n;
    const yesTx = await userWalletClient.writeContract({
      address: contractAddress,
      abi: GOLD_CLOB_ABI,
      functionName: "placeOrder",
      args: [
        duelKey,
        MARKET_KIND_DUEL_WINNER,
        BUY_SIDE,
        600,
        orderAmount,
        ORDER_FLAG_GTC,
      ],
      value: orderCost + orderFee + orderFee,
    });
    await waitForEvmReceipt(publicClient, yesTx as Hash);
    await clickRefreshMarket(page);
    await expect
      .poll(async () => {
        const result = await readEvmPosition(
          publicClient,
          contractAddress,
          marketKey,
          userAddress,
        );
        return result[0];
      })
      .toBeGreaterThan(0n);

    lifecycleStatus = "RESOLVED";
    lifecycleWinner = "A";
    await expect(page.getByTestId("market-status")).toContainText(
      /resolved/i,
      {
        timeout: 15_000,
      },
    );
    await expect(claimButton).toBeEnabled({ timeout: 15_000 });
    await expect(claimButton).toContainText(/claim/i);
  });

  test("evm predictions place YES and NO orders on a fresh live market", async ({
    page,
    request,
  }) => {
    const state = loadState();
    const rpcUrl = state.evmRpcUrl || "http://127.0.0.1:8545";
    const chainId = Number(state.evmChainId || 97);
    const userAddress = state.evmHeadlessAddress as Address;
    const contractAddress = state.evmGoldClobAddress as Address;
    const oracleAddress = state.evmOracleAddress as Address;
    const adminPrivateKey = requireStatePrivateKey(state, "evmAdminPrivateKey");
    const reporterPrivateKey = requireStatePrivateKey(
      state,
      "evmReporterPrivateKey",
    );
    const marketOperatorPrivateKey = requireStatePrivateKey(
      state,
      "evmMarketOperatorPrivateKey",
    );
    const matcherPrivateKey = requireStatePrivateKey(state, "evmMatcherPrivateKey");
    const finalizerPrivateKey = requireStatePrivateKey(
      state,
      "evmFinalizerPrivateKey",
    );
    const transport = createEvmTransport(rpcUrl);
    const publicClient = createPublicClient({
      chain: {
        id: chainId,
        name: "e2e-local-evm",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: {
          default: { http: [rpcUrl] },
          public: { http: [rpcUrl] },
        },
      },
      transport,
    });
    const adminAccount = privateKeyToAccount(adminPrivateKey);
    const reporterAccount = privateKeyToAccount(reporterPrivateKey);
    const marketOperatorAccount = privateKeyToAccount(marketOperatorPrivateKey);
    const makerAccount = privateKeyToAccount(matcherPrivateKey);
    const finalizerAccount =
      typeof finalizerPrivateKey === "string"
        ? privateKeyToAccount(finalizerPrivateKey as `0x${string}`)
        : mnemonicToAccount(DEFAULT_ANVIL_MNEMONIC, {
            accountIndex: 0,
            addressIndex: 2,
          });
    const adminWalletClient = createWalletClient({
      account: adminAccount,
      chain: {
        id: chainId,
        name: "e2e-local-evm",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: {
          default: { http: [rpcUrl] },
          public: { http: [rpcUrl] },
        },
      },
      transport,
    });
    const reporterWalletClient = createWalletClient({
      account: reporterAccount,
      chain: {
        id: chainId,
        name: "e2e-local-evm",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: {
          default: { http: [rpcUrl] },
          public: { http: [rpcUrl] },
        },
      },
      transport,
    });
    const marketOperatorWalletClient = createWalletClient({
      account: marketOperatorAccount,
      chain: {
        id: chainId,
        name: "e2e-local-evm",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: {
          default: { http: [rpcUrl] },
          public: { http: [rpcUrl] },
        },
      },
      transport,
    });
    const makerWalletClient = createWalletClient({
      account: makerAccount,
      chain: {
        id: chainId,
        name: "e2e-local-evm",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: {
          default: { http: [rpcUrl] },
          public: { http: [rpcUrl] },
        },
      },
      transport,
    });
    const finalizerWalletClient = createWalletClient({
      account: finalizerAccount,
      chain: {
        id: chainId,
        name: "e2e-local-evm",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: {
          default: { http: [rpcUrl] },
          public: { http: [rpcUrl] },
        },
      },
      transport,
    });
    const { duelKey, duelId, marketKey } = await createFreshEvmOpenMarket(
      request,
      publicClient,
      reporterWalletClient,
      marketOperatorWalletClient,
      makerWalletClient,
      oracleAddress,
      contractAddress,
      "bsc",
      {
        seedBuyOrder: true,
        seedSellAmount: E2E_LIGHT_PREDICTION_AMOUNT,
        seedBuyAmount: E2E_LIGHT_PREDICTION_AMOUNT,
      },
    );
    await expect
      .poll(async () => {
        const predictionMarkets = await fetchPredictionMarkets(request);
        const bscMarket = findPredictionMarket(predictionMarkets, "bsc", {
          duelKey,
          marketRef: marketKey,
        });
        return bscMarket?.contractAddress ?? null;
      })
      .toBe(contractAddress);

    await gotoApp(page, {
      e2eEvmDuelKey: duelKey,
      e2eEvmDuelId: duelId,
    });
    await selectChain(page, "bsc");

    const evmPanel = page.getByTestId("evm-panel").first();
    await expect(evmPanel).toBeVisible({ timeout: 60_000 });
    await expect(evmPanel.getByTestId("prediction-submit")).toBeEnabled({
      timeout: 60_000,
    });
    await ensureEvmPanelReadyOrThrow(page, "bsc-live-market-initial");

    await evmPanel
      .getByTestId("prediction-amount-input")
      .fill(E2E_LIGHT_PREDICTION_AMOUNT);
    await evmPanel.getByTestId("evm-price-input").fill("600");

    console.log("[e2e][evm] placing YES order");
    const previousYesTx = await readText(page, "evm-last-order-tx");
    await evmPanel.getByTestId("prediction-select-yes").click();
    await evmPanel.getByTestId("prediction-submit").click();
    const yesTx = await waitForNewEvmTxText(
      page,
      "evm-last-order-tx",
      previousYesTx,
      "YES order",
    );
    await waitForEvmReceipt(publicClient, yesTx as Hash);
    await waitForEvmPositionComponentOrThrow(
      page,
      publicClient,
      contractAddress,
      marketKey,
      userAddress,
      0,
      "YES order",
    );

    console.log("[e2e][evm] placing NO order");
    const previousNoTx = await readText(page, "evm-last-order-tx");
    await evmPanel.getByTestId("evm-price-input").fill("400");
    await evmPanel.getByTestId("prediction-select-no").click();
    await evmPanel.getByTestId("prediction-submit").click();
    const noTx = await waitForNewEvmTxText(
      page,
      "evm-last-order-tx",
      previousNoTx,
      "NO order",
    );
    await waitForEvmReceipt(publicClient, noTx as Hash);
    await waitForEvmPositionComponentOrThrow(
      page,
      publicClient,
      contractAddress,
      marketKey,
      userAddress,
      1,
      "NO order",
    );

    if (!supportsTimeTravelRpc(rpcUrl)) {
      await expect(page.getByTestId("market-status")).toContainText(ACTIVE_MARKET_UI, {
        timeout: 30_000,
      });
      return;
    }

    console.log("[e2e][evm] resolving YES winner");
    await resolveEvmWinner(
      publicClient,
      adminWalletClient,
      finalizerWalletClient,
      oracleAddress,
      contractAddress,
      duelKey,
      "e2e-resolved",
    );
    await expect
      .poll(
        async () => {
          const predictionMarkets = await fetchPredictionMarkets(request);
          const bscMarket = findPredictionMarket(predictionMarkets, "bsc", {
            duelKey,
            marketRef: marketKey,
          });
          return `${bscMarket?.lifecycleStatus || "missing"}:${bscMarket?.winner || "missing"}`;
        },
        {
          timeout: 60_000,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toBe("RESOLVED:A");

    const previousClaimTx = await readText(page, "evm-last-claim-tx");
    console.log("[e2e][evm] waiting for auto-claim or zeroed YES position");
    const autoClaimDeadline = Date.now() + 15_000;
    let claimedPosition = await readEvmPosition(
      publicClient,
      contractAddress,
      marketKey,
      userAddress,
    );
    while (Date.now() < autoClaimDeadline && claimedPosition[0] > 0n) {
      await page.waitForTimeout(1_000);
      claimedPosition = await readEvmPosition(
        publicClient,
        contractAddress,
        marketKey,
        userAddress,
      );
    }

    const claimTx = await readText(page, "evm-last-claim-tx");
    if (
      claimedPosition[0] === 0n &&
      claimTx &&
      claimTx !== "-" &&
      claimTx !== previousClaimTx
    ) {
      console.log("[e2e][evm] observed auto-claim transaction");
      await waitForEvmReceipt(publicClient, claimTx as Hash);
    } else {
      const maybeClaimed = await readEvmPosition(
        publicClient,
        contractAddress,
        marketKey,
        userAddress,
      );
      if (maybeClaimed[0] > 0n) {
        console.log("[e2e][evm] auto-claim not observed, claiming manually");
        const manualClaimTx = await adminWalletClient.writeContract({
          address: contractAddress,
          abi: GOLD_CLOB_ABI,
          functionName: "claim",
          args: [duelKey, MARKET_KIND_DUEL_WINNER],
        });
        await waitForEvmReceipt(publicClient, manualClaimTx);
      }
    }

    const finalPosition = await readEvmPosition(
      publicClient,
      contractAddress,
      marketKey,
      userAddress,
    );
    expect(finalPosition[0]).toBe(0n);
    expect(finalPosition[1]).toBe(0n);
  });

  test("bsc prediction markets recover after Hyperscapes restarts", async ({
    page,
    request,
  }) => {
    test.skip(
      E2E_DUEL_SOURCE !== "real_hyperscapes",
      "Hyperscapes restart recovery is only meaningful in real-duel mode",
    );
    const state = loadState();
    const control = loadControl();
    const rpcUrl = state.evmRpcUrl || "http://127.0.0.1:8545";
    const chainId = Number(state.evmChainId || 97);
    const userAddress = state.evmHeadlessAddress as Address;
    const contractAddress = state.evmGoldClobAddress as Address;
    const oracleAddress = state.evmOracleAddress as Address;
    const reporterPrivateKey = requireStatePrivateKey(
      state,
      "evmReporterPrivateKey",
    );
    const marketOperatorPrivateKey = requireStatePrivateKey(
      state,
      "evmMarketOperatorPrivateKey",
    );
    const matcherPrivateKey = requireStatePrivateKey(state, "evmMatcherPrivateKey");
    const transport = createEvmTransport(rpcUrl);
    const chainConfig = {
      id: chainId,
      name: "e2e-local-evm",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: {
        default: { http: [rpcUrl] },
        public: { http: [rpcUrl] },
      },
    } as const;
    const publicClient = createPublicClient({
      chain: chainConfig,
      transport,
    });
    const reporterWalletClient = createWalletClient({
      account: privateKeyToAccount(reporterPrivateKey),
      chain: chainConfig,
      transport,
    });
    const marketOperatorWalletClient = createWalletClient({
      account: privateKeyToAccount(marketOperatorPrivateKey),
      chain: chainConfig,
      transport,
    });
    const makerWalletClient = createWalletClient({
      account: privateKeyToAccount(matcherPrivateKey),
      chain: chainConfig,
      transport,
    });

    const { duelKey, duelId, marketKey } = await createFreshEvmOpenMarket(
      request,
      publicClient,
      reporterWalletClient,
      marketOperatorWalletClient,
      makerWalletClient,
      oracleAddress,
      contractAddress,
      "bsc",
      {
        seedBuyOrder: false,
        seedSellAmount: E2E_LIGHT_SEED_SELL_AMOUNT,
      },
    );

    await waitForPredictionMarketState(
      request,
      "bsc",
      duelKey,
      marketKey,
      "OPEN",
    );

    await gotoApp(page, {
      e2eEvmDuelKey: duelKey,
      e2eEvmDuelId: duelId,
    });
    await selectChain(page, "bsc");
    const evmPanel = page.getByTestId("evm-panel").first();
    await expect(evmPanel).toBeVisible({ timeout: 60_000 });

    runProcessControl(control, "restart", "hyperscapes");

    await expect
      .poll(
        async () => {
          const streamState = await fetchJson<StreamStateResponse>(
            request,
            "/api/streaming/state",
          );
          return {
            duelId: String(streamState.cycle?.duelId ?? ""),
            duelKey:
              typeof streamState.cycle?.duelKeyHex === "string"
                ? normalizeHex32(
                    streamState.cycle.duelKeyHex,
                    "stream duel key after Hyperscapes restart",
                  )
                : ZERO_HASH,
          };
        },
        {
          timeout: 90_000,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toEqual({
        duelId,
        duelKey,
      });

    await waitForPredictionMarketState(
      request,
      "bsc",
      duelKey,
      marketKey,
      "OPEN",
    );

    await page.reload({ waitUntil: "domcontentloaded" });
    await gotoApp(page, {
      e2eEvmDuelKey: duelKey,
      e2eEvmDuelId: duelId,
    });
    await selectChain(page, "bsc");
    await clickRefreshMarket(page);
    await expect(page.getByTestId("market-status")).toContainText(/open/i, {
      timeout: 60_000,
    });

    const beforePosition = await readEvmPosition(
      publicClient,
      contractAddress,
      marketKey,
      userAddress,
    );
    const previousYesTx = await readText(page, "evm-last-order-tx");
    await evmPanel
      .getByTestId("prediction-amount-input")
      .fill(E2E_LIGHT_PREDICTION_AMOUNT);
    await evmPanel.getByTestId("evm-price-input").fill("600");
    await evmPanel.getByTestId("prediction-select-yes").click();
    await evmPanel.getByTestId("prediction-submit").click();
    const yesTx = await waitForNewEvmTxText(
      page,
      "evm-last-order-tx",
      previousYesTx,
      "Hyperscapes restart YES order",
    );
    await waitForEvmReceipt(publicClient, yesTx as Hash);

    await expect
      .poll(async () => {
        const result = await readEvmPosition(
          publicClient,
          contractAddress,
          marketKey,
          userAddress,
        );
        return result[0] - beforePosition[0];
      })
      .toBeGreaterThan(0n);
  });

  test("bsc prediction markets recover after keeper restarts", async ({
    page,
    request,
  }) => {
    const state = loadState();
    const control = loadControl();
    const rpcUrl = state.evmRpcUrl || "http://127.0.0.1:8545";
    const chainId = Number(state.evmChainId || 97);
    const userAddress = state.evmHeadlessAddress as Address;
    const contractAddress = state.evmGoldClobAddress as Address;
    const oracleAddress = state.evmOracleAddress as Address;
    const adminPrivateKey = requireStatePrivateKey(state, "evmAdminPrivateKey");
    const reporterPrivateKey = requireStatePrivateKey(
      state,
      "evmReporterPrivateKey",
    );
    const marketOperatorPrivateKey = requireStatePrivateKey(
      state,
      "evmMarketOperatorPrivateKey",
    );
    const matcherPrivateKey = requireStatePrivateKey(state, "evmMatcherPrivateKey");
    const finalizerPrivateKey = requireStatePrivateKey(
      state,
      "evmFinalizerPrivateKey",
    );
    const transport = createEvmTransport(rpcUrl);
    const publicClient = createPublicClient({
      chain: {
        id: chainId,
        name: "e2e-local-evm",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: {
          default: { http: [rpcUrl] },
          public: { http: [rpcUrl] },
        },
      },
      transport,
    });
    const reporterAccount = privateKeyToAccount(reporterPrivateKey);
    const marketOperatorAccount = privateKeyToAccount(marketOperatorPrivateKey);
    const adminAccount = privateKeyToAccount(adminPrivateKey);
    const makerAccount = privateKeyToAccount(matcherPrivateKey);
    const finalizerAccount =
      typeof finalizerPrivateKey === "string"
        ? privateKeyToAccount(finalizerPrivateKey as `0x${string}`)
        : mnemonicToAccount(DEFAULT_ANVIL_MNEMONIC, {
            accountIndex: 0,
            addressIndex: 2,
          });
    const reporterWalletClient = createWalletClient({
      account: reporterAccount,
      chain: {
        id: chainId,
        name: "e2e-local-evm",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: {
          default: { http: [rpcUrl] },
          public: { http: [rpcUrl] },
        },
      },
      transport,
    });
    const marketOperatorWalletClient = createWalletClient({
      account: marketOperatorAccount,
      chain: {
        id: chainId,
        name: "e2e-local-evm",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: {
          default: { http: [rpcUrl] },
          public: { http: [rpcUrl] },
        },
      },
      transport,
    });
    const adminWalletClient = createWalletClient({
      account: adminAccount,
      chain: {
        id: chainId,
        name: "e2e-local-evm",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: {
          default: { http: [rpcUrl] },
          public: { http: [rpcUrl] },
        },
      },
      transport,
    });
    const makerWalletClient = createWalletClient({
      account: makerAccount,
      chain: {
        id: chainId,
        name: "e2e-local-evm",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: {
          default: { http: [rpcUrl] },
          public: { http: [rpcUrl] },
        },
      },
      transport,
    });
    const finalizerWalletClient = createWalletClient({
      account: finalizerAccount,
      chain: {
        id: chainId,
        name: "e2e-local-evm",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: {
          default: { http: [rpcUrl] },
          public: { http: [rpcUrl] },
        },
      },
      transport,
    });
    const { duelKey, duelId, marketKey } = await createFreshEvmOpenMarket(
      request,
      publicClient,
      reporterWalletClient,
      marketOperatorWalletClient,
      makerWalletClient,
      oracleAddress,
      contractAddress,
      "bsc",
      {
        seedBuyOrder: false,
        seedSellAmount: E2E_LIGHT_SEED_SELL_AMOUNT,
      },
    );

    runProcessControl(control, "restart", "keeper");
    await waitForKeeperBotHealth(request, "bsc", marketKey);
    if (E2E_DUEL_SOURCE === "synthetic_publish") {
      await publishEvmCycleState(
        request,
        "bsc",
        duelKey,
        duelId,
        `bsc-restart-open-${duelId}`,
      );
    }
    await waitForPredictionMarketState(
      request,
      "bsc",
      duelKey,
      marketKey,
      "OPEN",
    );

    await gotoApp(page, {
      e2eEvmDuelKey: duelKey,
      e2eEvmDuelId: duelId,
    });
    await selectChain(page, "bsc");
    const evmPanel = page.getByTestId("evm-panel").first();
    const claimButton = evmPanel.getByTestId("evm-claim-payout");
    await expect(evmPanel).toBeVisible({ timeout: 60_000 });
    await expect(evmPanel.getByTestId("prediction-submit")).toBeEnabled({
      timeout: 60_000,
    });

    await evmPanel
      .getByTestId("prediction-amount-input")
      .fill(E2E_LIGHT_PREDICTION_AMOUNT);
    await evmPanel.getByTestId("evm-price-input").fill("600");
    const previousYesTx = await readText(page, "evm-last-order-tx");
    await evmPanel.getByTestId("prediction-select-yes").click();
    await evmPanel.getByTestId("prediction-submit").click();
    const yesTx = await waitForNewEvmTxText(
      page,
      "evm-last-order-tx",
      previousYesTx,
      "reliability YES order",
    );
    await waitForEvmReceipt(publicClient, yesTx as Hash);

    await expect
      .poll(async () => {
        const result = await readEvmPosition(
          publicClient,
          contractAddress,
          marketKey,
          userAddress,
        );
        return result[0];
      })
      .toBeGreaterThan(0n);

    runProcessControl(control, "restart", "keeper");
    await waitForKeeperBotHealth(request, "bsc", marketKey);
    if (E2E_DUEL_SOURCE === "synthetic_publish") {
      await publishEvmCycleState(
        request,
        "bsc",
        duelKey,
        duelId,
        `bsc-restart-open-second-${duelId}`,
      );
    }

    await page.reload({ waitUntil: "domcontentloaded" });
    await gotoApp(page, {
      e2eEvmDuelKey: duelKey,
      e2eEvmDuelId: duelId,
    });
    await selectChain(page, "bsc");
    await clickRefreshMarket(page);

    await waitForPredictionMarketState(
      request,
      "bsc",
      duelKey,
      marketKey,
      "OPEN",
    );

    if (!supportsTimeTravelRpc(rpcUrl)) {
      await expect
        .poll(
          async () => {
            const result = await readEvmPosition(
              publicClient,
              contractAddress,
              marketKey,
              userAddress,
            );
            return result[0];
          },
          {
            timeout: 30_000,
            intervals: [1_000, 2_000, 5_000],
          },
        )
        .toBeGreaterThan(0n);
      await expect(page.getByTestId("market-status")).toContainText(/open/i, {
        timeout: 30_000,
      });
      return;
    }

    runProcessControl(control, "restart", "anvil");
    runProcessControl(control, "restart", "keeper");
    await waitForKeeperBotHealth(request, "bsc", marketKey);
    if (E2E_DUEL_SOURCE === "synthetic_publish") {
      await publishEvmCycleState(
        request,
        "bsc",
        duelKey,
        duelId,
        `bsc-restart-open-after-anvil-${duelId}`,
      );
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    await gotoApp(page, {
      e2eEvmDuelKey: duelKey,
      e2eEvmDuelId: duelId,
    });
    await selectChain(page, "bsc");
    await clickRefreshMarket(page);

    await waitForPredictionMarketState(
      request,
      "bsc",
      duelKey,
      marketKey,
      "OPEN",
    );

    await resolveEvmWinner(
      publicClient,
      adminWalletClient,
      finalizerWalletClient,
      oracleAddress,
      contractAddress,
      duelKey,
      "e2e-resolved-restart",
    );

    await expect
      .poll(
        async () => {
          const predictionMarkets = await fetchPredictionMarkets(request);
          const bscMarket = findPredictionMarket(predictionMarkets, "bsc", {
            duelKey,
            marketRef: marketKey,
          });
          return `${bscMarket?.lifecycleStatus || "missing"}:${bscMarket?.winner || "missing"}`;
        },
        {
          timeout: 60_000,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toBe("RESOLVED:A");

    runProcessControl(control, "restart", "keeper");
    await waitForKeeperBotHealth(request, "bsc", state.evmMarketKey || null);
    if (E2E_DUEL_SOURCE === "synthetic_publish") {
      await publishEvmCycleState(
        request,
        "bsc",
        duelKey,
        duelId,
        `bsc-restart-resolved-${duelId}`,
      );
    }

    await clickRefreshMarket(page);
    await expect
      .poll(
        async () => {
          const result = await readEvmPosition(
            publicClient,
            contractAddress,
            marketKey,
            userAddress,
          );
          return result[0];
        },
        {
          timeout: 30_000,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toBeGreaterThan(0n);
    await expect(claimButton).toBeEnabled({ timeout: 30_000 });
    const previousClaimTx = await readText(page, "evm-last-claim-tx");
    await claimButton.click();
    const claimTx = await waitForNewEvmTxText(
      page,
      "evm-last-claim-tx",
      previousClaimTx,
      "reliability claim",
    );
    await waitForEvmReceipt(publicClient, claimTx as Hash);

    const finalPosition = await readEvmPosition(
      publicClient,
      contractAddress,
      marketKey,
      userAddress,
    );
    expect(finalPosition[0]).toBe(0n);
    expect(finalPosition[1]).toBe(0n);
  });

  test("bsc cancelled prediction markets refund and clear positions", async ({
    page,
    request,
  }) => {
    const state = loadState();
    const control = loadControl();
    const rpcUrl = state.evmRpcUrl || "http://127.0.0.1:8545";
    const chainId = Number(state.evmChainId || 97);
    const userAddress = state.evmHeadlessAddress as Address;
    const contractAddress = state.evmGoldClobAddress as Address;
    const oracleAddress = state.evmOracleAddress as Address;
    const adminPrivateKey = requireStatePrivateKey(state, "evmAdminPrivateKey");
    const pauserPrivateKey = requireStatePrivateKey(state, "evmPauserPrivateKey");
    const reporterPrivateKey = requireStatePrivateKey(
      state,
      "evmReporterPrivateKey",
    );
    const marketOperatorPrivateKey = requireStatePrivateKey(
      state,
      "evmMarketOperatorPrivateKey",
    );
    const matcherPrivateKey = requireStatePrivateKey(state, "evmMatcherPrivateKey");
    const transport = createEvmTransport(rpcUrl);
    const publicClient = createPublicClient({
      chain: {
        id: chainId,
        name: "e2e-local-evm",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: {
          default: { http: [rpcUrl] },
          public: { http: [rpcUrl] },
        },
      },
      transport,
    });
    const reporterAccount = privateKeyToAccount(reporterPrivateKey);
    const marketOperatorAccount = privateKeyToAccount(marketOperatorPrivateKey);
    const adminAccount = privateKeyToAccount(adminPrivateKey);
    const pauserAccount = privateKeyToAccount(pauserPrivateKey);
    const makerAccount = privateKeyToAccount(matcherPrivateKey);
    const reporterWalletClient = createWalletClient({
      account: reporterAccount,
      chain: {
        id: chainId,
        name: "e2e-local-evm",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: {
          default: { http: [rpcUrl] },
          public: { http: [rpcUrl] },
        },
      },
      transport,
    });
    const marketOperatorWalletClient = createWalletClient({
      account: marketOperatorAccount,
      chain: {
        id: chainId,
        name: "e2e-local-evm",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: {
          default: { http: [rpcUrl] },
          public: { http: [rpcUrl] },
        },
      },
      transport,
    });
    const adminWalletClient = createWalletClient({
      account: adminAccount,
      chain: {
        id: chainId,
        name: "e2e-local-evm",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: {
          default: { http: [rpcUrl] },
          public: { http: [rpcUrl] },
        },
      },
      transport,
    });
    const pauserWalletClient = createWalletClient({
      account: pauserAccount,
      chain: {
        id: chainId,
        name: "e2e-local-evm",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: {
          default: { http: [rpcUrl] },
          public: { http: [rpcUrl] },
        },
      },
      transport,
    });
    const makerWalletClient = createWalletClient({
      account: makerAccount,
      chain: {
        id: chainId,
        name: "e2e-local-evm",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: {
          default: { http: [rpcUrl] },
          public: { http: [rpcUrl] },
        },
      },
      transport,
    });
    const { duelKey, duelId, marketKey } = await createFreshEvmOpenMarket(
      request,
      publicClient,
      reporterWalletClient,
      marketOperatorWalletClient,
      makerWalletClient,
      oracleAddress,
      contractAddress,
      "bsc",
      {
        seedBuyOrder: false,
        seedSellAmount: E2E_CANCEL_PREDICTION_AMOUNT,
      },
    );

    runProcessControl(control, "restart", "keeper");
    await waitForKeeperBotHealth(request, "bsc", marketKey);
    if (E2E_DUEL_SOURCE === "synthetic_publish") {
      await publishEvmCycleState(
        request,
        "bsc",
        duelKey,
        duelId,
        `bsc-restart-cancel-${duelId}`,
      );
    }
    await expect
      .poll(
        async () => {
          const predictionMarkets = await fetchPredictionMarkets(request);
          const bscMarket = findPredictionMarket(predictionMarkets, "bsc", {
            duelKey,
            marketRef: marketKey,
          });
          return {
            duelKey: bscMarket?.duelKey ?? predictionMarkets.duel.duelKey,
            marketRef: bscMarket?.marketRef ?? null,
            lifecycleStatus: bscMarket?.lifecycleStatus ?? null,
          };
        },
        {
          timeout: 60_000,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toEqual({
        duelKey: duelKey.slice(2),
        marketRef: marketKey,
        lifecycleStatus: "OPEN",
      });

    await gotoApp(page, {
      e2eEvmDuelKey: duelKey,
      e2eEvmDuelId: duelId,
    });
    await selectChain(page, "bsc");
    const evmPanel = page.getByTestId("evm-panel").first();
    const claimButton = evmPanel.getByTestId("evm-claim-payout");
    await expect(evmPanel).toBeVisible({ timeout: 60_000 });
    await clickRefreshMarket(page);
    await expect(page.getByTestId("market-status")).toContainText(/open/i, {
      timeout: 60_000,
    });
    await expect(evmPanel.getByTestId("prediction-submit")).toBeEnabled({
      timeout: 60_000,
    });

    await evmPanel
      .getByTestId("prediction-amount-input")
      .fill(E2E_CANCEL_PREDICTION_AMOUNT);
    await evmPanel.getByTestId("evm-price-input").fill("600");
    const previousYesTx = await readText(page, "evm-last-order-tx");
    await evmPanel.getByTestId("prediction-select-yes").click();
    await evmPanel.getByTestId("prediction-submit").click();
    const yesTx = await waitForNewEvmTxText(
      page,
      "evm-last-order-tx",
      previousYesTx,
      "cancel YES order",
    );
    await waitForEvmReceipt(publicClient, yesTx as Hash);

    const cancelTx = await pauserWalletClient.writeContract({
      address: oracleAddress,
      abi: duelOutcomeOracleArtifact.abi,
      functionName: "cancelDuel",
      args: [duelKey, "e2e-cancelled"],
    });
    await waitForEvmReceipt(publicClient, cancelTx);
    const cancelSyncTx = await adminWalletClient.writeContract({
      address: contractAddress,
      abi: GOLD_CLOB_ABI,
      functionName: "syncMarketFromOracle",
      args: [duelKey, MARKET_KIND_DUEL_WINNER],
    });
    await waitForEvmReceipt(publicClient, cancelSyncTx);

    await expect
      .poll(
        async () => {
          const predictionMarkets = await fetchPredictionMarkets(request);
          const bscMarket = findPredictionMarket(predictionMarkets, "bsc", {
            duelKey,
            marketRef: marketKey,
          });
          return bscMarket?.lifecycleStatus || "missing";
        },
        {
          timeout: 60_000,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toBe("CANCELLED");

    await clickRefreshMarket(page);
    await expect(claimButton).toBeEnabled({ timeout: 30_000 });
    const previousClaimTx = await readText(page, "evm-last-claim-tx");
    await claimButton.click();
    const claimTx = await waitForNewEvmTxText(
      page,
      "evm-last-claim-tx",
      previousClaimTx,
      "cancel claim",
    );
    await waitForEvmReceipt(publicClient, claimTx as Hash);

    const finalPosition = await readEvmPosition(
      publicClient,
      contractAddress,
      marketKey,
      userAddress,
    );
    expect(finalPosition[0]).toBe(0n);
    expect(finalPosition[1]).toBe(0n);
    expect(finalPosition[2]).toBe(0n);
    expect(finalPosition[3]).toBe(0n);
  });

});

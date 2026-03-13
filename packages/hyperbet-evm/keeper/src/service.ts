/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import fs_node from "node:fs";
import path from "node:path";

import {
  normalizeChainKey,
  type PredictionMarketLifecycleStatus,
  resolveLifecycleFromEvmStatus,
  resolveLifecycleFromStreamPhase,
  resolveWinnerFromEvmStatus,
  toRecordedBetChain,
  type PredictionMarketLifecycleRecord,
  type PredictionMarketWinner,
  type RecordedBetChain,
} from "@hyperbet/chain-registry";
import {
  mergePredictionMarketsWithHealth,
  type KeeperBotHealthSnapshot,
  type KeeperMarketHealthRecord,
} from "@hyperbet/mm-core";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import {
  createPublicClient,
  decodeEventLog,
  decodeFunctionData,
  http,
  parseAbi,
  parseAbiItem,
  type Address,
} from "viem";

import {
  createPrograms,
  duelKeyHexToBytes,
  findDuelStatePda,
  findMarketConfigPda,
  findMarketPda,
  FIGHT_ORACLE_PROGRAM_ID,
  GOLD_CLOB_MARKET_PROGRAM_ID,
  readKeypair,
} from "./common";
import {
  deleteIdentityMembers,
  loadAll,
  loadPerpsMarkets,
  loadPerpsOracleSnapshots,
  saveBet,
  savePointsEvent,
  saveWalletDisplay,
  saveWalletPoints,
  saveWalletGoldState,
  saveWalletCanonical,
  saveIdentityMembers,
  saveInviteCode,
  saveReferral,
  saveInvitedWallet,
  saveReferralFees,
} from "./db";
import { modelMarketIdFromCharacterId } from "./modelMarkets";
import {
  isLegacyDerivedPointsWalletKey,
  normalizePointsWalletInput,
} from "./walletKeys";

type StreamState = {
  type: "STREAMING_STATE_UPDATE";
  cycle: Record<string, any>;
  leaderboard: any[];
  cameraTarget: string | null;
  seq: number;
  emittedAt: number;
};

type BetRecord = {
  id: string;
  bettorWallet: string;
  chain: RecordedBetChain;
  sourceAsset: string;
  sourceAmount: number;
  goldAmount: number;
  feeBps: number;
  txSignature: string;
  marketPda: string | null;
  duelKey: string | null;
  duelId: string | null;
  inviteCode: string | null;
  externalBetRef: string | null;
  recordedAt: number;
};

type WalletPoints = {
  selfPoints: number;
  winPoints: number;
  referralPoints: number;
  stakingPoints: number;
};

type PointsEventRecord = {
  id: number;
  wallet: string;
  eventType: string;
  status: string;
  totalPoints: number;
  referenceType: string | null;
  referenceId: string | null;
  relatedWallet: string | null;
  createdAt: number;
};

type WalletGoldState = {
  goldBalance: number;
  goldHoldDays: number;
  updatedAt: number;
};

type PointsWindow = "alltime" | "daily" | "weekly" | "monthly";

type MultiplierTier = "NONE" | "BRONZE" | "SILVER" | "GOLD" | "DIAMOND";

type ParserState = {
  enabled: boolean;
  lastSuccessAt: number | null;
  lastError: string | null;
  snapshot: Record<string, any> | null;
};

type RateBucket = {
  tokens: number;
  lastRefillMs: number;
};

type JsonRpcRequestPayload = Record<string, unknown> & {
  method: string;
};

type ProxyCacheEntry = {
  status: number;
  bodyText: string;
  contentType: string;
  expiresAt: number;
};

const encoder = new TextEncoder();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const keeperRoot = path.resolve(__dirname, "..");
const KEEPER_BOT_HEALTH_FILE = (
  process.env.KEEPER_BOT_HEALTH_FILE ||
  path.resolve(keeperRoot, ".status", "keeper-bot-health.json")
).trim();
const KEEPER_STREAM_STATE_FILE = (
  process.env.KEEPER_STREAM_STATE_FILE ||
  path.resolve(keeperRoot, ".status", "stream-state.json")
).trim();
const IS_PRODUCTION = process.env.NODE_ENV === "production";

function loadKeeperBotHealthSnapshot(): KeeperBotHealthSnapshot | null {
  if (!KEEPER_BOT_HEALTH_FILE || !fs_node.existsSync(KEEPER_BOT_HEALTH_FILE)) {
    return null;
  }
  try {
    return JSON.parse(fs_node.readFileSync(KEEPER_BOT_HEALTH_FILE, "utf8"));
  } catch (error) {
    console.warn("[service] Failed to read keeper bot health snapshot:", error);
    return null;
  }
}

function loadStreamStateSnapshot(): StreamState | null {
  if (!KEEPER_STREAM_STATE_FILE || !fs_node.existsSync(KEEPER_STREAM_STATE_FILE)) {
    return null;
  }
  try {
    return JSON.parse(fs_node.readFileSync(KEEPER_STREAM_STATE_FILE, "utf8"));
  } catch (error) {
    console.warn("[service] Failed to read stream state snapshot:", error);
    return null;
  }
}

function persistStreamStateSnapshot(next: StreamState): void {
  if (!KEEPER_STREAM_STATE_FILE) return;
  try {
    fs_node.mkdirSync(path.dirname(KEEPER_STREAM_STATE_FILE), {
      recursive: true,
    });
    fs_node.writeFileSync(
      KEEPER_STREAM_STATE_FILE,
      `${JSON.stringify(next, null, 2)}\n`,
      "utf8",
    );
  } catch (error) {
    console.warn("[service] Failed to persist stream state snapshot:", error);
  }
}

function readPositiveEnvInteger(
  name: string,
  fallback: number,
  minimum: number,
): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.floor(parsed));
}

function readEnvBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

const PORT = Number(process.env.PORT || 8080);
const ARENA_WRITE_KEY = process.env.ARENA_EXTERNAL_BET_WRITE_KEY?.trim() || "";
const STREAM_PUBLISH_KEY =
  process.env.STREAM_PUBLISH_KEY?.trim() || ARENA_WRITE_KEY;
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY?.trim() || "";
const BIRDEYE_API_BASE =
  process.env.BIRDEYE_API_BASE?.trim() || "https://public-api.birdeye.so";
const ITEM_MANIFEST_BASE_URL =
  process.env.ITEM_MANIFEST_BASE_URL?.trim() ||
  "https://assets.hyperscape.club/manifests/items";
const STREAM_STATE_SOURCE_URL =
  process.env.STREAM_STATE_SOURCE_URL?.trim() || "";
const STREAM_STATE_SOURCE_BEARER_TOKEN =
  process.env.STREAM_STATE_SOURCE_BEARER_TOKEN?.trim() || "";
const STREAM_STATE_POLL_MS = Math.max(
  1_000,
  Number(process.env.STREAM_STATE_POLL_MS || 2_000),
);
const STREAM_STATE_SOURCE_TIMEOUT_MS = Math.max(
  500,
  Number(process.env.STREAM_STATE_SOURCE_TIMEOUT_MS || 3_000),
);
const STREAM_STATE_SOURCE_MAX_BACKOFF_MS = Math.max(
  STREAM_STATE_POLL_MS,
  Number(process.env.STREAM_STATE_SOURCE_MAX_BACKOFF_MS || 30_000),
);
const CONTRACT_POLL_MS = Math.max(
  5_000,
  Number(process.env.CONTRACT_POLL_MS || 15_000),
);
const CORS_ORIGINS = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const ENABLE_KEEPER_BOT = process.env.ENABLE_KEEPER_BOT !== "false";
const BET_STORE_LIMIT = Math.max(
  100,
  Number(process.env.BET_STORE_LIMIT || 5000),
);
const SOLANA_RPC_PROXY_URL = process.env.SOLANA_RPC_URL?.trim() || "";
const SOLANA_RPC_PROXY_MAX_BODY_BYTES = Math.max(
  1024,
  Number(process.env.SOLANA_RPC_PROXY_MAX_BODY_BYTES || 1_000_000),
);
const EVM_RPC_PROXY_MAX_BODY_BYTES = Math.max(
  1024,
  Number(process.env.EVM_RPC_PROXY_MAX_BODY_BYTES || 1_000_000),
);
const RPC_PROXY_CACHE_MAX_ENTRIES = Math.max(
  32,
  Number(process.env.RPC_PROXY_CACHE_MAX_ENTRIES || 512),
);
const RPC_PROXY_CACHE_MAX_PAYLOAD_BYTES = Math.max(
  1024,
  Number(process.env.RPC_PROXY_CACHE_MAX_PAYLOAD_BYTES || 512_000),
);
const BIRDEYE_PRICE_CACHE_TTL_MS = Math.max(
  1_000,
  Number(process.env.BIRDEYE_PRICE_CACHE_TTL_MS || 5_000),
);
const READ_RATE_LIMIT_PER_MINUTE = readPositiveEnvInteger(
  "READ_RATE_LIMIT_PER_MINUTE",
  IS_PRODUCTION ? 360 : 2_400,
  1,
);
const READ_RATE_LIMIT_BURST = readPositiveEnvInteger(
  "READ_RATE_LIMIT_BURST",
  IS_PRODUCTION ? 180 : 1_200,
  1,
);
const WRITE_RATE_LIMIT_PER_MINUTE = readPositiveEnvInteger(
  "WRITE_RATE_LIMIT_PER_MINUTE",
  IS_PRODUCTION ? 120 : 600,
  1,
);
const WRITE_RATE_LIMIT_BURST = readPositiveEnvInteger(
  "WRITE_RATE_LIMIT_BURST",
  IS_PRODUCTION ? 60 : 300,
  1,
);
const DISABLE_RATE_LIMIT = readEnvBoolean("DISABLE_RATE_LIMIT", false);

const GOLD_CLOB_READ_ABI = [
  {
    type: "function",
    name: "marketKey",
    stateMutability: "view",
    inputs: [
      { type: "bytes32" },
      { type: "uint8" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "feeBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getMarket",
    stateMutability: "view",
    inputs: [
      { type: "bytes32" },
      { type: "uint8" },
    ],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "exists", type: "bool" },
          { name: "duelKey", type: "bytes32" },
          { name: "status", type: "uint8" },
          { name: "winner", type: "uint8" },
          { name: "nextOrderId", type: "uint64" },
          { name: "bestBid", type: "uint16" },
          { name: "bestAsk", type: "uint16" },
          { name: "totalAShares", type: "uint128" },
          { name: "totalBShares", type: "uint128" },
        ],
      },
    ],
  },
] as const;

const defaultAgentA = {
  id: "agent-a",
  name: "Agent A",
  hp: 10,
  maxHp: 10,
};
const defaultAgentB = {
  id: "agent-b",
  name: "Agent B",
  hp: 10,
  maxHp: 10,
};

let streamSeq = 1;
const persistedStreamState = loadStreamStateSnapshot();
if (
  persistedStreamState &&
  typeof persistedStreamState.seq === "number" &&
  Number.isFinite(persistedStreamState.seq)
) {
  streamSeq = Math.max(1, Math.trunc(persistedStreamState.seq));
}
let streamState: StreamState = persistedStreamState ?? {
  type: "STREAMING_STATE_UPDATE",
  cycle: {
    cycleId: "boot-cycle",
    phase: "IDLE",
    countdown: null,
    timeRemaining: 0,
    winnerId: null,
    winnerName: null,
    winReason: null,
    agent1: defaultAgentA,
    agent2: defaultAgentB,
  },
  leaderboard: [
    { id: defaultAgentA.id, name: defaultAgentA.name, wins: 0, losses: 0 },
    { id: defaultAgentB.id, name: defaultAgentB.name, wins: 0, losses: 0 },
  ],
  cameraTarget: null,
  seq: streamSeq,
  emittedAt: Date.now(),
};
let streamLastUpdatedAt =
  typeof streamState.emittedAt === "number" && Number.isFinite(streamState.emittedAt)
    ? streamState.emittedAt
    : Date.now();
let streamLastSourcePollAt: number | null = null;
let streamLastSourceError: string | null = null;
let streamSourcePollInFlight = false;
let streamSourceConsecutiveFailures = 0;
let streamSourceBackoffUntil = 0;

const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();
const manifestCache = new Map<string, unknown>();
const rateBuckets = new Map<string, RateBucket>();
const proxyResponseCache = new Map<string, ProxyCacheEntry>();
const proxyResponseInFlight = new Map<string, Promise<ProxyCacheEntry>>();

// ── Persistent state (hydrated from SQLite on startup, written through on change)
const _db = loadAll(BET_STORE_LIMIT);

const bets: BetRecord[] = _db.bets;
const walletDisplay: Map<string, string> = _db.walletDisplay;
const pointsByWallet: Map<string, WalletPoints> = _db.pointsByWallet;
const pointsEvents: PointsEventRecord[] = _db.pointsEvents;
const walletGoldState: Map<string, WalletGoldState> = _db.walletGoldState;
const canonicalByWallet: Map<string, string> = _db.canonicalByWallet;
const identityMembers: Map<string, Set<string>> = _db.identityMembers;
const inviteCodeByWallet: Map<string, string> = _db.inviteCodeByWallet;
const walletByInviteCode: Map<string, string> = _db.walletByInviteCode;
const referredByWallet: Map<string, { wallet: string; code: string }> =
  _db.referredByWallet;
const invitedWalletsByWallet: Map<
  string,
  Set<string>
> = _db.invitedWalletsByWallet;
const referralFeeShareGoldByWallet: Map<string, number> =
  _db.referralFeeShareGoldByWallet;
const treasuryFeesFromReferralsByWallet: Map<string, number> =
  _db.treasuryFeesFromReferralsByWallet;

const parsers: {
  solana: ParserState;
  bsc: ParserState;
  base: ParserState;
} = {
  solana: {
    enabled: false,
    lastSuccessAt: null,
    lastError: null,
    snapshot: null,
  },
  bsc: { enabled: false, lastSuccessAt: null, lastError: null, snapshot: null },
  base: {
    enabled: false,
    lastSuccessAt: null,
    lastError: null,
    snapshot: null,
  },
};

const bscRpcUrl = (
  process.env.BSC_RPC_URL ||
  process.env.BSC_TESTNET_RPC ||
  ""
).trim();
const bscContractAddress = (
  process.env.BSC_GOLD_CLOB_ADDRESS ||
  process.env.CLOB_CONTRACT_ADDRESS_BSC ||
  ""
).trim();
const baseRpcUrl = (
  process.env.BASE_RPC_URL ||
  process.env.BASE_SEPOLIA_RPC ||
  ""
).trim();
const avaxRpcUrl = (process.env.AVAX_RPC_URL || "").trim();
const baseContractAddress = (
  process.env.BASE_GOLD_CLOB_ADDRESS ||
  process.env.CLOB_CONTRACT_ADDRESS_BASE ||
  ""
).trim();

const bscClient =
  bscRpcUrl && bscContractAddress
    ? createPublicClient({ transport: http(bscRpcUrl) })
    : null;
const baseClient =
  baseRpcUrl && baseContractAddress
    ? createPublicClient({ transport: http(baseRpcUrl) })
    : null;
const EVM_RPC_PROXY_TARGETS = {
  bsc: bscRpcUrl,
  base: baseRpcUrl,
  avax: avaxRpcUrl,
} as const;
type SupportedEvmRpcChain = keyof typeof EVM_RPC_PROXY_TARGETS;

const SOLANA_RPC_CACHE_TTL_MS: Record<string, number> = {
  getAccountInfo: 750,
  getBalance: 750,
  getBlockHeight: 250,
  getBlockTime: 5_000,
  getEpochInfo: 5_000,
  getEpochSchedule: 300_000,
  getFeeForMessage: 750,
  getGenesisHash: 300_000,
  getHealth: 1_000,
  getIdentity: 300_000,
  getLatestBlockhash: 250,
  getMinimumBalanceForRentExemption: 300_000,
  getMultipleAccounts: 750,
  getProgramAccounts: 750,
  getRecentPrioritizationFees: 500,
  getSlot: 250,
  getSupply: 5_000,
  getTokenAccountBalance: 750,
  getTokenLargestAccounts: 5_000,
  getTokenSupply: 5_000,
  getVersion: 300_000,
};

const EVM_RPC_CACHE_TTL_MS: Record<string, number> = {
  eth_blockNumber: 250,
  eth_call: 750,
  eth_chainId: 300_000,
  eth_getBalance: 750,
  eth_getBlockByNumber: 750,
  eth_getCode: 60_000,
  eth_getLogs: 750,
  eth_getStorageAt: 5_000,
  net_version: 300_000,
  web3_clientVersion: 300_000,
};

parsers.bsc.enabled = Boolean(bscClient);
parsers.base.enabled = Boolean(baseClient);

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeWallet(wallet: string): string {
  return wallet.trim().toLowerCase();
}

function rememberWalletCase(wallet: string): string {
  const normalized = normalizeWallet(wallet);
  if (!walletDisplay.has(normalized)) {
    walletDisplay.set(normalized, wallet.trim());
    saveWalletDisplay(normalized, wallet.trim());
  }
  return normalized;
}

function displayWallet(normalizedWallet: string): string {
  return walletDisplay.get(normalizedWallet) ?? normalizedWallet;
}

function ensureWalletPoints(wallet: string): WalletPoints {
  const normalized = rememberWalletCase(wallet);
  if (!pointsByWallet.has(normalized)) {
    const initial: WalletPoints = {
      selfPoints: 0,
      winPoints: 0,
      referralPoints: 0,
      stakingPoints: 0,
    };
    pointsByWallet.set(normalized, initial);
    saveWalletPoints(normalized, initial);
  }
  return pointsByWallet.get(normalized)!;
}

function ensureWalletGoldState(wallet: string): WalletGoldState {
  const normalized = rememberWalletCase(wallet);
  if (!walletGoldState.has(normalized)) {
    const initial: WalletGoldState = {
      goldBalance: 0,
      goldHoldDays: 0,
      updatedAt: Date.now(),
    };
    walletGoldState.set(normalized, initial);
    saveWalletGoldState(normalized, initial);
  }
  return walletGoldState.get(normalized)!;
}

function ensureIdentity(wallet: string): string {
  const normalized = rememberWalletCase(wallet);
  const existingCanonical = canonicalByWallet.get(normalized);
  if (existingCanonical) return existingCanonical;
  canonicalByWallet.set(normalized, normalized);
  saveWalletCanonical(normalized, normalized);
  const members = new Set([normalized]);
  identityMembers.set(normalized, members);
  saveIdentityMembers(normalized, members);
  return normalized;
}

function mergeIdentity(walletA: string, walletB: string): boolean {
  const canonicalA = ensureIdentity(walletA);
  const canonicalB = ensureIdentity(walletB);
  if (canonicalA === canonicalB) {
    return false;
  }

  const membersA = identityMembers.get(canonicalA) ?? new Set([canonicalA]);
  const membersB = identityMembers.get(canonicalB) ?? new Set([canonicalB]);
  const mergedCanonical =
    membersA.size >= membersB.size ? canonicalA : canonicalB;
  const obsoleteCanonical =
    canonicalA === mergedCanonical ? canonicalB : canonicalA;
  const mergedMembers = new Set<string>([...membersA, ...membersB]);

  for (const member of mergedMembers) {
    canonicalByWallet.set(member, mergedCanonical);
    saveWalletCanonical(member, mergedCanonical);
  }

  identityMembers.set(mergedCanonical, mergedMembers);
  saveIdentityMembers(mergedCanonical, mergedMembers);
  identityMembers.delete(obsoleteCanonical);
  deleteIdentityMembers(obsoleteCanonical);
  return true;
}

function identityWallets(wallet: string, scope: string | null): string[] {
  const normalized = rememberWalletCase(normalizePointsWalletInput(wallet));
  const canonical = ensureIdentity(normalized);
  if (scope?.toLowerCase() !== "linked") {
    return [normalized];
  }
  const members = identityMembers.get(canonical);
  return members ? [...members] : [normalized];
}

function totalPoints(points: WalletPoints): number {
  return (
    points.selfPoints +
    points.winPoints +
    points.referralPoints +
    points.stakingPoints
  );
}

function aggregatePoints(wallets: string[]): WalletPoints {
  return wallets.reduce<WalletPoints>(
    (acc, wallet) => {
      const points = ensureWalletPoints(wallet);
      acc.selfPoints += points.selfPoints;
      acc.winPoints += points.winPoints;
      acc.referralPoints += points.referralPoints;
      acc.stakingPoints += points.stakingPoints;
      return acc;
    },
    { selfPoints: 0, winPoints: 0, referralPoints: 0, stakingPoints: 0 },
  );
}

function recordPointsEvent(
  event: Omit<PointsEventRecord, "id">,
): PointsEventRecord {
  const normalizedWallet = rememberWalletCase(event.wallet);
  const normalizedRelatedWallet = event.relatedWallet
    ? rememberWalletCase(event.relatedWallet)
    : null;
  const payload = {
    ...event,
    wallet: normalizedWallet,
    relatedWallet: normalizedRelatedWallet,
  };
  const id = savePointsEvent(payload);
  const record: PointsEventRecord = { id, ...payload };
  pointsEvents.unshift(record);
  return record;
}

function readPointsWindow(rawValue: string | null): PointsWindow {
  switch (rawValue?.toLowerCase()) {
    case "daily":
      return "daily";
    case "weekly":
      return "weekly";
    case "monthly":
      return "monthly";
    default:
      return "alltime";
  }
}

function startOfTodayMs(now = Date.now()): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function startOfWeekMs(now = Date.now()): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();
  const diff = day === 0 ? 6 : day - 1;
  date.setDate(date.getDate() - diff);
  return date.getTime();
}

function startOfMonthMs(now = Date.now()): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  date.setDate(1);
  return date.getTime();
}

function pointsWindowStartMs(window: PointsWindow): number | null {
  switch (window) {
    case "daily":
      return startOfTodayMs();
    case "weekly":
      return startOfWeekMs();
    case "monthly":
      return startOfMonthMs();
    case "alltime":
    default:
      return null;
  }
}

function totalPointsFromEvents(
  wallets: Set<string>,
  window: PointsWindow,
): number {
  const windowStart = pointsWindowStartMs(window);
  return pointsEvents.reduce((sum, event) => {
    if (!wallets.has(event.wallet)) return sum;
    if (windowStart != null && event.createdAt < windowStart) return sum;
    return sum + event.totalPoints;
  }, 0);
}

function aggregateGoldState(wallets: string[]): WalletGoldState {
  return wallets.reduce<WalletGoldState>(
    (acc, wallet) => {
      const goldState = ensureWalletGoldState(wallet);
      acc.goldBalance += goldState.goldBalance;
      acc.goldHoldDays = Math.max(acc.goldHoldDays, goldState.goldHoldDays);
      acc.updatedAt = Math.max(acc.updatedAt, goldState.updatedAt);
      return acc;
    },
    { goldBalance: 0, goldHoldDays: 0, updatedAt: 0 },
  );
}

function multiplierDetailForWallets(wallets: string[]): {
  multiplier: number;
  tier: MultiplierTier;
  nextTierThreshold: number | null;
  goldBalance: string;
  goldHoldDays: number;
} {
  const aggregate = aggregateGoldState(wallets);
  const balance = aggregate.goldBalance;
  const holdDays = aggregate.goldHoldDays;

  if (balance >= 1_000_000) {
    const multiplier = holdDays >= 10 ? 4 : 3;
    return {
      multiplier,
      tier: holdDays >= 10 ? "DIAMOND" : "GOLD",
      nextTierThreshold: null,
      goldBalance: String(Math.round(balance)),
      goldHoldDays: holdDays,
    };
  }

  if (balance >= 100_000) {
    return {
      multiplier: 2,
      tier: "SILVER",
      nextTierThreshold: 1_000_000,
      goldBalance: String(Math.round(balance)),
      goldHoldDays: holdDays,
    };
  }

  if (balance >= 1_000) {
    return {
      multiplier: 1,
      tier: "BRONZE",
      nextTierThreshold: 100_000,
      goldBalance: String(Math.round(balance)),
      goldHoldDays: holdDays,
    };
  }

  return {
    multiplier: 1,
    tier: "NONE",
    nextTierThreshold: 1_000,
    goldBalance: String(Math.round(balance)),
    goldHoldDays: holdDays,
  };
}

function leaderboardRows(
  scope: string | null,
  window: PointsWindow,
): Array<{ wallet: string; totalPoints: number }> {
  const useLinked = scope?.toLowerCase() === "linked";

  if (useLinked) {
    const rows = [...identityMembers.entries()].map(([canonical, members]) => {
      const memberList = [...members];
      const total =
        window === "alltime" && pointsEvents.length === 0
          ? totalPoints(aggregatePoints(memberList))
          : totalPointsFromEvents(new Set(memberList), window);
      return {
        wallet: displayWallet(canonical),
        totalPoints: total,
      };
    });
    return rows
      .filter((entry) => entry.totalPoints > 0)
      .sort(
        (left, right) =>
          right.totalPoints - left.totalPoints ||
          left.wallet.localeCompare(right.wallet),
      );
  }

  const rows = [...pointsByWallet.keys()]
    .filter((wallet) => !isLegacyDerivedPointsWalletKey(wallet))
    .map((wallet) => {
      const total =
        window === "alltime" && pointsEvents.length === 0
          ? totalPoints(ensureWalletPoints(wallet))
          : totalPointsFromEvents(new Set([wallet]), window);
      return {
        wallet: displayWallet(wallet),
        totalPoints: total,
      };
    });
  return rows
    .filter((entry) => entry.totalPoints > 0)
    .sort(
      (left, right) =>
        right.totalPoints - left.totalPoints ||
        left.wallet.localeCompare(right.wallet),
    );
}

function inviteCodeForWallet(wallet: string): string {
  const normalized = rememberWalletCase(wallet);
  const existing = inviteCodeByWallet.get(normalized);
  if (existing) return existing;

  const hash = createHash("sha256").update(normalized).digest("hex");
  const code = `HS${hash.slice(0, 8).toUpperCase()}`;
  inviteCodeByWallet.set(normalized, code);
  walletByInviteCode.set(code, normalized);
  saveInviteCode(normalized, code);
  return code;
}

function parseNumberInput(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  if (typeof value === "bigint") return Number(value);
  return fallback;
}

function enumVariant(value: unknown): string {
  if (!value || typeof value !== "object") return "unknown";
  const key = Object.keys(value as Record<string, unknown>)[0];
  return key || "unknown";
}

function sanitizeUrlForStatus(rawUrl: string): string {
  if (!rawUrl) return rawUrl;
  try {
    const parsed = new URL(rawUrl);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return rawUrl.replace(/\?.*$/, "");
  }
}

function securityHeaders(): HeadersInit {
  return {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-xss-protection": "0",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "cross-origin",
  };
}

function applyCors(req: Request, headers: Headers): void {
  const origin = req.headers.get("origin");
  if (!origin) {
    headers.set("access-control-allow-origin", "*");
    return;
  }

  if (isAllowedAppOrigin(origin)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("vary", "Origin");
  } else {
    headers.set("access-control-allow-origin", "*");
  }

  headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  headers.set(
    "access-control-allow-headers",
    "content-type,x-arena-write-key,x-forwarded-for,solana-client,x-web3js-version",
  );
  headers.set("access-control-max-age", "86400");
}

function normalizeOriginLike(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      !url.hostname
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function isAllowedAppOrigin(origin: string | null): boolean {
  const normalized = normalizeOriginLike(origin);
  if (!normalized) return false;
  const { hostname } = new URL(normalized);
  const lowerHostname = hostname.toLowerCase();
  const canonicalHostname = lowerHostname.replace(/^\[(.*)\]$/, "$1");
  const matchesAppDomain = (domain: string) =>
    canonicalHostname === domain || canonicalHostname.endsWith(`.${domain}`);
  const isLoopbackHost =
    canonicalHostname === "localhost" ||
    canonicalHostname === "127.0.0.1" ||
    canonicalHostname === "::1";
  return (
    CORS_ORIGINS.includes(normalized) ||
    matchesAppDomain("hyperbet.win") ||
    matchesAppDomain("hyperscape.bet") ||
    matchesAppDomain("hyperscape.gg") ||
    matchesAppDomain("hyperbet.pages.dev") ||
    matchesAppDomain("hyperscape.club") ||
    matchesAppDomain("hyperscape.pages.dev") ||
    isLoopbackHost
  );
}

type ExternalBetVerificationInput = {
  marketRef: string | null;
  duelKey: string | null;
};

type VerifiedExternalBetRecord = {
  chain: RecordedBetChain;
  txSignature: string;
  bettorWallet: string;
  duelKey: string | null;
  marketRef: string | null;
  sourceAsset: string;
  sourceAmount: number;
  goldAmount: number;
  feeBps: number;
  feeAmount: number;
  pointsBasisAmount: number;
};

const GOLD_CLOB_PLACE_ORDER_DISCRIMINATOR = createHash("sha256")
  .update("global:place_order")
  .digest()
  .subarray(0, 8);
const GOLD_CLOB_EVM_PLACE_ORDER_ABI = parseAbi([
  "function placeOrder(bytes32 duelKey, uint8 marketKind, uint8 side, uint16 price, uint128 amount)",
]);
const GOLD_CLOB_EVM_ORDER_PLACED_EVENT = parseAbiItem(
  "event OrderPlaced(bytes32 indexed marketKey, uint64 indexed orderId, address indexed maker, uint8 side, uint16 price, uint128 amount)",
);
const GOLD_CLOB_EVM_DUEL_WINNER_MARKET_KIND = 0n;
const GOLD_CLOB_PLACE_ORDER_DATA_LENGTH = 27;
const SOL_DISPLAY_DECIMALS = 9;
const EVM_DISPLAY_DECIMALS = 18;
const EVM_MAX_PRICE = 1000n;

function normalizeDuelKeyHex(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  const normalized = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}

function toNumberLike(
  value: bigint | number | { toString(): string } | null | undefined,
): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "bigint") return Number(value);
  if (value && typeof value.toString === "function") {
    const parsed = Number(value.toString());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function formatAtomicAmount(amount: bigint, decimals: number): number {
  if (amount <= 0n) return 0;
  return Number(amount) / 10 ** decimals;
}

function normalizeBase58Key(value: string | null): string | null {
  if (!value) return null;
  try {
    return new PublicKey(value.trim()).toBase58();
  } catch {
    return null;
  }
}

function toInstructionAccountAddress(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (
    typeof value === "object" &&
    value !== null &&
    "pubkey" in value &&
    typeof (value as { pubkey?: unknown }).pubkey === "string"
  ) {
    return (value as { pubkey: string }).pubkey;
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "pubkey" in value &&
    typeof (value as { pubkey?: { toBase58?: () => string } }).pubkey?.toBase58 ===
      "function"
  ) {
    return (value as { pubkey: { toBase58: () => string } }).pubkey.toBase58();
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "toBase58" in value &&
    typeof (value as { toBase58?: () => string }).toBase58 === "function"
  ) {
    return (value as { toBase58: () => string }).toBase58();
  }
  return null;
}

function extractInstructionProgramId(instruction: unknown): string | null {
  if (
    typeof instruction === "object" &&
    instruction !== null &&
    "programId" in instruction
  ) {
    return toInstructionAccountAddress(
      (instruction as { programId?: unknown }).programId,
    );
  }
  return null;
}

function extractInstructionAccounts(instruction: unknown): string[] {
  if (
    typeof instruction !== "object" ||
    instruction === null ||
    !("accounts" in instruction) ||
    !Array.isArray((instruction as { accounts?: unknown[] }).accounts)
  ) {
    return [];
  }
  return (instruction as { accounts: unknown[] }).accounts
    .map((account) => toInstructionAccountAddress(account))
    .filter((account): account is string => Boolean(account));
}

function isPlaceOrderInstructionData(data: unknown): boolean {
  return decodePlaceOrderInstructionData(data) != null;
}

function decodePlaceOrderInstructionData(
  data: unknown,
): { side: number; price: number; amount: bigint } | null {
  if (typeof data !== "string") return null;
  try {
    const raw = Buffer.from(bs58.decode(data));
    if (raw.length !== GOLD_CLOB_PLACE_ORDER_DATA_LENGTH) {
      return null;
    }
    if (
      !raw
        .subarray(0, GOLD_CLOB_PLACE_ORDER_DISCRIMINATOR.length)
        .equals(GOLD_CLOB_PLACE_ORDER_DISCRIMINATOR)
    ) {
      return null;
    }
    return {
      side: raw.readUInt8(16),
      price: raw.readUInt16LE(17),
      amount: raw.readBigUInt64LE(19),
    };
  } catch {
    return null;
  }
}

function calculateQuoteCostAtomic(
  side: bigint | number,
  price: bigint | number,
  amount: bigint,
): bigint | null {
  if (amount <= 0n) return null;
  const sideValue = BigInt(side);
  const priceValue = BigInt(price);
  const priceComponent =
    sideValue === 1n ? priceValue : EVM_MAX_PRICE - priceValue;
  if (priceComponent <= 0n) return null;
  const cost = (amount * priceComponent) / EVM_MAX_PRICE;
  return cost > 0n ? cost : null;
}

function calculateBpsFeeAtomic(amount: bigint, feeBps: number): bigint {
  if (amount <= 0n || feeBps <= 0) return 0n;
  return (amount * BigInt(feeBps)) / 10_000n;
}

function evmSourceAssetForChain(chainKey: "bsc" | "base"): string {
  return chainKey === "base" ? "ETH" : "BNB";
}

function jsonResponse(
  req: Request,
  body: unknown,
  status = 200,
  extraHeaders: HeadersInit = {},
): Response {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    ...securityHeaders(),
    ...extraHeaders,
  });
  applyCors(req, headers);
  return new Response(JSON.stringify(body), { status, headers });
}

function textResponse(
  req: Request,
  body: string,
  status = 200,
  extraHeaders: HeadersInit = {},
): Response {
  const headers = new Headers({
    "content-type": "text/plain; charset=utf-8",
    ...securityHeaders(),
    ...extraHeaders,
  });
  applyCors(req, headers);
  return new Response(body, { status, headers });
}

function parseBoundedInteger(
  rawValue: string | null,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
}

function buildProxyCacheKey(namespace: string, rawKey: string): string {
  return createHash("sha256")
    .update(namespace)
    .update("\n")
    .update(rawKey)
    .digest("hex");
}

function resolveJsonRpcCacheTtlMs(
  requests: readonly JsonRpcRequestPayload[],
  ttlByMethod: Record<string, number>,
): number {
  let ttlMs: number | null = null;
  for (const request of requests) {
    const methodTtlMs = ttlByMethod[request.method];
    if (!methodTtlMs || methodTtlMs <= 0) {
      return 0;
    }
    ttlMs = ttlMs === null ? methodTtlMs : Math.min(ttlMs, methodTtlMs);
  }
  return ttlMs ?? 0;
}

function getProxyCacheEntry(key: string): ProxyCacheEntry | null {
  const cached = proxyResponseCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    proxyResponseCache.delete(key);
    return null;
  }
  proxyResponseCache.delete(key);
  proxyResponseCache.set(key, cached);
  return cached;
}

function pruneProxyResponseCache(): void {
  const now = Date.now();
  for (const [key, entry] of proxyResponseCache) {
    if (entry.expiresAt <= now) {
      proxyResponseCache.delete(key);
    }
  }
  while (proxyResponseCache.size > RPC_PROXY_CACHE_MAX_ENTRIES) {
    const oldestKey = proxyResponseCache.keys().next();
    if (oldestKey.done) break;
    proxyResponseCache.delete(oldestKey.value);
  }
}

function setProxyCacheEntry(key: string, entry: ProxyCacheEntry): void {
  if (entry.bodyText.length > RPC_PROXY_CACHE_MAX_PAYLOAD_BYTES) {
    return;
  }
  proxyResponseCache.delete(key);
  proxyResponseCache.set(key, entry);
  pruneProxyResponseCache();
}

async function fetchProxyResponseWithCache(
  key: string,
  ttlMs: number,
  load: () => Promise<Omit<ProxyCacheEntry, "expiresAt">>,
): Promise<{ entry: ProxyCacheEntry; cacheStatus: "HIT" | "MISS" | "BYPASS" }> {
  if (ttlMs <= 0) {
    const loaded = await load();
    return {
      entry: { ...loaded, expiresAt: 0 },
      cacheStatus: "BYPASS",
    };
  }

  const cached = getProxyCacheEntry(key);
  if (cached) {
    return { entry: cached, cacheStatus: "HIT" };
  }

  const inFlight = proxyResponseInFlight.get(key);
  if (inFlight) {
    return { entry: await inFlight, cacheStatus: "HIT" };
  }

  const startedAt = Date.now();
  const loadPromise = (async () => {
    const loaded = await load();
    const entry: ProxyCacheEntry = {
      ...loaded,
      expiresAt: startedAt + ttlMs,
    };
    if (loaded.status >= 200 && loaded.status < 300) {
      setProxyCacheEntry(key, entry);
    }
    return entry;
  })();

  proxyResponseInFlight.set(key, loadPromise);
  try {
    return { entry: await loadPromise, cacheStatus: "MISS" };
  } finally {
    proxyResponseInFlight.delete(key);
  }
}

async function fetchUpstreamText(
  target: string,
  init: RequestInit,
): Promise<Omit<ProxyCacheEntry, "expiresAt">> {
  const upstream = await fetch(target, init);
  return {
    status: upstream.status,
    bodyText: await upstream.text(),
    contentType:
      upstream.headers.get("content-type") || "application/json; charset=utf-8",
  };
}

function proxyTextResponse(
  req: Request,
  entry: Pick<ProxyCacheEntry, "status" | "bodyText" | "contentType">,
  cacheStatus: "HIT" | "MISS" | "BYPASS",
): Response {
  const headers = new Headers({
    "content-type": entry.contentType || "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-hyperbet-proxy-cache": cacheStatus,
    ...securityHeaders(),
  });
  applyCors(req, headers);
  return new Response(entry.bodyText, { status: entry.status, headers });
}

function isSupportedEvmRpcChain(
  value: string,
): value is SupportedEvmRpcChain {
  return Object.hasOwn(EVM_RPC_PROXY_TARGETS, value);
}

function handlePerpsOracleHistory(req: Request, url: URL): Response {
  const characterId = url.searchParams.get("characterId")?.trim() || "";
  if (!characterId) {
    return jsonResponse(req, { error: "characterId is required" }, 400);
  }

  const limit = parseBoundedInteger(url.searchParams.get("limit"), 120, 1, 500);
  const snapshots = loadPerpsOracleSnapshots(characterId, limit)
    .slice()
    .reverse();
  const marketId =
    snapshots[0]?.marketId ?? modelMarketIdFromCharacterId(characterId);

  return jsonResponse(
    req,
    {
      characterId,
      marketId,
      snapshots,
      updatedAt: Date.now(),
    },
    200,
    {
      "cache-control": "no-store",
    },
  );
}

function handlePerpsMarkets(req: Request): Response {
  return jsonResponse(
    req,
    {
      markets: loadPerpsMarkets().map((market) => ({
        characterId: market.agentId,
        marketId: market.marketId,
        rank: market.rank,
        name: market.name,
        provider: market.provider,
        model: market.model,
        wins: market.wins,
        losses: market.losses,
        winRate: market.winRate,
        combatLevel: market.combatLevel,
        currentStreak: market.currentStreak,
        status: market.status,
        lastSeenAt: market.lastSeenAt,
        deprecatedAt: market.deprecatedAt,
        updatedAt: market.updatedAt,
      })),
      updatedAt: Date.now(),
    },
    200,
    {
      "cache-control": "no-store",
    },
  );
}

function handleDuelContext(req: Request): Response {
  return jsonResponse(
    req,
    {
      type: "STREAMING_DUEL_CONTEXT",
      cycle: streamState.cycle,
      leaderboard: streamState.leaderboard,
      cameraTarget: streamState.cameraTarget,
      updatedAt: streamState.emittedAt,
    },
    200,
    {
      "cache-control": "no-store",
    },
  );
}

function currentDuelKey(): string | null {
  const raw = streamState.cycle?.duelKeyHex;
  if (typeof raw !== "string") return null;
  const normalized = raw.trim().replace(/^0x/i, "").toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function currentDuelId(): string | null {
  const raw = streamState.cycle?.duelId;
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
}

function currentBetCloseTime(): number | null {
  const raw = streamState.cycle?.betCloseTime;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function currentWinnerFromCycle(): PredictionMarketWinner {
  const cycleAgent1 = streamState.cycle?.agent1 as { id?: unknown } | null | undefined;
  const cycleAgent2 = streamState.cycle?.agent2 as { id?: unknown } | null | undefined;
  const winnerId =
    typeof streamState.cycle?.winnerId === "string"
      ? streamState.cycle.winnerId
      : null;
  const agent1Id =
    typeof cycleAgent1?.id === "string"
      ? cycleAgent1.id
      : null;
  const agent2Id =
    typeof cycleAgent2?.id === "string"
      ? cycleAgent2.id
      : null;

  if (winnerId && agent1Id && winnerId === agent1Id) return "A";
  if (winnerId && agent2Id && winnerId === agent2Id) return "B";
  return "NONE";
}

function enumName(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const [key] = Object.keys(value as Record<string, unknown>);
  return typeof key === "string" && key.length > 0 ? key : null;
}

function resolveLifecycleFromSolanaStatus(
  status: string | null,
  fallback: PredictionMarketLifecycleStatus,
): PredictionMarketLifecycleStatus {
  switch (status?.toLowerCase()) {
    case "open":
      return "OPEN";
    case "locked":
      return "LOCKED";
    case "resolved":
      return "RESOLVED";
    case "cancelled":
      return "CANCELLED";
    default:
      return fallback;
  }
}

function resolveWinnerFromSolanaState(
  winner: string | null,
  fallback: PredictionMarketWinner,
): PredictionMarketWinner {
  switch (winner?.toLowerCase()) {
    case "a":
      return "A";
    case "b":
      return "B";
    case "none":
      return "NONE";
    default:
      return fallback;
  }
}

function resolvePhaseFromLifecycleStatus(
  lifecycleStatus: PredictionMarketLifecycleStatus | null | undefined,
): string | null {
  switch (lifecycleStatus) {
    case "OPEN":
      return "ANNOUNCEMENT";
    case "LOCKED":
      return "COUNTDOWN";
    case "RESOLVED":
    case "CANCELLED":
      return "RESOLUTION";
    default:
      return null;
  }
}

function normalizeHex32(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

function selectBotHealthMarket(
  botHealthSnapshot: KeeperBotHealthSnapshot | null,
  chainKey: "bsc" | "base",
): KeeperMarketHealthRecord | null {
  return (
    botHealthSnapshot?.markets.find((market) => market.chainKey === chainKey) ??
    null
  );
}

function resolveEvmLifecycleStatus(
  currentMatch: Record<string, any> | undefined,
  fallbackHealth: KeeperMarketHealthRecord | null,
): PredictionMarketLifecycleStatus {
  const parsedStatus = resolveLifecycleFromEvmStatus(currentMatch?.status);
  if (parsedStatus !== "UNKNOWN") return parsedStatus;
  return fallbackHealth?.lifecycleStatus ?? "UNKNOWN";
}

function buildPredictionMarketLifecycleRecords(
  botHealthSnapshot: KeeperBotHealthSnapshot | null = null,
): PredictionMarketLifecycleRecord[] {
  const duelKey = currentDuelKey();
  const duelId = currentDuelId();
  const betCloseTime = currentBetCloseTime();
  const cycleLifecycle = resolveLifecycleFromStreamPhase(
    typeof streamState.cycle?.phase === "string" ? streamState.cycle.phase : null,
  );
  const cycleWinner = currentWinnerFromCycle();
  const records: PredictionMarketLifecycleRecord[] = [];

  if (parsers.solana.enabled || parsers.solana.snapshot) {
    const snapshot = parsers.solana.snapshot as Record<string, any> | null;
    const solanaMarketPda =
      duelKey != null
        ? findMarketPda(
          GOLD_CLOB_MARKET_PROGRAM_ID,
          findDuelStatePda(FIGHT_ORACLE_PROGRAM_ID, duelKeyHexToBytes(duelKey)),
        ).toBase58()
        : null;
    const solanaLifecycle = resolveLifecycleFromSolanaStatus(
      typeof snapshot?.currentMarketStatus === "string"
        ? snapshot.currentMarketStatus
        : null,
      cycleLifecycle,
    );
    const solanaWinner = resolveWinnerFromSolanaState(
      typeof snapshot?.currentMarketWinner === "string"
        ? snapshot.currentMarketWinner
        : null,
      cycleWinner,
    );
    records.push({
      chainKey: "solana",
      duelKey,
      duelId,
      marketId:
        solanaMarketPda ??
        snapshot?.derivedMarketPda ??
        snapshot?.latestMarketAccount ??
        null,
      marketRef:
        solanaMarketPda ??
        snapshot?.derivedMarketPda ??
        snapshot?.latestMarketAccount ??
        null,
      lifecycleStatus: solanaLifecycle,
      winner: solanaWinner,
      betCloseTime,
      contractAddress: null,
      programId: snapshot?.marketProgram ?? null,
      txRef: snapshot?.recentSignature ?? null,
      syncedAt: parsers.solana.lastSuccessAt,
      metadata: {
        fightAccountCount: snapshot?.fightAccountCount ?? null,
        marketAccountCount: snapshot?.marketAccountCount ?? null,
      },
    });
  }

  for (const chainKey of ["bsc", "base"] as const) {
    const parser = parsers[chainKey];
    const fallbackHealth = selectBotHealthMarket(botHealthSnapshot, chainKey);
    if (!parser.enabled && !parser.snapshot && !fallbackHealth) continue;
    const snapshot = parser.snapshot as Record<string, any> | null;
    const snapshotDuelKey =
      typeof snapshot?.duelKey === "string" ? snapshot.duelKey : null;
    const snapshotDuelId =
      typeof snapshot?.duelId === "string" ? snapshot.duelId : null;
    const currentMatch = snapshot?.currentMatch as Record<string, any> | undefined;
    const marketKey =
      normalizeHex32(snapshot?.marketKey) ??
      normalizeHex32(fallbackHealth?.marketRef) ??
      null;
    const lifecycleStatus = resolveEvmLifecycleStatus(currentMatch, fallbackHealth);
    records.push({
      chainKey,
      duelKey: duelKey ?? snapshotDuelKey ?? fallbackHealth?.duelKey ?? null,
      duelId: duelId ?? snapshotDuelId ?? fallbackHealth?.duelId ?? null,
      marketId: marketKey,
      marketRef: marketKey,
      lifecycleStatus,
      winner:
        currentMatch?.winner != null
          ? resolveWinnerFromEvmStatus(currentMatch.winner)
          : (fallbackHealth?.winner ?? "NONE"),
      betCloseTime,
      contractAddress:
        snapshot?.contractAddress ??
        (chainKey === "bsc" ? bscContractAddress : baseContractAddress) ??
        null,
      programId: null,
      txRef: null,
      syncedAt: parser.lastSuccessAt ?? botHealthSnapshot?.updatedAtMs ?? null,
      metadata: {
        marketKey,
        yesPool: currentMatch?.yesPool ?? null,
        noPool: currentMatch?.noPool ?? null,
        recoveredFromBotHealth:
          Boolean(fallbackHealth) &&
          (duelKey == null ||
            duelId == null ||
            snapshot == null ||
            lifecycleStatus === fallbackHealth?.lifecycleStatus),
      },
    });
  }

  return records;
}

function handlePredictionMarkets(req: Request): Response {
  const botHealthSnapshot = loadKeeperBotHealthSnapshot();
  const markets = buildPredictionMarketLifecycleRecords(botHealthSnapshot);
  const fallbackMarket =
    markets.find((market) => market.duelKey != null || market.duelId != null) ?? null;
  const cyclePhase =
    typeof streamState.cycle?.phase === "string"
      ? streamState.cycle.phase
      : resolvePhaseFromLifecycleStatus(fallbackMarket?.lifecycleStatus);
  const cycleWinner = currentWinnerFromCycle();
  return jsonResponse(
    req,
    {
      duel: {
        duelKey: currentDuelKey() ?? fallbackMarket?.duelKey ?? null,
        duelId: currentDuelId() ?? fallbackMarket?.duelId ?? null,
        phase: cyclePhase,
        winner:
          cycleWinner !== "NONE"
            ? cycleWinner
            : (fallbackMarket?.winner ?? "NONE"),
        betCloseTime: currentBetCloseTime() ?? fallbackMarket?.betCloseTime ?? null,
      },
      markets,
      updatedAt: Date.now(),
    },
    200,
    {
      "cache-control": "no-store",
    },
  );
}

function handleStreamingLeaderboardDetails(req: Request, url: URL): Response {
  const historyLimit = parseBoundedInteger(
    url.searchParams.get("historyLimit"),
    10,
    1,
    100,
  );
  return jsonResponse(
    req,
    {
      leaderboard: streamState.leaderboard,
      cycle: streamState.cycle,
      recentDuels: [],
      historyLimit,
      updatedAt: streamState.emittedAt,
    },
    200,
    {
      "cache-control": "no-store",
    },
  );
}

function clientIp(req: Request): string {
  const directHeaders = [
    "cf-connecting-ip",
    "true-client-ip",
    "x-real-ip",
  ] as const;
  for (const name of directHeaders) {
    const value = req.headers.get(name)?.trim();
    if (value) return value;
  }

  const forwarded = req.headers.get("x-forwarded-for")?.trim();
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  const userAgent = req.headers.get("user-agent")?.trim();
  if (userAgent) {
    return `ua:${createHash("sha256")
      .update(userAgent)
      .digest("hex")
      .slice(0, 16)}`;
  }

  return "unknown";
}

function normalizeRateLimitPath(pathname: string): string {
  if (pathname.startsWith("/api/arena/points/history/")) {
    return "/api/arena/points/history/:wallet";
  }
  if (pathname.startsWith("/api/arena/points/rank/")) {
    return "/api/arena/points/rank/:wallet";
  }
  if (pathname.startsWith("/api/arena/points/multiplier/")) {
    return "/api/arena/points/multiplier/:wallet";
  }
  if (pathname.startsWith("/api/arena/points/")) {
    return "/api/arena/points/:wallet";
  }
  if (pathname.startsWith("/api/arena/invite/")) {
    return "/api/arena/invite/:wallet";
  }
  return pathname;
}

function checkRateLimit(
  req: Request,
  pathname: string,
  limitPerMinute: number,
  burst: number,
): boolean {
  if (DISABLE_RATE_LIMIT) {
    return true;
  }

  const now = Date.now();
  const key = [
    clientIp(req),
    req.method.toUpperCase(),
    normalizeRateLimitPath(pathname),
    limitPerMinute,
    burst,
  ].join(":");
  const bucket = rateBuckets.get(key) ?? {
    tokens: burst,
    lastRefillMs: now,
  };

  const elapsed = Math.max(0, now - bucket.lastRefillMs);
  const refill = (elapsed / 60_000) * limitPerMinute;
  bucket.tokens = Math.min(burst, bucket.tokens + refill);
  bucket.lastRefillMs = now;

  if (bucket.tokens < 1) {
    rateBuckets.set(key, bucket);
    return false;
  }

  bucket.tokens -= 1;
  rateBuckets.set(key, bucket);
  return true;
}

function requireWriteAuth(
  req: Request,
  fallbackKey = ARENA_WRITE_KEY,
): boolean {
  if (!fallbackKey) return true;
  const provided = req.headers.get("x-arena-write-key")?.trim() || "";
  return provided === fallbackKey;
}

function hasPrivilegedWriteAuth(
  req: Request,
  fallbackKey = ARENA_WRITE_KEY,
): boolean {
  return Boolean(fallbackKey) && requireWriteAuth(req, fallbackKey);
}

async function verifySolanaRecordedBet(
  bettorWallet: string,
  txSignature: string,
  expected: ExternalBetVerificationInput,
): Promise<VerifiedExternalBetRecord | null> {
  if (!solanaCtx) return null;
  const normalizedWallet = normalizeBase58Key(bettorWallet);
  const rawMarketRef = expected.marketRef?.trim() || null;
  const rawDuelKey = expected.duelKey?.trim() || null;
  const normalizedMarketRef = rawMarketRef
    ? normalizeBase58Key(rawMarketRef)
    : null;
  const normalizedDuelKey = normalizeDuelKeyHex(rawDuelKey);
  if (!normalizedWallet || !txSignature.trim()) {
    return null;
  }
  if ((rawMarketRef && !normalizedMarketRef) || (rawDuelKey && !normalizedDuelKey)) {
    return null;
  }
  if (!normalizedMarketRef && !normalizedDuelKey) {
    return null;
  }

  const expectedDuelState = normalizedDuelKey
    ? findDuelStatePda(
      FIGHT_ORACLE_PROGRAM_ID,
      duelKeyHexToBytes(normalizedDuelKey),
    ).toBase58()
    : null;
  const derivedMarketRef = expectedDuelState
    ? findMarketPda(
      GOLD_CLOB_MARKET_PROGRAM_ID,
      new PublicKey(expectedDuelState),
    ).toBase58()
    : null;
  if (
    normalizedMarketRef &&
    derivedMarketRef &&
    normalizedMarketRef !== derivedMarketRef
  ) {
    return null;
  }
  const expectedMarketRef = normalizedMarketRef ?? derivedMarketRef;

  try {
    const transaction = await solanaCtx.connection.getParsedTransaction(
      txSignature,
      {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      },
    );
    if (!transaction || transaction.meta?.err) {
      return null;
    }

    const walletSigned = transaction.transaction.message.accountKeys.some(
      (key: { pubkey: unknown; signer: boolean }) =>
        key.signer &&
        normalizeBase58Key(toInstructionAccountAddress(key.pubkey)) ===
          normalizedWallet,
    );
    if (!walletSigned) {
      return null;
    }

    for (const instruction of transaction.transaction.message.instructions) {
      const programId = extractInstructionProgramId(instruction);
      if (programId !== GOLD_CLOB_MARKET_PROGRAM_ID.toBase58()) {
        continue;
      }
      const decodedOrder =
        typeof instruction === "object" && instruction !== null && "data" in instruction
          ? decodePlaceOrderInstructionData(
            (instruction as { data?: unknown }).data,
          )
          : null;
      if (!decodedOrder) {
        continue;
      }
      const accounts = extractInstructionAccounts(instruction);
      const marketState = normalizeBase58Key(accounts[0] ?? null);
      const duelState = normalizeBase58Key(accounts[1] ?? null);
      const user = normalizeBase58Key(accounts[9] ?? null);
      if (user !== normalizedWallet) continue;
      if (expectedMarketRef && marketState !== expectedMarketRef) continue;
      if (expectedDuelState && duelState !== expectedDuelState) continue;
      if (!marketState) continue;

      const marketConfig = await solanaCtx.marketProgram.account.marketConfig.fetch(
        findMarketConfigPda(solanaCtx.marketProgramId),
      );
      const totalFeeBps =
        toNumberLike(marketConfig?.tradeTreasuryFeeBps) +
        toNumberLike(marketConfig?.tradeMarketMakerFeeBps);
      const quoteCostAtomic = calculateQuoteCostAtomic(
        decodedOrder.side,
        decodedOrder.price,
        decodedOrder.amount,
      );
      if (quoteCostAtomic == null) continue;
      const feeAmountAtomic = calculateBpsFeeAtomic(quoteCostAtomic, totalFeeBps);
      const totalSpendAtomic = quoteCostAtomic + feeAmountAtomic;
      const totalSpend = formatAtomicAmount(totalSpendAtomic, SOL_DISPLAY_DECIMALS);
      const feeAmount = formatAtomicAmount(feeAmountAtomic, SOL_DISPLAY_DECIMALS);

      return {
        chain: toRecordedBetChain("solana"),
        txSignature: txSignature.trim(),
        bettorWallet: normalizedWallet,
        duelKey: normalizedDuelKey,
        marketRef: marketState,
        sourceAsset: "SOL",
        sourceAmount: totalSpend,
        goldAmount: totalSpend,
        feeBps: totalFeeBps,
        feeAmount,
        pointsBasisAmount: totalSpend,
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function verifyEvmRecordedBet(
  client: ReturnType<typeof createPublicClient> | null,
  contractAddress: string,
  chainKey: "bsc" | "base",
  bettorWallet: string,
  txSignature: string,
  expected: ExternalBetVerificationInput,
): Promise<VerifiedExternalBetRecord | null> {
  if (!client || !contractAddress) return null;
  if (!/^0x[0-9a-fA-F]{64}$/.test(txSignature)) return null;
  const rawMarketRef = expected.marketRef?.trim() || null;
  const rawDuelKey = expected.duelKey?.trim() || null;
  const normalizedMarketRef = rawMarketRef ? normalizeHex32(rawMarketRef) : null;
  const normalizedDuelKey = normalizeHex32(
    rawDuelKey ? `0x${normalizeDuelKeyHex(rawDuelKey) ?? ""}` : null,
  );
  if ((rawMarketRef && !normalizedMarketRef) || (rawDuelKey && !normalizedDuelKey)) {
    return null;
  }
  if (!normalizedMarketRef && !normalizedDuelKey) {
    return null;
  }
  try {
    const [receipt, tx, totalFeeBpsRaw] = await Promise.all([
      client.getTransactionReceipt({ hash: txSignature as `0x${string}` }),
      client.getTransaction({ hash: txSignature as `0x${string}` }),
      client.readContract({
        address: contractAddress as Address,
        abi: GOLD_CLOB_READ_ABI,
        functionName: "feeBps",
      }),
    ]);
    if (
      receipt.status !== "success" ||
      tx.from.toLowerCase() !== bettorWallet.trim().toLowerCase() ||
      tx.to?.toLowerCase() !== contractAddress.toLowerCase()
    ) {
      return null;
    }

    const decodedCall = decodeFunctionData({
      abi: GOLD_CLOB_EVM_PLACE_ORDER_ABI,
      data: tx.input,
    });
    if (decodedCall.functionName !== "placeOrder") {
      return null;
    }
    const duelKeyArg = normalizeHex32((decodedCall.args?.[0] as string | undefined) ?? null);
    const marketKindArg = BigInt((decodedCall.args?.[1] as bigint | number | undefined) ?? 255);
    if (!duelKeyArg || marketKindArg !== GOLD_CLOB_EVM_DUEL_WINNER_MARKET_KIND) {
      return null;
    }
    if (normalizedDuelKey && duelKeyArg !== normalizedDuelKey) {
      return null;
    }
    const sideArg = BigInt(
      (decodedCall.args?.[2] as bigint | number | undefined) ?? 0,
    );
    const priceArg = Number(
      (decodedCall.args?.[3] as bigint | number | undefined) ?? 0,
    );
    const amountArg = BigInt(
      (decodedCall.args?.[4] as bigint | number | undefined) ?? 0,
    );
    const totalFeeBps = toNumberLike(
      totalFeeBpsRaw as bigint | number | { toString(): string },
    );
    const quoteCostAtomic = calculateQuoteCostAtomic(
      sideArg,
      priceArg,
      amountArg,
    );
    if (quoteCostAtomic == null) {
      return null;
    }
    const feeAmountAtomic = calculateBpsFeeAtomic(quoteCostAtomic, totalFeeBps);
    const totalSpendAtomic = quoteCostAtomic + feeAmountAtomic;
    const totalSpend = formatAtomicAmount(totalSpendAtomic, EVM_DISPLAY_DECIMALS);
    const feeAmount = formatAtomicAmount(feeAmountAtomic, EVM_DISPLAY_DECIMALS);

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== contractAddress.toLowerCase()) continue;
      try {
        const decodedLog = decodeEventLog({
          abi: [GOLD_CLOB_EVM_ORDER_PLACED_EVENT],
          data: log.data,
          topics: log.topics,
        });
        const args = decodedLog.args as { marketKey?: string; maker?: string };
        const marketKey = normalizeHex32(args.marketKey ?? null);
        const maker = args.maker?.toLowerCase();
        if (!marketKey || maker !== bettorWallet.trim().toLowerCase()) {
          continue;
        }
        if (normalizedMarketRef && marketKey !== normalizedMarketRef) {
          continue;
        }
        return {
          chain: toRecordedBetChain(chainKey),
          txSignature: txSignature.trim(),
          bettorWallet: bettorWallet.trim(),
          duelKey: duelKeyArg.replace(/^0x/i, "").toLowerCase(),
          marketRef: marketKey,
          sourceAsset: evmSourceAssetForChain(chainKey),
          sourceAmount: totalSpend,
          goldAmount: totalSpend,
          feeBps: totalFeeBps,
          feeAmount,
          pointsBasisAmount: totalSpend,
        };
      } catch {
        continue;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function authorizeExternalBetRecord(
  req: Request,
  chainKey: "solana" | "bsc" | "base" | "avax",
  bettorWallet: string,
  txSignature: string,
  expected: ExternalBetVerificationInput,
): Promise<VerifiedExternalBetRecord | null> {
  if (!isAllowedAppOrigin(req.headers.get("origin")) || !txSignature.trim()) {
    return null;
  }

  if (chainKey === "solana") {
    return verifySolanaRecordedBet(bettorWallet, txSignature, expected);
  }
  if (chainKey === "bsc") {
    return verifyEvmRecordedBet(
      bscClient,
      bscContractAddress,
      "bsc",
      bettorWallet,
      txSignature,
      expected,
    );
  }
  if (chainKey === "base") {
    return verifyEvmRecordedBet(
      baseClient,
      baseContractAddress,
      "base",
      bettorWallet,
      txSignature,
      expected,
    );
  }
  return null;
}

function toStreamState(payload: any): StreamState | null {
  if (!payload || typeof payload !== "object") return null;

  const candidate = payload as Record<string, any>;
  const cycle = candidate.cycle;
  if (!cycle || typeof cycle !== "object") return null;

  return {
    type: "STREAMING_STATE_UPDATE",
    cycle: cycle as Record<string, any>,
    leaderboard: Array.isArray(candidate.leaderboard)
      ? candidate.leaderboard
      : [],
    cameraTarget:
      typeof candidate.cameraTarget === "string" ||
      candidate.cameraTarget === null
        ? candidate.cameraTarget
        : null,
    seq:
      typeof candidate.seq === "number" && Number.isFinite(candidate.seq)
        ? candidate.seq
        : streamSeq + 1,
    emittedAt:
      typeof candidate.emittedAt === "number" &&
      Number.isFinite(candidate.emittedAt)
        ? candidate.emittedAt
        : Date.now(),
  };
}

function sendSse(
  controller: ReadableStreamDefaultController<Uint8Array>,
  event: string,
  id: number,
  data: unknown,
): void {
  const message =
    `id: ${id}\n` + `event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`;
  controller.enqueue(encoder.encode(message));
}

function broadcastStreamState(nextState: StreamState, event = "state"): void {
  for (const controller of sseClients) {
    try {
      sendSse(controller, event, nextState.seq, nextState);
    } catch {
      sseClients.delete(controller);
    }
  }
}

function publishStreamState(next: StreamState, sourceLabel: string): void {
  streamSeq = Math.max(streamSeq + 1, next.seq || streamSeq + 1);
  streamState = {
    ...next,
    type: "STREAMING_STATE_UPDATE",
    seq: streamSeq,
    emittedAt: Date.now(),
  };
  streamLastUpdatedAt = Date.now();
  streamLastSourceError = null;
  persistStreamStateSnapshot(streamState);
  broadcastStreamState(streamState, "state");
  console.log(
    `[${nowIso()}] [stream] updated from ${sourceLabel} cycle=${streamState.cycle?.cycleId ?? "unknown"} phase=${streamState.cycle?.phase ?? "unknown"}`,
  );
}

function nextStreamSourceBackoffMs(): number {
  const step = Math.min(streamSourceConsecutiveFailures, 5);
  return Math.min(
    STREAM_STATE_SOURCE_MAX_BACKOFF_MS,
    STREAM_STATE_POLL_MS * 2 ** step,
  );
}

function registerStreamSourceFailure(reason: string): void {
  streamSourceConsecutiveFailures += 1;
  const backoffMs = nextStreamSourceBackoffMs();
  streamSourceBackoffUntil = Date.now() + backoffMs;

  if (
    streamSourceConsecutiveFailures === 1 ||
    streamSourceConsecutiveFailures % 10 === 0
  ) {
    console.warn(
      `[${nowIso()}] [stream] source poll failed (${reason}); backing off ${backoffMs}ms (consecutive=${streamSourceConsecutiveFailures})`,
    );
  }
}

function resetStreamSourceFailures(): void {
  streamSourceConsecutiveFailures = 0;
  streamSourceBackoffUntil = 0;
}

async function pollStreamStateSource(): Promise<void> {
  if (!STREAM_STATE_SOURCE_URL) return;
  if (streamSourcePollInFlight) return;
  if (Date.now() < streamSourceBackoffUntil) return;

  streamSourcePollInFlight = true;
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    STREAM_STATE_SOURCE_TIMEOUT_MS,
  );

  try {
    const headers: Record<string, string> = {};
    if (STREAM_STATE_SOURCE_BEARER_TOKEN) {
      headers.authorization = `Bearer ${STREAM_STATE_SOURCE_BEARER_TOKEN}`;
    }
    headers.connection = "close";

    const response = await fetch(STREAM_STATE_SOURCE_URL, {
      cache: "no-store",
      headers,
      signal: controller.signal,
    });
    streamLastSourcePollAt = Date.now();
    if (!response.ok) {
      streamLastSourceError = `HTTP ${response.status}`;
      try {
        await response.body?.cancel();
      } catch {
        // Ignore cancellation issues for already-closed streams.
      }
      registerStreamSourceFailure(streamLastSourceError);
      return;
    }

    const payload = await response.json();
    const nextState =
      toStreamState(payload) ||
      toStreamState((payload as Record<string, unknown>)?.data);

    if (!nextState) {
      streamLastSourceError = "Invalid payload";
      registerStreamSourceFailure(streamLastSourceError);
      return;
    }

    const changed =
      streamState.cycle?.cycleId !== nextState.cycle?.cycleId ||
      streamState.cycle?.phase !== nextState.cycle?.phase ||
      streamState.cycle?.winnerId !== nextState.cycle?.winnerId;
    if (changed) {
      publishStreamState(nextState, "poll");
    }
    streamLastSourceError = null;
    resetStreamSourceFailures();
  } catch (error) {
    streamLastSourceError =
      error instanceof Error ? error.message : "stream source request failed";
    registerStreamSourceFailure(streamLastSourceError);
  } finally {
    clearTimeout(timeoutId);
    streamSourcePollInFlight = false;
  }
}

function connectedSseCount(): number {
  return sseClients.size;
}

let botSubprocess: Bun.Subprocess | null = null;
let botExitCode: number | null = null;
let botLastExitAt: number | null = null;

function startKeeperBotIfEnabled(): void {
  if (!ENABLE_KEEPER_BOT) return;
  if (botSubprocess) return;

  const childEnv = {
    ...process.env,
    GAME_URL: process.env.GAME_URL || `http://127.0.0.1:${PORT}`,
    EVM_KEEPER_CHAINS: process.env.EVM_KEEPER_CHAINS || "bsc,base",
    KEEPER_BOT_HEALTH_FILE,
  };

  botSubprocess = Bun.spawn(["bun", "--bun", "src/bot.ts"], {
    cwd: keeperRoot,
    env: childEnv,
    stdout: "inherit",
    stderr: "inherit",
  });

  void botSubprocess.exited.then((code: number) => {
    botExitCode = code;
    botLastExitAt = Date.now();
    botSubprocess = null;
    console.warn(`[${nowIso()}] [bot] exited with code ${code}`);
    if (ENABLE_KEEPER_BOT) {
      setTimeout(() => {
        startKeeperBotIfEnabled();
      }, 5_000);
    }
  });
}

const solanaKeyRef =
  process.env.BOT_KEYPAIR ||
  process.env.ORACLE_AUTHORITY_KEYPAIR ||
  process.env.MARKET_MAKER_KEYPAIR ||
  "";

let solanaCtx: {
  connection: any;
  fightProgram: any;
  marketProgram: any;
  marketProgramId: any;
} | null = null;

if (solanaKeyRef) {
  try {
    const signer = readKeypair(solanaKeyRef);
    const { connection, fightOracle, goldClobMarket } = createPrograms(signer);
    solanaCtx = {
      connection,
      fightProgram: fightOracle,
      marketProgram: goldClobMarket,
      marketProgramId: goldClobMarket.programId,
    };
    parsers.solana.enabled = true;
  } catch (error) {
    parsers.solana.enabled = false;
    parsers.solana.lastError =
      error instanceof Error
        ? error.message
        : "Failed to initialize Solana parser";
  }
} else {
  parsers.solana.lastError =
    "No BOT_KEYPAIR / ORACLE_AUTHORITY_KEYPAIR / MARKET_MAKER_KEYPAIR configured";
}

async function pollSolanaSnapshot(): Promise<void> {
  if (!solanaCtx) return;
  try {
    // Use raw program account scans/signatures for resilient parsing across
    // account-layout upgrades and IDL drift.
    const [fightAccounts, marketAccounts, recentSignatures] = await Promise.all(
      [
        solanaCtx.connection.getProgramAccounts(
          solanaCtx.fightProgram.programId,
          {
            dataSlice: { offset: 0, length: 0 },
          },
        ),
        solanaCtx.connection.getProgramAccounts(
          solanaCtx.marketProgram.programId,
          {
            dataSlice: { offset: 0, length: 0 },
          },
        ),
        solanaCtx.connection.getSignaturesForAddress(
          solanaCtx.fightProgram.programId,
          { limit: 10 },
        ),
      ],
    );

    const latestFightAccount = fightAccounts[0]?.pubkey?.toBase58?.() ?? null;
    const latestMarketAccount = marketAccounts[0]?.pubkey?.toBase58?.() ?? null;
    const derivedMarketPda =
      fightAccounts[0]?.pubkey != null
        ? findMarketPda(
            solanaCtx.marketProgramId,
            fightAccounts[0]!.pubkey,
          ).toBase58()
        : null;
    const currentSolanaDuelKey = currentDuelKey();
    const currentMarketPda =
      currentSolanaDuelKey != null
        ? findMarketPda(
            solanaCtx.marketProgramId,
            findDuelStatePda(
              solanaCtx.fightProgram.programId,
              duelKeyHexToBytes(currentSolanaDuelKey),
            ),
          ).toBase58()
        : null;
    const currentMarketAccount =
      currentMarketPda != null
        ? await solanaCtx.marketProgram.account.marketState.fetchNullable(
            new PublicKey(currentMarketPda),
          )
        : null;
    const recentSignature =
      recentSignatures.find((entry: any) => entry?.signature)?.signature ??
      null;

    parsers.solana.snapshot = {
      rpc: sanitizeUrlForStatus(solanaCtx.connection.rpcEndpoint),
      fightOracleProgram: solanaCtx.fightProgram.programId.toBase58(),
      marketProgram: solanaCtx.marketProgram.programId.toBase58(),
      fightAccountCount: fightAccounts.length,
      marketAccountCount: marketAccounts.length,
      latestFightAccount,
      latestMarketAccount,
      derivedMarketPda,
      currentMarketPda,
      currentMarketStatus: enumName(currentMarketAccount?.status),
      currentMarketWinner: enumName(currentMarketAccount?.winner),
      recentSignature,
    };
    parsers.solana.lastSuccessAt = Date.now();
    parsers.solana.lastError = null;
  } catch (error) {
    parsers.solana.lastError =
      error instanceof Error ? error.message : "Solana poll failed";
  }
}

async function pollEvmSnapshot(
  label: "bsc" | "base",
  client: ReturnType<typeof createPublicClient> | null,
  contractAddress: string,
): Promise<void> {
  if (!client || !contractAddress) return;
  const parser = parsers[label];

  try {
    const snapshotDuelKey =
      typeof parser.snapshot?.duelKey === "string"
        ? parser.snapshot.duelKey.trim().replace(/^0x/i, "").toLowerCase()
        : null;
    const snapshotDuelId =
      typeof parser.snapshot?.duelId === "string"
        ? parser.snapshot.duelId.trim()
        : null;
    const fallbackHealth = selectBotHealthMarket(
      loadKeeperBotHealthSnapshot(),
      label,
    );
    const duelKey =
      currentDuelKey() ?? snapshotDuelKey ?? fallbackHealth?.duelKey ?? null;
    if (!duelKey) return;
    const duelId =
      currentDuelId() ?? snapshotDuelId ?? fallbackHealth?.duelId ?? null;

    const normalizedDuelKey = `0x${duelKey}` as `0x${string}`;
    const marketKey = (await client.readContract({
      address: contractAddress as Address,
      abi: GOLD_CLOB_READ_ABI,
      functionName: "marketKey",
      args: [normalizedDuelKey, 0],
    })) as `0x${string}`;
    const market = (await client.readContract({
      address: contractAddress as Address,
      abi: GOLD_CLOB_READ_ABI,
      functionName: "getMarket",
      args: [normalizedDuelKey, 0],
    })) as any;

    const status = Number(market?.status ?? 0);
    const winner = Number(market?.winner ?? 0);
    const yesPool = String(market?.totalAShares ?? 0n);
    const noPool = String(market?.totalBShares ?? 0n);

    parser.snapshot = {
      contractAddress,
      duelKey,
      duelId,
      marketKey,
      currentMatch: {
        status,
        winner,
        yesPool,
        noPool,
      },
    };
    parser.lastSuccessAt = Date.now();
    parser.lastError = null;
  } catch (error) {
    parser.lastError =
      error instanceof Error ? error.message : `${label} poll failed`;
  }
}

let contractPollInFlight = false;
async function pollContractParsers(): Promise<void> {
  if (contractPollInFlight) return;
  contractPollInFlight = true;
  try {
    await Promise.all([
      pollSolanaSnapshot(),
      pollEvmSnapshot("bsc", bscClient, bscContractAddress),
      pollEvmSnapshot("base", baseClient, baseContractAddress),
    ]);
  } finally {
    contractPollInFlight = false;
  }
}

function getReferralOwner(
  wallet: string,
): { wallet: string; code: string } | null {
  const normalized = rememberWalletCase(wallet);
  const direct = referredByWallet.get(normalized);
  if (direct) return direct;

  const canonical = ensureIdentity(normalized);
  const members = identityMembers.get(canonical);
  if (!members) return null;
  for (const member of members) {
    const linked = referredByWallet.get(member);
    if (linked) return linked;
  }
  return null;
}

function pointsForWalletResponse(
  wallet: string,
  scope: string | null,
): Record<string, any> {
  const wallets = identityWallets(wallet, scope);
  const aggregate = aggregatePoints(wallets);
  const multiplierDetail = multiplierDetailForWallets(wallets);
  const normalized = rememberWalletCase(wallet);
  const referredBy = getReferralOwner(normalized);

  return {
    wallet: wallet.trim(),
    pointsScope: scope?.toLowerCase() === "linked" ? "LINKED" : "WALLET",
    identityWalletCount: wallets.length,
    totalPoints: totalPoints(aggregate),
    selfPoints: aggregate.selfPoints,
    winPoints: aggregate.winPoints,
    referralPoints: aggregate.referralPoints,
    stakingPoints: aggregate.stakingPoints,
    multiplier: multiplierDetail.multiplier,
    goldBalance: multiplierDetail.goldBalance,
    goldHoldDays: multiplierDetail.goldHoldDays,
    invitedWalletCount: (
      invitedWalletsByWallet.get(ensureIdentity(normalized)) ?? new Set()
    ).size,
    referredBy: referredBy
      ? {
          wallet: displayWallet(referredBy.wallet),
          code: referredBy.code,
        }
      : null,
  };
}

function leaderboardResponse(
  limit: number,
  offset: number,
  scope: string | null,
  window: PointsWindow,
): {
  leaderboard: Array<{ rank: number; wallet: string; totalPoints: number }>;
} {
  const rows = leaderboardRows(scope, window);
  const sliced = rows.slice(offset, offset + limit);
  return {
    leaderboard: sliced.map((row, index) => ({
      rank: offset + index + 1,
      wallet: row.wallet,
      totalPoints: row.totalPoints,
    })),
  };
}

function rankResponse(wallet: string): Record<string, any> {
  const normalized = rememberWalletCase(wallet);
  const canonical = ensureIdentity(normalized);
  const rows = leaderboardRows("linked", "alltime");
  const rank =
    rows.findIndex((entry) => normalizeWallet(entry.wallet) === canonical) + 1;
  const wallets = identityWallets(normalized, "linked");

  return {
    wallet: displayWallet(canonical),
    rank: rank > 0 ? rank : 0,
    totalPoints: totalPoints(aggregatePoints(wallets)),
  };
}

function historyResponse(
  wallet: string,
  limit: number,
  offset: number,
  eventType: string | null,
): Record<string, any> {
  const normalized = rememberWalletCase(wallet);
  const wallets = new Set(identityWallets(normalized, "linked"));
  const filtered = pointsEvents.filter((entry) => {
    if (!wallets.has(entry.wallet)) return false;
    if (eventType && entry.eventType !== eventType) return false;
    return true;
  });

  const entries = filtered.slice(offset, offset + limit).map((entry) => ({
    id: entry.id,
    wallet: displayWallet(entry.wallet),
    eventType: entry.eventType,
    status: entry.status,
    totalPoints: entry.totalPoints,
    referenceType: entry.referenceType,
    referenceId: entry.referenceId,
    relatedWallet: entry.relatedWallet
      ? displayWallet(entry.relatedWallet)
      : entry.wallet !== normalized
        ? displayWallet(entry.wallet)
        : null,
    createdAt: entry.createdAt,
  }));

  return {
    wallet: wallet.trim(),
    entries,
    total: filtered.length,
    limit,
    offset,
  };
}

function multiplierResponse(wallet: string): Record<string, any> {
  const wallets = identityWallets(wallet, "linked");
  const detail = multiplierDetailForWallets(wallets);
  return {
    wallet: wallet.trim(),
    multiplier: detail.multiplier,
    tier: detail.tier,
    nextTierThreshold: detail.nextTierThreshold,
    goldBalance: detail.goldBalance,
    goldHoldDays: detail.goldHoldDays,
  };
}

async function handleBetRecord(req: Request): Promise<Response> {
  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(req, { error: "Invalid JSON body" }, 400);
  }

  const walletRaw = String(payload.bettorWallet || "").trim();
  if (!walletRaw) {
    return jsonResponse(req, { error: "Missing bettorWallet" }, 400);
  }

  const chainKey = normalizeChainKey(
    String(payload.chainKey || payload.chain || "solana"),
  );
  const txSignature = String(payload.txSignature || "").trim();
  const marketRefRaw = payload.marketPda
    ? String(payload.marketPda)
    : payload.marketRef
      ? String(payload.marketRef)
      : null;
  const duelKeyRaw = payload.duelKey ? String(payload.duelKey).trim() : null;
  const authorizedByWriteKey = hasPrivilegedWriteAuth(req);
  const verifiedExternalBet = authorizedByWriteKey
    ? null
    : await authorizeExternalBetRecord(req, chainKey, walletRaw, txSignature, {
      marketRef: marketRefRaw,
      duelKey: duelKeyRaw,
    });
  if (!authorizedByWriteKey && !verifiedExternalBet) {
    return jsonResponse(req, { error: "Unauthorized write key" }, 401);
  }

  const sourceAmount = verifiedExternalBet
    ? verifiedExternalBet.sourceAmount
    : parseNumberInput(payload.sourceAmount, 0);
  const goldAmount = verifiedExternalBet
    ? verifiedExternalBet.goldAmount
    : parseNumberInput(payload.goldAmount, sourceAmount);
  const feeBps = verifiedExternalBet
    ? Math.max(0, verifiedExternalBet.feeBps)
    : Math.max(0, parseNumberInput(payload.feeBps, 0));
  const recordedAt = Date.now();

  const normalizedWallet = rememberWalletCase(walletRaw);
  ensureIdentity(normalizedWallet);
  const pointsBasisAmount = verifiedExternalBet
    ? Math.max(verifiedExternalBet.pointsBasisAmount, 0)
    : Math.max(goldAmount, sourceAmount);
  const pointsAwarded = Math.max(
    1,
    Math.round(pointsBasisAmount * 10),
  );
  const canonicalChain = verifiedExternalBet?.chain ?? toRecordedBetChain(chainKey);
  const canonicalTxSignature = verifiedExternalBet?.txSignature ?? txSignature;
  const canonicalMarketRef = verifiedExternalBet?.marketRef ?? marketRefRaw;
  const canonicalDuelKey = verifiedExternalBet?.duelKey ?? duelKeyRaw;
  const canonicalSourceAsset =
    verifiedExternalBet?.sourceAsset ?? String(payload.sourceAsset || "GOLD");
  const canonicalExternalBetRef = authorizedByWriteKey
    ? payload.externalBetRef
      ? String(payload.externalBetRef)
      : canonicalTxSignature
        ? `${chainKey}:${canonicalTxSignature}`
        : null
    : canonicalTxSignature
      ? `${chainKey}:${canonicalTxSignature}`
      : null;
  const record: BetRecord = {
    id: `${recordedAt}-${Math.random().toString(36).slice(2, 10)}`,
    bettorWallet: displayWallet(normalizedWallet),
    chain: canonicalChain,
    sourceAsset: canonicalSourceAsset,
    sourceAmount,
    goldAmount,
    feeBps,
    txSignature: canonicalTxSignature,
    marketPda: canonicalMarketRef,
    duelKey: canonicalDuelKey,
    duelId: payload.duelId ? String(payload.duelId).trim() : null,
    inviteCode: null,
    externalBetRef: canonicalExternalBetRef,
    recordedAt,
  };

  const inviteCodeRaw = String(payload.inviteCode || "")
    .trim()
    .toUpperCase();
  record.inviteCode = inviteCodeRaw || null;
  const inserted = saveBet(record);
  if (!inserted) {
    return jsonResponse(req, {
      ok: true,
      duplicate: true,
      pointsAwarded: 0,
      wallet: record.bettorWallet,
      totalPoints: totalPoints(aggregatePoints([normalizedWallet])),
    });
  }

  const points = ensureWalletPoints(normalizedWallet);
  points.selfPoints += pointsAwarded;
  saveWalletPoints(normalizedWallet, points);

  if (inviteCodeRaw && !referredByWallet.has(normalizedWallet)) {
    const inviter = walletByInviteCode.get(inviteCodeRaw);
    if (inviter && inviter !== normalizedWallet) {
      referredByWallet.set(normalizedWallet, {
        wallet: inviter,
        code: inviteCodeRaw,
      });
      saveReferral(normalizedWallet, inviter, inviteCodeRaw);
      const invited = invitedWalletsByWallet.get(inviter) ?? new Set<string>();
      invited.add(normalizedWallet);
      invitedWalletsByWallet.set(inviter, invited);
      saveInvitedWallet(inviter, normalizedWallet);
    }
  }

  recordPointsEvent({
    wallet: normalizedWallet,
    eventType: "BET_PLACED",
    status: "CONFIRMED",
    totalPoints: pointsAwarded,
    referenceType: "BET",
    referenceId: record.externalBetRef ?? record.txSignature ?? record.id,
    relatedWallet: null,
    createdAt: record.recordedAt,
  });

  const referrer = getReferralOwner(normalizedWallet);
  if (referrer && referrer.wallet !== normalizedWallet) {
    const referrerPoints = ensureWalletPoints(referrer.wallet);
    const referralPointsAwarded = Math.max(1, Math.round(pointsAwarded * 0.2));
    referrerPoints.referralPoints += referralPointsAwarded;
    saveWalletPoints(referrer.wallet, referrerPoints);

    const betFeeGold = verifiedExternalBet
      ? Math.max(verifiedExternalBet.feeAmount, 0)
      : (Math.max(goldAmount, 0) * Math.max(feeBps, 0)) / 10_000;
    const referralFeeShare = betFeeGold * 0.5;
    const newFeeShare =
      (referralFeeShareGoldByWallet.get(referrer.wallet) ?? 0) +
      referralFeeShare;
    const newTreasuryFees =
      (treasuryFeesFromReferralsByWallet.get(referrer.wallet) ?? 0) +
      betFeeGold;
    referralFeeShareGoldByWallet.set(referrer.wallet, newFeeShare);
    treasuryFeesFromReferralsByWallet.set(referrer.wallet, newTreasuryFees);
    saveReferralFees(referrer.wallet, newFeeShare, newTreasuryFees);
    recordPointsEvent({
      wallet: referrer.wallet,
      eventType: "REFERRAL_WIN",
      status: "CONFIRMED",
      totalPoints: referralPointsAwarded,
      referenceType: "BET",
      referenceId: record.externalBetRef ?? record.txSignature ?? record.id,
      relatedWallet: normalizedWallet,
      createdAt: record.recordedAt,
    });
  }
  bets.unshift(record);
  if (bets.length > BET_STORE_LIMIT) {
    bets.length = BET_STORE_LIMIT;
  }

  return jsonResponse(req, {
    ok: true,
    pointsAwarded,
    wallet: record.bettorWallet,
    totalPoints: totalPoints(aggregatePoints([normalizedWallet])),
  });
}

async function handleInviteRedeem(req: Request): Promise<Response> {
  if (!requireWriteAuth(req)) {
    return jsonResponse(req, { error: "Unauthorized write key" }, 401);
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(req, { error: "Invalid JSON body" }, 400);
  }

  const walletRaw = String(payload.wallet || "").trim();
  const inviteCode = String(payload.inviteCode || "")
    .trim()
    .toUpperCase();
  if (!walletRaw || !inviteCode) {
    return jsonResponse(
      req,
      { error: "wallet and inviteCode are required" },
      400,
    );
  }

  const wallet = rememberWalletCase(walletRaw);
  ensureIdentity(wallet);

  const inviterWallet = walletByInviteCode.get(inviteCode);
  if (!inviterWallet) {
    return jsonResponse(req, { error: "Invalid invite code" }, 404);
  }
  if (inviterWallet === wallet) {
    return jsonResponse(
      req,
      { error: "Cannot redeem your own invite code" },
      400,
    );
  }

  const existing = referredByWallet.get(wallet);
  if (existing) {
    return jsonResponse(req, {
      result: {
        alreadyLinked: true,
        signupBonus: 0,
      },
    });
  }

  referredByWallet.set(wallet, { wallet: inviterWallet, code: inviteCode });
  saveReferral(wallet, inviterWallet, inviteCode);
  const invited =
    invitedWalletsByWallet.get(inviterWallet) ?? new Set<string>();
  invited.add(wallet);
  invitedWalletsByWallet.set(inviterWallet, invited);
  saveInvitedWallet(inviterWallet, wallet);

  const signupBonus = 50;
  const walletPts = ensureWalletPoints(wallet);
  walletPts.selfPoints += signupBonus;
  saveWalletPoints(wallet, walletPts);
  recordPointsEvent({
    wallet,
    eventType: "SIGNUP_REFEREE",
    status: "CONFIRMED",
    totalPoints: signupBonus,
    referenceType: "INVITE",
    referenceId: inviteCode,
    relatedWallet: inviterWallet,
    createdAt: Date.now(),
  });

  const referrerSignupBonus = 25;
  const referrerPoints = ensureWalletPoints(inviterWallet);
  referrerPoints.referralPoints += referrerSignupBonus;
  saveWalletPoints(inviterWallet, referrerPoints);
  recordPointsEvent({
    wallet: inviterWallet,
    eventType: "SIGNUP_REFERRER",
    status: "CONFIRMED",
    totalPoints: referrerSignupBonus,
    referenceType: "INVITE",
    referenceId: inviteCode,
    relatedWallet: wallet,
    createdAt: Date.now(),
  });

  return jsonResponse(req, {
    result: {
      alreadyLinked: false,
      signupBonus,
    },
  });
}

async function handleWalletLink(req: Request): Promise<Response> {
  if (!requireWriteAuth(req)) {
    return jsonResponse(req, { error: "Unauthorized write key" }, 401);
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(req, { error: "Invalid JSON body" }, 400);
  }

  const walletRaw = String(payload.wallet || "").trim();
  const linkedWalletRaw = String(payload.linkedWallet || "").trim();
  if (!walletRaw || !linkedWalletRaw) {
    return jsonResponse(
      req,
      { error: "wallet and linkedWallet are required" },
      400,
    );
  }

  const wallet = rememberWalletCase(walletRaw);
  const linkedWallet = rememberWalletCase(linkedWalletRaw);

  const merged = mergeIdentity(wallet, linkedWallet);
  const awardedPoints = merged ? 100 : 0;
  if (merged) {
    const walletPts = ensureWalletPoints(wallet);
    walletPts.selfPoints += awardedPoints;
    saveWalletPoints(wallet, walletPts);
    recordPointsEvent({
      wallet,
      eventType: "WALLET_LINK",
      status: "CONFIRMED",
      totalPoints: awardedPoints,
      referenceType: "IDENTITY",
      referenceId: `${wallet}:${linkedWallet}`,
      relatedWallet: linkedWallet,
      createdAt: Date.now(),
    });
  }

  return jsonResponse(req, {
    result: {
      alreadyLinked: !merged,
      awardedPoints,
    },
  });
}

function inviteSummary(
  walletRaw: string,
  platformView: string,
): Record<string, any> {
  const wallet = rememberWalletCase(walletRaw);
  const code = inviteCodeForWallet(wallet);
  const canonical = ensureIdentity(wallet);
  const invited = invitedWalletsByWallet.get(canonical) ?? new Set<string>();
  const aggregate = aggregatePoints(identityWallets(wallet, "linked"));
  const referredBy = getReferralOwner(wallet);
  const invitedWallets = [...invited].map((entry) => displayWallet(entry));
  const feeShare = referralFeeShareGoldByWallet.get(canonical) ?? 0;
  const treasuryFees = treasuryFeesFromReferralsByWallet.get(canonical) ?? 0;
  const inviteWallets = new Set(identityWallets(wallet, "linked"));
  const totalReferralWinPoints = pointsEvents
    .filter(
      (entry) =>
        inviteWallets.has(entry.wallet) && entry.eventType === "REFERRAL_WIN",
    )
    .reduce((sum, entry) => sum + entry.totalPoints, 0);

  return {
    wallet: displayWallet(wallet),
    platformView: platformView || "unknown",
    inviteCode: code,
    invitedWalletCount: invitedWallets.length,
    invitedWallets: invitedWallets.slice(0, 25),
    invitedWalletsTruncated: invitedWallets.length > 25,
    pointsFromReferrals: aggregate.referralPoints,
    feeShareFromReferralsGold: feeShare.toFixed(6),
    treasuryFeesFromReferredBetsGold: treasuryFees.toFixed(6),
    referredByWallet: referredBy ? displayWallet(referredBy.wallet) : null,
    referredByCode: referredBy ? referredBy.code : null,
    activeReferralCount: invitedWallets.length,
    pendingSignupBonuses: 0,
    totalReferralWinPoints,
  };
}

async function handleSolanaRpcProxy(req: Request): Promise<Response> {
  if (!SOLANA_RPC_PROXY_URL) {
    return jsonResponse(
      req,
      { error: "SOLANA_RPC_URL is not configured" },
      503,
    );
  }

  const rpcBody = await readJsonRpcBody(req, SOLANA_RPC_PROXY_MAX_BODY_BYTES);
  if (!rpcBody.ok) {
    return rpcBody.response;
  }

  try {
    const ttlMs = resolveJsonRpcCacheTtlMs(
      rpcBody.requests,
      SOLANA_RPC_CACHE_TTL_MS,
    );
    const cacheKey = buildProxyCacheKey(
      "solana-rpc",
      `${SOLANA_RPC_PROXY_URL}\n${rpcBody.bodyText}`,
    );
    const { entry, cacheStatus } = await fetchProxyResponseWithCache(
      cacheKey,
      ttlMs,
      () =>
        fetchUpstreamText(SOLANA_RPC_PROXY_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: rpcBody.bodyText,
          cache: "no-store",
        }),
    );
    return proxyTextResponse(req, entry, cacheStatus);
  } catch (error) {
    return jsonResponse(
      req,
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to proxy Solana RPC request",
      },
      502,
    );
  }
}

type JsonRpcBodyResult =
  | { ok: true; bodyText: string; requests: JsonRpcRequestPayload[] }
  | { ok: false; response: Response };

async function readJsonRpcBody(
  req: Request,
  maxBodyBytes: number,
): Promise<JsonRpcBodyResult> {
  let bodyText = "";
  try {
    bodyText = await req.text();
  } catch {
    return {
      ok: false,
      response: jsonResponse(
        req,
        { error: "Unable to read request body" },
        400,
      ),
    };
  }

  if (!bodyText.trim()) {
    return {
      ok: false,
      response: jsonResponse(req, { error: "Missing JSON-RPC body" }, 400),
    };
  }

  if (bodyText.length > maxBodyBytes) {
    return {
      ok: false,
      response: jsonResponse(req, { error: "JSON-RPC body too large" }, 413),
    };
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(bodyText);
  } catch {
    return {
      ok: false,
      response: jsonResponse(req, { error: "Invalid JSON-RPC body" }, 400),
    };
  }

  const requests = (
    Array.isArray(parsedBody) ? parsedBody : [parsedBody]
  ) as JsonRpcRequestPayload[];
  const hasInvalidRequest = requests.some((entry) => {
    if (!entry || typeof entry !== "object") return true;
    const method = (entry as Record<string, unknown>).method;
    return typeof method !== "string" || method.trim().length === 0;
  });
  if (requests.length === 0 || hasInvalidRequest) {
    return {
      ok: false,
      response: jsonResponse(req, { error: "Invalid JSON-RPC payload" }, 400),
    };
  }

  return {
    ok: true,
    bodyText,
    requests: requests.map((entry) => ({
      ...entry,
      method: entry.method.trim(),
    })),
  };
}

async function handleEvmRpcProxy(req: Request, url: URL): Promise<Response> {
  const chainRaw = url.searchParams.get("chain")?.trim().toLowerCase();
  if (!chainRaw || !isSupportedEvmRpcChain(chainRaw)) {
    return jsonResponse(req, { error: "Invalid EVM chain" }, 400);
  }
  const chain = chainRaw;

  const target = EVM_RPC_PROXY_TARGETS[chain];
  if (!target) {
    return jsonResponse(
      req,
      { error: `${chain.toUpperCase()} RPC is not configured` },
      503,
    );
  }

  const rpcBody = await readJsonRpcBody(req, EVM_RPC_PROXY_MAX_BODY_BYTES);
  if (!rpcBody.ok) {
    return rpcBody.response;
  }

  try {
    const ttlMs = resolveJsonRpcCacheTtlMs(
      rpcBody.requests,
      EVM_RPC_CACHE_TTL_MS,
    );
    const cacheKey = buildProxyCacheKey(
      `evm-rpc:${chain}`,
      `${target}\n${rpcBody.bodyText}`,
    );
    const { entry, cacheStatus } = await fetchProxyResponseWithCache(
      cacheKey,
      ttlMs,
      () =>
        fetchUpstreamText(target, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: rpcBody.bodyText,
          cache: "no-store",
        }),
    );
    return proxyTextResponse(req, entry, cacheStatus);
  } catch (error) {
    return jsonResponse(
      req,
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to proxy EVM RPC request",
      },
      502,
    );
  }
}

async function handleBirdeyePrice(req: Request, url: URL): Promise<Response> {
  const address = url.searchParams.get("address")?.trim();
  if (!address) {
    return jsonResponse(req, { error: "Missing address query param" }, 400);
  }
  if (!BIRDEYE_API_KEY) {
    return jsonResponse(
      req,
      { error: "Birdeye API key is not configured" },
      503,
    );
  }

  try {
    const target = `${BIRDEYE_API_BASE}/defi/price?address=${encodeURIComponent(address)}`;
    const cacheKey = buildProxyCacheKey("birdeye-price", address);
    const { entry, cacheStatus } = await fetchProxyResponseWithCache(
      cacheKey,
      BIRDEYE_PRICE_CACHE_TTL_MS,
      () =>
        fetchUpstreamText(target, {
          headers: {
            "x-api-key": BIRDEYE_API_KEY,
          },
          cache: "no-store",
        }),
    );
    return proxyTextResponse(req, entry, cacheStatus);
  } catch (error) {
    return jsonResponse(
      req,
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to proxy Birdeye request",
      },
      502,
    );
  }
}

async function handleItemManifest(
  req: Request,
  fileName: string,
): Promise<Response> {
  const allowed = new Set([
    "weapons.json",
    "ammunition.json",
    "resources.json",
    "tools.json",
    "misc.json",
    "armor.json",
    "runes.json",
    "food.json",
  ]);

  if (!allowed.has(fileName)) {
    return jsonResponse(req, { error: "Unknown manifest file" }, 404);
  }

  const cached = manifestCache.get(fileName);
  if (cached) {
    return jsonResponse(req, cached, 200, {
      "cache-control": "public, max-age=60, stale-while-revalidate=60",
    });
  }

  try {
    const upstream = await fetch(`${ITEM_MANIFEST_BASE_URL}/${fileName}`, {
      cache: "no-store",
    });
    if (upstream.ok) {
      const payload = await upstream.json();
      manifestCache.set(fileName, payload);
      return jsonResponse(req, payload, 200, {
        "cache-control": "public, max-age=60, stale-while-revalidate=60",
      });
    }
  } catch {
    // Fall back below.
  }

  const fallback: any[] = [];
  manifestCache.set(fileName, fallback);
  return jsonResponse(req, fallback, 200, {
    "cache-control": "public, max-age=60, stale-while-revalidate=60",
  });
}

async function handleStreamPublish(req: Request): Promise<Response> {
  if (!requireWriteAuth(req, STREAM_PUBLISH_KEY)) {
    return jsonResponse(req, { error: "Unauthorized stream publish key" }, 401);
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(req, { error: "Invalid JSON body" }, 400);
  }

  const nextState = toStreamState(payload);
  if (!nextState) {
    return jsonResponse(req, { error: "Invalid stream payload" }, 400);
  }

  publishStreamState(nextState, "publish");
  return jsonResponse(req, { ok: true, seq: streamState.seq });
}

const server = Bun.serve({
  port: PORT,
  idleTimeout: 60,
  development: process.env.NODE_ENV !== "production",
  fetch: async (req: Request) => {
    const url = new URL(req.url);
    const isWriteRoute =
      req.method === "POST" || url.pathname === "/api/streaming/state/publish";
    const allowed = checkRateLimit(
      req,
      url.pathname,
      isWriteRoute ? WRITE_RATE_LIMIT_PER_MINUTE : READ_RATE_LIMIT_PER_MINUTE,
      isWriteRoute ? WRITE_RATE_LIMIT_BURST : READ_RATE_LIMIT_BURST,
    );
    if (!allowed) {
      return jsonResponse(req, { error: "Rate limit exceeded" }, 429);
    }

    if (req.method === "OPTIONS") {
      const headers = new Headers({ ...securityHeaders() });
      applyCors(req, headers);
      return new Response(null, { status: 204, headers });
    }

    if (url.pathname === "/status") {
      const botHealthSnapshotRaw = loadKeeperBotHealthSnapshot();
      const predictionMarkets = buildPredictionMarketLifecycleRecords(
        botHealthSnapshotRaw,
      );
      const botHealthSnapshot = botHealthSnapshotRaw
        ? {
          ...botHealthSnapshotRaw,
          running: Boolean(botSubprocess),
        }
        : null;
      const marketStatuses = mergePredictionMarketsWithHealth(
        predictionMarkets,
        botHealthSnapshot,
      );
      return jsonResponse(req, {
        ok: true,
        service: "hyperbet-bsc-backend",
        now: Date.now(),
        stream: {
          seq: streamState.seq,
          cycleId: streamState.cycle?.cycleId ?? null,
          phase: streamState.cycle?.phase ?? null,
          lastUpdatedAt: streamLastUpdatedAt,
          sourceUrl: STREAM_STATE_SOURCE_URL
            ? sanitizeUrlForStatus(STREAM_STATE_SOURCE_URL)
            : null,
          lastSourcePollAt: streamLastSourcePollAt,
          lastSourceError: streamLastSourceError,
          sseClients: connectedSseCount(),
        },
        parsers,
        proxies: {
          solanaRpc: Boolean(SOLANA_RPC_PROXY_URL),
          bscRpc: Boolean(EVM_RPC_PROXY_TARGETS.bsc),
          baseRpc: Boolean(EVM_RPC_PROXY_TARGETS.base),
        },
        bot: {
          enabled: ENABLE_KEEPER_BOT,
          running: Boolean(botSubprocess),
          lastExitCode: botExitCode,
          lastExitAt: botLastExitAt,
          health: botHealthSnapshot,
        },
        stats: {
          trackedBets: bets.length,
          linkedIdentities: identityMembers.size,
          knownWallets: walletDisplay.size,
        },
        predictionMarkets: {
          activeDuelKey: currentDuelKey(),
          marketCount: predictionMarkets.length,
          botHealthUpdatedAt: botHealthSnapshot?.updatedAtMs ?? null,
          chains: marketStatuses.map((market) => ({
            chainKey: market.chainKey,
            marketRef: market.marketRef,
            lifecycleStatus: market.lifecycleStatus,
            winner: market.winner,
            betCloseTime: market.betCloseTime,
            syncedAt: market.syncedAt,
            txRef: market.txRef,
            metadata: market.metadata ?? null,
            health: market.health,
          })),
        },
      });
    }

    if (url.pathname === "/") {
      return textResponse(
        req,
        "hyperbet-bsc backend online\n\nUse /status for health.",
      );
    }

    if (req.method === "GET" && url.pathname === "/api/streaming/state") {
      return jsonResponse(req, streamState, 200, {
        "cache-control": "no-store",
      });
    }

    if (
      req.method === "GET" &&
      url.pathname === "/api/streaming/duel-context"
    ) {
      return handleDuelContext(req);
    }

    if (
      req.method === "GET" &&
      url.pathname === "/api/arena/prediction-markets/active"
    ) {
      return handlePredictionMarkets(req);
    }

    if (req.method === "GET" && url.pathname === "/api/keeper/bot-health") {
      const botHealthSnapshotRaw = loadKeeperBotHealthSnapshot();
      return jsonResponse(req, {
        ok: true,
        running: Boolean(botSubprocess),
        health: botHealthSnapshotRaw
          ? {
            ...botHealthSnapshotRaw,
            running: Boolean(botSubprocess),
          }
          : null,
      });
    }

    if (
      req.method === "GET" &&
      url.pathname === "/api/streaming/leaderboard/details"
    ) {
      return handleStreamingLeaderboardDetails(req, url);
    }

    if (
      req.method === "GET" &&
      url.pathname === "/api/streaming/state/events"
    ) {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          sseClients.add(controller);
          sendSse(controller, "reset", streamState.seq, streamState);
          controller.enqueue(encoder.encode(": connected\n\n"));
        },
        cancel(reason) {
          void reason;
          // The controller that was cancelled is already detached from writes;
          // stale controllers are pruned on keepalive/broadcast write failure.
        },
      });

      const headers = new Headers({
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control":
          "no-store, no-cache, must-revalidate, proxy-revalidate",
        connection: "keep-alive",
        ...securityHeaders(),
      });
      applyCors(req, headers);
      return new Response(stream, { status: 200, headers });
    }

    if (
      req.method === "POST" &&
      url.pathname === "/api/streaming/state/publish"
    ) {
      return handleStreamPublish(req);
    }

    if (
      req.method === "POST" &&
      url.pathname === "/api/arena/bet/record-external"
    ) {
      return handleBetRecord(req);
    }

    if (
      req.method === "GET" &&
      url.pathname === "/api/arena/points/leaderboard"
    ) {
      const limit = Math.max(
        1,
        Math.min(200, Number(url.searchParams.get("limit") || 20)),
      );
      const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
      const payload = leaderboardResponse(
        limit,
        offset,
        url.searchParams.get("scope"),
        readPointsWindow(url.searchParams.get("window")),
      );
      return jsonResponse(req, {
        ...payload,
        limit,
        offset,
      });
    }

    if (req.method === "GET" && url.pathname === "/api/perps/oracle-history") {
      return handlePerpsOracleHistory(req, url);
    }

    if (req.method === "GET" && url.pathname === "/api/perps/markets") {
      return handlePerpsMarkets(req);
    }

    if (
      req.method === "GET" &&
      url.pathname.startsWith("/api/arena/points/rank/")
    ) {
      const wallet = normalizePointsWalletInput(
        decodeURIComponent(url.pathname.replace("/api/arena/points/rank/", "")),
      );
      if (!wallet) {
        return jsonResponse(req, { error: "Wallet is required" }, 400);
      }
      return jsonResponse(req, rankResponse(wallet), 200, {
        "cache-control": "no-store",
      });
    }

    if (
      req.method === "GET" &&
      url.pathname.startsWith("/api/arena/points/history/")
    ) {
      const wallet = normalizePointsWalletInput(
        decodeURIComponent(
          url.pathname.replace("/api/arena/points/history/", ""),
        ),
      );
      if (!wallet) {
        return jsonResponse(req, { error: "Wallet is required" }, 400);
      }
      const limit = parseBoundedInteger(
        url.searchParams.get("limit"),
        15,
        1,
        100,
      );
      const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
      return jsonResponse(
        req,
        historyResponse(
          wallet,
          limit,
          offset,
          url.searchParams.get("eventType"),
        ),
        200,
        {
          "cache-control": "no-store",
        },
      );
    }

    if (
      req.method === "GET" &&
      url.pathname.startsWith("/api/arena/points/multiplier/")
    ) {
      const wallet = normalizePointsWalletInput(
        decodeURIComponent(
          url.pathname.replace("/api/arena/points/multiplier/", ""),
        ),
      );
      if (!wallet) {
        return jsonResponse(req, { error: "Wallet is required" }, 400);
      }
      return jsonResponse(req, multiplierResponse(wallet), 200, {
        "cache-control": "no-store",
      });
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/arena/points/")) {
      const wallet = normalizePointsWalletInput(
        decodeURIComponent(url.pathname.replace("/api/arena/points/", "")),
      );
      if (!wallet) {
        return jsonResponse(req, { error: "Wallet is required" }, 400);
      }
      return jsonResponse(
        req,
        pointsForWalletResponse(wallet, url.searchParams.get("scope")),
      );
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/arena/invite/")) {
      const wallet = decodeURIComponent(
        url.pathname.replace("/api/arena/invite/", ""),
      );
      if (!wallet) {
        return jsonResponse(req, { error: "Wallet is required" }, 400);
      }
      return jsonResponse(
        req,
        inviteSummary(wallet, url.searchParams.get("platform") || "unknown"),
      );
    }

    if (req.method === "POST" && url.pathname === "/api/arena/invite/redeem") {
      return handleInviteRedeem(req);
    }

    if (req.method === "POST" && url.pathname === "/api/arena/wallet-link") {
      return handleWalletLink(req);
    }

    if (req.method === "POST" && url.pathname === "/api/proxy/solana/rpc") {
      return handleSolanaRpcProxy(req);
    }

    if (req.method === "POST" && url.pathname === "/api/proxy/evm/rpc") {
      return handleEvmRpcProxy(req, url);
    }

    if (req.method === "GET" && url.pathname === "/api/proxy/birdeye/price") {
      return handleBirdeyePrice(req, url);
    }

    if (
      req.method === "GET" &&
      url.pathname.startsWith("/game-assets/manifests/items/")
    ) {
      const fileName = decodeURIComponent(
        url.pathname.replace("/game-assets/manifests/items/", ""),
      );
      return handleItemManifest(req, fileName);
    }

    return jsonResponse(req, { error: "Not Found" }, 404);
  },
});

console.log(`[${nowIso()}] [backend] listening on http://0.0.0.0:${PORT}`);

setInterval(() => {
  for (const controller of sseClients) {
    try {
      controller.enqueue(encoder.encode(": keepalive\n\n"));
    } catch {
      sseClients.delete(controller);
    }
  }
}, 20_000);

if (STREAM_STATE_SOURCE_URL) {
  console.log(
    `[${nowIso()}] [stream] polling source ${STREAM_STATE_SOURCE_URL}`,
  );
  setInterval(() => {
    void pollStreamStateSource();
  }, STREAM_STATE_POLL_MS);
  void pollStreamStateSource();
}

setInterval(() => {
  void pollContractParsers();
}, CONTRACT_POLL_MS);
void pollContractParsers();

startKeeperBotIfEnabled();

process.on("SIGINT", () => {
  server.stop(true);
  botSubprocess?.kill();
  process.exit(0);
});

process.on("SIGTERM", () => {
  server.stop(true);
  botSubprocess?.kill();
  process.exit(0);
});

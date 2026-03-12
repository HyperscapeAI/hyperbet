import { Buffer } from "buffer";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import fs_node from "node:fs";
import path from "node:path";
import { type Program } from "@coral-xyz/anchor";
import {
  type PredictionMarketLifecycleStatus,
  resolveLifecycleFromStreamPhase,
  toRecordedBetChain,
  type PredictionMarketLifecycleRecord,
  type PredictionMarketWinner,
  type RecordedBetChain,
} from "@hyperbet/chain-registry";
import {
  mergePredictionMarketsWithHealth,
  type KeeperBotHealthSnapshot,
} from "@hyperbet/mm-core";
import {
  type Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";

import {
  createPrograms,
  duelKeyHexToBytes,
  FIGHT_ORACLE_PROGRAM_ID,
  findDuelStatePda,
  findMarketPda,
  getSenderUrl,
  GOLD_CLOB_MARKET_PROGRAM_ID,
  GOLD_PERPS_MARKET_PROGRAM_ID,
  readKeypair,
} from "./common";
import type { FightOracle } from "./idl/fight_oracle";
import type { GoldClobMarket } from "./idl/gold_clob_market";
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
import { buildKeeperBotChildEnv } from "./keeperBot";
import { modelMarketIdFromCharacterId } from "./modelMarkets";
import {
  isLegacyDerivedPointsWalletKey,
  normalizePointsWalletInput,
} from "./walletKeys";

type StreamState = {
  type: "STREAMING_STATE_UPDATE";
  cycle: Record<string, unknown>;
  leaderboard: unknown[];
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
  snapshot: Record<string, unknown> | null;
};

type RateBucket = {
  tokens: number;
  lastRefillMs: number;
};

const encoder = new TextEncoder();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const keeperRoot = path.resolve(__dirname, "..");
const KEEPER_BOT_HEALTH_FILE = (
  process.env.KEEPER_BOT_HEALTH_FILE ||
  path.resolve(keeperRoot, ".status", "keeper-bot-health.json")
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
const SOLANA_SENDER_PROXY_URL = getSenderUrl();
const SOLANA_RPC_PROXY_MAX_BODY_BYTES = Math.max(
  1024,
  Number(process.env.SOLANA_RPC_PROXY_MAX_BODY_BYTES || 1_000_000),
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
let streamState: StreamState = {
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
let streamLastUpdatedAt = Date.now();
let streamLastSourcePollAt: number | null = null;
let streamLastSourceError: string | null = null;
let streamSourcePollInFlight = false;
let streamSourceConsecutiveFailures = 0;
let streamSourceBackoffUntil = 0;

const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();
const manifestCache = new Map<string, unknown>();
const rateBuckets = new Map<string, RateBucket>();

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
} = {
  solana: {
    enabled: false,
    lastSuccessAt: null,
    lastError: null,
    snapshot: null,
  },
};

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

  const isAllowedOrigin =
    CORS_ORIGINS.length === 0 ||
    CORS_ORIGINS.includes(origin) ||
    origin === "https://hyperbet.win" ||
    origin.endsWith(".hyperbet.win") ||
    origin === "https://hyperscape.bet" ||
    origin.endsWith(".hyperscape.bet") ||
    origin === "https://hyperscape.gg" ||
    origin.endsWith(".hyperscape.gg") ||
    origin === "https://hyperbet.pages.dev" ||
    origin.endsWith(".hyperbet.pages.dev") ||
    origin === "https://hyperscape.club" ||
    origin.endsWith(".hyperscape.club") ||
    origin === "https://hyperscape.pages.dev" ||
    origin.endsWith(".hyperscape.pages.dev") ||
    origin.includes("localhost") ||
    origin.includes("127.0.0.1");

  if (isAllowedOrigin) {
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
    return new URL(value).origin;
  } catch {
    return value;
  }
}

function isAllowedAppOrigin(origin: string | null): boolean {
  const normalized = normalizeOriginLike(origin);
  if (!normalized) return false;
  return (
    CORS_ORIGINS.includes(normalized) ||
    normalized === "https://hyperbet.win" ||
    normalized.endsWith(".hyperbet.win") ||
    normalized === "https://hyperscape.bet" ||
    normalized.endsWith(".hyperscape.bet") ||
    normalized === "https://hyperscape.gg" ||
    normalized.endsWith(".hyperscape.gg") ||
    normalized === "https://hyperbet.pages.dev" ||
    normalized.endsWith(".hyperbet.pages.dev") ||
    normalized === "https://hyperscape.club" ||
    normalized.endsWith(".hyperscape.club") ||
    normalized === "https://hyperscape.pages.dev" ||
    normalized.endsWith(".hyperscape.pages.dev") ||
    normalized.includes("localhost") ||
    normalized.includes("127.0.0.1")
  );
}

function decodeSenderTransaction(transaction: string): Transaction | VersionedTransaction {
  const raw = Buffer.from(transaction, "base64");
  try {
    return VersionedTransaction.deserialize(raw);
  } catch {
    return Transaction.from(raw);
  }
}

function extractSenderProgramIds(
  transaction: Transaction | VersionedTransaction,
): string[] {
  if (transaction instanceof VersionedTransaction) {
    const accountKeys = transaction.message.staticAccountKeys;
    return transaction.message.compiledInstructions.map(
      (instruction: { programIdIndex: number }) =>
        accountKeys[instruction.programIdIndex]?.toBase58() ?? "",
    );
  }
  return transaction.instructions.map(
    (instruction: { programId: PublicKey }) =>
      instruction.programId.toBase58(),
  );
}

function isWhitelistedSenderTransaction(
  transaction: Transaction | VersionedTransaction,
): boolean {
  const allowedPrograms = new Set([
    FIGHT_ORACLE_PROGRAM_ID.toBase58(),
    GOLD_CLOB_MARKET_PROGRAM_ID.toBase58(),
    GOLD_PERPS_MARKET_PROGRAM_ID.toBase58(),
    SystemProgram.programId.toBase58(),
  ]);
  const programIds = extractSenderProgramIds(transaction);
  const touchesHyperbetProgram = programIds.some(
    (programId) =>
      programId === FIGHT_ORACLE_PROGRAM_ID.toBase58() ||
      programId === GOLD_CLOB_MARKET_PROGRAM_ID.toBase58() ||
      programId === GOLD_PERPS_MARKET_PROGRAM_ID.toBase58(),
  );
  return touchesHyperbetProgram && programIds.every((programId) => allowedPrograms.has(programId));
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

function buildPredictionMarketLifecycleRecords(): PredictionMarketLifecycleRecord[] {
  const snapshot = parsers.solana.snapshot as Record<string, unknown> | null;
  const duelKey = currentDuelKey();
  const duelId = currentDuelId();
  const cycleLifecycle = resolveLifecycleFromStreamPhase(
    typeof streamState.cycle?.phase === "string" ? streamState.cycle.phase : null,
  );
  const cycleWinner = currentWinnerFromCycle();
  const derivedCurrentMarketPda =
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

  if (!parsers.solana.enabled && !snapshot && !derivedCurrentMarketPda) {
    return [];
  }

  return [
    {
      chainKey: "solana",
      duelKey,
      duelId,
      marketId:
        derivedCurrentMarketPda ??
        (typeof snapshot?.derivedMarketPda === "string"
          ? snapshot.derivedMarketPda
          : typeof snapshot?.latestMarketAccount === "string"
            ? snapshot.latestMarketAccount
            : null),
      marketRef:
        derivedCurrentMarketPda ??
        (typeof snapshot?.derivedMarketPda === "string"
          ? snapshot.derivedMarketPda
          : typeof snapshot?.latestMarketAccount === "string"
            ? snapshot.latestMarketAccount
            : null),
      lifecycleStatus: solanaLifecycle,
      winner: solanaWinner,
      betCloseTime: currentBetCloseTime(),
      contractAddress: null,
      programId:
        typeof snapshot?.marketProgram === "string" ? snapshot.marketProgram : null,
      txRef:
        typeof snapshot?.recentSignature === "string"
          ? snapshot.recentSignature
          : null,
      syncedAt: parsers.solana.lastSuccessAt,
      metadata: {
        fightAccountCount:
          typeof snapshot?.fightAccountCount === "number"
            ? snapshot.fightAccountCount
            : null,
        marketAccountCount:
          typeof snapshot?.marketAccountCount === "number"
            ? snapshot.marketAccountCount
            : null,
      },
    },
  ];
}

function handlePredictionMarkets(req: Request): Response {
  return jsonResponse(
    req,
    {
      duel: {
        duelKey: currentDuelKey(),
        duelId: currentDuelId(),
        phase:
          typeof streamState.cycle?.phase === "string"
            ? streamState.cycle.phase
            : null,
        winner: currentWinnerFromCycle(),
        betCloseTime: currentBetCloseTime(),
      },
      markets: buildPredictionMarketLifecycleRecords(),
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

async function verifyRecordedBet(
  bettorWallet: string,
  txSignature: string,
): Promise<boolean> {
  if (!solanaCtx) return true;
  try {
    const transaction = await solanaCtx.connection.getParsedTransaction(
      txSignature,
      {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      },
    );
    if (!transaction || transaction.meta?.err) {
      return false;
    }
    const walletLower = bettorWallet.trim().toLowerCase();
    return transaction.transaction.message.accountKeys.some(
      (key) => key.signer && key.pubkey.toBase58().toLowerCase() === walletLower,
    );
  } catch {
    return false;
  }
}

async function authorizeExternalBetRecord(
  req: Request,
  bettorWallet: string,
  txSignature: string,
): Promise<boolean> {
  if (requireWriteAuth(req)) return true;

  const trustedOrigin =
    isAllowedAppOrigin(req.headers.get("origin")) ||
    isAllowedAppOrigin(req.headers.get("referer"));
  if (!trustedOrigin || !txSignature.trim()) {
    return false;
  }

  return verifyRecordedBet(bettorWallet, txSignature);
}

function toStreamState(payload: unknown): StreamState | null {
  if (!payload || typeof payload !== "object") return null;

  const candidate = payload as Record<string, unknown>;
  const cycle = candidate.cycle;
  if (!cycle || typeof cycle !== "object") return null;

  return {
    type: "STREAMING_STATE_UPDATE",
    cycle: cycle as Record<string, unknown>,
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

  const childEnv = buildKeeperBotChildEnv(
    {
      ...process.env,
      KEEPER_BOT_HEALTH_FILE,
    },
    PORT,
  );

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
  connection: Connection;
  fightProgram: Program<FightOracle>;
  marketProgram: Program<GoldClobMarket>;
  marketProgramId: PublicKey;
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
      (
        recentSignatures as Array<{ signature?: string } | null>
      ).find((entry) => entry?.signature)?.signature ??
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

let contractPollInFlight = false;
async function pollContractParsers(): Promise<void> {
  if (contractPollInFlight) return;
  contractPollInFlight = true;
  try {
    await pollSolanaSnapshot();
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
): Record<string, unknown> {
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

function rankResponse(wallet: string): Record<string, unknown> {
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
): Record<string, unknown> {
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

function multiplierResponse(wallet: string): Record<string, unknown> {
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
  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse(req, { error: "Invalid JSON body" }, 400);
  }

  const walletRaw = String(payload.bettorWallet || "").trim();
  if (!walletRaw) {
    return jsonResponse(req, { error: "Missing bettorWallet" }, 400);
  }

  const txSignature = String(payload.txSignature || "").trim();
  if (!(await authorizeExternalBetRecord(req, walletRaw, txSignature))) {
    return jsonResponse(req, { error: "Unauthorized write key" }, 401);
  }

  const sourceAmount = parseNumberInput(payload.sourceAmount, 0);
  const goldAmount = parseNumberInput(payload.goldAmount, sourceAmount);
  const feeBps = Math.max(0, parseNumberInput(payload.feeBps, 0));
  const recordedAt = Date.now();

  const normalizedWallet = rememberWalletCase(walletRaw);
  ensureIdentity(normalizedWallet);
  const points = ensureWalletPoints(normalizedWallet);
  const pointsAwarded = Math.max(
    1,
    Math.round(Math.max(goldAmount, sourceAmount) * 10),
  );
  const record: BetRecord = {
    id: `${recordedAt}-${Math.random().toString(36).slice(2, 10)}`,
    bettorWallet: displayWallet(normalizedWallet),
    chain: toRecordedBetChain("solana"),
    sourceAsset: String(payload.sourceAsset || "GOLD"),
    sourceAmount,
    goldAmount,
    feeBps,
    txSignature,
    marketPda: payload.marketPda
      ? String(payload.marketPda)
      : payload.marketRef
        ? String(payload.marketRef)
        : null,
    duelKey: payload.duelKey ? String(payload.duelKey).trim() : null,
    duelId: payload.duelId ? String(payload.duelId).trim() : null,
    inviteCode: null,
    externalBetRef: payload.externalBetRef
      ? String(payload.externalBetRef)
      : txSignature
        ? `solana:${txSignature}`
      : null,
    recordedAt,
  };
  points.selfPoints += pointsAwarded;
  saveWalletPoints(normalizedWallet, points);

  const inviteCodeRaw = String(payload.inviteCode || "")
    .trim()
    .toUpperCase();
  record.inviteCode = inviteCodeRaw || null;
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

    const betFeeGold = (Math.max(goldAmount, 0) * Math.max(feeBps, 0)) / 10_000;
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
  saveBet(record);

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

  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
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

  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
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
): Record<string, unknown> {
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
    const upstream = await fetch(SOLANA_RPC_PROXY_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: rpcBody.bodyText,
      cache: "no-store",
    });
    const payload = await upstream.text();
    const headers = new Headers({
      "content-type":
        upstream.headers.get("content-type") ||
        "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...securityHeaders(),
    });
    applyCors(req, headers);
    return new Response(payload, { status: upstream.status, headers });
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

async function handleSolanaSenderProxy(req: Request): Promise<Response> {
  if (!SOLANA_SENDER_PROXY_URL) {
    return jsonResponse(
      req,
      { error: "Helius Sender is not configured" },
      503,
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse(req, { error: "Invalid JSON body" }, 400);
  }

  const transaction = typeof payload.transaction === "string"
    ? payload.transaction.trim()
    : "";
  if (!transaction) {
    return jsonResponse(req, { error: "transaction is required" }, 400);
  }

  const authorizedByKey = requireWriteAuth(req);
  const trustedOrigin =
    isAllowedAppOrigin(req.headers.get("origin")) ||
    isAllowedAppOrigin(req.headers.get("referer"));

  let decodedTransaction: Transaction | VersionedTransaction;
  try {
    decodedTransaction = decodeSenderTransaction(transaction);
  } catch {
    return jsonResponse(req, { error: "invalid transaction encoding" }, 400);
  }

  if (!isWhitelistedSenderTransaction(decodedTransaction)) {
    return jsonResponse(
      req,
      { error: "sender proxy only accepts Hyperbet Solana transactions" },
      403,
    );
  }

  if (!authorizedByKey && !trustedOrigin) {
    return jsonResponse(
      req,
      { error: "sender proxy requires a trusted Hyperbet origin" },
      403,
    );
  }

  try {
    const upstream = await fetch(SOLANA_SENDER_PROXY_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `sender-${Date.now()}`,
        method: "sendTransaction",
        params: [
          transaction,
          {
            encoding: "base64",
            skipPreflight: true,
            maxRetries: 0,
          },
        ],
      }),
      cache: "no-store",
    });
    const raw = (await upstream.json()) as Record<string, unknown>;
    const error = raw.error;
    if (!upstream.ok || error) {
      const message =
        typeof error === "object" &&
          error !== null &&
          typeof (error as Record<string, unknown>).message === "string"
          ? ((error as Record<string, unknown>).message as string)
          : `Sender proxy HTTP ${upstream.status}`;
      return jsonResponse(req, { error: message }, upstream.status || 502);
    }

    const signature =
      typeof raw.result === "string" ? raw.result : null;
    if (!signature) {
      return jsonResponse(req, { error: "Sender returned no signature" }, 502);
    }

    return jsonResponse(req, { signature }, 200);
  } catch (error) {
    return jsonResponse(
      req,
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to proxy Solana Sender request",
      },
      502,
    );
  }
}

type JsonRpcBodyResult =
  | { ok: true; bodyText: string }
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

  const requests = Array.isArray(parsedBody) ? parsedBody : [parsedBody];
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

  return { ok: true, bodyText };
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
    const upstream = await fetch(
      `${BIRDEYE_API_BASE}/defi/price?address=${encodeURIComponent(address)}`,
      {
        headers: {
          "x-api-key": BIRDEYE_API_KEY,
        },
      },
    );
    const payload = await upstream.json();
    return jsonResponse(req, payload, upstream.status);
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

  const fallback: unknown[] = [];
  manifestCache.set(fileName, fallback);
  return jsonResponse(req, fallback, 200, {
    "cache-control": "public, max-age=60, stale-while-revalidate=60",
  });
}

async function handleStreamPublish(req: Request): Promise<Response> {
  if (!requireWriteAuth(req, STREAM_PUBLISH_KEY)) {
    return jsonResponse(req, { error: "Unauthorized stream publish key" }, 401);
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
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
      const predictionMarkets = buildPredictionMarketLifecycleRecords();
      const botHealthSnapshotRaw = loadKeeperBotHealthSnapshot();
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
        service: "hyperbet-solana-backend",
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
          solanaSender: Boolean(SOLANA_SENDER_PROXY_URL),
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
        "hyperbet-solana backend online\n\nUse /status for health.",
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

    if (req.method === "POST" && url.pathname === "/api/proxy/solana/sender") {
      return handleSolanaSenderProxy(req);
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

import { Buffer } from "buffer";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import fs_node from "node:fs";
import path from "node:path";
import { type Program } from "@coral-xyz/anchor";
import {
  normalizePredictionMarketLifecycleMetadata,
  type PredictionMarketLifecycleStatus,
  resolveLifecycleFromSolanaDuelStatus,
  resolveLifecycleFromSolanaMarketStatus,
  resolveLifecycleFromStreamPhase,
  toRecordedBetChain,
  type PredictionMarketLifecycleRecord,
  type PredictionMarketWinner,
  type RecordedBetChain,
} from "./solanaLifecycle";
import {
  mergePredictionMarketsWithHealth,
  type KeeperBotHealthSnapshot,
  type KeeperMarketHealthRecord,
} from "./launchHealth";
import {
  findUnsupportedJsonRpcMethod,
  isWriteRateLimitedRoute,
  PUBLIC_SOLANA_RPC_READ_METHODS,
} from "./solanaRpcProxyPolicy";
import {
  type Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  createReadOnlyLaunchPrograms,
  duelKeyHexToBytes,
  DUEL_WINNER_MARKET_KIND,
  FIGHT_ORACLE_PROGRAM_ID,
  findClobVaultPda,
  findDuelStatePda,
  findMarketConfigPda,
  findOracleConfigPda,
  findMarketPda,
  findOrderPda,
  findPriceLevelPda,
  findUserBalancePda,
  getSenderUrl,
  DUEL_MARKET_PROGRAM_ID,
} from "./launchCommon";
import type { FightOracle } from "./idl/fight_oracle";
import type { DuelMarket } from "./idl/duel_market";
import {
  checkDatabaseHealth,
  commitSolanaIndexedTransaction,
  loadAll,
  loadSolanaIndexedOrderPlacement,
  loadSolanaIndexedTransactionEvidence,
  loadSolanaIndexerCheckpoint,
  loadSolanaWalletBetHistory,
  reconcileSolanaBetLifecycleAccounting,
  saveBet,
  savePointsEvent,
  saveWalletDisplay,
  saveWalletPoints,
  saveInviteCode,
  saveReferral,
  saveInvitedWallet,
} from "./db";
import {
  evaluateKeeperReadiness,
  isAuthoritativeStreamSnapshot,
  parseKeeperBotHealthSnapshot,
} from "./readiness";
import {
  canAcceptStreamStatePublish,
  resolveStreamStateSourceConfig,
} from "./feedConfig";
import {
  normalizeLamports,
  pointsForLamports,
  referralPointsForBetPoints,
} from "./nativeAmount";
import {
  isLegacyDerivedPointsWalletKey,
  normalizePointsWalletInput,
} from "./walletKeys";
import { normalizeSolanaWalletKey } from "./solanaWallet";
import {
  classifySignatureFinality,
  decodePlaceOrderInstructionData,
  isCanonicalSolanaTransactionSignature,
  quoteCostLamports,
  requiresFinalizedBetVerification,
  verifyIndexedPlaceOrderAccounting,
  verifyPlaceOrderAccounting,
  type MatchedOrderEvidence,
  type NativeTransferEvidence,
  type PlacedOrderEvidence,
  type SelfTradeEvidence,
  type TradeFeeEscrowEvidence,
  type VerifiedPlaceOrderAccounting,
} from "./solanaBetAccounting";
import {
  fetchUpgradeableProgramIdentity,
  resolveExpectedUpgradeAuthority,
  type ExpectedUpgradeAuthority,
} from "./solanaProgramIdentity";
import {
  collectFinalizedSignatureBackfill,
  normalizeLifecycleFact,
  resolveLifecycleIndexStartSlot,
  unitsReleasedByVaultRefund,
  verifyClaimLifecycleAccounting,
  verifyLosingBalanceCleanupAccounting,
  type SignaturePageEntry,
  type SolanaLifecycleFact,
} from "./solanaLifecycleIndexer";
import {
  extractStreamStateSourceEvents,
  resolveStreamStateEventsUrl,
} from "./streamStateSourceSse";

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
  sourceAsset: "SOL";
  sourceAmountLamports: string;
  feeAmountLamports: string;
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

type PointsWindow = "alltime" | "daily" | "weekly" | "monthly";

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

type JsonRpcRequestPayload = Record<string, unknown> & {
  method: string;
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
const SERVICE_SOLANA_CLUSTER = (
  process.env.SOLANA_CLUSTER ||
  process.env.CLUSTER ||
  "mainnet-beta"
)
  .trim()
  .toLowerCase();
const SERVICE_IS_MAINNET =
  SERVICE_SOLANA_CLUSTER === "mainnet" ||
  SERVICE_SOLANA_CLUSTER === "mainnet-beta";
const REQUIRE_ONCHAIN_BET_VERIFICATION = requiresFinalizedBetVerification({
  nodeEnv: process.env.NODE_ENV,
  cluster: SERVICE_SOLANA_CLUSTER,
});
const SOLANA_LIFECYCLE_INDEX_PAGE_SIZE = Math.min(
  1_000,
  readPositiveEnvInteger("SOLANA_LIFECYCLE_INDEX_PAGE_SIZE", 250, 1),
);
const SOLANA_LIFECYCLE_INDEX_MAX_PAGES = readPositiveEnvInteger(
  "SOLANA_LIFECYCLE_INDEX_MAX_PAGES",
  25,
  1,
);
const SOLANA_LIFECYCLE_INDEX_BATCH_SIZE = readPositiveEnvInteger(
  "SOLANA_LIFECYCLE_INDEX_BATCH_SIZE",
  250,
  1,
);

function loadKeeperBotHealthSnapshot(): KeeperBotHealthSnapshot | null {
  if (!KEEPER_BOT_HEALTH_FILE || !fs_node.existsSync(KEEPER_BOT_HEALTH_FILE)) {
    return null;
  }
  try {
    const snapshot = parseKeeperBotHealthSnapshot(
      JSON.parse(fs_node.readFileSync(KEEPER_BOT_HEALTH_FILE, "utf8")),
    );
    if (!snapshot) {
      console.warn("[service] Ignoring invalid keeper bot health snapshot");
    }
    return snapshot;
  } catch (error) {
    console.warn("[service] Failed to read keeper bot health snapshot:", error);
    return null;
  }
}

function loadStreamStateSnapshot(): StreamState | null {
  if (
    !KEEPER_STREAM_STATE_FILE ||
    !fs_node.existsSync(KEEPER_STREAM_STATE_FILE)
  ) {
    return null;
  }
  try {
    return toStreamState(
      JSON.parse(fs_node.readFileSync(KEEPER_STREAM_STATE_FILE, "utf8")),
    );
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
const ITEM_MANIFEST_BASE_URL =
  process.env.ITEM_MANIFEST_BASE_URL?.trim() ||
  "https://assets.hyperia.club/manifests/items";
const STREAM_STATE_SOURCE = resolveStreamStateSourceConfig({
  production: IS_PRODUCTION,
  sourceUrl: process.env.STREAM_STATE_SOURCE_URL,
  bearerToken: process.env.STREAM_STATE_SOURCE_BEARER_TOKEN,
});
const STREAM_STATE_SOURCE_URL = STREAM_STATE_SOURCE.sourceUrl;
const STREAM_STATE_SOURCE_BEARER_TOKEN = STREAM_STATE_SOURCE.bearerToken;
const STREAM_STATE_PUBLISH_ENABLED = canAcceptStreamStatePublish({
  production: IS_PRODUCTION,
  sourceConfigured: Boolean(STREAM_STATE_SOURCE_URL),
});
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
const STREAM_STATE_SOURCE_EVENTS_ENABLED = readEnvBoolean(
  "STREAM_STATE_SOURCE_EVENTS_ENABLED",
  true,
);
const STREAM_STATE_SOURCE_EVENTS_RECONNECT_MS = readPositiveEnvInteger(
  "STREAM_STATE_SOURCE_EVENTS_RECONNECT_MS",
  1_000,
  250,
);
const STREAM_STATE_HEARTBEAT_MS = readPositiveEnvInteger(
  "STREAM_STATE_HEARTBEAT_MS",
  0,
  1_000,
);
const CONTRACT_POLL_MS = Math.max(
  5_000,
  Number(process.env.CONTRACT_POLL_MS || 15_000),
);
const READINESS_STREAM_MAX_AGE_MS = readPositiveEnvInteger(
  "READINESS_STREAM_MAX_AGE_MS",
  15_000,
  1_000,
);
const READINESS_BOT_MAX_AGE_MS = readPositiveEnvInteger(
  "READINESS_BOT_MAX_AGE_MS",
  30_000,
  5_000,
);
const READINESS_PARSER_MAX_AGE_MS = readPositiveEnvInteger(
  "READINESS_PARSER_MAX_AGE_MS",
  30_000,
  5_000,
);
const CORS_ORIGINS = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
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

const initialStreamState = loadStreamStateSnapshot() ?? {
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
  seq: 1,
  emittedAt: Date.now(),
};
let streamSeq =
  typeof initialStreamState.seq === "number" &&
  Number.isFinite(initialStreamState.seq) &&
  initialStreamState.seq > 0
    ? initialStreamState.seq
    : 1;
let streamState: StreamState = {
  ...initialStreamState,
  type: "STREAMING_STATE_UPDATE",
  seq: streamSeq,
  emittedAt:
    typeof initialStreamState.emittedAt === "number" &&
    Number.isFinite(initialStreamState.emittedAt)
      ? initialStreamState.emittedAt
      : Date.now(),
};
let streamLastUpdatedAt =
  typeof streamState.emittedAt === "number" &&
  Number.isFinite(streamState.emittedAt)
    ? streamState.emittedAt
    : Date.now();
let streamLastSourcePollAt: number | null = null;
let streamLastSourceError: string | null = null;
let streamSourcePollInFlight = false;
let streamSourceConsecutiveFailures = 0;
let streamSourceBackoffUntil = 0;
let streamSourceEventsConnected = false;
let streamSourceEventsLastEventAt: number | null = null;
let streamSourceEventsLastEventId: number | null = null;
let streamSourceEventsLastError: string | null = null;
let streamSourceEventsReconnectAttempt = 0;

const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();
const manifestCache = new Map<string, unknown>();
const rateBuckets = new Map<string, RateBucket>();

// ── Persistent state (hydrated from SQLite on startup, written through on change)
const _db = loadAll(BET_STORE_LIMIT);

const bets: BetRecord[] = _db.bets;
const walletDisplay: Map<string, string> = _db.walletDisplay;
const pointsByWallet: Map<string, WalletPoints> = _db.pointsByWallet;
const pointsEvents: PointsEventRecord[] = _db.pointsEvents;
const inviteCodeByWallet: Map<string, string> = _db.inviteCodeByWallet;
const walletByInviteCode: Map<string, string> = _db.walletByInviteCode;
const referredByWallet: Map<string, { wallet: string; code: string }> =
  _db.referredByWallet;
const invitedWalletsByWallet: Map<
  string,
  Set<string>
> = _db.invitedWalletsByWallet;

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
  return normalizeSolanaWalletKey(wallet);
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
    };
    pointsByWallet.set(normalized, initial);
    saveWalletPoints(normalized, initial);
  }
  return pointsByWallet.get(normalized)!;
}

function totalPoints(points: WalletPoints): number {
  return points.selfPoints + points.winPoints + points.referralPoints;
}

function aggregatePoints(wallets: string[]): WalletPoints {
  return wallets.reduce<WalletPoints>(
    (acc, wallet) => {
      const points = ensureWalletPoints(wallet);
      acc.selfPoints += points.selfPoints;
      acc.winPoints += points.winPoints;
      acc.referralPoints += points.referralPoints;
      return acc;
    },
    { selfPoints: 0, winPoints: 0, referralPoints: 0 },
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

function leaderboardRows(
  window: PointsWindow,
): Array<{ wallet: string; totalPoints: number }> {
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
  headers.set("access-control-expose-headers", "retry-after");
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
  const matchesAppDomain = (domain: string) =>
    lowerHostname === domain || lowerHostname.endsWith(`.${domain}`);
  const isLoopbackHost =
    lowerHostname === "localhost" ||
    lowerHostname === "127.0.0.1" ||
    lowerHostname === "::1" ||
    lowerHostname === "[::1]";
  return (
    CORS_ORIGINS.includes(normalized) ||
    matchesAppDomain("hyperbet.win") ||
    matchesAppDomain("hyperia.gg") ||
    matchesAppDomain("hyperia.club") ||
    matchesAppDomain("hyperbet.pages.dev") ||
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
  marketRef: string;
  sourceAsset: "SOL";
  sourceAmountLamports: string;
  feeAmountLamports: string;
  feeBps: number;
  accounting: VerifiedPlaceOrderAccounting;
};

type ExternalBetVerificationFailureCode =
  | "context-unavailable"
  | "request-identity-invalid"
  | "expected-identity-invalid"
  | "expected-identity-missing"
  | "transaction-not-found"
  | "transaction-meta-missing"
  | "transaction-failed"
  | "indexed-evidence-invalid"
  | "indexed-transaction-shape"
  | "indexed-order-identity"
  | "indexed-market-identity"
  | "indexed-accounting-invalid"
  | "wallet-signature-mismatch"
  | "market-instruction-count"
  | "place-order-data-invalid"
  | "instruction-account-graph"
  | "market-account-identity"
  | "market-pda-identity"
  | "market-fee-snapshot"
  | "event-market-invalid"
  | "order-placed-event-invalid"
  | "order-matched-event-invalid"
  | "self-trade-event-invalid"
  | "fee-event-invalid"
  | "inner-instructions-missing"
  | "transfer-event-invalid"
  | "transaction-query-failed"
  | "market-account-query-failed"
  | "event-decode-failed"
  | "accounting-failed";

type ExternalBetVerificationResult =
  | { status: "verified"; record: VerifiedExternalBetRecord }
  | { status: "rejected"; code: ExternalBetVerificationFailureCode };

type ExternalBetAuthorization =
  | { status: "verified"; record: VerifiedExternalBetRecord }
  | {
      status: "pending-finality";
      verificationCode: ExternalBetVerificationFailureCode;
    }
  | { status: "rpc-unavailable" }
  | {
      status: "rejected";
      verificationCode?: ExternalBetVerificationFailureCode;
    };

type ExternalBetIndexDiagnostics = {
  checkpointSlot: number | null;
  checkpointSignature: string | null;
  transactionSlot: number | null;
  transactionIndexedAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  lookupError: boolean;
};

function normalizeDuelKeyHex(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  const normalized = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : null;
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
    typeof (value as { pubkey?: { toBase58?: () => string } }).pubkey
      ?.toBase58 === "function"
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

function toNumberLike(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Number(value);
  if (
    typeof value === "object" &&
    value !== null &&
    "toNumber" in value &&
    typeof (value as { toNumber?: () => number }).toNumber === "function"
  ) {
    return (value as { toNumber: () => number }).toNumber();
  }
  return 0;
}

function toBigIntLike(value: unknown): bigint | null {
  try {
    if (typeof value === "bigint") return value;
    if (typeof value === "number" && Number.isSafeInteger(value)) {
      return BigInt(value);
    }
    if (typeof value === "string" && /^\d+$/.test(value)) {
      return BigInt(value);
    }
    if (value && typeof value === "object" && "toString" in value) {
      const rendered = (value as { toString(): string }).toString();
      return /^\d+$/.test(rendered) ? BigInt(rendered) : null;
    }
  } catch {
    return null;
  }
  return null;
}

function bytes32Hex(value: unknown): string | null {
  const bytes =
    value instanceof Uint8Array
      ? Array.from(value)
      : Array.isArray(value)
        ? value.map(Number)
        : null;
  if (
    !bytes ||
    bytes.length !== 32 ||
    bytes.some((entry) => !Number.isInteger(entry) || entry < 0 || entry > 255)
  ) {
    return null;
  }
  return Buffer.from(bytes).toString("hex");
}

function decodeSenderTransaction(
  transaction: string,
): Transaction | VersionedTransaction {
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
  return transaction.instructions.map((instruction: { programId: PublicKey }) =>
    instruction.programId.toBase58(),
  );
}

function isWhitelistedSenderTransaction(
  transaction: Transaction | VersionedTransaction,
): boolean {
  const allowedPrograms = new Set([
    FIGHT_ORACLE_PROGRAM_ID.toBase58(),
    DUEL_MARKET_PROGRAM_ID.toBase58(),
    SystemProgram.programId.toBase58(),
  ]);
  const programIds = extractSenderProgramIds(transaction);
  const touchesHyperbetProgram = programIds.some(
    (programId) =>
      programId === FIGHT_ORACLE_PROGRAM_ID.toBase58() ||
      programId === DUEL_MARKET_PROGRAM_ID.toBase58(),
  );
  return (
    touchesHyperbetProgram &&
    programIds.every((programId) => allowedPrograms.has(programId))
  );
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
  const cycleAgent1 = streamState.cycle?.agent1 as
    | { id?: unknown }
    | null
    | undefined;
  const cycleAgent2 = streamState.cycle?.agent2 as
    | { id?: unknown }
    | null
    | undefined;
  const winnerId =
    typeof streamState.cycle?.winnerId === "string"
      ? streamState.cycle.winnerId
      : null;
  const agent1Id = typeof cycleAgent1?.id === "string" ? cycleAgent1.id : null;
  const agent2Id = typeof cycleAgent2?.id === "string" ? cycleAgent2.id : null;

  if (winnerId && agent1Id && winnerId === agent1Id) return "A";
  if (winnerId && agent2Id && winnerId === agent2Id) return "B";
  return "NONE";
}

function enumName(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const [key] = Object.keys(value as Record<string, unknown>);
  return typeof key === "string" && key.length > 0 ? key : null;
}

const ZERO_HEX_32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

function toNullableTimestamp(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (
    value &&
    typeof (value as { toString(): string }).toString === "function"
  ) {
    const parsed = Number((value as { toString(): string }).toString());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeHexProposalId(value: unknown): string | null {
  if (typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value.trim())) {
    const normalized = value.trim().toLowerCase();
    return normalized === ZERO_HEX_32 ? null : normalized;
  }
  if (
    value instanceof Uint8Array ||
    Buffer.isBuffer(value) ||
    Array.isArray(value)
  ) {
    const normalized = `0x${Buffer.from(value).toString("hex")}`;
    return normalized === ZERO_HEX_32 ? null : normalized;
  }
  return null;
}

function resolveLifecycleFromSolanaSnapshot(
  duelStatus: string | null,
  marketStatus: string | null,
  fallback: PredictionMarketLifecycleStatus,
): PredictionMarketLifecycleStatus {
  const duelLifecycle = resolveLifecycleFromSolanaDuelStatus(duelStatus);
  if (duelLifecycle !== "UNKNOWN") return duelLifecycle;
  const marketLifecycle = resolveLifecycleFromSolanaMarketStatus(marketStatus);
  return marketLifecycle !== "UNKNOWN" ? marketLifecycle : fallback;
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
    case "PROPOSED":
    case "CHALLENGED":
    case "RESOLVED":
    case "CANCELLED":
      return "RESOLUTION";
    default:
      return null;
  }
}

function buildPredictionMarketLifecycleRecords(): PredictionMarketLifecycleRecord[] {
  const snapshot = parsers.solana.snapshot as Record<string, unknown> | null;
  const duelKey = currentDuelKey();
  const duelId = currentDuelId();
  const cycleLifecycle = resolveLifecycleFromStreamPhase(
    typeof streamState.cycle?.phase === "string"
      ? streamState.cycle.phase
      : null,
  );
  const cycleWinner = currentWinnerFromCycle();
  const derivedCurrentMarketPda =
    duelKey != null
      ? findMarketPda(
          DUEL_MARKET_PROGRAM_ID,
          findDuelStatePda(FIGHT_ORACLE_PROGRAM_ID, duelKeyHexToBytes(duelKey)),
        ).toBase58()
      : null;
  const solanaLifecycle = resolveLifecycleFromSolanaSnapshot(
    typeof snapshot?.currentDuelStatus === "string"
      ? snapshot.currentDuelStatus
      : null,
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
        typeof snapshot?.marketProgram === "string"
          ? snapshot.marketProgram
          : null,
      txRef:
        typeof snapshot?.recentSignature === "string"
          ? snapshot.recentSignature
          : null,
      syncedAt: parsers.solana.lastSuccessAt,
      metadata: normalizePredictionMarketLifecycleMetadata({
        proposalId: normalizeHexProposalId(snapshot?.currentProposalId),
        challengeWindowEndsAt: (() => {
          const proposedAt = toNullableTimestamp(
            snapshot?.currentProposalProposedAt,
          );
          const disputeWindowSeconds = toNullableTimestamp(
            snapshot?.currentDisputeWindowSeconds,
          );
          return proposedAt != null && disputeWindowSeconds != null
            ? proposedAt + disputeWindowSeconds
            : null;
        })(),
        finalizedAt: null,
        cancellationReason: null,
        fightAccountCount:
          typeof snapshot?.fightAccountCount === "number"
            ? snapshot.fightAccountCount
            : null,
        marketAccountCount:
          typeof snapshot?.marketAccountCount === "number"
            ? snapshot.marketAccountCount
            : null,
        duelStatus: snapshot?.currentDuelStatus ?? null,
        proposalChallenged:
          typeof snapshot?.currentProposalChallenged === "boolean"
            ? snapshot.currentProposalChallenged
            : null,
      }),
    },
  ];
}

function toFallbackKeeperMarketHealthRecord(
  record: PredictionMarketLifecycleRecord,
): KeeperMarketHealthRecord {
  return {
    chainKey: record.chainKey,
    duelId: record.duelId ?? null,
    duelKey: record.duelKey ?? null,
    marketRef: record.marketRef ?? null,
    lifecycleStatus: record.lifecycleStatus,
    winner: record.winner,
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
    lastStreamAtMs: record.syncedAt ?? null,
    lastOracleAtMs: record.syncedAt ?? null,
    lastRpcAtMs: record.syncedAt ?? null,
    circuitBreakerReason: null,
    lastResolvedAtMs:
      typeof record.metadata?.finalizedAt === "number"
        ? record.metadata.finalizedAt
        : null,
    lastClaimAtMs: null,
    recovery: [],
  };
}

function resolveKeeperBotHealthSnapshot(
  botHealthSnapshot: KeeperBotHealthSnapshot | null,
): KeeperBotHealthSnapshot | null {
  if (botHealthSnapshot == null || botHealthSnapshot.markets.length > 0) {
    return botHealthSnapshot;
  }
  const fallbackMarkets = buildPredictionMarketLifecycleRecords().map(
    toFallbackKeeperMarketHealthRecord,
  );
  if (fallbackMarkets.length === 0) {
    return botHealthSnapshot;
  }
  return {
    ...botHealthSnapshot,
    markets: fallbackMarkets,
  };
}

function resolveServiceReadiness(
  botHealthSnapshot: KeeperBotHealthSnapshot | null,
) {
  const cycleId = streamState.cycle?.cycleId;
  return evaluateKeeperReadiness({
    nowMs: Date.now(),
    requireStreamSource: IS_PRODUCTION,
    streamMaxAgeMs: READINESS_STREAM_MAX_AGE_MS,
    botMaxAgeMs: READINESS_BOT_MAX_AGE_MS,
    parserMaxAgeMs: READINESS_PARSER_MAX_AGE_MS,
    stream: {
      sourceConfigured: Boolean(STREAM_STATE_SOURCE_URL),
      authoritative: isAuthoritativeStreamSnapshot(
        cycleId ?? null,
        streamState.cycle?.phase ?? null,
      ),
      lastUpdatedAt: streamLastUpdatedAt,
      lastSourceError: streamLastSourceError,
    },
    bot: botHealthSnapshot,
    parser: parsers.solana,
    database: checkDatabaseHealth(),
  });
}

function handlePredictionMarkets(req: Request): Response {
  const markets = buildPredictionMarketLifecycleRecords();
  const fallbackMarket =
    markets.find((market) => market.duelKey != null || market.duelId != null) ??
    null;
  return jsonResponse(
    req,
    {
      duel: {
        duelKey: currentDuelKey() ?? fallbackMarket?.duelKey ?? null,
        duelId: currentDuelId() ?? fallbackMarket?.duelId ?? null,
        phase:
          typeof streamState.cycle?.phase === "string"
            ? streamState.cycle.phase
            : resolvePhaseFromLifecycleStatus(fallbackMarket?.lifecycleStatus),
        winner:
          currentWinnerFromCycle() !== "NONE"
            ? currentWinnerFromCycle()
            : (fallbackMarket?.winner ?? "NONE"),
        betCloseTime:
          currentBetCloseTime() ?? fallbackMarket?.betCloseTime ?? null,
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
  if (pathname.startsWith("/api/arena/settlements/")) {
    return "/api/arena/settlements/:wallet";
  }
  if (pathname.startsWith("/api/arena/points/history/")) {
    return "/api/arena/points/history/:wallet";
  }
  if (pathname.startsWith("/api/arena/points/rank/")) {
    return "/api/arena/points/rank/:wallet";
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

async function fetchFinalizedParsedTransaction(
  signature: string,
): Promise<ParsedFinalizedTransaction | null> {
  if (!solanaCtx) return null;
  const transaction = await solanaCtx.connection.getParsedTransaction(
    signature,
    {
      commitment: "finalized",
      maxSupportedTransactionVersion: 0,
    },
  );
  if (transaction) return transaction;

  // A provider can briefly route SDK and raw JSON-RPC requests to nodes with
  // different transaction-history visibility. Retry once through an
  // independent request path, then apply the same complete verifier below.
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), 5_000);
  try {
    const response = await fetch(solanaCtx.connection.rpcEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "external-bet-verification",
        method: "getTransaction",
        params: [
          signature,
          {
            encoding: "jsonParsed",
            commitment: "finalized",
            maxSupportedTransactionVersion: 0,
          },
        ],
      }),
      signal: abortController.signal,
    });
    if (!response.ok) {
      throw new Error("finalized transaction fallback returned HTTP failure");
    }
    const payload = (await response.json()) as {
      error?: unknown;
      result?: unknown;
    };
    if (payload.error !== undefined) {
      throw new Error("finalized transaction fallback returned RPC failure");
    }
    if (payload.result === null || payload.result === undefined) return null;
    if (typeof payload.result !== "object") {
      throw new Error("finalized transaction fallback returned invalid data");
    }
    return payload.result as ParsedFinalizedTransaction;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function verifyIndexedRecordedBet(
  normalizedWallet: string,
  txSignature: string,
  normalizedMarketRef: string | null,
  normalizedDuelKey: string | null,
): Promise<ExternalBetVerificationResult> {
  const rejectVerification = (
    code: ExternalBetVerificationFailureCode,
  ): ExternalBetVerificationResult => ({ status: "rejected", code });
  if (!solanaCtx) return rejectVerification("context-unavailable");

  let evidence: ReturnType<typeof loadSolanaIndexedTransactionEvidence>;
  try {
    evidence = loadSolanaIndexedTransactionEvidence({
      cluster: SERVICE_SOLANA_CLUSTER,
      programId: solanaCtx.marketProgramId.toBase58(),
      signature: txSignature,
    });
  } catch {
    return rejectVerification("indexed-evidence-invalid");
  }
  if (!evidence) return rejectVerification("transaction-not-found");
  if (
    !evidence.succeeded ||
    evidence.instructionNames.length !== 1 ||
    evidence.instructionNames[0] !== "placeOrder"
  ) {
    return rejectVerification("indexed-transaction-shape");
  }

  const placedFacts = evidence.facts.filter(
    (fact) => fact.kind === "ORDER_PLACED",
  );
  const executionFacts = evidence.facts.filter(
    (fact) => fact.kind === "TAKER_EXECUTION",
  );
  const matchedFacts = evidence.facts.filter(
    (fact) => fact.kind === "ORDER_MATCHED",
  );
  const allowedFactKinds = new Set([
    "MARKET_SYNCED",
    "ORDER_PLACED",
    "ORDER_MATCHED",
    "TAKER_EXECUTION",
  ]);
  const placed = placedFacts[0];
  if (
    placedFacts.length !== 1 ||
    !placed ||
    executionFacts.length > 1 ||
    evidence.facts.some((fact) => !allowedFactKinds.has(fact.kind)) ||
    !placed.orderId ||
    placed.wallet !== normalizedWallet ||
    (placed.side !== 1 && placed.side !== 2) ||
    placed.price === undefined ||
    (placed.orderBehavior !== 0 &&
      placed.orderBehavior !== 1 &&
      placed.orderBehavior !== 2) ||
    !placed.amountUnits ||
    (normalizedMarketRef && placed.marketPda !== normalizedMarketRef)
  ) {
    return rejectVerification("indexed-order-identity");
  }

  const execution = executionFacts[0];
  if (
    (execution &&
      (execution.marketPda !== placed.marketPda ||
        execution.orderId !== placed.orderId ||
        execution.wallet !== normalizedWallet ||
        execution.side !== placed.side ||
        execution.price !== placed.price ||
        execution.amountUnits === undefined ||
        execution.releasedAmountUnits === undefined ||
        execution.amountLamports === undefined ||
        execution.refundLamports === undefined ||
        execution.treasuryFeeLamports === undefined ||
        execution.marketMakerFeeLamports === undefined ||
        typeof execution.selfTradeTriggered !== "boolean")) ||
    matchedFacts.some(
      (fact) =>
        fact.marketPda !== placed.marketPda ||
        fact.takerOrderId !== placed.orderId ||
        fact.amountUnits === undefined,
    )
  ) {
    return rejectVerification("indexed-order-identity");
  }
  try {
    const indexedMatchedAmount = matchedFacts.reduce(
      (total, fact) => total + BigInt(fact.amountUnits!),
      0n,
    );
    if (indexedMatchedAmount !== BigInt(execution?.amountUnits ?? "0")) {
      return rejectVerification("indexed-order-identity");
    }
  } catch {
    return rejectVerification("indexed-order-identity");
  }

  let marketAccount: Record<string, unknown>;
  try {
    marketAccount = (await solanaCtx.marketProgram.account.marketState.fetch(
      new PublicKey(placed.marketPda),
    )) as Record<string, unknown>;
  } catch {
    return rejectVerification("indexed-market-identity");
  }
  const canonicalDuelKey = bytes32Hex(marketAccount.duelKey);
  const marketDuelState = normalizeBase58Key(
    toInstructionAccountAddress(marketAccount.duelState),
  );
  if (!canonicalDuelKey || !marketDuelState) {
    return rejectVerification("indexed-market-identity");
  }
  const canonicalDuelState = findDuelStatePda(
    FIGHT_ORACLE_PROGRAM_ID,
    duelKeyHexToBytes(canonicalDuelKey),
  );
  const tradeTreasuryFeeBps = toNumberLike(
    marketAccount.tradeTreasuryFeeBpsSnapshot,
  );
  const tradeMarketMakerFeeBps = toNumberLike(
    marketAccount.tradeMarketMakerFeeBpsSnapshot,
  );
  if (
    canonicalDuelState.toBase58() !== marketDuelState ||
    findMarketPda(
      DUEL_MARKET_PROGRAM_ID,
      canonicalDuelState,
      DUEL_WINNER_MARKET_KIND,
    ).toBase58() !== placed.marketPda ||
    toNumberLike(marketAccount.marketKind) !== DUEL_WINNER_MARKET_KIND ||
    (normalizedDuelKey && normalizedDuelKey !== canonicalDuelKey) ||
    !Number.isInteger(tradeTreasuryFeeBps) ||
    tradeTreasuryFeeBps < 0 ||
    tradeTreasuryFeeBps > 10_000 ||
    !Number.isInteger(tradeMarketMakerFeeBps) ||
    tradeMarketMakerFeeBps < 0 ||
    tradeMarketMakerFeeBps > 10_000
  ) {
    return rejectVerification("indexed-market-identity");
  }

  let accounting: VerifiedPlaceOrderAccounting;
  try {
    accounting = verifyIndexedPlaceOrderAccounting({
      orderId: placed.orderId,
      side: placed.side,
      limitPrice: placed.price,
      orderBehavior: placed.orderBehavior,
      orderAmountUnits: placed.amountUnits,
      matchedAmountUnits: execution?.amountUnits ?? "0",
      releasedAmountUnits: execution?.releasedAmountUnits ?? "0",
      executedCostLamports: execution?.amountLamports ?? "0",
      refundLamports: execution?.refundLamports ?? "0",
      tradeTreasuryFeeLamports: execution?.treasuryFeeLamports ?? "0",
      tradeMarketMakerFeeLamports: execution?.marketMakerFeeLamports ?? "0",
      selfTradeTriggered: execution?.selfTradeTriggered ?? false,
      tradeTreasuryFeeBps,
      tradeMarketMakerFeeBps,
    });
  } catch {
    return rejectVerification("indexed-accounting-invalid");
  }
  return {
    status: "verified",
    record: {
      chain: toRecordedBetChain("solana"),
      txSignature,
      bettorWallet: normalizedWallet,
      duelKey: canonicalDuelKey,
      marketRef: placed.marketPda,
      sourceAsset: "SOL",
      sourceAmountLamports: accounting.sourceAmountLamports,
      feeAmountLamports: accounting.feeAmountLamports,
      feeBps: tradeTreasuryFeeBps + tradeMarketMakerFeeBps,
      accounting,
    },
  };
}

async function verifyRecordedBet(
  bettorWallet: string,
  txSignature: string,
  expected: ExternalBetVerificationInput,
): Promise<ExternalBetVerificationResult> {
  const rejectVerification = (
    code: ExternalBetVerificationFailureCode,
  ): ExternalBetVerificationResult => ({ status: "rejected", code });
  if (!solanaCtx) return rejectVerification("context-unavailable");
  const normalizedWallet = normalizeBase58Key(bettorWallet);
  const rawMarketRef = expected.marketRef?.trim() || null;
  const rawDuelKey = expected.duelKey?.trim() || null;
  const normalizedMarketRef = rawMarketRef
    ? normalizeBase58Key(rawMarketRef)
    : null;
  const normalizedDuelKey = normalizeDuelKeyHex(rawDuelKey);
  if (!normalizedWallet || !txSignature.trim()) {
    return rejectVerification("request-identity-invalid");
  }
  if (
    (rawMarketRef && !normalizedMarketRef) ||
    (rawDuelKey && !normalizedDuelKey)
  ) {
    return rejectVerification("expected-identity-invalid");
  }
  if (!normalizedMarketRef && !normalizedDuelKey) {
    return rejectVerification("expected-identity-missing");
  }

  let verificationStage: ExternalBetVerificationFailureCode =
    "transaction-query-failed";
  try {
    const transaction = await fetchFinalizedParsedTransaction(txSignature);
    if (!transaction) {
      return await verifyIndexedRecordedBet(
        normalizedWallet,
        txSignature.trim(),
        normalizedMarketRef,
        normalizedDuelKey,
      );
    }
    if (!transaction.meta) {
      return rejectVerification("transaction-meta-missing");
    }
    if (transaction.meta.err) return rejectVerification("transaction-failed");

    const walletSigned = transaction.transaction.message.accountKeys.some(
      (key) =>
        key.signer &&
        normalizeBase58Key(toInstructionAccountAddress(key.pubkey)) ===
          normalizedWallet,
    );
    if (!walletSigned) {
      return rejectVerification("wallet-signature-mismatch");
    }

    const marketInstructionEntries =
      transaction.transaction.message.instructions
        .map((instruction, index) => ({ instruction, index }))
        .filter(
          ({ instruction }) =>
            extractInstructionProgramId(instruction) ===
            DUEL_MARKET_PROGRAM_ID.toBase58(),
        );
    if (marketInstructionEntries.length !== 1) {
      return rejectVerification("market-instruction-count");
    }
    const marketInstructionEntry = marketInstructionEntries[0];
    if (!marketInstructionEntry) {
      return rejectVerification("market-instruction-count");
    }
    const { instruction, index: instructionIndex } = marketInstructionEntry;
    const decodedOrder =
      typeof instruction === "object" &&
      instruction !== null &&
      "data" in instruction
        ? decodePlaceOrderInstructionData(
            (instruction as { data?: unknown }).data,
          )
        : null;
    if (!decodedOrder) return rejectVerification("place-order-data-invalid");

    const accounts = extractInstructionAccounts(instruction);
    if (accounts.length < 11) {
      return rejectVerification("instruction-account-graph");
    }
    const marketState = normalizeBase58Key(accounts[0] ?? null);
    const duelState = normalizeBase58Key(accounts[1] ?? null);
    const userBalance = normalizeBase58Key(accounts[2] ?? null);
    const orderAccount = normalizeBase58Key(accounts[3] ?? null);
    const priceLevel = normalizeBase58Key(accounts[4] ?? null);
    const marketConfig = normalizeBase58Key(accounts[5] ?? null);
    const treasury = normalizeBase58Key(accounts[6] ?? null);
    const marketMaker = normalizeBase58Key(accounts[7] ?? null);
    const vault = normalizeBase58Key(accounts[8] ?? null);
    const user = normalizeBase58Key(accounts[9] ?? null);
    const systemProgram = normalizeBase58Key(accounts[10] ?? null);
    if (
      !marketState ||
      !duelState ||
      !treasury ||
      !marketMaker ||
      !vault ||
      user !== normalizedWallet ||
      systemProgram !== SystemProgram.programId.toBase58() ||
      marketConfig !==
        findMarketConfigPda(solanaCtx.marketProgramId).toBase58() ||
      userBalance !==
        findUserBalancePda(
          solanaCtx.marketProgramId,
          new PublicKey(marketState),
          new PublicKey(normalizedWallet),
        ).toBase58() ||
      orderAccount !==
        findOrderPda(
          solanaCtx.marketProgramId,
          new PublicKey(marketState),
          decodedOrder.orderId,
        ).toBase58() ||
      priceLevel !==
        findPriceLevelPda(
          solanaCtx.marketProgramId,
          new PublicKey(marketState),
          decodedOrder.side,
          decodedOrder.price,
        ).toBase58() ||
      vault !==
        findClobVaultPda(
          solanaCtx.marketProgramId,
          new PublicKey(marketState),
        ).toBase58()
    ) {
      return rejectVerification("instruction-account-graph");
    }

    verificationStage = "market-account-query-failed";
    const marketAccount =
      await solanaCtx.marketProgram.account.marketState.fetch(
        new PublicKey(marketState),
      );
    const canonicalDuelKey = bytes32Hex(marketAccount.duelKey);
    const marketDuelState = normalizeBase58Key(
      toInstructionAccountAddress(marketAccount.duelState),
    );
    if (!canonicalDuelKey || marketDuelState !== duelState) {
      return rejectVerification("market-account-identity");
    }
    const canonicalDuelState = findDuelStatePda(
      FIGHT_ORACLE_PROGRAM_ID,
      duelKeyHexToBytes(canonicalDuelKey),
    );
    if (
      canonicalDuelState.toBase58() !== duelState ||
      findMarketPda(
        DUEL_MARKET_PROGRAM_ID,
        canonicalDuelState,
        DUEL_WINNER_MARKET_KIND,
      ).toBase58() !== marketState ||
      (normalizedMarketRef && normalizedMarketRef !== marketState) ||
      (normalizedDuelKey && normalizedDuelKey !== canonicalDuelKey) ||
      toNumberLike(marketAccount.marketKind) !== DUEL_WINNER_MARKET_KIND
    ) {
      return rejectVerification("market-pda-identity");
    }

    const tradeTreasuryFeeBps = toNumberLike(
      marketAccount.tradeTreasuryFeeBpsSnapshot,
    );
    const tradeMarketMakerFeeBps = toNumberLike(
      marketAccount.tradeMarketMakerFeeBpsSnapshot,
    );
    const snapshottedTreasury = normalizeBase58Key(
      toInstructionAccountAddress(marketAccount.treasury),
    );
    const snapshottedMarketMaker = normalizeBase58Key(
      toInstructionAccountAddress(marketAccount.marketMaker),
    );
    if (
      treasury !== snapshottedTreasury ||
      marketMaker !== snapshottedMarketMaker ||
      !Number.isInteger(tradeTreasuryFeeBps) ||
      tradeTreasuryFeeBps < 0 ||
      tradeTreasuryFeeBps > 10_000 ||
      !Number.isInteger(tradeMarketMakerFeeBps) ||
      tradeMarketMakerFeeBps < 0 ||
      tradeMarketMakerFeeBps > 10_000
    ) {
      return rejectVerification("market-fee-snapshot");
    }

    verificationStage = "event-decode-failed";
    const placedEvents: PlacedOrderEvidence[] = [];
    const matchedEvents: MatchedOrderEvidence[] = [];
    const selfTradeEvents: SelfTradeEvidence[] = [];
    const tradeFeeEscrowEvents: TradeFeeEscrowEvidence[] = [];
    for (const log of transaction.meta.logMessages ?? []) {
      if (!log.startsWith("Program data: ")) continue;
      const decodedEvent = solanaCtx.marketProgram.coder.events.decode(
        log.slice("Program data: ".length),
      );
      if (!decodedEvent) continue;
      const data = decodedEvent.data as Record<string, unknown>;
      const eventMarket = normalizeBase58Key(
        toInstructionAccountAddress(data.marketKey ?? data.marketRef ?? null),
      );
      if (!eventMarket) return rejectVerification("event-market-invalid");
      if (decodedEvent.name === "orderPlaced") {
        const orderId = toBigIntLike(data.orderId);
        const amount = toBigIntLike(data.amount);
        const maker = normalizeBase58Key(
          toInstructionAccountAddress(data.maker),
        );
        if (orderId === null || amount === null || !maker) {
          return rejectVerification("order-placed-event-invalid");
        }
        placedEvents.push({
          marketRef: eventMarket,
          orderId,
          maker,
          side: toNumberLike(data.side),
          price: toNumberLike(data.price),
          amount,
        });
      } else if (decodedEvent.name === "orderMatched") {
        const takerOrderId = toBigIntLike(data.takerOrderId);
        const matchedAmount = toBigIntLike(data.matchedAmount);
        if (takerOrderId === null || matchedAmount === null) {
          return rejectVerification("order-matched-event-invalid");
        }
        matchedEvents.push({
          marketRef: eventMarket,
          takerOrderId,
          matchedAmount,
          price: toNumberLike(data.price),
        });
      } else if (decodedEvent.name === "selfTradePolicyTriggered") {
        const takerOrderId = toBigIntLike(data.takerOrderId);
        if (takerOrderId === null) {
          return rejectVerification("self-trade-event-invalid");
        }
        selfTradeEvents.push({
          marketRef: eventMarket,
          takerOrderId,
        });
      } else if (decodedEvent.name === "tradeFeesEscrowed") {
        const orderId = toBigIntLike(data.orderId);
        const payer = normalizeBase58Key(
          toInstructionAccountAddress(data.payer),
        );
        const executedCostLamports = toBigIntLike(data.executedCostLamports);
        const treasuryFeeLamports = toBigIntLike(data.treasuryFeeLamports);
        const marketMakerFeeLamports = toBigIntLike(
          data.marketMakerFeeLamports,
        );
        if (
          orderId === null ||
          !payer ||
          executedCostLamports === null ||
          treasuryFeeLamports === null ||
          marketMakerFeeLamports === null
        ) {
          return rejectVerification("fee-event-invalid");
        }
        tradeFeeEscrowEvents.push({
          marketRef: eventMarket,
          orderId,
          payer,
          executedCostLamports,
          treasuryFeeLamports,
          marketMakerFeeLamports,
        });
      }
    }

    const innerInstructions = transaction.meta.innerInstructions?.find(
      (entry) => entry.index === instructionIndex,
    );
    if (!innerInstructions) {
      return rejectVerification("inner-instructions-missing");
    }
    const transfers: NativeTransferEvidence[] = [];
    for (const innerInstruction of innerInstructions.instructions) {
      if (
        typeof innerInstruction !== "object" ||
        innerInstruction === null ||
        !("parsed" in innerInstruction)
      ) {
        continue;
      }
      const parsed = (innerInstruction as { parsed?: unknown }).parsed;
      if (!parsed || typeof parsed !== "object") continue;
      const parsedRecord = parsed as {
        type?: unknown;
        info?: Record<string, unknown>;
      };
      if (parsedRecord.type !== "transfer" || !parsedRecord.info) continue;
      const source = normalizeBase58Key(
        typeof parsedRecord.info.source === "string"
          ? parsedRecord.info.source
          : null,
      );
      const destination = normalizeBase58Key(
        typeof parsedRecord.info.destination === "string"
          ? parsedRecord.info.destination
          : null,
      );
      const lamports = toBigIntLike(parsedRecord.info.lamports);
      if (!source || !destination || lamports === null) {
        return rejectVerification("transfer-event-invalid");
      }
      transfers.push({ source, destination, lamports });
    }

    verificationStage = "accounting-failed";
    const accounting = verifyPlaceOrderAccounting({
      order: decodedOrder,
      wallet: normalizedWallet,
      marketRef: marketState,
      vault,
      treasury,
      marketMaker,
      tradeTreasuryFeeBps,
      tradeMarketMakerFeeBps,
      placedEvents,
      matchedEvents,
      selfTradeEvents,
      tradeFeeEscrowEvents,
      transfers,
    });
    return {
      status: "verified",
      record: {
        chain: toRecordedBetChain("solana"),
        txSignature: txSignature.trim(),
        bettorWallet: normalizedWallet,
        duelKey: canonicalDuelKey,
        marketRef: marketState,
        sourceAsset: "SOL",
        sourceAmountLamports: accounting.sourceAmountLamports,
        feeAmountLamports: accounting.feeAmountLamports,
        feeBps: tradeTreasuryFeeBps + tradeMarketMakerFeeBps,
        accounting,
      },
    };
  } catch {
    return rejectVerification(verificationStage);
  }
}

async function authorizeExternalBetRecord(
  req: Request,
  bettorWallet: string,
  txSignature: string,
  expected: ExternalBetVerificationInput,
): Promise<ExternalBetAuthorization> {
  const signature = txSignature.trim();
  if (
    !isAllowedAppOrigin(req.headers.get("origin")) ||
    !isCanonicalSolanaTransactionSignature(signature)
  ) {
    return { status: "rejected" };
  }

  if (!solanaCtx) return { status: "rpc-unavailable" };
  let finality: ReturnType<typeof classifySignatureFinality>;
  try {
    const [signatureStatus] = (
      await solanaCtx.connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      })
    ).value;
    finality = classifySignatureFinality(signatureStatus);
    if (finality === "rejected") return { status: "rejected" };
  } catch {
    return { status: "rpc-unavailable" };
  }

  const verification = await verifyRecordedBet(
    bettorWallet,
    txSignature,
    expected,
  );
  if (verification.status === "verified") return verification;
  return finality === "pending"
    ? {
        status: "pending-finality",
        verificationCode: verification.code,
      }
    : { status: "rejected", verificationCode: verification.code };
}

function externalBetIndexDiagnostics(
  txSignature: string,
): ExternalBetIndexDiagnostics | null {
  if (IS_PRODUCTION || !solanaCtx) return null;
  const identity = {
    cluster: SERVICE_SOLANA_CLUSTER,
    programId: solanaCtx.marketProgramId.toBase58(),
  };
  let checkpointSlot: number | null = null;
  let checkpointSignature: string | null = null;
  let transactionSlot: number | null = null;
  let transactionIndexedAt: number | null = null;
  let lookupError = false;
  try {
    const checkpoint = loadSolanaIndexerCheckpoint(identity);
    checkpointSlot = checkpoint?.slot ?? null;
    checkpointSignature = checkpoint?.signature ?? null;
    const evidence = loadSolanaIndexedTransactionEvidence({
      ...identity,
      signature: txSignature,
    });
    transactionSlot = evidence?.slot ?? null;
    transactionIndexedAt = evidence?.indexedAt ?? null;
  } catch {
    lookupError = true;
  }
  return {
    checkpointSlot,
    checkpointSignature,
    transactionSlot,
    transactionIndexedAt,
    lastSuccessAt: parsers.solana.lastSuccessAt,
    lastError: parsers.solana.lastError,
    lookupError,
  };
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
        ? (candidate.cameraTarget as string | null)
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

function publishStreamState(
  next: StreamState,
  sourceLabel: string,
  logUpdate = true,
): void {
  const receivedAt = Date.now();
  streamSeq = Math.max(streamSeq + 1, next.seq || streamSeq + 1);
  streamState = {
    ...next,
    type: "STREAMING_STATE_UPDATE",
    seq: streamSeq,
    emittedAt:
      Number.isFinite(next.emittedAt) && next.emittedAt > 0
        ? next.emittedAt
        : receivedAt,
  };
  streamLastUpdatedAt = receivedAt;
  streamLastSourceError = null;
  persistStreamStateSnapshot(streamState);
  broadcastStreamState(streamState, "state");
  if (logUpdate) {
    console.log(
      `[${nowIso()}] [stream] updated from ${sourceLabel} cycle=${streamState.cycle?.cycleId ?? "unknown"} phase=${streamState.cycle?.phase ?? "unknown"}`,
    );
  }
}

function relayStreamTimelineState(
  next: StreamState,
  sourceLabel: string,
  logUpdate = true,
): void {
  const receivedAt = Date.now();
  streamSeq = Math.max(streamSeq + 1, next.seq || streamSeq + 1);
  const timelineState: StreamState = {
    ...next,
    type: "STREAMING_STATE_UPDATE",
    seq: streamSeq,
    emittedAt:
      Number.isFinite(next.emittedAt) && next.emittedAt > 0
        ? next.emittedAt
        : receivedAt,
  };
  streamSourceEventsLastEventAt = receivedAt;
  streamSourceEventsLastError = null;
  broadcastStreamState(timelineState, "timeline");
  if (logUpdate) {
    console.log(
      `[${nowIso()}] [stream] relayed timeline from ${sourceLabel} cycle=${timelineState.cycle?.cycleId ?? "unknown"} phase=${timelineState.cycle?.phase ?? "unknown"}`,
    );
  }
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
    } else {
      // Stable phases can last for minutes. Republish a quiet heartbeat so
      // both readiness and browser consumers share the same source liveness.
      publishStreamState(nextState, "poll-heartbeat", false);
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

function streamSourceEventsReconnectDelayMs(): number {
  return Math.min(
    15_000,
    STREAM_STATE_SOURCE_EVENTS_RECONNECT_MS *
      2 ** Math.min(streamSourceEventsReconnectAttempt, 4),
  );
}

function waitForStreamSourceEventsReconnect(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function consumeStreamStateSourceEvents(): Promise<void> {
  if (!STREAM_STATE_SOURCE_URL) return;

  const sourceUrl = resolveStreamStateEventsUrl(
    STREAM_STATE_SOURCE_URL,
    streamSourceEventsLastEventId,
  );
  const headers: Record<string, string> = {
    accept: "text/event-stream",
    "cache-control": "no-cache",
  };
  if (STREAM_STATE_SOURCE_BEARER_TOKEN) {
    headers.authorization = `Bearer ${STREAM_STATE_SOURCE_BEARER_TOKEN}`;
  }

  const response = await fetch(sourceUrl, {
    cache: "no-store",
    headers,
  });
  if (!response.ok) {
    try {
      await response.body?.cancel();
    } catch {
      // Ignore cancellation issues for already-closed streams.
    }
    throw new Error(`HTTP ${response.status}`);
  }
  if (!response.body) {
    throw new Error("stream source event response had no body");
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("text/event-stream")) {
    await response.body.cancel();
    throw new Error("stream source event response was not event-stream data");
  }

  streamSourceEventsConnected = true;
  streamSourceEventsLastError = null;
  streamSourceEventsReconnectAttempt = 0;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) throw new Error("stream source event connection closed");
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 1_048_576) {
        throw new Error("stream source event buffer exceeded 1 MiB");
      }

      const extracted = extractStreamStateSourceEvents(buffer);
      buffer = extracted.remainder;
      for (const event of extracted.events) {
        if (event.event !== "state" && event.event !== "reset") continue;
        if (
          event.event === "state" &&
          event.id !== null &&
          streamSourceEventsLastEventId !== null &&
          event.id <= streamSourceEventsLastEventId
        ) {
          continue;
        }

        let payload: unknown;
        try {
          payload = JSON.parse(event.data);
        } catch {
          throw new Error("stream source event contained invalid JSON");
        }
        const nextState =
          toStreamState(payload) ||
          toStreamState((payload as Record<string, unknown>)?.data);
        if (!nextState) {
          throw new Error("stream source event contained an invalid state");
        }

        const changed =
          streamState.cycle?.cycleId !== nextState.cycle?.cycleId ||
          streamState.cycle?.phase !== nextState.cycle?.phase ||
          streamState.cycle?.winnerId !== nextState.cycle?.winnerId;
        relayStreamTimelineState(nextState, `source-${event.event}`, changed);
        if (event.id !== null) {
          streamSourceEventsLastEventId = event.id;
        }
      }
    }
  } finally {
    streamSourceEventsConnected = false;
    try {
      await reader.cancel();
    } catch {
      // The source may already have closed the reader.
    }
  }
}

async function runStreamStateSourceEvents(): Promise<void> {
  while (STREAM_STATE_SOURCE_URL && STREAM_STATE_SOURCE_EVENTS_ENABLED) {
    try {
      await consumeStreamStateSourceEvents();
    } catch (error) {
      streamSourceEventsConnected = false;
      streamSourceEventsLastError =
        error instanceof Error
          ? error.message
          : "stream source event connection failed";
      const delayMs = streamSourceEventsReconnectDelayMs();
      streamSourceEventsReconnectAttempt += 1;
      if (
        streamSourceEventsReconnectAttempt === 1 ||
        streamSourceEventsReconnectAttempt % 10 === 0
      ) {
        console.warn(
          `[${nowIso()}] [stream] source events disconnected (${streamSourceEventsLastError}); reconnecting in ${delayMs}ms`,
        );
      }
      await waitForStreamSourceEventsReconnect(delayMs);
    }
  }
}

function connectedSseCount(): number {
  return sseClients.size;
}

type ParsedFinalizedTransaction = NonNullable<
  Awaited<ReturnType<Connection["getParsedTransaction"]>>
>;

type IndexedMarketInstruction = {
  index: number;
  name: string;
  data: Record<string, unknown>;
  accounts: string[];
  transfers: NativeTransferEvidence[];
};

type DecodedMarketEvent = {
  name: string;
  data: Record<string, unknown>;
};

function isTransactionSigner(
  transaction: ParsedFinalizedTransaction,
  wallet: string,
): boolean {
  return transaction.transaction.message.accountKeys.some(
    (key) =>
      key.signer &&
      normalizeBase58Key(toInstructionAccountAddress(key.pubkey)) === wallet,
  );
}

function innerNativeTransfers(
  transaction: ParsedFinalizedTransaction,
  instructionIndex: number,
): NativeTransferEvidence[] {
  const entry = transaction.meta?.innerInstructions?.find(
    (candidate) => candidate.index === instructionIndex,
  );
  const transfers: NativeTransferEvidence[] = [];
  for (const instruction of entry?.instructions ?? []) {
    if (
      typeof instruction !== "object" ||
      instruction === null ||
      !("parsed" in instruction)
    ) {
      continue;
    }
    const parsed = (instruction as { parsed?: unknown }).parsed;
    if (!parsed || typeof parsed !== "object") continue;
    const record = parsed as {
      type?: unknown;
      info?: Record<string, unknown>;
    };
    if (record.type !== "transfer" || !record.info) continue;
    const source = normalizeBase58Key(
      typeof record.info.source === "string" ? record.info.source : null,
    );
    const destination = normalizeBase58Key(
      typeof record.info.destination === "string"
        ? record.info.destination
        : null,
    );
    const lamports = toBigIntLike(record.info.lamports);
    if (!source || !destination || lamports === null || lamports <= 0n) {
      throw new Error(
        "indexed transaction contains an invalid native transfer",
      );
    }
    transfers.push({ source, destination, lamports });
  }
  return transfers;
}

function sumNativeTransfers(
  transfers: NativeTransferEvidence[],
  source: string,
  destination: string,
): bigint {
  return transfers.reduce(
    (sum, transfer) =>
      transfer.source === source && transfer.destination === destination
        ? sum + transfer.lamports
        : sum,
    0n,
  );
}

function digestFinalizedTransactionEvidence(
  transaction: ParsedFinalizedTransaction,
): string {
  const serialized = JSON.stringify(transaction, (_key, value) => {
    if (typeof value === "bigint") return value.toString();
    if (value instanceof PublicKey) return value.toBase58();
    if (value instanceof Uint8Array) {
      return Buffer.from(value).toString("base64");
    }
    return value;
  });
  if (!serialized) {
    throw new Error("finalized transaction evidence is not serializable");
  }
  return createHash("sha256").update(serialized).digest("hex");
}

function marketRefFromEvent(event: DecodedMarketEvent): string {
  const marketRef = normalizeBase58Key(
    toInstructionAccountAddress(
      event.data.marketKey ?? event.data.marketRef ?? null,
    ),
  );
  if (!marketRef) {
    throw new Error(`${event.name} event has no canonical market`);
  }
  return marketRef;
}

async function parseFinalizedMarketLifecycleTransaction(
  transaction: ParsedFinalizedTransaction,
): Promise<{ instructionNames: string[]; facts: SolanaLifecycleFact[] }> {
  if (!solanaCtx || !transaction.meta || transaction.meta.err) {
    throw new Error(
      "lifecycle index requires a successful finalized transaction",
    );
  }
  const programId = solanaCtx.marketProgramId.toBase58();
  const instructions: IndexedMarketInstruction[] = [];
  for (const [
    index,
    instruction,
  ] of transaction.transaction.message.instructions.entries()) {
    if (extractInstructionProgramId(instruction) !== programId) continue;
    if (
      typeof instruction !== "object" ||
      instruction === null ||
      !("data" in instruction) ||
      typeof (instruction as { data?: unknown }).data !== "string"
    ) {
      throw new Error("lifecycle index cannot decode a market instruction");
    }
    const decoded = (
      solanaCtx.marketProgram.coder.instruction as unknown as {
        decode(
          data: string,
          encoding: "base58",
        ): { name: string; data: unknown } | null;
      }
    ).decode((instruction as { data: string }).data, "base58");
    if (!decoded) {
      throw new Error(
        "lifecycle index encountered an unknown market instruction",
      );
    }
    instructions.push({
      index,
      name: decoded.name,
      data: decoded.data as Record<string, unknown>,
      accounts: extractInstructionAccounts(instruction),
      transfers: innerNativeTransfers(transaction, index),
    });
  }

  const logMessages = transaction.meta.logMessages ?? [];
  const invokedDirectly = logMessages.some((log) =>
    log.startsWith(`Program ${programId} invoke`),
  );
  if (invokedDirectly && instructions.length === 0) {
    throw new Error(
      "lifecycle index does not permit unparsed CPI-only market transactions",
    );
  }

  const events: DecodedMarketEvent[] = [];
  for (const log of logMessages) {
    if (!log.startsWith("Program data: ")) continue;
    const decoded = solanaCtx.marketProgram.coder.events.decode(
      log.slice("Program data: ".length),
    );
    if (decoded) {
      events.push({
        name: decoded.name,
        data: decoded.data as Record<string, unknown>,
      });
    }
  }

  const marketAccountCache = new Map<string, Record<string, unknown>>();
  const fetchMarket = async (marketPda: string) => {
    const cached = marketAccountCache.get(marketPda);
    if (cached) return cached;
    const account = (await solanaCtx!.marketProgram.account.marketState.fetch(
      new PublicKey(marketPda),
    )) as Record<string, unknown>;
    marketAccountCache.set(marketPda, account);
    return account;
  };
  const validateCanonicalMarket = async (marketPda: string) => {
    const market = await fetchMarket(marketPda);
    const canonicalDuelState = normalizeBase58Key(
      toInstructionAccountAddress(market.duelState),
    );
    const marketKind = toNumberLike(market.marketKind);
    if (
      !canonicalDuelState ||
      findMarketPda(
        solanaCtx!.marketProgramId,
        new PublicKey(canonicalDuelState),
        marketKind,
      ).toBase58() !== marketPda
    ) {
      throw new Error(
        "indexed lifecycle instruction has a noncanonical market",
      );
    }
    return { market, canonicalDuelState };
  };
  const validateMarketAndDuel = async (
    marketPda: string,
    duelState: string,
  ) => {
    const { market, canonicalDuelState } =
      await validateCanonicalMarket(marketPda);
    if (canonicalDuelState !== duelState) {
      throw new Error(
        "indexed lifecycle instruction has a noncanonical market",
      );
    }
    return market;
  };

  const facts: SolanaLifecycleFact[] = [];
  const marketInstructionRefs = new Set<string>();
  for (const instruction of instructions) {
    const marketIndex = instruction.name === "initializeMarket" ? 3 : 0;
    if (
      [
        "initializeMarket",
        "syncMarketFromDuel",
        "placeOrder",
        "continueOrder",
        "cancelOrder",
        "reclaimRestingOrder",
        "closeFilledOrder",
        "closeEmptyPriceLevel",
        "claim",
        "closeLosingBalance",
        "withdrawResolvedTradeFees",
      ].includes(instruction.name)
    ) {
      const marketRef = normalizeBase58Key(
        instruction.accounts[marketIndex] ?? null,
      );
      if (!marketRef) {
        throw new Error(`${instruction.name} has no canonical market account`);
      }
      marketInstructionRefs.add(marketRef);
    }
  }

  for (const event of events) {
    const marketPda = marketRefFromEvent(event);
    if (!marketInstructionRefs.has(marketPda)) {
      throw new Error(`${event.name} is not bound to a decoded instruction`);
    }
    if (event.name === "orderPlaced") {
      const orderId = toBigIntLike(event.data.orderId);
      const amount = toBigIntLike(event.data.amount);
      const maker = normalizeBase58Key(
        toInstructionAccountAddress(event.data.maker),
      );
      const side = toNumberLike(event.data.side);
      const price = toNumberLike(event.data.price);
      const matching = instructions.filter(
        (instruction) =>
          instruction.name === "placeOrder" &&
          instruction.accounts[0] === marketPda &&
          toBigIntLike(instruction.data.orderId) === orderId &&
          toNumberLike(instruction.data.side) === side &&
          toNumberLike(instruction.data.price) === price &&
          toBigIntLike(instruction.data.amount) === amount &&
          instruction.accounts[9] === maker,
      );
      const orderBehavior = toNumberLike(matching[0]?.data.orderBehavior);
      if (
        orderId === null ||
        amount === null ||
        !maker ||
        matching.length !== 1 ||
        (orderBehavior !== 0 && orderBehavior !== 1 && orderBehavior !== 2) ||
        !isTransactionSigner(transaction, maker)
      ) {
        throw new Error(
          "orderPlaced event does not match one signed instruction",
        );
      }
      const instruction = matching[0]!;
      const duelState = normalizeBase58Key(instruction.accounts[1] ?? null);
      if (
        !duelState ||
        instruction.accounts[2] !==
          findUserBalancePda(
            solanaCtx.marketProgramId,
            new PublicKey(marketPda),
            new PublicKey(maker),
          ).toBase58() ||
        instruction.accounts[3] !==
          findOrderPda(
            solanaCtx.marketProgramId,
            new PublicKey(marketPda),
            orderId,
          ).toBase58() ||
        instruction.accounts[4] !==
          findPriceLevelPda(
            solanaCtx.marketProgramId,
            new PublicKey(marketPda),
            side,
            price,
          ).toBase58() ||
        instruction.accounts[5] !==
          findMarketConfigPda(solanaCtx.marketProgramId).toBase58() ||
        instruction.accounts[8] !==
          findClobVaultPda(
            solanaCtx.marketProgramId,
            new PublicKey(marketPda),
          ).toBase58() ||
        instruction.accounts[10] !== SystemProgram.programId.toBase58()
      ) {
        throw new Error(
          "orderPlaced instruction account graph is noncanonical",
        );
      }
      await validateMarketAndDuel(marketPda, duelState);
      facts.push(
        normalizeLifecycleFact({
          kind: "ORDER_PLACED",
          marketPda,
          orderId: orderId.toString(),
          wallet: maker,
          side: side as 1 | 2,
          price,
          orderBehavior: orderBehavior as 0 | 1 | 2,
          amountUnits: amount.toString(),
        }),
      );
    } else if (event.name === "orderMatched") {
      const makerOrderId = toBigIntLike(event.data.makerOrderId);
      const takerOrderId = toBigIntLike(event.data.takerOrderId);
      const amount = toBigIntLike(event.data.matchedAmount);
      const price = toNumberLike(event.data.price);
      const matchingInstruction = instructions.find(
        (instruction) =>
          (instruction.name === "placeOrder" ||
            instruction.name === "continueOrder") &&
          instruction.accounts[0] === marketPda &&
          toBigIntLike(instruction.data.orderId) === takerOrderId,
      );
      if (
        makerOrderId === null ||
        takerOrderId === null ||
        amount === null ||
        !matchingInstruction
      ) {
        throw new Error(
          "orderMatched event has no canonical taker instruction",
        );
      }
      facts.push(
        normalizeLifecycleFact({
          kind: "ORDER_MATCHED",
          marketPda,
          makerOrderId: makerOrderId.toString(),
          takerOrderId: takerOrderId.toString(),
          price,
          amountUnits: amount.toString(),
        }),
      );
    } else if (event.name === "filledOrderClosed") {
      const orderId = toBigIntLike(event.data.orderId);
      const maker = normalizeBase58Key(
        toInstructionAccountAddress(event.data.maker),
      );
      const matching = instructions.filter(
        (instruction) =>
          instruction.name === "closeFilledOrder" &&
          instruction.accounts[0] === marketPda &&
          toBigIntLike(instruction.data.orderId) === orderId &&
          instruction.accounts[2] === maker,
      );
      const instruction = matching[0];
      if (
        orderId === null ||
        !maker ||
        !instruction ||
        matching.length !== 1 ||
        instruction.accounts.length !== 3 ||
        instruction.accounts[1] !==
          findOrderPda(
            solanaCtx.marketProgramId,
            new PublicKey(marketPda),
            orderId,
          ).toBase58() ||
        !isTransactionSigner(transaction, maker) ||
        instruction.transfers.length !== 0
      ) {
        throw new Error(
          "filledOrderClosed account/event graph is noncanonical",
        );
      }
      await validateCanonicalMarket(marketPda);
      facts.push(
        normalizeLifecycleFact({
          kind: "FILLED_ORDER_CLOSED",
          marketPda,
          orderId: orderId.toString(),
          wallet: maker,
        }),
      );
    } else if (event.name === "priceLevelClosed") {
      const side = toNumberLike(event.data.side);
      const price = toNumberLike(event.data.price);
      const rentRecipient = normalizeBase58Key(
        toInstructionAccountAddress(event.data.rentRecipient),
      );
      const closer = normalizeBase58Key(
        toInstructionAccountAddress(event.data.closer),
      );
      const matching = instructions.filter(
        (instruction) =>
          instruction.name === "closeEmptyPriceLevel" &&
          instruction.accounts[0] === marketPda &&
          toNumberLike(instruction.data.side) === side &&
          toNumberLike(instruction.data.price) === price &&
          instruction.accounts[2] === rentRecipient &&
          instruction.accounts[3] === closer,
      );
      const instruction = matching[0];
      if (
        (side !== 1 && side !== 2) ||
        price === null ||
        price <= 0 ||
        price >= 1_000 ||
        !rentRecipient ||
        !closer ||
        !instruction ||
        matching.length !== 1 ||
        instruction.accounts.length !== 4 ||
        instruction.accounts[1] !==
          findPriceLevelPda(
            solanaCtx.marketProgramId,
            new PublicKey(marketPda),
            side,
            price,
          ).toBase58() ||
        !isTransactionSigner(transaction, closer) ||
        instruction.transfers.length !== 0
      ) {
        throw new Error("priceLevelClosed account/event graph is noncanonical");
      }
      await validateCanonicalMarket(marketPda);
      facts.push(
        normalizeLifecycleFact({
          kind: "PRICE_LEVEL_CLOSED",
          marketPda,
          wallet: rentRecipient,
          side,
          price,
        }),
      );
    } else if (event.name === "marketSynced") {
      const status = enumName(event.data.status)?.toLowerCase();
      const winner = enumName(event.data.winner)?.toLowerCase();
      facts.push(
        normalizeLifecycleFact({
          kind: "MARKET_SYNCED",
          marketPda,
          status: status as SolanaLifecycleFact["status"],
          winner: winner as SolanaLifecycleFact["winner"],
        }),
      );
    } else if (
      ![
        "marketCreated",
        "orderCancelled",
        "restingOrderReclaimed",
        "losingBalanceClosed",
        "selfTradePolicyTriggered",
        "tradeFeesEscrowed",
        "claimSettled",
        "resolvedTradeFeesWithdrawn",
      ].includes(event.name)
    ) {
      throw new Error(`unsupported market lifecycle event ${event.name}`);
    }
  }

  for (const instruction of instructions) {
    if (
      instruction.name !== "placeOrder" &&
      instruction.name !== "continueOrder"
    ) {
      continue;
    }
    const marketPda = normalizeBase58Key(instruction.accounts[0] ?? null);
    const duelState = normalizeBase58Key(instruction.accounts[1] ?? null);
    const orderId = toBigIntLike(instruction.data.orderId);
    const wallet = normalizeBase58Key(instruction.accounts[9] ?? null);
    if (!marketPda || !duelState || orderId === null || !wallet) {
      throw new Error(`${instruction.name} execution graph is incomplete`);
    }
    const currentPlacement = facts.find(
      (fact) =>
        fact.kind === "ORDER_PLACED" &&
        fact.marketPda === marketPda &&
        fact.orderId === orderId.toString(),
    );
    const placement =
      currentPlacement ??
      loadSolanaIndexedOrderPlacement({
        cluster: SERVICE_SOLANA_CLUSTER,
        programId,
        marketPda,
        orderId: orderId.toString(),
      });
    if (
      !placement ||
      placement.wallet !== wallet ||
      (placement.side !== 1 && placement.side !== 2) ||
      placement.price === undefined ||
      (placement.orderBehavior !== 0 &&
        placement.orderBehavior !== 1 &&
        placement.orderBehavior !== 2) ||
      placement.amountUnits === undefined ||
      !isTransactionSigner(transaction, wallet)
    ) {
      throw new Error(`${instruction.name} has no canonical order placement`);
    }
    const side = placement.side;
    const limitPrice = placement.price;
    const orderBehavior = placement.orderBehavior;
    const treasury = normalizeBase58Key(instruction.accounts[6] ?? null);
    const marketMaker = normalizeBase58Key(instruction.accounts[7] ?? null);
    const vault = normalizeBase58Key(instruction.accounts[8] ?? null);
    if (
      !treasury ||
      !marketMaker ||
      !vault ||
      instruction.accounts[2] !==
        findUserBalancePda(
          solanaCtx.marketProgramId,
          new PublicKey(marketPda),
          new PublicKey(wallet),
        ).toBase58() ||
      instruction.accounts[3] !==
        findOrderPda(
          solanaCtx.marketProgramId,
          new PublicKey(marketPda),
          orderId,
        ).toBase58() ||
      instruction.accounts[4] !==
        findPriceLevelPda(
          solanaCtx.marketProgramId,
          new PublicKey(marketPda),
          side,
          limitPrice,
        ).toBase58() ||
      instruction.accounts[5] !==
        findMarketConfigPda(solanaCtx.marketProgramId).toBase58() ||
      vault !==
        findClobVaultPda(
          solanaCtx.marketProgramId,
          new PublicKey(marketPda),
        ).toBase58() ||
      instruction.accounts[10] !== SystemProgram.programId.toBase58()
    ) {
      throw new Error(
        `${instruction.name} execution accounts are noncanonical`,
      );
    }
    const market = await validateMarketAndDuel(marketPda, duelState);
    const marketMakerSnapshot = normalizeBase58Key(
      toInstructionAccountAddress(market.marketMaker),
    );
    const treasurySnapshot = normalizeBase58Key(
      toInstructionAccountAddress(market.treasury),
    );
    const treasuryFeeBps = toNumberLike(market.tradeTreasuryFeeBpsSnapshot);
    const marketMakerFeeBps = toNumberLike(
      market.tradeMarketMakerFeeBpsSnapshot,
    );
    if (
      marketMakerSnapshot !== marketMaker ||
      treasurySnapshot !== treasury ||
      !Number.isInteger(treasuryFeeBps) ||
      treasuryFeeBps < 0 ||
      treasuryFeeBps > 10_000 ||
      !Number.isInteger(marketMakerFeeBps) ||
      marketMakerFeeBps < 0 ||
      marketMakerFeeBps > 10_000 ||
      instruction.transfers.some(
        (transfer) =>
          (transfer.source === wallet && transfer.destination !== vault) ||
          (transfer.source === vault && transfer.destination !== wallet),
      )
    ) {
      throw new Error(`${instruction.name} fee/transfer graph is noncanonical`);
    }

    const matchingEvents = events.filter(
      (event) =>
        event.name === "orderMatched" &&
        marketRefFromEvent(event) === marketPda &&
        toBigIntLike(event.data.takerOrderId) === orderId,
    );
    const matchingSelfTradeEvents = events.filter(
      (event) =>
        event.name === "selfTradePolicyTriggered" &&
        marketRefFromEvent(event) === marketPda &&
        toBigIntLike(event.data.takerOrderId) === orderId,
    );
    if (matchingSelfTradeEvents.length > 1) {
      throw new Error(
        `${instruction.name} has contradictory self-trade events`,
      );
    }
    const selfTradeTriggered = matchingSelfTradeEvents.length === 1;
    let matchedAmount = 0n;
    let executedCost = 0n;
    for (const event of matchingEvents) {
      const amount = toBigIntLike(event.data.matchedAmount);
      const executionPrice = toNumberLike(event.data.price);
      if (amount === null) {
        throw new Error("orderMatched event has an invalid amount");
      }
      const cost = quoteCostLamports(side, executionPrice, amount);
      if (cost === null) {
        throw new Error("orderMatched event cannot be priced exactly");
      }
      matchedAmount += amount;
      executedCost += cost;
    }
    const limitMatchCost =
      matchedAmount === 0n
        ? 0n
        : quoteCostLamports(side, limitPrice, matchedAmount);
    if (limitMatchCost === null || limitMatchCost < executedCost) {
      throw new Error(`${instruction.name} execution exceeds its signed limit`);
    }
    const treasuryFee =
      (executedCost * BigInt(treasuryFeeBps)) / BigInt(10_000);
    const marketMakerFee =
      (executedCost * BigInt(marketMakerFeeBps)) / BigInt(10_000);
    const totalTradeFee = treasuryFee + marketMakerFee;
    const matchingFeeEvents = events.filter(
      (event) =>
        event.name === "tradeFeesEscrowed" &&
        marketRefFromEvent(event) === marketPda &&
        toBigIntLike(event.data.orderId) === orderId &&
        normalizeBase58Key(toInstructionAccountAddress(event.data.payer)) ===
          wallet,
    );
    if (
      matchingFeeEvents.length !== (executedCost > 0n ? 1 : 0) ||
      (matchingFeeEvents[0] !== undefined &&
        (toBigIntLike(matchingFeeEvents[0].data.executedCostLamports) !==
          executedCost ||
          toBigIntLike(matchingFeeEvents[0].data.treasuryFeeLamports) !==
            treasuryFee ||
          toBigIntLike(matchingFeeEvents[0].data.marketMakerFeeLamports) !==
            marketMakerFee))
    ) {
      throw new Error(`${instruction.name} fee escrow event does not conserve`);
    }
    const walletToVault = sumNativeTransfers(
      instruction.transfers,
      wallet,
      vault,
    );
    const vaultRefund = sumNativeTransfers(
      instruction.transfers,
      vault,
      wallet,
    );
    if (instruction.name === "placeOrder") {
      const orderAmount = BigInt(placement.amountUnits);
      const signedLimitCost = quoteCostLamports(side, limitPrice, orderAmount);
      if (
        signedLimitCost === null ||
        walletToVault !== signedLimitCost + totalTradeFee
      ) {
        throw new Error("placeOrder vault funding does not match signed units");
      }
    } else if (walletToVault !== totalTradeFee) {
      throw new Error("continueOrder fee escrow does not conserve");
    }
    const improvementRefund = limitMatchCost - executedCost;
    if (vaultRefund < improvementRefund) {
      throw new Error(
        `${instruction.name} vault refund misses price improvement`,
      );
    }
    const releasedAmount = unitsReleasedByVaultRefund({
      side,
      price: limitPrice,
      lamports: vaultRefund - improvementRefund,
    });
    const orderAmount = BigInt(placement.amountUnits);
    if (matchedAmount + releasedAmount > orderAmount) {
      throw new Error(`${instruction.name} execution exceeds order units`);
    }
    const restingAmount = orderAmount - matchedAmount - releasedAmount;
    if (
      (orderBehavior === 1 && restingAmount !== 0n) ||
      (orderBehavior === 2 &&
        (matchedAmount !== 0n || releasedAmount !== 0n)) ||
      (orderBehavior === 0 &&
        ((selfTradeTriggered &&
          (releasedAmount === 0n || restingAmount !== 0n)) ||
          (!selfTradeTriggered && releasedAmount !== 0n)))
    ) {
      throw new Error(`${instruction.name} order behavior is inconsistent`);
    }
    if (matchedAmount > 0n || releasedAmount > 0n) {
      facts.push(
        normalizeLifecycleFact({
          kind: "TAKER_EXECUTION",
          marketPda,
          orderId: orderId.toString(),
          wallet,
          side,
          price: limitPrice,
          amountUnits: matchedAmount.toString(),
          releasedAmountUnits: releasedAmount.toString(),
          amountLamports: executedCost.toString(),
          feeLamports: (treasuryFee + marketMakerFee).toString(),
          refundLamports: vaultRefund.toString(),
          treasuryFeeLamports: treasuryFee.toString(),
          marketMakerFeeLamports: marketMakerFee.toString(),
          selfTradeTriggered,
        }),
      );
    } else if (
      executedCost !== 0n ||
      treasuryFee !== 0n ||
      marketMakerFee !== 0n ||
      vaultRefund !== 0n
    ) {
      throw new Error(
        `${instruction.name} has unexplained zero-unit transfers`,
      );
    }
  }

  for (const instruction of instructions) {
    if (
      instruction.name !== "cancelOrder" &&
      instruction.name !== "reclaimRestingOrder" &&
      instruction.name !== "claim" &&
      instruction.name !== "closeLosingBalance" &&
      instruction.name !== "withdrawResolvedTradeFees"
    ) {
      continue;
    }
    const marketPda = normalizeBase58Key(instruction.accounts[0] ?? null);
    const duelState = normalizeBase58Key(instruction.accounts[1] ?? null);
    if (!marketPda || !duelState) {
      throw new Error(`${instruction.name} account graph is incomplete`);
    }
    const market = await validateMarketAndDuel(marketPda, duelState);
    if (instruction.name === "withdrawResolvedTradeFees") {
      const treasury = normalizeBase58Key(instruction.accounts[2] ?? null);
      const marketMaker = normalizeBase58Key(instruction.accounts[3] ?? null);
      const vault = normalizeBase58Key(instruction.accounts[4] ?? null);
      const submitter = normalizeBase58Key(instruction.accounts[5] ?? null);
      const treasurySnapshot = normalizeBase58Key(
        toInstructionAccountAddress(market.treasury),
      );
      const marketMakerSnapshot = normalizeBase58Key(
        toInstructionAccountAddress(market.marketMaker),
      );
      const status = enumName(market.status)?.toLowerCase();
      const winner = enumName(market.winner)?.toLowerCase();
      const matchingEvents = events.filter(
        (event) =>
          event.name === "resolvedTradeFeesWithdrawn" &&
          marketRefFromEvent(event) === marketPda,
      );
      const event = matchingEvents[0];
      const eventTreasury = event
        ? normalizeBase58Key(toInstructionAccountAddress(event.data.treasury))
        : null;
      const eventMarketMaker = event
        ? normalizeBase58Key(
            toInstructionAccountAddress(event.data.marketMaker),
          )
        : null;
      const eventSubmitter = event
        ? normalizeBase58Key(toInstructionAccountAddress(event.data.submitter))
        : null;
      const treasuryFeeLamports = event
        ? toBigIntLike(event.data.treasuryFeeLamports)
        : null;
      const marketMakerFeeLamports = event
        ? toBigIntLike(event.data.marketMakerFeeLamports)
        : null;
      if (
        instruction.accounts.length !== 7 ||
        !treasury ||
        !marketMaker ||
        !vault ||
        !submitter ||
        treasury !== treasurySnapshot ||
        marketMaker !== marketMakerSnapshot ||
        vault !==
          findClobVaultPda(
            solanaCtx.marketProgramId,
            new PublicKey(marketPda),
          ).toBase58() ||
        instruction.accounts[6] !== SystemProgram.programId.toBase58() ||
        !isTransactionSigner(transaction, submitter) ||
        status !== "resolved" ||
        (winner !== "a" && winner !== "b") ||
        matchingEvents.length !== 1 ||
        eventTreasury !== treasury ||
        eventMarketMaker !== marketMaker ||
        eventSubmitter !== submitter ||
        treasuryFeeLamports === null ||
        marketMakerFeeLamports === null ||
        (treasuryFeeLamports === 0n && marketMakerFeeLamports === 0n) ||
        sumNativeTransfers(instruction.transfers, vault, treasury) !==
          treasuryFeeLamports +
            (treasury === marketMaker ? marketMakerFeeLamports : 0n) ||
        (treasury !== marketMaker &&
          sumNativeTransfers(instruction.transfers, vault, marketMaker) !==
            marketMakerFeeLamports) ||
        instruction.transfers.some(
          (transfer) =>
            transfer.source !== vault ||
            (transfer.destination !== treasury &&
              transfer.destination !== marketMaker),
        )
      ) {
        throw new Error(
          "withdrawResolvedTradeFees account/event/transfer graph is noncanonical",
        );
      }
      facts.push(
        normalizeLifecycleFact({
          kind: "RESOLVED_TRADE_FEES_WITHDRAWN",
          marketPda,
          treasury,
          marketMaker,
          submitter,
          treasuryFeeLamports: treasuryFeeLamports.toString(),
          marketMakerFeeLamports: marketMakerFeeLamports.toString(),
          status: "resolved",
          winner,
        }),
      );
      continue;
    }
    if (instruction.name === "closeLosingBalance") {
      const userBalance = normalizeBase58Key(instruction.accounts[2] ?? null);
      const wallet = normalizeBase58Key(instruction.accounts[3] ?? null);
      const matchingEvents = events.filter(
        (event) =>
          event.name === "losingBalanceClosed" &&
          marketRefFromEvent(event) === marketPda &&
          normalizeBase58Key(toInstructionAccountAddress(event.data.user)) ===
            wallet,
      );
      const status = enumName(market.status)?.toLowerCase();
      const winner = enumName(market.winner)?.toLowerCase();
      const event = matchingEvents[0];
      const aShares = event ? toBigIntLike(event.data.aShares) : null;
      const bShares = event ? toBigIntLike(event.data.bShares) : null;
      const aLockedLamports = event
        ? toBigIntLike(event.data.aLockedLamports)
        : null;
      const bLockedLamports = event
        ? toBigIntLike(event.data.bLockedLamports)
        : null;
      if (
        !userBalance ||
        !wallet ||
        instruction.accounts.length !== 4 ||
        matchingEvents.length !== 1 ||
        !isTransactionSigner(transaction, wallet) ||
        userBalance !==
          findUserBalancePda(
            solanaCtx.marketProgramId,
            new PublicKey(marketPda),
            new PublicKey(wallet),
          ).toBase58() ||
        instruction.transfers.length !== 0 ||
        aShares === null ||
        bShares === null ||
        aLockedLamports === null ||
        bLockedLamports === null
      ) {
        throw new Error(
          "closeLosingBalance account/event graph is noncanonical",
        );
      }
      const cleanup = verifyLosingBalanceCleanupAccounting({
        status,
        winner,
        aShares,
        bShares,
        aLockedLamports,
        bLockedLamports,
      });
      facts.push(
        normalizeLifecycleFact({
          kind: "LOSING_BALANCE_CLOSED",
          marketPda,
          wallet,
          side: cleanup.side,
          amountUnits: cleanup.amountUnits.toString(),
          amountLamports: cleanup.amountLamports.toString(),
          status: status as "resolved",
          winner: winner as "a" | "b",
        }),
      );
      continue;
    }
    if (
      instruction.name === "cancelOrder" ||
      instruction.name === "reclaimRestingOrder"
    ) {
      const orderId = toBigIntLike(instruction.data.orderId);
      const side = toNumberLike(instruction.data.side);
      const price = toNumberLike(instruction.data.price);
      const vault = normalizeBase58Key(instruction.accounts[4] ?? null);
      const wallet = normalizeBase58Key(instruction.accounts[5] ?? null);
      const expectedEventName =
        instruction.name === "cancelOrder"
          ? "orderCancelled"
          : "restingOrderReclaimed";
      const matchingEvents = events.filter(
        (event) =>
          event.name === expectedEventName &&
          marketRefFromEvent(event) === marketPda &&
          toBigIntLike(event.data.orderId) === orderId,
      );
      if (
        orderId === null ||
        (side !== 1 && side !== 2) ||
        !Number.isInteger(price) ||
        !vault ||
        !wallet ||
        matchingEvents.length !== 1 ||
        !isTransactionSigner(transaction, wallet) ||
        instruction.accounts[2] !==
          findOrderPda(
            solanaCtx.marketProgramId,
            new PublicKey(marketPda),
            orderId,
          ).toBase58() ||
        instruction.accounts[3] !==
          findPriceLevelPda(
            solanaCtx.marketProgramId,
            new PublicKey(marketPda),
            side,
            price,
          ).toBase58() ||
        vault !==
          findClobVaultPda(
            solanaCtx.marketProgramId,
            new PublicKey(marketPda),
          ).toBase58() ||
        instruction.accounts[6] !== SystemProgram.programId.toBase58()
      ) {
        throw new Error(
          `${instruction.name} account/event graph is noncanonical`,
        );
      }
      if (
        instruction.transfers.some(
          (transfer) =>
            transfer.source === vault && transfer.destination !== wallet,
        )
      ) {
        throw new Error(
          `${instruction.name} contains an unexplained vault transfer`,
        );
      }
      const refundLamports = sumNativeTransfers(
        instruction.transfers,
        vault,
        wallet,
      );
      const amountUnits = unitsReleasedByVaultRefund({
        side,
        price,
        lamports: refundLamports,
      });
      facts.push(
        normalizeLifecycleFact({
          kind:
            instruction.name === "cancelOrder"
              ? "ORDER_CANCELLED"
              : "RESTING_ORDER_RECLAIMED",
          marketPda,
          orderId: orderId.toString(),
          wallet,
          side,
          price,
          amountUnits: amountUnits.toString(),
          amountLamports: refundLamports.toString(),
        }),
      );
      continue;
    }

    const userBalance = normalizeBase58Key(instruction.accounts[2] ?? null);
    const config = normalizeBase58Key(instruction.accounts[3] ?? null);
    const marketMaker = normalizeBase58Key(instruction.accounts[4] ?? null);
    const vault = normalizeBase58Key(instruction.accounts[5] ?? null);
    const wallet = normalizeBase58Key(instruction.accounts[6] ?? null);
    const marketMakerSnapshot = normalizeBase58Key(
      toInstructionAccountAddress(market.marketMaker),
    );
    if (
      instruction.accounts.length !== 8 ||
      !userBalance ||
      !config ||
      !marketMaker ||
      !vault ||
      !wallet ||
      !isTransactionSigner(transaction, wallet) ||
      userBalance !==
        findUserBalancePda(
          solanaCtx.marketProgramId,
          new PublicKey(marketPda),
          new PublicKey(wallet),
        ).toBase58() ||
      config !== findMarketConfigPda(solanaCtx.marketProgramId).toBase58() ||
      marketMaker !== marketMakerSnapshot ||
      vault !==
        findClobVaultPda(
          solanaCtx.marketProgramId,
          new PublicKey(marketPda),
        ).toBase58() ||
      instruction.accounts[7] !== SystemProgram.programId.toBase58() ||
      instruction.transfers.some(
        (transfer) =>
          transfer.source === vault &&
          transfer.destination !== wallet &&
          transfer.destination !== marketMaker,
      )
    ) {
      throw new Error("claim account/transfer graph is noncanonical");
    }
    const payoutLamports = sumNativeTransfers(
      instruction.transfers,
      vault,
      wallet,
    );
    const feeLamports = sumNativeTransfers(
      instruction.transfers,
      vault,
      marketMaker,
    );
    const status = enumName(market.status)?.toLowerCase();
    const winner = enumName(market.winner)?.toLowerCase();
    const claimEvents = events.filter(
      (event) =>
        event.name === "claimSettled" &&
        marketRefFromEvent(event) === marketPda &&
        normalizeBase58Key(toInstructionAccountAddress(event.data.user)) ===
          wallet,
    );
    const claimEvent = claimEvents[0];
    const eventStatus = claimEvent
      ? enumName(claimEvent.data.status)?.toLowerCase()
      : null;
    const eventWinner = claimEvent
      ? enumName(claimEvent.data.winner)?.toLowerCase()
      : null;
    const eventPayout = claimEvent
      ? toBigIntLike(claimEvent.data.payoutLamports)
      : null;
    const eventWinningsFee = claimEvent
      ? toBigIntLike(claimEvent.data.winningsFeeLamports)
      : null;
    const refundedTradeTreasuryFee = claimEvent
      ? toBigIntLike(claimEvent.data.refundedTradeTreasuryFeeLamports)
      : null;
    const refundedTradeMarketMakerFee = claimEvent
      ? toBigIntLike(claimEvent.data.refundedTradeMarketMakerFeeLamports)
      : null;
    const winningsFeeBps = toNumberLike(
      market.winningsMarketMakerFeeBpsSnapshot,
    );
    if (
      (status !== "resolved" && status !== "cancelled") ||
      (winner !== "none" && winner !== "a" && winner !== "b") ||
      claimEvents.length !== 1 ||
      eventStatus !== status ||
      eventWinner !== winner ||
      eventPayout !== payoutLamports ||
      eventWinningsFee !== feeLamports ||
      refundedTradeTreasuryFee === null ||
      refundedTradeMarketMakerFee === null ||
      (status === "resolved" &&
        (refundedTradeTreasuryFee !== 0n ||
          refundedTradeMarketMakerFee !== 0n)) ||
      (status === "cancelled" &&
        (feeLamports !== 0n ||
          refundedTradeTreasuryFee + refundedTradeMarketMakerFee >
            payoutLamports))
    ) {
      throw new Error("claim market/event accounting is invalid");
    }
    const kind = verifyClaimLifecycleAccounting({
      status,
      winner,
      payoutLamports,
      feeLamports,
      winningsFeeBps,
    });
    facts.push(
      normalizeLifecycleFact({
        kind,
        marketPda,
        wallet,
        amountLamports: payoutLamports.toString(),
        feeLamports: feeLamports.toString(),
        ...(kind === "CANCELLATION_REFUND"
          ? {
              treasuryFeeLamports: refundedTradeTreasuryFee.toString(),
              marketMakerFeeLamports: refundedTradeMarketMakerFee.toString(),
            }
          : {}),
        status,
        winner,
      }),
    );
  }

  return {
    instructionNames: [...new Set(instructions.map((item) => item.name))],
    facts,
  };
}

let solanaCtx: {
  connection: Connection;
  fightProgram: Program<FightOracle>;
  marketProgram: Program<DuelMarket>;
  marketProgramId: PublicKey;
  expectedFightUpgradeAuthority: ExpectedUpgradeAuthority;
  expectedMarketUpgradeAuthority: ExpectedUpgradeAuthority;
  lifecycleIndexStartSlot: number;
} | null = null;

try {
  const { connection, fightOracle, duelMarket } =
    createReadOnlyLaunchPrograms();
  solanaCtx = {
    connection,
    fightProgram: fightOracle,
    marketProgram: duelMarket,
    marketProgramId: duelMarket.programId,
    expectedFightUpgradeAuthority: resolveExpectedUpgradeAuthority({
      value:
        process.env.FIGHT_ORACLE_EXPECTED_UPGRADE_AUTHORITY ||
        process.env.SOLANA_EXPECTED_UPGRADE_AUTHORITY,
      required: SERVICE_IS_MAINNET,
      label: "fight oracle",
    }),
    expectedMarketUpgradeAuthority: resolveExpectedUpgradeAuthority({
      value:
        process.env.DUEL_MARKET_EXPECTED_UPGRADE_AUTHORITY ||
        process.env.SOLANA_EXPECTED_UPGRADE_AUTHORITY,
      required: SERVICE_IS_MAINNET,
      label: "duel market",
    }),
    lifecycleIndexStartSlot: resolveLifecycleIndexStartSlot({
      value: process.env.SOLANA_LIFECYCLE_INDEX_START_SLOT,
      required: SERVICE_IS_MAINNET,
    }),
  };
  parsers.solana.enabled = true;
} catch (error) {
  parsers.solana.enabled = false;
  parsers.solana.lastError =
    error instanceof Error
      ? error.message
      : "Failed to initialize read-only Solana parser";
}

async function syncFinalizedMarketLifecycleIndex(): Promise<{
  checkpointSignature: string | null;
  checkpointSlot: number | null;
  indexedTransactions: number;
  indexedFacts: number;
  remainingTransactions: number;
  reconciledBets: number;
  rewardChanges: number;
  terminalSettlements: number;
  settledBets: number;
}> {
  if (!solanaCtx) {
    throw new Error("Solana lifecycle index is unavailable");
  }
  const programId = solanaCtx.marketProgramId.toBase58();
  const checkpoint = loadSolanaIndexerCheckpoint({
    cluster: SERVICE_SOLANA_CLUSTER,
    programId,
  });
  if (
    checkpoint &&
    checkpoint.startSlot !== solanaCtx.lifecycleIndexStartSlot
  ) {
    throw new Error("Solana lifecycle index start slot drifted");
  }
  const minimumAvailableSlot =
    await solanaCtx.connection.getMinimumLedgerSlot();
  const pending = await collectFinalizedSignatureBackfill({
    fetchPage: async ({ before, limit }) =>
      (await solanaCtx!.connection.getSignaturesForAddress(
        solanaCtx!.marketProgramId,
        { before, limit },
        "finalized",
      )) as SignaturePageEntry[],
    checkpointSignature: checkpoint?.signature ?? null,
    checkpointSlot: checkpoint?.slot ?? null,
    startSlot: solanaCtx.lifecycleIndexStartSlot,
    minimumAvailableSlot,
    pageSize: SOLANA_LIFECYCLE_INDEX_PAGE_SIZE,
    maxPages: SOLANA_LIFECYCLE_INDEX_MAX_PAGES,
  });

  let indexedTransactions = 0;
  let indexedFacts = 0;
  for (const reference of pending.slice(0, SOLANA_LIFECYCLE_INDEX_BATCH_SIZE)) {
    if (!reference.succeeded) {
      const inserted = commitSolanaIndexedTransaction({
        cluster: SERVICE_SOLANA_CLUSTER,
        programId,
        startSlot: solanaCtx.lifecycleIndexStartSlot,
        signature: reference.signature,
        slot: reference.slot,
        blockTime: reference.blockTime,
        succeeded: false,
        instructionNames: [],
        transactionDigest: createHash("sha256")
          .update(`failed:${reference.signature}`)
          .digest("hex"),
        facts: [],
        indexedAt: Date.now(),
      });
      if (inserted) indexedTransactions += 1;
      continue;
    }

    const transaction = await solanaCtx.connection.getParsedTransaction(
      reference.signature,
      {
        commitment: "finalized",
        maxSupportedTransactionVersion: 0,
      },
    );
    if (
      !transaction ||
      !transaction.meta ||
      transaction.meta.err ||
      transaction.slot !== reference.slot ||
      !transaction.transaction.signatures.includes(reference.signature) ||
      (reference.blockTime !== null &&
        transaction.blockTime !== null &&
        transaction.blockTime !== reference.blockTime)
    ) {
      throw new Error(
        `finalized lifecycle transaction evidence drifted for ${reference.signature}`,
      );
    }
    let parsed: Awaited<
      ReturnType<typeof parseFinalizedMarketLifecycleTransaction>
    >;
    try {
      parsed = await parseFinalizedMarketLifecycleTransaction(transaction);
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.message
          : "unknown lifecycle parsing failure";
      throw new Error(
        `finalized lifecycle transaction ${reference.signature} at slot ${reference.slot} failed validation: ${reason}`,
        { cause: error },
      );
    }
    const inserted = commitSolanaIndexedTransaction({
      cluster: SERVICE_SOLANA_CLUSTER,
      programId,
      startSlot: solanaCtx.lifecycleIndexStartSlot,
      signature: reference.signature,
      slot: reference.slot,
      blockTime: transaction.blockTime ?? reference.blockTime,
      succeeded: true,
      instructionNames: parsed.instructionNames,
      transactionDigest: digestFinalizedTransactionEvidence(transaction),
      facts: parsed.facts,
      indexedAt: Date.now(),
    });
    if (inserted) {
      indexedTransactions += 1;
      indexedFacts += parsed.facts.length;
    }
  }
  if (pending.length > SOLANA_LIFECYCLE_INDEX_BATCH_SIZE) {
    throw new Error(
      `Solana lifecycle index backlog remains: ${pending.length - SOLANA_LIFECYCLE_INDEX_BATCH_SIZE} finalized transaction(s) still require indexing`,
    );
  }

  const updatedCheckpoint = loadSolanaIndexerCheckpoint({
    cluster: SERVICE_SOLANA_CLUSTER,
    programId,
  });
  const reconciliation = reconcileSolanaBetLifecycleAccounting({
    cluster: SERVICE_SOLANA_CLUSTER,
    programId,
    throughSlot: updatedCheckpoint?.slot ?? solanaCtx.lifecycleIndexStartSlot,
    throughSignature:
      updatedCheckpoint?.signature ??
      `start:${solanaCtx.lifecycleIndexStartSlot}`,
    reconciledAt: Date.now(),
  });
  for (const change of reconciliation.changes) {
    const wallet = normalizeWallet(change.wallet);
    const walletPoints = pointsByWallet.get(wallet) ?? {
      selfPoints: 0,
      winPoints: 0,
      referralPoints: 0,
    };
    walletPoints.selfPoints += change.selfPointsDelta;
    pointsByWallet.set(wallet, walletPoints);
    if (change.referrerWallet) {
      const referrer = normalizeWallet(change.referrerWallet);
      const referrerPoints = pointsByWallet.get(referrer) ?? {
        selfPoints: 0,
        winPoints: 0,
        referralPoints: 0,
      };
      referrerPoints.referralPoints += change.referralPointsDelta;
      pointsByWallet.set(referrer, referrerPoints);
    }
    pointsEvents.unshift(...change.events.slice().reverse());
  }
  if (reconciliation.pendingBets > 0) {
    throw new Error(
      `Solana lifecycle reconciliation is waiting for ${reconciliation.pendingBets} recorded bet transaction(s) to enter the finalized index`,
    );
  }
  return {
    checkpointSignature: updatedCheckpoint?.signature ?? null,
    checkpointSlot: updatedCheckpoint?.slot ?? null,
    indexedTransactions,
    indexedFacts,
    remainingTransactions: Math.max(
      0,
      pending.length - SOLANA_LIFECYCLE_INDEX_BATCH_SIZE,
    ),
    reconciledBets: reconciliation.reconciledBets,
    rewardChanges: reconciliation.changes.length,
    terminalSettlements: reconciliation.terminalSettlements,
    settledBets: reconciliation.settledBets,
  };
}

async function pollSolanaSnapshot(): Promise<void> {
  if (!solanaCtx) return;
  try {
    const [fightIdentity, marketIdentity] = await Promise.all([
      fetchUpgradeableProgramIdentity({
        connection: solanaCtx.connection,
        label: "fight oracle",
        programId: solanaCtx.fightProgram.programId,
        expectedUpgradeAuthority: solanaCtx.expectedFightUpgradeAuthority,
      }),
      fetchUpgradeableProgramIdentity({
        connection: solanaCtx.connection,
        label: "duel market",
        programId: solanaCtx.marketProgram.programId,
        expectedUpgradeAuthority: solanaCtx.expectedMarketUpgradeAuthority,
      }),
    ]);
    const lifecycleIndex = await syncFinalizedMarketLifecycleIndex();
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
    const oracleConfigPda = findOracleConfigPda(
      solanaCtx.fightProgram.programId,
    );
    const oracleConfig =
      await solanaCtx.fightProgram.account.oracleConfig.fetchNullable(
        oracleConfigPda,
      );
    const currentDuelPda =
      currentSolanaDuelKey != null
        ? findDuelStatePda(
            solanaCtx.fightProgram.programId,
            duelKeyHexToBytes(currentSolanaDuelKey),
          ).toBase58()
        : null;
    const currentDuelAccount =
      currentDuelPda != null
        ? await solanaCtx.fightProgram.account.duelState.fetchNullable(
            new PublicKey(currentDuelPda),
          )
        : null;
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
      (recentSignatures as Array<{ signature?: string } | null>).find(
        (entry) => entry?.signature,
      )?.signature ?? null;
    const currentDuelData = currentDuelAccount as Record<
      string,
      unknown
    > | null;
    const oracleConfigData = oracleConfig as Record<string, unknown> | null;

    parsers.solana.snapshot = {
      rpc: sanitizeUrlForStatus(solanaCtx.connection.rpcEndpoint),
      fightOracleProgram: solanaCtx.fightProgram.programId.toBase58(),
      marketProgram: solanaCtx.marketProgram.programId.toBase58(),
      fightProgramData: fightIdentity.programDataAddress.toBase58(),
      fightUpgradeAuthority:
        fightIdentity.upgradeAuthority?.toBase58() ?? "immutable",
      fightDeployedSlot: fightIdentity.deployedSlot.toString(),
      marketProgramData: marketIdentity.programDataAddress.toBase58(),
      marketUpgradeAuthority:
        marketIdentity.upgradeAuthority?.toBase58() ?? "immutable",
      marketDeployedSlot: marketIdentity.deployedSlot.toString(),
      lifecycleIndexStartSlot: solanaCtx.lifecycleIndexStartSlot,
      lifecycleIndexCheckpointSignature: lifecycleIndex.checkpointSignature,
      lifecycleIndexCheckpointSlot: lifecycleIndex.checkpointSlot,
      lifecycleIndexedTransactions: lifecycleIndex.indexedTransactions,
      lifecycleIndexedFacts: lifecycleIndex.indexedFacts,
      lifecycleRemainingTransactions: lifecycleIndex.remainingTransactions,
      lifecycleReconciledBets: lifecycleIndex.reconciledBets,
      lifecycleRewardChanges: lifecycleIndex.rewardChanges,
      lifecycleTerminalSettlements: lifecycleIndex.terminalSettlements,
      lifecycleSettledBets: lifecycleIndex.settledBets,
      fightAccountCount: fightAccounts.length,
      marketAccountCount: marketAccounts.length,
      latestFightAccount,
      latestMarketAccount,
      derivedMarketPda,
      currentDuelPda,
      currentMarketPda,
      currentDuelStatus: enumName(currentDuelAccount?.status),
      currentMarketStatus: enumName(currentMarketAccount?.status),
      currentMarketWinner: enumName(currentMarketAccount?.winner),
      currentProposalId: normalizeHexProposalId(
        currentDuelData?.activeProposal,
      ),
      currentProposalProposedAt: toNullableTimestamp(
        currentDuelData?.pendingProposedAt,
      ),
      currentProposalChallenged:
        typeof currentDuelData?.pendingChallenged === "boolean"
          ? currentDuelData.pendingChallenged
          : null,
      currentDisputeWindowSeconds: toNullableTimestamp(
        oracleConfigData?.disputeWindowSecs,
      ),
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
  return referredByWallet.get(normalized) ?? null;
}

function pointsForWalletResponse(wallet: string): Record<string, unknown> {
  const normalized = rememberWalletCase(wallet);
  const aggregate = aggregatePoints([normalized]);
  const referredBy = getReferralOwner(normalized);

  return {
    wallet: wallet.trim(),
    totalPoints: totalPoints(aggregate),
    selfPoints: aggregate.selfPoints,
    winPoints: aggregate.winPoints,
    referralPoints: aggregate.referralPoints,
    invitedWalletCount: (invitedWalletsByWallet.get(normalized) ?? new Set())
      .size,
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
  window: PointsWindow,
): {
  leaderboard: Array<{ rank: number; wallet: string; totalPoints: number }>;
} {
  const rows = leaderboardRows(window);
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
  const rows = leaderboardRows("alltime");
  const rank =
    rows.findIndex((entry) => normalizeWallet(entry.wallet) === normalized) + 1;

  return {
    wallet: displayWallet(normalized),
    rank: rank > 0 ? rank : 0,
    totalPoints: totalPoints(aggregatePoints([normalized])),
  };
}

function historyResponse(
  wallet: string,
  limit: number,
  offset: number,
  eventType: string | null,
): Record<string, unknown> {
  const normalized = rememberWalletCase(wallet);
  const filtered = pointsEvents.filter((entry) => {
    if (entry.wallet !== normalized) return false;
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

function canonicalSolanaRequestAddress(value: string): string | null {
  if (!value || value !== value.trim()) return null;
  try {
    const canonical = new PublicKey(value).toBase58();
    return canonical === value ? canonical : null;
  } catch {
    return null;
  }
}

function settlementLedgerStatus(): {
  current: boolean;
  lastIndexedAt: number | null;
  degradedReason: string | null;
} {
  const lastIndexedAt = parsers.solana.lastSuccessAt;
  const snapshot = parsers.solana.snapshot as Record<string, unknown> | null;
  const remaining = Number(snapshot?.lifecycleRemainingTransactions ?? 0);
  const stale =
    lastIndexedAt === null ||
    Date.now() - lastIndexedAt > READINESS_PARSER_MAX_AGE_MS;
  const current =
    parsers.solana.enabled &&
    parsers.solana.lastError === null &&
    !stale &&
    Number.isSafeInteger(remaining) &&
    remaining === 0;
  return {
    current,
    lastIndexedAt,
    degradedReason: current
      ? null
      : parsers.solana.lastError
        ? "Settlement reconciliation is temporarily unavailable"
        : remaining > 0
          ? "Settlement history is catching up"
          : "Settlement history is not current",
  };
}

function handleSolanaSettlementHistory(
  req: Request,
  url: URL,
  walletPath: string,
): Response {
  const wallet = canonicalSolanaRequestAddress(walletPath);
  const marketParam = url.searchParams.get("marketPda");
  const marketPda = marketParam
    ? canonicalSolanaRequestAddress(marketParam)
    : null;
  if (!wallet) {
    return jsonResponse(
      req,
      { error: "Canonical Solana wallet is required" },
      400,
    );
  }
  if (marketParam && !marketPda) {
    return jsonResponse(req, { error: "marketPda must be canonical" }, 400);
  }
  const limit = parseBoundedInteger(url.searchParams.get("limit"), 10, 1, 100);
  const offset = parseBoundedInteger(
    url.searchParams.get("offset"),
    0,
    0,
    10_000,
  );
  try {
    const history = loadSolanaWalletBetHistory({
      cluster: SERVICE_SOLANA_CLUSTER,
      programId: DUEL_MARKET_PROGRAM_ID.toBase58(),
      wallet,
      marketPda,
      limit,
      offset,
    });
    return jsonResponse(
      req,
      {
        schemaVersion: 1,
        chain: "SOLANA",
        asset: "SOL",
        decimals: 9,
        ledger: settlementLedgerStatus(),
        ...history,
        updatedAt: Date.now(),
      },
      200,
      { "cache-control": "no-store" },
    );
  } catch (error) {
    console.error("[service] Failed to load settlement history", error);
    return jsonResponse(
      req,
      { error: "Settlement history is unavailable" },
      500,
      {
        "cache-control": "no-store",
      },
    );
  }
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
  const marketRefRaw = payload.marketPda
    ? String(payload.marketPda)
    : payload.marketRef
      ? String(payload.marketRef)
      : null;
  const duelKeyRaw = payload.duelKey ? String(payload.duelKey).trim() : null;
  const authorizedByWriteKey = hasPrivilegedWriteAuth(req);
  const allowPrivilegedBypass =
    authorizedByWriteKey && !REQUIRE_ONCHAIN_BET_VERIFICATION;
  const authorization = allowPrivilegedBypass
    ? ({ status: "bypass" } as const)
    : await authorizeExternalBetRecord(req, walletRaw, txSignature, {
        marketRef: marketRefRaw,
        duelKey: duelKeyRaw,
      });
  if (authorization.status === "pending-finality") {
    return jsonResponse(
      req,
      {
        error: "Solana place-order finalization is still pending",
        retryable: true,
        ...(!IS_PRODUCTION
          ? {
              verificationCode: authorization.verificationCode,
              verificationRpc: solanaCtx
                ? sanitizeUrlForStatus(solanaCtx.connection.rpcEndpoint)
                : null,
              verificationIndex: externalBetIndexDiagnostics(txSignature),
            }
          : {}),
      },
      425,
      { "retry-after": "1" },
    );
  }
  if (authorization.status === "rpc-unavailable") {
    return jsonResponse(
      req,
      { error: "Solana verification RPC is unavailable", retryable: true },
      503,
      { "retry-after": "2" },
    );
  }
  if (authorization.status === "rejected") {
    return jsonResponse(
      req,
      {
        error: "Finalized Solana place-order verification failed",
        ...(!IS_PRODUCTION && authorization.verificationCode
          ? {
              verificationCode: authorization.verificationCode,
              verificationRpc: solanaCtx
                ? sanitizeUrlForStatus(solanaCtx.connection.rpcEndpoint)
                : null,
              verificationIndex: externalBetIndexDiagnostics(txSignature),
            }
          : {}),
      },
      401,
    );
  }
  const verifiedExternalBet =
    authorization.status === "verified" ? authorization.record : null;

  const sourceAmountLamports = verifiedExternalBet
    ? verifiedExternalBet.sourceAmountLamports
    : normalizeLamports(payload.sourceAmountLamports);
  if (!sourceAmountLamports || sourceAmountLamports === "0") {
    return jsonResponse(
      req,
      { error: "sourceAmountLamports must be a positive integer" },
      400,
    );
  }
  const feeAmountLamports = verifiedExternalBet
    ? verifiedExternalBet.feeAmountLamports
    : (normalizeLamports(payload.feeAmountLamports) ?? "0");
  const feeBps = verifiedExternalBet
    ? Math.max(0, verifiedExternalBet.feeBps)
    : Math.max(0, parseNumberInput(payload.feeBps, 0));
  const recordedAt = Date.now();

  const normalizedWallet = rememberWalletCase(walletRaw);
  const pointsAwarded = pointsForLamports(
    verifiedExternalBet?.accounting.rewardEligibleLamports ??
      sourceAmountLamports,
  );
  const canonicalTxSignature = verifiedExternalBet?.txSignature ?? txSignature;
  const canonicalMarketRef = verifiedExternalBet?.marketRef ?? marketRefRaw;
  const canonicalDuelKey = verifiedExternalBet?.duelKey ?? duelKeyRaw;
  const canonicalExternalBetRef = allowPrivilegedBypass
    ? payload.externalBetRef
      ? String(payload.externalBetRef)
      : canonicalTxSignature
        ? `solana:${canonicalTxSignature}`
        : null
    : canonicalTxSignature
      ? `solana:${canonicalTxSignature}`
      : null;
  const record: BetRecord = {
    id: `${recordedAt}-${Math.random().toString(36).slice(2, 10)}`,
    bettorWallet: displayWallet(normalizedWallet),
    chain: toRecordedBetChain("solana"),
    sourceAsset: "SOL",
    sourceAmountLamports,
    feeAmountLamports,
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
  const inserted = saveBet(
    record,
    verifiedExternalBet
      ? { ...verifiedExternalBet.accounting, verifiedAt: recordedAt }
      : null,
  );
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
  if (referrer && referrer.wallet !== normalizedWallet && pointsAwarded > 0) {
    const referrerPoints = ensureWalletPoints(referrer.wallet);
    const referralPointsAwarded = referralPointsForBetPoints(pointsAwarded);
    referrerPoints.referralPoints += referralPointsAwarded;
    saveWalletPoints(referrer.wallet, referrerPoints);

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
    execution: verifiedExternalBet?.accounting ?? null,
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
        alreadyRedeemed: true,
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
      alreadyRedeemed: false,
      signupBonus,
    },
  });
}

function inviteSummary(
  walletRaw: string,
  platformView: string,
): Record<string, unknown> {
  const wallet = rememberWalletCase(walletRaw);
  const code = inviteCodeForWallet(wallet);
  const invited = invitedWalletsByWallet.get(wallet) ?? new Set<string>();
  const aggregate = aggregatePoints([wallet]);
  const referredBy = getReferralOwner(wallet);
  const invitedWallets = [...invited].map((entry) => displayWallet(entry));
  const totalReferralWinPoints = pointsEvents
    .filter(
      (entry) => entry.wallet === wallet && entry.eventType === "REFERRAL_WIN",
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
  if (rpcBody.ok === false) {
    return rpcBody.response;
  }
  const unsupportedMethod = findUnsupportedJsonRpcMethod(
    rpcBody.requests,
    PUBLIC_SOLANA_RPC_READ_METHODS,
  );
  if (unsupportedMethod) {
    return jsonResponse(
      req,
      {
        error: `JSON-RPC method ${unsupportedMethod} is not allowed on the public Solana RPC proxy`,
      },
      403,
    );
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
    return jsonResponse(req, { error: "Helius Sender is not configured" }, 503);
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse(req, { error: "Invalid JSON body" }, 400);
  }

  const transaction =
    typeof payload.transaction === "string" ? payload.transaction.trim() : "";
  if (!transaction) {
    return jsonResponse(req, { error: "transaction is required" }, 400);
  }

  const authorizedByKey = hasPrivilegedWriteAuth(req);
  const trustedOrigin = isAllowedAppOrigin(req.headers.get("origin"));

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

    const signature = typeof raw.result === "string" ? raw.result : null;
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
    const isWriteRoute = isWriteRateLimitedRoute(req.method, url.pathname);
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

    if (
      req.method === "GET" &&
      (url.pathname === "/health" || url.pathname === "/ready")
    ) {
      const botHealthSnapshot = resolveKeeperBotHealthSnapshot(
        loadKeeperBotHealthSnapshot(),
      );
      const readiness = resolveServiceReadiness(botHealthSnapshot);
      return jsonResponse(
        req,
        {
          ok: readiness.ready,
          service: "hyperbet-solana-backend",
          now: Date.now(),
          readiness,
        },
        readiness.ready ? 200 : 503,
        { "cache-control": "no-store" },
      );
    }

    if (url.pathname === "/status") {
      const predictionMarkets = buildPredictionMarketLifecycleRecords();
      const botHealthSnapshotRaw = resolveKeeperBotHealthSnapshot(
        loadKeeperBotHealthSnapshot(),
      );
      const botHealthSnapshot = botHealthSnapshotRaw;
      const readiness = resolveServiceReadiness(botHealthSnapshot);
      const marketStatuses = mergePredictionMarketsWithHealth(
        predictionMarkets,
        botHealthSnapshot,
      );
      return jsonResponse(req, {
        ok: readiness.ready,
        service: "hyperbet-solana-backend",
        now: Date.now(),
        readiness,
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
          sourceEventsEnabled:
            Boolean(STREAM_STATE_SOURCE_URL) &&
            STREAM_STATE_SOURCE_EVENTS_ENABLED,
          sourceEventsUrl:
            STREAM_STATE_SOURCE_URL && STREAM_STATE_SOURCE_EVENTS_ENABLED
              ? sanitizeUrlForStatus(
                  resolveStreamStateEventsUrl(
                    STREAM_STATE_SOURCE_URL,
                    null,
                  ).toString(),
                )
              : null,
          sourceEventsConnected: streamSourceEventsConnected,
          sourceEventsLastEventAt: streamSourceEventsLastEventAt,
          sourceEventsLastEventId: streamSourceEventsLastEventId,
          sourceEventsLastError: streamSourceEventsLastError,
          publishEnabled: STREAM_STATE_PUBLISH_ENABLED,
          sseClients: connectedSseCount(),
        },
        parsers,
        proxies: {
          solanaRpc: Boolean(SOLANA_RPC_PROXY_URL),
          solanaSender: Boolean(SOLANA_SENDER_PROXY_URL),
        },
        bot: {
          supervision: "external",
          running: Boolean(botHealthSnapshot?.running),
          health: botHealthSnapshot,
        },
        stats: {
          trackedBets: bets.length,
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
        "hyperbet-solana backend online\n\nUse /health for readiness and /status for diagnostics.",
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
      const botHealthSnapshotRaw = resolveKeeperBotHealthSnapshot(
        loadKeeperBotHealthSnapshot(),
      );
      const readiness = resolveServiceReadiness(botHealthSnapshotRaw);
      return jsonResponse(
        req,
        {
          ok: readiness.ready,
          supervision: "external",
          running: Boolean(botHealthSnapshotRaw?.running),
          readiness,
          health: botHealthSnapshotRaw,
        },
        readiness.ready ? 200 : 503,
        { "cache-control": "no-store" },
      );
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
      if (!STREAM_STATE_PUBLISH_ENABLED) {
        return jsonResponse(req, { error: "Not Found" }, 404);
      }
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
        readPointsWindow(url.searchParams.get("window")),
      );
      return jsonResponse(req, {
        ...payload,
        limit,
        offset,
      });
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

    const settlementWalletMatch = url.pathname.match(
      /^\/api\/arena\/settlements\/([^/]+)$/,
    );
    if (req.method === "GET" && settlementWalletMatch) {
      const walletPath = decodeURIComponent(settlementWalletMatch[1] ?? "");
      return handleSolanaSettlementHistory(req, url, walletPath);
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

    const pointsWalletMatch = url.pathname.match(
      /^\/api\/arena\/points\/([^/]+)$/,
    );
    if (req.method === "GET" && pointsWalletMatch) {
      const wallet = normalizePointsWalletInput(
        decodeURIComponent(pointsWalletMatch[1] ?? ""),
      );
      if (!wallet) {
        return jsonResponse(req, { error: "Wallet is required" }, 400);
      }
      return jsonResponse(req, pointsForWalletResponse(wallet));
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

    if (req.method === "POST" && url.pathname === "/api/proxy/solana/rpc") {
      return handleSolanaRpcProxy(req);
    }

    if (req.method === "POST" && url.pathname === "/api/proxy/solana/sender") {
      return handleSolanaSenderProxy(req);
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
  if (STREAM_STATE_SOURCE_EVENTS_ENABLED) {
    console.log(
      `[${nowIso()}] [stream] connecting source events ${resolveStreamStateEventsUrl(STREAM_STATE_SOURCE_URL, null)}`,
    );
    void runStreamStateSourceEvents();
  }
}

if (STREAM_STATE_HEARTBEAT_MS > 0) {
  console.log(
    `[${nowIso()}] [stream] test heartbeat enabled every ${STREAM_STATE_HEARTBEAT_MS}ms`,
  );
  setInterval(() => {
    publishStreamState(streamState, "heartbeat");
  }, STREAM_STATE_HEARTBEAT_MS);
}

setInterval(() => {
  void pollContractParsers();
}, CONTRACT_POLL_MS);
void pollContractParsers();

process.on("SIGINT", () => {
  server.stop(true);
  process.exit(0);
});

process.on("SIGTERM", () => {
  server.stop(true);
  process.exit(0);
});

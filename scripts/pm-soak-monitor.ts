import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import BN from "bn.js";
import * as solanaWeb3 from "@solana/web3.js";
import * as viem from "viem";
import * as viemAccounts from "viem/accounts";

import { resolveBettingEvmDeploymentForChain } from "../packages/hyperbet-chain-registry/src/index";
import {
  createPrograms,
  duelKeyHexToBytes,
  FIGHT_ORACLE_PROGRAM_ID,
  findClobVaultPda,
  findDuelStatePda,
  findMarketConfigPda,
  findOrderPda,
  findPriceLevelPda,
  findUserBalancePda,
  ORDER_BEHAVIOR_IOC,
  readKeypair,
  SIDE_ASK,
  SIDE_BID,
} from "../packages/hyperbet-solana/keeper/src/common";
import { GOLD_CLOB_ABI } from "../packages/hyperbet-ui/src/lib/goldClobAbi";
import { resolveArtifactRoot, rootDir, writeJsonArtifact } from "./ci-lib";

const { PublicKey, SystemProgram } = solanaWeb3;
const { createPublicClient, createWalletClient, http } = viem;
const { privateKeyToAccount } = viemAccounts;
type SolanaPublicKey = InstanceType<typeof PublicKey>;

type AccountMeta = solanaWeb3.AccountMeta;
type Address = `0x${string}`;
type Hash = `0x${string}`;

const BUY_SIDE = 1;
const SELL_SIDE = 2;
const MARKET_KIND_DUEL_WINNER = 0;
const ORDER_FLAG_IOC = 0x02;
const LOCAL_MIN_DUEL_CYCLE_MS = 60_000;
const LOCAL_MAX_DUEL_CYCLE_MS = 240_000;
const OPEN_LAG_BUDGET_MS = 15_000;
const QUOTE_LAG_BUDGET_MS = 20_000;
const LOCK_LAG_BUDGET_MS = 10_000;
const PROPOSAL_LAG_BUDGET_MS = 60_000;
const MAX_MATCH_ACCOUNTS = 16;
const DEFAULT_EVM_CANARY_AMOUNT = 1_000n;
const DEFAULT_SOLANA_CANARY_LAMPORTS = 1_000_000n;
const DEFAULT_POLL_MS = 5_000;
const DEFAULT_STAGED_DURATION_MIN = 120;
const DEFAULT_LOCAL_DURATION_MIN = 25;

type MonitorMode = "local" | "staged";
type RunScope = "LOCALNET" | "LIVE_INDICATOR" | "LIVE_CANARY";
type SupportedChain = "solana" | "bsc" | "avax";
type CanaryIntent = "YES" | "NO";

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

type BuildInfo = {
  commitHash?: string | null;
  builtAt?: string | null;
  [key: string]: JsonValue | undefined;
};

type StreamState = {
  cycle?: {
    cycleId?: string | null;
    phase?: string | null;
    duelId?: string | null;
    duelKey?: string | null;
    duelKeyHex?: string | null;
    phaseStartTime?: number | null;
    phaseEndTime?: number | null;
    betCloseTime?: number | null;
  };
  duel?: {
    duelId?: string | null;
    duelKey?: string | null;
    phase?: string | null;
  };
  [key: string]: JsonValue | undefined;
};

type KeeperMarketHealth = {
  chainKey?: string | null;
  duelId?: string | null;
  duelKey?: string | null;
  marketRef?: string | null;
  lifecycleStatus?: string | null;
  winner?: string | null;
  bidPrice?: number | null;
  askPrice?: number | null;
  bidUnits?: number | null;
  askUnits?: number | null;
  openOrderCount?: number | null;
  quoteAgeMs?: number | null;
  circuitBreakerReason?: string | null;
  recovery?: string[] | null;
  [key: string]: JsonValue | undefined;
};

type ActiveMarketRecord = {
  chainKey: string;
  marketRef: string | null;
  lifecycleStatus: string;
  winner?: string | null;
  contractAddress?: string | null;
  programId?: string | null;
  metadata?: Record<string, unknown> | null;
  health?: KeeperMarketHealth | null;
};

type PredictionMarketsResponse = {
  duel: {
    duelKey: string | null;
    duelId: string | null;
    phase?: string | null;
    winner?: string | null;
    betCloseTime: number | null;
  };
  markets: ActiveMarketRecord[];
  updatedAt?: number | null;
};

type PredictionMarketsOverviewResponse = {
  live: PredictionMarketsResponse | null;
  recentSettlement: PredictionMarketsResponse | null;
  updatedAt?: number | null;
};

type PerpsEvidence = {
  markets: JsonValue | null;
  oracleHistory: JsonValue | null;
};

type SyncStatusResponse = {
  sourceEpoch?: number | null;
  sourceLatestSeq?: number | null;
  lastSeenSeq?: number | null;
  lastAppliedSeq?: number | null;
  applyLagMs?: number | null;
  sourceEventAgeMs?: number | null;
  replayMode?: string | null;
  degradedReason?: string | null;
  rendererHealth?: RendererHealth | null;
  rendererHealthAgeMs?: number | null;
  lastEventReceivedAt?: number | null;
  lastAppliedAt?: number | null;
  connectedAt?: number | null;
  enabled?: boolean | null;
};

type RendererHealth = {
  ready?: boolean | null;
  degradedReason?: string | null;
  updatedAt?: number | null;
  phase?: string | null;
};

type BetSyncSourceEvent = {
  sourceEpoch?: number | null;
  seq?: number | null;
  duelId?: string | null;
  duelKey?: string | null;
  phase?: string | null;
  rendererHealth?: RendererHealth | null;
};

type BetSyncBootstrapStateResponse = {
  sourceEpoch?: number | null;
  seq?: number | null;
  latestSeq?: number | null;
  oldestReplaySeq?: number | null;
  duelId?: string | null;
  duelKey?: string | null;
  phase?: string | null;
  rendererHealth?: RendererHealth | null;
  latestEvent?: BetSyncSourceEvent | null;
  replay?: {
    sourceEpoch?: number | null;
    latestSeq?: number | null;
    oldestSeq?: number | null;
  } | null;
};

type SourceRtmpStatusResponse = {
  updatedAt?: number | null;
  rendererHealth?: RendererHealth | null;
};

type KeeperStatusResponse = {
  ok?: boolean;
  bot?: {
    enabled?: boolean;
    running?: boolean;
    lastExitCode?: number | null;
    lastExitAt?: number | null;
    health?: {
      updatedAtMs?: number | null;
      markets?: KeeperMarketHealth[] | null;
    } | null;
  };
  predictionMarkets?: {
    activeDuelKey?: string | null;
    marketCount?: number | null;
    botHealthUpdatedAt?: number | null;
    chains?: Array<{
      chainKey: string;
      marketRef: string | null;
      lifecycleStatus: string;
      winner?: string | null;
      betCloseTime?: number | null;
      metadata?: Record<string, unknown> | null;
      health?: KeeperMarketHealth | null;
    }> | null;
  };
  proxies?: Record<string, boolean> | null;
  parsers?: Record<string, boolean> | null;
  [key: string]: unknown;
};

type BotHealthResponse = {
  ok?: boolean;
  running?: boolean;
  health?: {
    updatedAtMs?: number | null;
    markets?: KeeperMarketHealth[] | null;
  } | null;
};

type ScreenshotTarget = {
  name: string;
  url: string;
  selector?: string;
  fullPage?: boolean;
  pageKey?: string;
};

type BrowserLaunchCandidate = {
  channel?: string;
  args?: string[];
};

type SelectorClip = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type EmbeddedFrameMeta = {
  href: string;
  title: string;
  bodyPreview: string;
  streamReady: JsonValue;
  rendererHealth: JsonValue;
  canvasCount: number;
};

type ScreenshotCaptureResult = {
  target: string;
  filePath: string;
  meta: Record<string, JsonValue>;
};

type ScreenshotRuntimeModule = {
  chromium: {
    launch(options?: Record<string, unknown>): Promise<{
      newContext(options?: Record<string, unknown>): Promise<{
        newPage(): Promise<{
          goto(
            url: string,
            options?: Record<string, unknown>,
          ): Promise<unknown>;
          url(): string;
          waitForLoadState(
            state?: string,
            options?: Record<string, unknown>,
          ): Promise<unknown>;
          waitForTimeout(timeout: number): Promise<unknown>;
          screenshot(options: Record<string, unknown>): Promise<unknown>;
          evaluate<T>(callback: () => T): Promise<T>;
          isClosed?(): boolean;
          close(options?: Record<string, unknown>): Promise<unknown>;
        }>;
        close(options?: Record<string, unknown>): Promise<unknown>;
      }>;
      close(options?: Record<string, unknown>): Promise<unknown>;
    }>;
  };
  devices?: Record<string, Record<string, unknown>>;
};

type ScreenshotSession = {
  browser: Awaited<ReturnType<ScreenshotRuntimeModule["chromium"]["launch"]>>;
  context: Awaited<
    ReturnType<
      Awaited<ReturnType<ScreenshotRuntimeModule["chromium"]["launch"]>>["newContext"]
    >
  >;
  pages: Map<
    string,
    Awaited<
      ReturnType<
        Awaited<
          ReturnType<
            Awaited<ReturnType<ScreenshotRuntimeModule["chromium"]["launch"]>>["newContext"]
          >
        >["newPage"]
      >
    >
  >;
};

type Incident = {
  at: string;
  mode: MonitorMode;
  chain: SupportedChain | "local";
  code: string;
  message: string;
  detailPath: string;
};

type LocalCycleRecord = {
  cycleId: string;
  duelKey: string;
  duelId: string | null;
  startedAtMs: number;
  endedAtMs: number | null;
  durationMs: number | null;
  phases: string[];
  marketCountMax: number;
  incidents: string[];
};

type TradeRecord = {
  intent: CanaryIntent;
  attemptedAtMs: number;
  amount: string;
  side: number;
  price: number;
  txRef: string | null;
  matched: boolean;
  claimAttemptedAtMs: number | null;
  claimTxRef: string | null;
  syncTxRef: string | null;
  clearedAtMs: number | null;
  residual: Record<string, string> | null;
};

type ChainCycleRecord = {
  cycleIndex: number;
  duelKey: string;
  duelId: string | null;
  startedAtMs: number;
  betCloseTimeMs: number | null;
  resolutionAtMs: number | null;
  openAtMs: number | null;
  quotesAtMs: number | null;
  lockAtMs: number | null;
  proposalAtMs: number | null;
  terminalAtMs: number | null;
  trade: TradeRecord | null;
  incidents: string[];
};

type ChainSnapshot = {
  chain: SupportedChain | "local";
  buildInfo: BuildInfo | null;
  status: KeeperStatusResponse | null;
  active: PredictionMarketsResponse | null;
  overview: PredictionMarketsOverviewResponse | null;
  syncStatus: SyncStatusResponse | null;
  sourceBetSyncState: BetSyncBootstrapStateResponse | null;
  sourceRtmpStatus: SourceRtmpStatusResponse | null;
  botHealth: BotHealthResponse | null;
  streamState: StreamState | null;
  perps: PerpsEvidence;
  fetchedAtMs: number;
};

type LocalSummary = {
  mode: "local";
  startedAt: string;
  completedAt: string;
  durationMs: number;
  pollMs: number;
  artifactRoot: string;
  runScope: RunScope;
  follow: boolean;
  cyclesObserved: number;
  scoredCyclesObserved: number;
  ignoredCyclesObserved: number;
  driftCyclesObserved: number;
  cycleDurationsMs: number[];
  bothUiReachable: boolean;
  streamDuelKey: string | null;
  activeDuelKey: string | null;
  recentSettlementDuelKey: string | null;
  driftPolls: number;
  reconcileAttempts: number;
  incidents: Incident[];
  pass: boolean;
};

type StagedChainSummary = {
  cyclesObserved: number;
  openLagMs: number[];
  quoteLagMs: number[];
  lockLagMs: number[];
  proposalLagMs: number[];
  finalizedCycles: number;
  claimClears: number;
  tradeAttempts: number;
  tradeMatches: number;
  incidents: number;
};

type StagedSummary = {
  mode: "staged";
  startedAt: string;
  completedAt: string;
  durationMs: number;
  pollMs: number;
  artifactRoot: string;
  runScope: RunScope;
  chains: SupportedChain[];
  incidents: Incident[];
  chainSummary: Record<SupportedChain, StagedChainSummary>;
  pass: boolean;
};

type MonitorArgs = {
  mode: MonitorMode;
  runScope: RunScope;
  chains: SupportedChain[];
  durationMin: number;
  pollMs: number;
  artifactRoot: string;
  follow: boolean;
};

type LocalContext = {
  mode: "local";
  artifactRoot: string;
  screenshotsEnabled: boolean;
  screenshotTargets: ScreenshotTarget[];
  incidents: Incident[];
  captureIndex: number;
  streamDuelKey: string | null;
  activeDuelKey: string | null;
  recentSettlementDuelKey: string | null;
  driftPolls: number;
  reconcileAttempts: number;
};

type StagedContext = {
  mode: "staged";
  artifactRoot: string;
  screenshotsEnabled: boolean;
  incidents: Incident[];
  captureIndex: number;
  milestoneScreenshots: Set<string>;
  canaryTradesEnabled: boolean;
  chainScreenshots: Record<SupportedChain, ScreenshotTarget | null>;
};

function parseArgs(): MonitorArgs {
  const rawArgs = process.argv.slice(2);
  const mode = getArg(rawArgs, "--mode", "local");
  if (mode !== "local" && mode !== "staged") {
    throw new Error(`unsupported soak mode ${mode}`);
  }
  const runScope = resolveRunScope(rawArgs, mode);
  const follow = getBooleanArg(rawArgs, "--follow", false);

  const chainsArg = getArg(rawArgs, "--chains", "solana,bsc,avax");
  const chains = chainsArg
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      if (value !== "solana" && value !== "bsc" && value !== "avax") {
        throw new Error(`unsupported chain ${value}`);
      }
      return value;
    });

  const durationMin = Number.parseInt(
    getArg(
      rawArgs,
      "--duration-min",
      String(
        mode === "local"
          ? DEFAULT_LOCAL_DURATION_MIN
          : DEFAULT_STAGED_DURATION_MIN,
      ),
    ),
    10,
  );
  if (!Number.isFinite(durationMin) || durationMin <= 0) {
    throw new Error(`invalid --duration-min ${durationMin}`);
  }

  const pollMs = Number.parseInt(
    getArg(rawArgs, "--poll-ms", String(DEFAULT_POLL_MS)),
    10,
  );
  if (!Number.isFinite(pollMs) || pollMs <= 0) {
    throw new Error(`invalid --poll-ms ${pollMs}`);
  }

  const artifactsDirArg = getArg(rawArgs, "--artifacts-dir", "");
  const artifactRoot =
    artifactsDirArg.trim().length > 0
      ? resolvePath(artifactsDirArg)
      : mode === "local"
        ? path.join(
            rootDir,
            "output",
            "playwright",
            "pm-soak",
            new Date().toISOString().replace(/[:.]/g, "-"),
          )
        : resolveArtifactRoot("pm-soak");

  mkdirSync(artifactRoot, { recursive: true });

  return {
    mode,
    runScope,
    chains,
    durationMin,
    pollMs,
    artifactRoot,
    follow,
  };
}

function getArg(args: string[], name: string, fallback: string): string {
  const prefix = `${name}=`;
  return (
    args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? fallback
  );
}

function getBooleanArg(
  args: string[],
  name: string,
  fallback: boolean,
): boolean {
  const prefix = `${name}=`;
  const match = args.find((arg) => arg === name || arg.startsWith(prefix));
  if (!match) {
    return fallback;
  }
  if (match === name) {
    return true;
  }
  const raw = match.slice(prefix.length).trim().toLowerCase();
  if (!raw) {
    return true;
  }
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function getOptionalArg(args: string[], name: string): string | null {
  const prefix = `${name}=`;
  const match = args.find((entry) => entry.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : null;
}

function resolveRunScope(
  args: string[],
  mode: MonitorMode,
): RunScope {
  const explicit = getOptionalArg(args, "--run-scope");
  const envScope = process.env.RUN_SCOPE?.trim();
  const rawScope = (
    explicit ??
    envScope ??
    (mode === "local" ? "LOCALNET" : "LIVE_INDICATOR")
  ).toUpperCase();
  if (
    rawScope !== "LOCALNET" &&
    rawScope !== "LIVE_INDICATOR" &&
    rawScope !== "LIVE_CANARY"
  ) {
    throw new Error(
      `unsupported run scope ${rawScope}; expected LOCALNET, LIVE_INDICATOR, or LIVE_CANARY`,
    );
  }

  if (mode === "local" && rawScope !== "LOCALNET") {
    throw new Error(`local soak mode requires run scope LOCALNET (got ${rawScope})`);
  }
  if (mode === "staged" && rawScope === "LOCALNET") {
    throw new Error(`staged soak mode does not support run scope LOCALNET (got ${rawScope})`);
  }

  return rawScope as RunScope;
}

function resolvePath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(rootDir, value);
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (!value) {
    throw new Error(`Missing required env ${name}`);
  }
  return value;
}

function optionalEnv(name: string): string | null {
  const value = process.env[name]?.trim() ?? "";
  return value || null;
}

function normalizeDuelKey(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return null;
  }
  return trimmed.toLowerCase().replace(/^0x/, "");
}

function duelKeysAligned(
  streamDuelKey: string | null,
  activeDuelKey: string | null,
): boolean {
  return normalizeDuelKey(streamDuelKey) === normalizeDuelKey(activeDuelKey);
}

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/$/, "");
}

function quoteCost(side: number, price: number, amount: bigint): bigint {
  const component = BigInt(side === BUY_SIDE ? price : 1000 - price);
  return (amount * component) / 1000n;
}

function quoteOrderValue(side: number, price: number, amount: bigint): bigint {
  const cost = quoteCost(side, price, amount);
  const fee = (cost * 200n) / 10_000n;
  return cost + fee + 20n;
}

function nowIso(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("accept")) {
    headers.set("accept", "application/json");
  }
  const response = await fetch(url, {
    ...init,
    headers,
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${raw}`);
  }
  return JSON.parse(raw) as T;
}

async function requestJsonOrNull<T>(
  url: string,
  init: RequestInit = {},
): Promise<T | null> {
  try {
    return await requestJson<T>(url, init);
  } catch {
    return null;
  }
}

function currentCycleId(
  streamState: StreamState | null,
  active: PredictionMarketsResponse | null,
): string {
  return (
    streamState?.cycle?.cycleId ||
    streamState?.cycle?.duelKeyHex ||
    streamState?.cycle?.duelKey ||
    active?.duel?.duelKey ||
    active?.duel?.duelId ||
    "unknown"
  );
}

function currentDuelKey(
  streamState: StreamState | null,
  active: PredictionMarketsResponse | null,
): string {
  return (
    streamState?.cycle?.duelKeyHex ||
    streamState?.cycle?.duelKey ||
    streamState?.duel?.duelKey ||
    active?.duel?.duelKey ||
    active?.duel?.duelId ||
    "unknown"
  );
}

function currentStreamDuelKey(streamState: StreamState | null): string | null {
  return normalizeDuelKey(
    streamState?.cycle?.duelKeyHex ||
      streamState?.cycle?.duelKey ||
      streamState?.duel?.duelKey ||
      null,
  );
}

function currentSourceBetSyncDuelKey(
  sourceBetSyncState: BetSyncBootstrapStateResponse | null,
): string | null {
  return normalizeDuelKey(
    sourceBetSyncState?.latestEvent?.duelKey ?? sourceBetSyncState?.duelKey ?? null,
  );
}

function currentActiveDuelKey(
  active: PredictionMarketsResponse | null,
): string | null {
  return normalizeDuelKey(active?.duel?.duelKey ?? null);
}

function currentOverviewLiveDuelKey(
  overview: PredictionMarketsOverviewResponse | null,
): string | null {
  return normalizeDuelKey(overview?.live?.duel?.duelKey ?? null);
}

function currentOverviewRecentSettlementDuelKey(
  overview: PredictionMarketsOverviewResponse | null,
): string | null {
  return normalizeDuelKey(overview?.recentSettlement?.duel?.duelKey ?? null);
}

function currentRendererHealth(
  snapshot: ChainSnapshot | null,
): RendererHealth | null {
  return (
    snapshot?.sourceBetSyncState?.latestEvent?.rendererHealth ??
    snapshot?.sourceBetSyncState?.rendererHealth ??
    snapshot?.syncStatus?.rendererHealth ??
    snapshot?.sourceRtmpStatus?.rendererHealth ??
    null
  );
}

function currentSourceEpoch(snapshot: ChainSnapshot | null): number | null {
  return (
    snapshot?.sourceBetSyncState?.latestEvent?.sourceEpoch ??
    snapshot?.sourceBetSyncState?.sourceEpoch ??
    snapshot?.syncStatus?.sourceEpoch ??
    null
  );
}

function currentSourceSeq(snapshot: ChainSnapshot | null): number | null {
  return (
    snapshot?.sourceBetSyncState?.latestEvent?.seq ??
    snapshot?.sourceBetSyncState?.seq ??
    snapshot?.sourceBetSyncState?.latestSeq ??
    snapshot?.syncStatus?.sourceLatestSeq ??
    null
  );
}

function currentSourceBetSyncPhase(
  sourceBetSyncState: BetSyncBootstrapStateResponse | null,
): string | null {
  const phase =
    sourceBetSyncState?.latestEvent?.phase ?? sourceBetSyncState?.phase ?? null;
  return typeof phase === "string" && phase.trim().length > 0 ? phase : null;
}

function buildAuthHeadersFromEnv(token: string | null): HeadersInit | undefined {
  if (!token) return undefined;
  return {
    authorization: `Bearer ${token}`,
  };
}

function currentPhase(
  streamState: StreamState | null,
  active: PredictionMarketsResponse | null,
): string {
  return (
    streamState?.cycle?.phase ||
    streamState?.duel?.phase ||
    active?.duel?.phase ||
    "UNKNOWN"
  );
}

function terminalLifecycle(status: string | null | undefined): boolean {
  return status === "RESOLVED" || status === "CANCELLED";
}

function isScoreableLocalCycle(cycle: CycleRecord): boolean {
  if (cycle.durationMs == null || !Number.isFinite(cycle.durationMs)) {
    return false;
  }
  if (cycle.phases.includes("IDLE")) {
    return false;
  }
  return (
    cycle.phases.includes("RESOLUTION") || cycle.phases.includes("TERMINAL")
  );
}

function proposalLifecycle(status: string | null | undefined): boolean {
  return (
    status === "PROPOSED" ||
    status === "CHALLENGED" ||
    terminalLifecycle(status)
  );
}

function hasTwoSidedQuotes(
  health: KeeperMarketHealth | null | undefined,
): boolean {
  return (
    (health?.bidPrice ?? null) != null &&
    (health?.askPrice ?? null) != null &&
    Number(health?.bidPrice ?? 0) > 0 &&
    Number(health?.askPrice ?? 1000) < 1000 &&
    Number(health?.bidUnits ?? 0) > 0 &&
    Number(health?.askUnits ?? 0) > 0
  );
}

function hasAnyQuote(health: KeeperMarketHealth | null | undefined): boolean {
  return (
    ((health?.bidPrice ?? null) != null && Number(health?.bidUnits ?? 0) > 0) ||
    ((health?.askPrice ?? null) != null && Number(health?.askUnits ?? 0) > 0)
  );
}

let screenshotRuntimePromise: Promise<ScreenshotRuntimeModule> | null = null;
let screenshotSessionPromise: Promise<ScreenshotSession> | null = null;

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim() ?? "";
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) {
    return fallback;
  }
  if (["1", "true", "yes", "on"].includes(raw)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(raw)) {
    return false;
  }
  return fallback;
}

function parseLaunchArgs(value: string | undefined): string[] | undefined {
  const args = value
    ?.split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return args && args.length > 0 ? args : undefined;
}

function buildBrowserLaunchCandidates(
  browserChannel: string | undefined,
  launchArgs: string[] | undefined,
): BrowserLaunchCandidate[] {
  const dedupe = new Set<string>();
  const candidates: BrowserLaunchCandidate[] = [];
  const push = (candidate: BrowserLaunchCandidate) => {
    const key = JSON.stringify({
      channel: candidate.channel ?? null,
      args: candidate.args ?? [],
    });
    if (dedupe.has(key)) {
      return;
    }
    dedupe.add(key);
    candidates.push(candidate);
  };

  push({ channel: browserChannel, args: launchArgs });
  if (browserChannel) {
    push({ args: launchArgs });
  }
  if (launchArgs && launchArgs.length > 0) {
    push({ channel: browserChannel });
    if (browserChannel) {
      push({});
    }
  }
  return candidates;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function screenshotActionTimeoutMs(): number {
  return parsePositiveIntEnv("PM_SOAK_SCREENSHOT_ACTION_TIMEOUT_MS", 15_000);
}

function screenshotCloseTimeoutMs(): number {
  return parsePositiveIntEnv("PM_SOAK_SCREENSHOT_CLOSE_TIMEOUT_MS", 5_000);
}

function resolvePlaywrightModuleUrl(): string {
  const bunModulesDir = path.join(rootDir, "node_modules", ".bun");
  const playwrightEntry = readdirSync(bunModulesDir).find((entry) =>
    entry.startsWith("playwright@"),
  );
  if (!playwrightEntry) {
    throw new Error(
      `could not locate playwright runtime under ${bunModulesDir}`,
    );
  }
  return pathToFileURL(
    path.join(
      bunModulesDir,
      playwrightEntry,
      "node_modules",
      "playwright",
      "index.mjs",
    ),
  ).href;
}

async function loadScreenshotRuntime(): Promise<ScreenshotRuntimeModule> {
  screenshotRuntimePromise ??= import(
    resolvePlaywrightModuleUrl()
  ) as Promise<ScreenshotRuntimeModule>;
  return screenshotRuntimePromise;
}

async function getScreenshotSession(): Promise<ScreenshotSession> {
  screenshotSessionPromise ??= (async () => {
    const runtime = await loadScreenshotRuntime();
    const device = runtime.devices?.["Desktop Chrome"] ?? {};
    const viewportWidth = parsePositiveIntEnv("PM_SOAK_SCREENSHOT_WIDTH", 1280);
    const viewportHeight = parsePositiveIntEnv("PM_SOAK_SCREENSHOT_HEIGHT", 720);
    const headless = parseBooleanEnv("PM_SOAK_HEADLESS", true);
    const browserChannel = process.env.PM_SOAK_BROWSER_CHANNEL?.trim() || undefined;
    const launchArgs = parseLaunchArgs(process.env.PM_SOAK_WEBGPU_ARGS);
    const launchCandidates = buildBrowserLaunchCandidates(
      browserChannel,
      launchArgs,
    );
    let browser: Awaited<
      ReturnType<ScreenshotRuntimeModule["chromium"]["launch"]>
    > | null = null;
    const launchErrors: string[] = [];
    for (const candidate of launchCandidates) {
      try {
        browser = await withTimeout(
          runtime.chromium.launch({
            headless,
            channel: candidate.channel,
            args: candidate.args,
            timeout: 20_000,
          }),
          20_000,
          `screenshot browser launch (${candidate.channel ?? "chromium"})`,
        );
        break;
      } catch (error) {
        launchErrors.push(
          `${candidate.channel ?? "chromium"}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    if (!browser) {
      throw new Error(
        `unable to launch screenshot browser: ${launchErrors.join(" | ")}`,
      );
    }
    const context = await browser.newContext({
      ...device,
      viewport: {
        width: viewportWidth,
        height: viewportHeight,
      },
      ignoreHTTPSErrors: true,
    });
    return {
      browser,
      context,
      pages: new Map(),
    };
  })().catch((error) => {
    screenshotSessionPromise = null;
    throw error;
  });
  return screenshotSessionPromise;
}

function normalizeScreenshotUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.searchParams.delete("streamToken");
    url.searchParams.delete("sessionToken");
    return url.toString();
  } catch {
    return rawUrl;
  }
}

async function resetScreenshotPage(target: ScreenshotTarget): Promise<void> {
  if (!screenshotSessionPromise) {
    return;
  }
  const session = await screenshotSessionPromise.catch(() => null);
  if (!session) {
    screenshotSessionPromise = null;
    screenshotRuntimePromise = null;
    return;
  }
  const pageKey = target.pageKey ?? target.name;
  const page = session.pages.get(pageKey);
  session.pages.delete(pageKey);
  if (!page || page.isClosed?.() === true) {
    return;
  }
  await withTimeout(
    page.close({ runBeforeUnload: true }).catch(() => undefined),
    screenshotCloseTimeoutMs(),
    `screenshot page reset (${target.name})`,
  ).catch(() => undefined);
}

async function getScreenshotPage(
  target: ScreenshotTarget,
): Promise<ScreenshotSession["pages"] extends Map<string, infer T> ? T : never> {
  const session = await getScreenshotSession();
  const timeoutMs = screenshotActionTimeoutMs();
  const pageKey = target.pageKey ?? target.name;
  const existing = session.pages.get(pageKey);
  const targetUrl = normalizeScreenshotUrl(target.url);
  if (existing && existing.isClosed?.() !== true) {
    if (normalizeScreenshotUrl(existing.url()) !== targetUrl) {
      await withTimeout(
        existing.goto(target.url, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        }),
        timeoutMs,
        `screenshot goto (${target.name})`,
      );
      await withTimeout(
        existing.waitForTimeout(1_500),
        timeoutMs,
        `screenshot settle wait (${target.name})`,
      );
    }
    return existing;
  }

  const page = await withTimeout(
    session.context.newPage(),
    timeoutMs,
    `screenshot newPage (${target.name})`,
  );
  await withTimeout(
    page.goto(target.url, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    }),
    timeoutMs,
    `screenshot goto (${target.name})`,
  );
  await withTimeout(
    page.waitForTimeout(1_500),
    timeoutMs,
    `screenshot settle wait (${target.name})`,
  );
  session.pages.set(pageKey, page);
  return page;
}

async function takeScreenshot(
  target: ScreenshotTarget,
  filePath: string,
): Promise<ScreenshotCaptureResult> {
  const timeoutMs = screenshotActionTimeoutMs();
  const page = await getScreenshotPage(target);
  await page.bringToFront?.().catch(() => undefined);
  await withTimeout(
    page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(
      () => undefined,
    ),
    timeoutMs,
    `screenshot load state (${target.name})`,
  ).catch(() => undefined);
  await withTimeout(
    page.waitForTimeout(1_000),
    timeoutMs,
    `screenshot final settle wait (${target.name})`,
  ).catch(() => undefined);

  let selectorClip: SelectorClip | null = null;
  let embeddedFrameMeta: EmbeddedFrameMeta | null = null;

  if (target.selector) {
    const selectorState = (await withTimeout(
      page.evaluate((selector) => {
        const element = document.querySelector(selector);
        if (!element) {
          return null;
        }
        const rect = element.getBoundingClientRect();
        const clip =
          rect.width > 0 && rect.height > 0
            ? {
                x: Math.max(0, Math.floor(rect.left)),
                y: Math.max(0, Math.floor(rect.top)),
                width: Math.max(1, Math.ceil(rect.width)),
                height: Math.max(1, Math.ceil(rect.height)),
              }
            : null;
        if (!(element instanceof HTMLIFrameElement)) {
          return {
            clip,
            iframe: null,
          };
        }
        return {
          clip,
          iframe: {
            src: element.getAttribute("src") ?? "",
            title: element.getAttribute("title") ?? "",
          },
        };
      }, target.selector),
      timeoutMs,
      `screenshot selector state (${target.name})`,
    )) as
      | {
          clip: SelectorClip | null;
          iframe: { src: string; title: string } | null;
        }
      | null;

    selectorClip = selectorState?.clip ?? null;
    if (selectorClip) {
      await withTimeout(
        page.screenshot({
          path: filePath,
          clip: selectorClip,
        }),
        timeoutMs,
        `screenshot clip capture (${target.name})`,
      );
    } else {
      await withTimeout(
        page.screenshot({
          path: filePath,
          fullPage: target.fullPage ?? true,
        }),
        timeoutMs,
        `screenshot page capture (${target.name})`,
      );
    }

    if (selectorState?.iframe?.src) {
      const embeddedFrame = page
        .frames()
        .find((frame) => frame.url() === selectorState.iframe?.src);
      if (embeddedFrame) {
        embeddedFrameMeta = (await withTimeout(
          embeddedFrame.evaluate(() => ({
            href: location.href,
            title: document.title,
            bodyPreview: (document.body?.innerText ?? "").slice(0, 2_000),
            streamReady:
              (
                window as typeof window & {
                  __HYPERSCAPE_STREAM_READY__?: unknown;
                }
              ).__HYPERSCAPE_STREAM_READY__ ?? null,
            rendererHealth:
              (
                window as typeof window & {
                  __HYPERSCAPE_STREAM_RENDERER_HEALTH__?: unknown;
                }
              ).__HYPERSCAPE_STREAM_RENDERER_HEALTH__ ?? null,
            canvasCount: document.querySelectorAll("canvas").length,
          })),
          timeoutMs,
          `screenshot iframe meta (${target.name})`,
        )) as EmbeddedFrameMeta;
      }
    }
  } else {
    await withTimeout(
      page.screenshot({
        path: filePath,
        fullPage: target.fullPage ?? true,
      }),
      timeoutMs,
      `screenshot page capture (${target.name})`,
    );
  }

  const meta = (await withTimeout(
    page.evaluate(() => {
      const bodyPreview = (document.body?.innerText ?? "").slice(0, 2_000);
      const iframeSrcs = Array.from(document.querySelectorAll("iframe"))
        .map((frame) => frame.getAttribute("src") ?? "")
        .slice(0, 8);
      const streamReady =
        (window as typeof window & { __HYPERSCAPE_STREAM_READY__?: unknown })
          .__HYPERSCAPE_STREAM_READY__ ?? null;
      const rendererHealth = (
        window as typeof window & {
          __HYPERSCAPE_STREAM_RENDERER_HEALTH__?: unknown;
        }
      ).__HYPERSCAPE_STREAM_RENDERER_HEALTH__ ?? null;
      return {
        href: location.href,
        title: document.title,
        bodyPreview,
        iframeSrcs,
        streamReady,
        rendererHealth,
      };
    }),
    timeoutMs,
    `screenshot page meta (${target.name})`,
  )) as Record<string, JsonValue>;

  meta.selectorClip = selectorClip;
  meta.embeddedFrame = embeddedFrameMeta;

  return {
    target: target.name,
    filePath,
    meta,
  };
}

async function closeScreenshotSession(): Promise<void> {
  if (!screenshotSessionPromise) {
    return;
  }
  const session = await screenshotSessionPromise.catch(() => null);
  screenshotSessionPromise = null;
  screenshotRuntimePromise = null;
  if (!session) {
    return;
  }
  for (const page of session.pages.values()) {
    if (page.isClosed?.() === true) {
      continue;
    }
    await withTimeout(
      page.close({ runBeforeUnload: true }).catch(() => undefined),
      screenshotCloseTimeoutMs(),
      "screenshot page close",
    ).catch(() => undefined);
  }
  await withTimeout(
    session.context.close().catch(() => undefined),
    screenshotCloseTimeoutMs(),
    "screenshot context close",
  ).catch(() => undefined);
  await withTimeout(
    session.browser.close().catch(() => undefined),
    screenshotCloseTimeoutMs(),
    "screenshot browser close",
  ).catch(() => undefined);
}

type LocalCapturePayload = {
  capturedAt: string;
  sourceDuelKey: string | null;
  liveDuelKey: string | null;
  recentSettlementDuelKey: string | null;
  sourceEpoch: number | null;
  sourceSeq: number | null;
  rendererHealth: RendererHealth | null;
  aligned: boolean;
  snapshot: ChainSnapshot | null;
  meta?: Record<string, JsonValue>;
};

function buildLocalCapturePayload(
  snapshot: ChainSnapshot | null,
  meta: Record<string, JsonValue> = {},
): LocalCapturePayload {
  const sourceDuelKey = snapshot
    ? currentSourceBetSyncDuelKey(snapshot.sourceBetSyncState) ??
      currentStreamDuelKey(snapshot.streamState)
    : null;
  const liveDuelKey = snapshot
    ? currentOverviewLiveDuelKey(snapshot.overview) ??
      currentActiveDuelKey(snapshot.active)
    : null;
  const recentSettlementDuelKey = snapshot
    ? currentOverviewRecentSettlementDuelKey(snapshot.overview)
    : null;
  return {
    capturedAt: nowIso(),
    sourceDuelKey,
    liveDuelKey,
    recentSettlementDuelKey,
    sourceEpoch: currentSourceEpoch(snapshot),
    sourceSeq: currentSourceSeq(snapshot),
    rendererHealth: currentRendererHealth(snapshot),
    aligned: duelKeysAligned(sourceDuelKey, liveDuelKey),
    snapshot,
    meta,
  };
}

async function captureScreenshots(
  artifactRoot: string,
  label: string,
  targets: ScreenshotTarget[],
  screenshotsEnabled: boolean,
): Promise<ScreenshotCaptureResult[]> {
  if (!screenshotsEnabled || targets.length === 0) {
    return [];
  }

  const written: ScreenshotCaptureResult[] = [];
  const screenshotDir = path.join(artifactRoot, "screenshots");
  mkdirSync(screenshotDir, { recursive: true });
  for (const target of targets) {
    const filePath = path.join(screenshotDir, `${label}.${target.name}.png`);
    try {
      written.push(await takeScreenshot(target, filePath));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("timed out after") ||
        message.includes("Target page, context or browser has been closed")
      ) {
        await closeScreenshotSession().catch(() => undefined);
      } else {
        await resetScreenshotPage(target).catch(() => undefined);
      }
      writeJsonArtifact(artifactRoot, path.join("events", `${label}.${target.name}.screenshot-error.json`), {
        target: target.name,
        url: target.url,
        selector: target.selector ?? null,
        error: String(error),
      });
      console.warn(
        `[pm-soak] screenshot capture failed for ${label}.${target.name}: ${String(error)}`,
      );
    }
  }
  return written;
}

async function recordContextEvent(
  context: LocalContext | StagedContext,
  label: string,
  payload: unknown,
  targets: ScreenshotTarget[],
): Promise<string> {
  context.captureIndex += 1;
  const baseName = `${String(context.captureIndex).padStart(4, "0")}-${safeSlug(label)}`;
  const detailPath = writeJsonArtifact(
    context.artifactRoot,
    path.join("events", `${baseName}.json`),
    payload,
  );
  try {
    const captures = await captureScreenshots(
      context.artifactRoot,
      baseName,
      targets,
      context.screenshotsEnabled,
    );
    if (captures.length > 0) {
      writeJsonArtifact(
        context.artifactRoot,
        path.join("events", `${baseName}.screenshots.json`),
        captures.map((capture) => capture.filePath),
      );
      writeJsonArtifact(
        context.artifactRoot,
        path.join("events", `${baseName}.screenshots.meta.json`),
        captures,
      );
    }
  } catch (error) {
    writeJsonArtifact(
      context.artifactRoot,
      path.join("events", `${baseName}.screenshot-error.json`),
      { error: String(error) },
    );
    console.warn(
      `[pm-soak] screenshot capture failed for ${baseName}: ${String(error)}`,
    );
  }
  return detailPath;
}

async function recordIncident(
  context: LocalContext | StagedContext,
  chain: SupportedChain | "local",
  code: string,
  message: string,
  payload: unknown,
  targets: ScreenshotTarget[],
): Promise<void> {
  const detailPath = await recordContextEvent(
    context,
    `incident-${chain}-${code}`,
    {
      at: nowIso(),
      chain,
      code,
      message,
      payload,
    },
    targets,
  );
  context.incidents.push({
    at: nowIso(),
    mode: chain === "local" ? "local" : "staged",
    chain,
    code,
    message,
    detailPath,
  });
  console.error(`[pm-soak] ${chain} ${code}: ${message}`);
}

function safeSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function localScreenshotTargets(): ScreenshotTarget[] {
  const targets: ScreenshotTarget[] = [];
  const hyperscapes =
    optionalEnv("HYPERSCAPES_UI_URL") ??
    "http://127.0.0.1:3333/stream.html?disableBridgeCapture=1";
  const hyperbet = optionalEnv("HYPERBET_UI_URL") ?? "http://127.0.0.1:4179/";
  targets.push({ name: "hyperscapes", url: hyperscapes, fullPage: false });
  targets.push({ name: "hyperbet", url: hyperbet, fullPage: false });
  targets.push({
    name: "hyperbet-stream",
    url: hyperbet,
    selector: 'iframe[title="Live Stream"]',
    fullPage: false,
    pageKey: "hyperbet",
  });
  return targets;
}

function localReconcileTarget(): { url: string; key: string | null } {
  const url =
    optionalEnv("PM_SOAK_RECONCILE_PUBLISH_URL") ??
    optionalEnv("STREAM_PUBLISH_URL") ??
    "http://127.0.0.1:8080/api/streaming/state/publish";
  const key =
    optionalEnv("PM_SOAK_RECONCILE_PUBLISH_KEY") ??
    optionalEnv("STREAM_PUBLISH_KEY") ??
    optionalEnv("ARENA_EXTERNAL_BET_WRITE_KEY") ??
    optionalEnv("E2E_ARENA_WRITE_KEY");
  return { url, key };
}

function isBenignLocalRendererDegradation(
  degradedReason: string | null | undefined,
): boolean {
  return (
    degradedReason === "capture_client_disconnected" ||
    degradedReason === "renderer_health_stale"
  );
}

async function reconcileLocalStreamState(
  snapshot: ChainSnapshot,
  context: LocalContext,
): Promise<boolean> {
  const { url, key } = localReconcileTarget();
  if (!key) {
    await recordIncident(
      context,
      "local",
      "duel_key_drift_no_publish_key",
      "stream and active market duel keys diverged, but no publish key is configured for reconciliation",
      {
        sourceDuelKey: currentStreamDuelKey(snapshot.streamState),
        liveDuelKey:
          currentOverviewLiveDuelKey(snapshot.overview) ??
          currentActiveDuelKey(snapshot.active),
        targetUrl: url,
      },
      context.screenshotTargets,
    );
    return false;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-arena-write-key": key,
    },
    body: JSON.stringify(snapshot.streamState ?? {}),
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(
      `local stream reconciliation failed: ${response.status} ${response.statusText}: ${bodyText}`,
    );
  }

  await recordContextEvent(
    context,
    "local-reconcile",
    {
      reconciledAt: nowIso(),
      targetUrl: url,
      sourceDuelKey: currentStreamDuelKey(snapshot.streamState),
      liveDuelKey:
        currentOverviewLiveDuelKey(snapshot.overview) ??
        currentActiveDuelKey(snapshot.active),
      body: bodyText,
    },
    context.screenshotTargets,
  );

  return true;
}

async function recordLocalContextEvent(
  context: LocalContext,
  label: string,
  snapshot: ChainSnapshot,
  extra: Record<string, JsonValue> = {},
): Promise<string> {
  return recordContextEvent(
    context,
    label,
    {
      ...buildLocalCapturePayload(snapshot, extra),
    },
    context.screenshotTargets,
  );
}

function stagedPagesTarget(chain: SupportedChain): ScreenshotTarget | null {
  const prefix = `HYPERBET_${chain.toUpperCase()}_PAGES_STAGING_URL`;
  const url = optionalEnv(prefix);
  if (!url) {
    return null;
  }
  return { name: `${chain}-pages`, url: normalizeUrl(url) };
}

async function fetchLocalSnapshot(): Promise<{
  chain: "local";
  streamState: StreamState | null;
  active: PredictionMarketsResponse | null;
  overview: PredictionMarketsOverviewResponse | null;
  syncStatus: SyncStatusResponse | null;
  sourceBetSyncState: BetSyncBootstrapStateResponse | null;
  sourceRtmpStatus: SourceRtmpStatusResponse | null;
  status: KeeperStatusResponse | null;
  botHealth: BotHealthResponse | null;
  buildInfo: BuildInfo | null;
  perps: PerpsEvidence;
  fetchedAtMs: number;
}> {
  const fetchedAtMs = Date.now();
  const sourceBetSyncToken =
    optionalEnv("SOURCE_BET_SYNC_BEARER_TOKEN") ??
    optionalEnv("STREAMING_VIEWER_ACCESS_TOKEN");
  const sourceStreamStateUrl =
    optionalEnv("SOURCE_STREAM_STATE_URL") ??
    optionalEnv("STREAM_STATE_URL") ??
    "http://127.0.0.1:5555/api/streaming/state";
  const sourceBetSyncStateUrl =
    optionalEnv("SOURCE_BET_SYNC_STATE_URL") ??
    "http://127.0.0.1:5555/api/internal/bet-sync/state";
  const sourceRtmpStatusUrl =
    optionalEnv("SOURCE_RTMP_STATUS_URL") ??
    "http://127.0.0.1:5555/api/streaming/rtmp/status";
  const activeMarketsUrl =
    optionalEnv("ACTIVE_MARKETS_URL") ??
    "http://127.0.0.1:8080/api/arena/prediction-markets/active";
  const overviewMarketsUrl =
    optionalEnv("OVERVIEW_MARKETS_URL") ??
    "http://127.0.0.1:8080/api/arena/prediction-markets/overview";
  const statusUrl =
    optionalEnv("KEEPER_STATUS_URL") ?? "http://127.0.0.1:8080/status";
  const keeperBaseUrl = statusUrl.replace(/\/status\/?$/, "");
  const perpsMarketsUrl =
    optionalEnv("PERPS_MARKETS_URL") ??
    `${keeperBaseUrl}/api/perps/markets`;
  const perpsOracleHistoryUrl =
    optionalEnv("PERPS_ORACLE_HISTORY_URL") ??
    `${keeperBaseUrl}/api/perps/oracle-history`;
  const botHealthUrl =
    optionalEnv("KEEPER_BOT_HEALTH_URL") ??
    "http://127.0.0.1:8080/api/keeper/bot-health";
  const syncStatusUrl =
    optionalEnv("SYNC_STATUS_URL") ?? "http://127.0.0.1:8080/api/sync/status";
  const buildInfoUrl = optionalEnv("HYPERBET_BUILD_INFO_URL");

  const [
    streamState,
    sourceBetSyncState,
    sourceRtmpStatus,
    active,
    overview,
    syncStatus,
    status,
    botHealth,
    buildInfo,
    perpsMarkets,
    perpsOracleHistory,
  ] =
    await Promise.all([
      requestJson<StreamState>(sourceStreamStateUrl),
      requestJsonOrNull<BetSyncBootstrapStateResponse>(
        sourceBetSyncStateUrl,
        {
          headers: buildAuthHeadersFromEnv(sourceBetSyncToken),
        },
      ),
      requestJsonOrNull<SourceRtmpStatusResponse>(sourceRtmpStatusUrl),
      requestJson<PredictionMarketsResponse>(activeMarketsUrl),
      requestJsonOrNull<PredictionMarketsOverviewResponse>(overviewMarketsUrl),
      requestJsonOrNull<SyncStatusResponse>(syncStatusUrl),
      requestJson<KeeperStatusResponse>(statusUrl),
      requestJson<BotHealthResponse>(botHealthUrl),
      buildInfoUrl
        ? requestJson<BuildInfo>(buildInfoUrl)
        : Promise.resolve(null),
      requestJsonOrNull<JsonValue>(perpsMarketsUrl),
      requestJsonOrNull<JsonValue>(perpsOracleHistoryUrl),
    ]);

  return {
    chain: "local",
    streamState,
    sourceBetSyncState,
    sourceRtmpStatus,
    active,
    overview,
    syncStatus,
    status,
    botHealth,
    buildInfo,
    perps: {
      markets: perpsMarkets,
      oracleHistory: perpsOracleHistory,
    },
    fetchedAtMs,
  };
}

function stagedKeeperUrls(chain: SupportedChain): {
  pagesUrl: string;
  keeperUrl: string;
} {
  const upper = chain.toUpperCase();
  return {
    pagesUrl: normalizeUrl(requiredEnv(`HYPERBET_${upper}_PAGES_STAGING_URL`)),
    keeperUrl: normalizeUrl(
      requiredEnv(`HYPERBET_${upper}_KEEPER_STAGING_URL`),
    ),
  };
}

async function fetchStagedChainSnapshot(
  chain: SupportedChain,
): Promise<ChainSnapshot> {
  const urls = stagedKeeperUrls(chain);
  const fetchedAtMs = Date.now();
  const [
    buildInfo,
    status,
    active,
    overview,
    syncStatus,
    botHealth,
    streamState,
    perpsMarkets,
    perpsOracleHistory,
  ] = await Promise.all([
      requestJson<BuildInfo>(`${urls.pagesUrl}/build-info.json`),
      requestJson<KeeperStatusResponse>(`${urls.keeperUrl}/status`),
      requestJson<PredictionMarketsResponse>(
        `${urls.keeperUrl}/api/arena/prediction-markets/active`,
      ),
      requestJsonOrNull<PredictionMarketsOverviewResponse>(
        `${urls.keeperUrl}/api/arena/prediction-markets/overview`,
      ),
      requestJsonOrNull<SyncStatusResponse>(`${urls.keeperUrl}/api/sync/status`),
      requestJson<BotHealthResponse>(`${urls.keeperUrl}/api/keeper/bot-health`),
      requestJson<StreamState>(`${urls.keeperUrl}/api/streaming/state`),
      requestJsonOrNull<JsonValue>(`${urls.keeperUrl}/api/perps/markets`),
      requestJsonOrNull<JsonValue>(`${urls.keeperUrl}/api/perps/oracle-history`),
    ]);
  return {
    chain,
    buildInfo,
    status,
    active,
    overview,
    syncStatus,
    sourceBetSyncState: null,
    sourceRtmpStatus: null,
    botHealth,
    streamState,
    perps: {
      markets: perpsMarkets,
      oracleHistory: perpsOracleHistory,
    },
    fetchedAtMs,
  };
}

async function runLocalSoak(args: MonitorArgs): Promise<void> {
  const context: LocalContext = {
    mode: "local",
    artifactRoot: args.artifactRoot,
    screenshotsEnabled: (process.env.PM_SOAK_SCREENSHOTS ?? "true") !== "false",
    screenshotTargets: localScreenshotTargets(),
    incidents: [],
    captureIndex: 0,
    streamDuelKey: null,
    activeDuelKey: null,
    recentSettlementDuelKey: null,
    driftPolls: 0,
    reconcileAttempts: 0,
  };
  const startedAtMs = Date.now();
  const deadline = args.follow
    ? Number.POSITIVE_INFINITY
    : startedAtMs + args.durationMin * 60_000;

  const cycles: LocalCycleRecord[] = [];
  let currentCycle: LocalCycleRecord | null = null;
  let previousPhase = "";
  let idlePolls = 0;
  let pollIndex = 0;
  let bothUiReachable = true;
  let lastSnapshot: ChainSnapshot | null = null;
  let driftConsecutivePolls = 0;
  let driftHandled = false;
  let rendererDegradedPolls = 0;
  let syncDegradedPolls = 0;

  await recordContextEvent(
    context,
    "local-start",
    {
      startedAt: nowIso(),
      durationMin: args.durationMin,
      pollMs: args.pollMs,
      minCycleMs: LOCAL_MIN_DUEL_CYCLE_MS,
      maxCycleMs: LOCAL_MAX_DUEL_CYCLE_MS,
      follow: args.follow,
    },
    context.screenshotTargets,
  );

  while (Date.now() < deadline && !stopping) {
    pollIndex += 1;
    try {
      const snapshot = await fetchLocalSnapshot();
      lastSnapshot = snapshot;
      const sourceDuelKey =
        currentSourceBetSyncDuelKey(snapshot.sourceBetSyncState) ??
        currentStreamDuelKey(snapshot.streamState);
      const liveDuelKey =
        currentOverviewLiveDuelKey(snapshot.overview) ??
        currentActiveDuelKey(snapshot.active);
      const recentSettlementDuelKey = currentOverviewRecentSettlementDuelKey(
        snapshot.overview,
      );
      const rendererHealth = currentRendererHealth(snapshot);
      const aligned = duelKeysAligned(sourceDuelKey, liveDuelKey);
      context.streamDuelKey = sourceDuelKey;
      context.activeDuelKey = liveDuelKey;
      context.recentSettlementDuelKey = recentSettlementDuelKey;

      writeJsonArtifact(
        context.artifactRoot,
        path.join("polls", `${String(pollIndex).padStart(5, "0")}.json`),
        {
          ...snapshot,
          sourceDuelKey,
          liveDuelKey,
          recentSettlementDuelKey,
          sourceEpoch: currentSourceEpoch(snapshot),
          sourceSeq: currentSourceSeq(snapshot),
          rendererHealth,
          aligned,
        },
      );

      const cycleId = currentCycleId(snapshot.streamState, snapshot.active);
      const duelKey =
        liveDuelKey ??
        sourceDuelKey ??
        currentDuelKey(snapshot.streamState, snapshot.active);
      const phase =
        currentSourceBetSyncPhase(snapshot.sourceBetSyncState) ??
        currentPhase(snapshot.streamState, snapshot.active);
      const marketCount = snapshot.active?.markets?.length ?? 0;
      const driftRelevant = marketCount > 0 || phase !== "IDLE";
      const rendererSignoffRelevant = phase !== "IDLE" || marketCount > 0;
      const syncDegradedReason =
        snapshot.syncStatus?.degradedReason &&
        snapshot.syncStatus.degradedReason !== rendererHealth?.degradedReason
          ? snapshot.syncStatus.degradedReason
          : null;

      if (
        rendererSignoffRelevant &&
        rendererHealth?.ready === false &&
        !isBenignLocalRendererDegradation(rendererHealth.degradedReason)
      ) {
        rendererDegradedPolls += 1;
        if (rendererDegradedPolls >= 2) {
          currentCycle?.incidents.push("renderer_unhealthy");
          await recordIncident(
            context,
            "local",
            "renderer_unhealthy",
            `standalone source renderer is degraded: ${rendererHealth.degradedReason || "unknown"}`,
            {
              sourceDuelKey,
              liveDuelKey,
              recentSettlementDuelKey,
              sourceEpoch: currentSourceEpoch(snapshot),
              sourceSeq: currentSourceSeq(snapshot),
              rendererHealth,
              syncStatus: snapshot.syncStatus,
            },
            context.screenshotTargets,
          );
          throw new Error(
            `local renderer unhealthy during active duel: ${rendererHealth.degradedReason || "unknown"}`,
          );
        }
      } else {
        rendererDegradedPolls = 0;
      }

      if (rendererSignoffRelevant && syncDegradedReason) {
        syncDegradedPolls += 1;
        if (syncDegradedPolls >= 2) {
          currentCycle?.incidents.push("sync_status_degraded");
          await recordIncident(
            context,
            "local",
            "sync_status_degraded",
            `keeper sync status is degraded: ${syncDegradedReason}`,
            {
              sourceDuelKey,
              liveDuelKey,
              recentSettlementDuelKey,
              sourceEpoch: currentSourceEpoch(snapshot),
              sourceSeq: currentSourceSeq(snapshot),
              rendererHealth,
              syncStatus: snapshot.syncStatus,
            },
            context.screenshotTargets,
          );
          throw new Error(`local sync status degraded: ${syncDegradedReason}`);
        }
      } else {
        syncDegradedPolls = 0;
      }

      if (phase === "IDLE") {
        idlePolls += 1;
      } else {
        idlePolls = 0;
      }

      if (idlePolls >= 2 && cycles.length === 0) {
        await recordIncident(
          context,
          "local",
          "idle_seed_required",
          "local Hyperscapes duel stream is still IDLE; create and start two local agents before the soak clock starts",
          {
            ...snapshot,
            sourceDuelKey,
            liveDuelKey,
            recentSettlementDuelKey,
            aligned,
          },
          context.screenshotTargets,
        );
        throw new Error(
          "local duel stream remained IDLE; seed local agents before running the soak",
        );
      }

      if (driftRelevant && !aligned) {
        driftConsecutivePolls += 1;
        context.driftPolls = driftConsecutivePolls;
        const driftCode =
          snapshot.syncStatus?.applyLagMs != null &&
          snapshot.syncStatus.applyLagMs > 0
            ? "consumer_lag"
            : "source_feed_lag";
        currentCycle?.incidents.push(driftCode);

        if (!driftHandled) {
          await recordLocalContextEvent(
            context,
            `local-${driftCode}-${driftConsecutivePolls}`,
            snapshot,
            {
              pollIndex,
              driftConsecutivePolls,
              driftCode,
            },
          );
        }

        if (driftConsecutivePolls >= 2) {
          if (!driftHandled) {
            driftHandled = true;
            context.driftPolls = driftConsecutivePolls;
            const reconciled = await reconcileLocalStreamState(
              snapshot,
              context,
            );
            context.reconcileAttempts += reconciled ? 1 : 0;
            if (reconciled) {
              const refreshed = await fetchLocalSnapshot();
              const refreshedStreamDuelKey = currentStreamDuelKey(
                refreshed.streamState,
              );
              const refreshedLiveDuelKey = currentOverviewLiveDuelKey(
                refreshed.overview,
              ) ?? currentActiveDuelKey(refreshed.active);
              const refreshedRecentSettlementDuelKey =
                currentOverviewRecentSettlementDuelKey(refreshed.overview);
              const refreshedPhase =
                currentSourceBetSyncPhase(refreshed.sourceBetSyncState) ??
                currentPhase(refreshed.streamState, refreshed.active);
              const refreshedAligned = duelKeysAligned(
                refreshedStreamDuelKey,
                refreshedLiveDuelKey,
              );
              if (!refreshedAligned) {
                const recentSettlementLagOnly =
                  refreshedPhase !== "IDLE" &&
                  refreshedStreamDuelKey != null &&
                  refreshedRecentSettlementDuelKey != null &&
                  refreshedStreamDuelKey === refreshedRecentSettlementDuelKey &&
                  refreshedLiveDuelKey != null &&
                  refreshedLiveDuelKey !== refreshedStreamDuelKey;
                if (recentSettlementLagOnly) {
                  context.streamDuelKey = refreshedStreamDuelKey;
                  context.activeDuelKey = refreshedLiveDuelKey;
                  context.recentSettlementDuelKey =
                    refreshedRecentSettlementDuelKey;
                  driftConsecutivePolls = 0;
                  context.driftPolls = 0;
                  driftHandled = false;
                  await recordLocalContextEvent(
                    context,
                    "local-source-feed-settlement-lag",
                    refreshed,
                    {
                      sourceDuelKey: refreshedStreamDuelKey,
                      liveDuelKey: refreshedLiveDuelKey,
                      recentSettlementDuelKey:
                        refreshedRecentSettlementDuelKey,
                      phase: refreshedPhase,
                    },
                  );
                  continue;
                }
                await recordIncident(
                  context,
                  "local",
                  "source_feed_lag_persisted",
                  "source and live market duel keys still diverged after local-only repair",
                  {
                    before: {
                      sourceDuelKey,
                      liveDuelKey,
                    },
                    after: {
                      sourceDuelKey: refreshedStreamDuelKey,
                      liveDuelKey: refreshedLiveDuelKey,
                    },
                  },
                  context.screenshotTargets,
                );
                throw new Error(
                  "local duel key drift persisted after local-only repair",
                );
              }

              context.streamDuelKey = refreshedStreamDuelKey;
              context.activeDuelKey = refreshedLiveDuelKey;
              context.recentSettlementDuelKey =
                currentOverviewRecentSettlementDuelKey(refreshed.overview);
              driftConsecutivePolls = 0;
              context.driftPolls = 0;
              driftHandled = false;
              await recordLocalContextEvent(
                context,
                "local-duel-repaired",
                refreshed,
                {
                  reconciled: true,
                  sourceDuelKey: refreshedStreamDuelKey,
                  liveDuelKey: refreshedLiveDuelKey,
                },
              );
              continue;
            }

            throw new Error("local duel key drift could not be repaired");
          }

          throw new Error(
            "local duel key drift persisted beyond the allowed poll window",
          );
        }
      } else {
        driftConsecutivePolls = 0;
        context.driftPolls = 0;
        driftHandled = false;
      }

      if (!currentCycle || currentCycle.cycleId !== cycleId) {
        if (currentCycle) {
          currentCycle.endedAtMs = snapshot.fetchedAtMs;
          currentCycle.durationMs =
            currentCycle.endedAtMs - currentCycle.startedAtMs;
          cycles.push(currentCycle);
        }
        currentCycle = {
          cycleId,
          duelKey,
          duelId: snapshot.active?.duel?.duelId ?? null,
          startedAtMs: snapshot.fetchedAtMs,
          endedAtMs: null,
          durationMs: null,
          phases: phase === "UNKNOWN" ? [] : [phase],
          marketCountMax: marketCount,
          incidents: [],
        };
        await recordLocalContextEvent(
          context,
          `local-cycle-${cycleId}`,
          snapshot,
          {
            cycleId,
            sourceDuelKey,
            liveDuelKey,
            recentSettlementDuelKey,
            aligned,
            phase,
            marketCount,
          },
        );
      }

      currentCycle.marketCountMax = Math.max(
        currentCycle.marketCountMax,
        marketCount,
      );
      if (phase && phase !== previousPhase) {
        if (currentCycle.phases[currentCycle.phases.length - 1] !== phase) {
          currentCycle.phases.push(phase);
        }
        await recordLocalContextEvent(
          context,
          `local-phase-${phase}`,
          snapshot,
          {
            cycleId,
            sourceDuelKey,
            liveDuelKey,
            recentSettlementDuelKey,
            aligned,
            marketCount,
          },
        );
      }

      previousPhase = phase;

      if (snapshot.status?.ok === false || snapshot.botHealth?.ok === false) {
        await recordIncident(
          context,
          "local",
          "keeper_unhealthy",
          "local keeper status or bot-health endpoint reported not-ok",
          {
            ...snapshot,
            sourceDuelKey,
            liveDuelKey,
            recentSettlementDuelKey,
            aligned,
          },
          context.screenshotTargets,
        );
      }
    } catch (error) {
      bothUiReachable = false;
      await recordIncident(
        context,
        "local",
        "poll_failed",
        String(error),
        {
          poll: pollIndex,
          sourceDuelKey: context.streamDuelKey,
          liveDuelKey: context.activeDuelKey,
          recentSettlementDuelKey: context.recentSettlementDuelKey,
          aligned: duelKeysAligned(context.streamDuelKey, context.activeDuelKey),
        },
        context.screenshotTargets,
      );
      if (args.follow && lastSnapshot) {
        driftConsecutivePolls = 0;
      }
    }

    await sleep(args.pollMs);
  }

  if (currentCycle) {
    currentCycle.endedAtMs = Date.now();
    currentCycle.durationMs = currentCycle.endedAtMs - currentCycle.startedAtMs;
    cycles.push(currentCycle);
  }

  const scoredCycles = cycles.filter(isScoreableLocalCycle);
  const cycleDurationsMs = scoredCycles
    .map((cycle) => cycle.durationMs)
    .filter((value): value is number => Number.isFinite(value));

  for (const cycle of scoredCycles) {
    if (
      cycle.durationMs != null &&
      cycle.durationMs < LOCAL_MIN_DUEL_CYCLE_MS ||
      cycle.durationMs > LOCAL_MAX_DUEL_CYCLE_MS
    ) {
      cycle.incidents.push("cycle_drift");
    }
  }

  const requiredCycles = args.follow
    ? 1
    : args.durationMin >= DEFAULT_LOCAL_DURATION_MIN
      ? 8
      : 1;
  const driftCyclesObserved = scoredCycles.filter((cycle) =>
    cycle.incidents.includes("cycle_drift"),
  ).length;
  const pass =
    context.incidents.length === 0 &&
    scoredCycles.length >= requiredCycles &&
    bothUiReachable;

  const summary: LocalSummary = {
    mode: "local",
    runScope: args.runScope,
    startedAt: new Date(startedAtMs).toISOString(),
    completedAt: nowIso(),
    durationMs: Date.now() - startedAtMs,
    pollMs: args.pollMs,
    artifactRoot: context.artifactRoot,
    follow: args.follow,
    cyclesObserved: cycles.length,
    scoredCyclesObserved: scoredCycles.length,
    ignoredCyclesObserved: cycles.length - scoredCycles.length,
    driftCyclesObserved,
    cycleDurationsMs,
    bothUiReachable,
    streamDuelKey: context.streamDuelKey,
    activeDuelKey: context.activeDuelKey,
    recentSettlementDuelKey: context.recentSettlementDuelKey,
    driftPolls: context.driftPolls,
    reconcileAttempts: context.reconcileAttempts,
    incidents: context.incidents,
    pass,
  };

  writeJsonArtifact(context.artifactRoot, "cycles.json", cycles);
  writeJsonArtifact(context.artifactRoot, "summary.json", summary);
  writeFileSync(
    path.join(context.artifactRoot, "cycles.csv"),
    [
      "cycle_id,duel_key,started_at_ms,ended_at_ms,duration_ms,market_count_max,phase_count,incidents",
      ...cycles.map((cycle) =>
        [
          cycle.cycleId,
          cycle.duelKey,
          cycle.startedAtMs,
          cycle.endedAtMs ?? "",
          cycle.durationMs ?? "",
          cycle.marketCountMax,
          cycle.phases.length,
          cycle.incidents.join("|"),
        ].join(","),
      ),
    ].join("\n"),
  );

  await recordContextEvent(
    context,
    "local-final",
    summary,
    context.screenshotTargets,
  );

  if (!pass) {
    throw new Error(
      "local PM soak failed; inspect output/playwright/pm-soak summary and incident artifacts",
    );
  }
}

type StagedRuntimeState = {
  cycles: ChainCycleRecord[];
  current: ChainCycleRecord | null;
  lastPhase: string;
  lastLifecycle: string;
  staleQuotePolls: number;
  openLagIncident: boolean;
  quoteLagIncident: boolean;
  lockLagIncident: boolean;
  proposalLagIncident: boolean;
};

async function runStagedSoak(args: MonitorArgs): Promise<void> {
  const context: StagedContext = {
    mode: "staged",
    artifactRoot: args.artifactRoot,
    screenshotsEnabled: (process.env.PM_SOAK_SCREENSHOTS ?? "true") !== "false",
    incidents: [],
    captureIndex: 0,
    milestoneScreenshots: new Set<string>(),
    canaryTradesEnabled:
      (process.env.PM_SOAK_ENABLE_CANARY_TRADES ?? "true") !== "false",
    chainScreenshots: {
      solana: args.chains.includes("solana")
        ? stagedPagesTarget("solana")
        : null,
      bsc: args.chains.includes("bsc") ? stagedPagesTarget("bsc") : null,
      avax: args.chains.includes("avax") ? stagedPagesTarget("avax") : null,
    },
  };

  const startedAtMs = Date.now();
  const deadline = startedAtMs + args.durationMin * 60_000;
  const stateByChain = new Map<SupportedChain, StagedRuntimeState>();
  for (const chain of args.chains) {
    stateByChain.set(chain, {
      cycles: [],
      current: null,
      lastPhase: "",
      lastLifecycle: "",
      staleQuotePolls: 0,
      openLagIncident: false,
      quoteLagIncident: false,
      lockLagIncident: false,
      proposalLagIncident: false,
    });
  }

  const screenshotsFor = (chain: SupportedChain): ScreenshotTarget[] => {
    const target = context.chainScreenshots[chain];
    return target ? [target] : [];
  };

  await recordContextEvent(
    context,
    "staged-start",
    {
      startedAt: nowIso(),
      durationMin: args.durationMin,
      pollMs: args.pollMs,
      chains: args.chains,
      canaryTradesEnabled: context.canaryTradesEnabled,
    },
    args.chains.flatMap((chain) => screenshotsFor(chain)),
  );

  let pollIndex = 0;
  while (Date.now() < deadline) {
    pollIndex += 1;
    const snapshots = await Promise.allSettled(
      args.chains.map((chain) => fetchStagedChainSnapshot(chain)),
    );
    const pollPayload: Record<string, unknown> = {
      fetchedAt: nowIso(),
      pollIndex,
    };
    for (let index = 0; index < snapshots.length; index += 1) {
      const chain = args.chains[index];
      const result = snapshots[index];
      if (result.status !== "fulfilled") {
        await recordIncident(
          context,
          chain,
          "snapshot_failed",
          String(result.reason),
          { pollIndex },
          screenshotsFor(chain),
        );
        continue;
      }

      const snapshot = result.value;
      pollPayload[chain] = snapshot;
      await processStagedSnapshot(
        args,
        context,
        stateByChain.get(chain)!,
        snapshot,
        screenshotsFor(chain),
      );
    }
    writeJsonArtifact(
      context.artifactRoot,
      path.join("polls", `${String(pollIndex).padStart(5, "0")}.json`),
      pollPayload,
    );
    await sleep(args.pollMs);
  }

  const chainSummary = {
    solana: emptyStagedChainSummary(),
    bsc: emptyStagedChainSummary(),
    avax: emptyStagedChainSummary(),
  } as Record<SupportedChain, StagedChainSummary>;

  const csvRows = [
    "chain,cycle_index,duel_key,started_at_ms,open_lag_ms,quote_lag_ms,lock_lag_ms,proposal_lag_ms,trade_attempted,trade_matched,claim_cleared,incidents",
  ];

  for (const chain of args.chains) {
    const state = stateByChain.get(chain)!;
    if (state.current) {
      state.cycles.push(state.current);
      state.current = null;
    }
    const summary = chainSummary[chain];
    summary.cyclesObserved = state.cycles.length;
    for (const cycle of state.cycles) {
      if (cycle.openAtMs != null)
        summary.openLagMs.push(cycle.openAtMs - cycle.startedAtMs);
      if (cycle.quotesAtMs != null && cycle.openAtMs != null)
        summary.quoteLagMs.push(cycle.quotesAtMs - cycle.openAtMs);
      if (cycle.lockAtMs != null && cycle.betCloseTimeMs != null)
        summary.lockLagMs.push(cycle.lockAtMs - cycle.betCloseTimeMs);
      if (cycle.proposalAtMs != null && cycle.resolutionAtMs != null)
        summary.proposalLagMs.push(cycle.proposalAtMs - cycle.resolutionAtMs);
      if (cycle.terminalAtMs != null) summary.finalizedCycles += 1;
      if (cycle.trade) {
        summary.tradeAttempts += 1;
        if (cycle.trade.matched) summary.tradeMatches += 1;
        if (cycle.trade.clearedAtMs != null) summary.claimClears += 1;
      }
      summary.incidents += cycle.incidents.length;
      csvRows.push(
        [
          chain,
          cycle.cycleIndex,
          cycle.duelKey,
          cycle.startedAtMs,
          cycle.openAtMs != null ? cycle.openAtMs - cycle.startedAtMs : "",
          cycle.quotesAtMs != null && cycle.openAtMs != null
            ? cycle.quotesAtMs - cycle.openAtMs
            : "",
          cycle.lockAtMs != null && cycle.betCloseTimeMs != null
            ? cycle.lockAtMs - cycle.betCloseTimeMs
            : "",
          cycle.proposalAtMs != null && cycle.resolutionAtMs != null
            ? cycle.proposalAtMs - cycle.resolutionAtMs
            : "",
          cycle.trade ? "yes" : "no",
          cycle.trade?.matched ? "yes" : "no",
          cycle.trade?.clearedAtMs != null ? "yes" : "no",
          cycle.incidents.join("|"),
        ].join(","),
      );
    }
  }

  const requiredClaims =
    args.durationMin >= DEFAULT_STAGED_DURATION_MIN ? 3 : 0;
  const pass =
    context.incidents.length === 0 &&
    args.chains.every((chain) => {
      const summary = chainSummary[chain];
      return (
        summary.openLagMs.every((value) => value <= OPEN_LAG_BUDGET_MS) &&
        summary.quoteLagMs.every((value) => value <= QUOTE_LAG_BUDGET_MS) &&
        summary.lockLagMs.every((value) => value <= LOCK_LAG_BUDGET_MS) &&
        summary.proposalLagMs.every(
          (value) => value <= PROPOSAL_LAG_BUDGET_MS,
        ) &&
        summary.claimClears >= requiredClaims
      );
    });

  const summary: StagedSummary = {
    mode: "staged",
    runScope: args.runScope,
    startedAt: new Date(startedAtMs).toISOString(),
    completedAt: nowIso(),
    durationMs: Date.now() - startedAtMs,
    pollMs: args.pollMs,
    artifactRoot: context.artifactRoot,
    chains: args.chains,
    incidents: context.incidents,
    chainSummary,
    pass,
  };

  writeJsonArtifact(context.artifactRoot, "summary.json", summary);
  writeFileSync(
    path.join(context.artifactRoot, "cycles.csv"),
    `${csvRows.join("\n")}\n`,
  );
  await recordContextEvent(
    context,
    "staged-final",
    summary,
    args.chains.flatMap((chain) => screenshotsFor(chain)),
  );

  if (!pass) {
    throw new Error(
      "staged PM soak failed; inspect .ci-artifacts/pm-soak/summary.json and incident artifacts",
    );
  }
}

function emptyStagedChainSummary(): StagedChainSummary {
  return {
    cyclesObserved: 0,
    openLagMs: [],
    quoteLagMs: [],
    lockLagMs: [],
    proposalLagMs: [],
    finalizedCycles: 0,
    claimClears: 0,
    tradeAttempts: 0,
    tradeMatches: 0,
    incidents: 0,
  };
}

async function processStagedSnapshot(
  args: MonitorArgs,
  context: StagedContext,
  state: StagedRuntimeState,
  snapshot: ChainSnapshot,
  screenshotTargets: ScreenshotTarget[],
): Promise<void> {
  const duelKey = currentDuelKey(snapshot.streamState, snapshot.active);
  const phase = currentPhase(snapshot.streamState, snapshot.active);
  const market =
    snapshot.active?.markets.find(
      (candidate) => candidate.chainKey === snapshot.chain,
    ) ?? null;
  const statusChain =
    snapshot.status?.predictionMarkets?.chains?.find(
      (candidate) => candidate.chainKey === snapshot.chain,
    ) ?? null;
  const health =
    (statusChain?.health as KeeperMarketHealth | null | undefined) ??
    snapshot.botHealth?.health?.markets?.find(
      (candidate) => candidate.chainKey === snapshot.chain,
    ) ??
    null;
  const lifecycle =
    statusChain?.lifecycleStatus ?? market?.lifecycleStatus ?? "UNKNOWN";
  const nowMs = snapshot.fetchedAtMs;

  if (!state.current || state.current.duelKey !== duelKey) {
    if (state.current) {
      state.cycles.push(state.current);
    }
    state.current = {
      cycleIndex: state.cycles.length + 1,
      duelKey,
      duelId: snapshot.active?.duel?.duelId ?? null,
      startedAtMs: nowMs,
      betCloseTimeMs:
        snapshot.active?.duel?.betCloseTime ??
        statusChain?.betCloseTime ??
        null,
      resolutionAtMs: null,
      openAtMs: null,
      quotesAtMs: null,
      lockAtMs: null,
      proposalAtMs: null,
      terminalAtMs: null,
      trade: null,
      incidents: [],
    };
    state.lastPhase = "";
    state.lastLifecycle = "";
    state.staleQuotePolls = 0;
    state.openLagIncident = false;
    state.quoteLagIncident = false;
    state.lockLagIncident = false;
    state.proposalLagIncident = false;
    await recordContextEvent(
      context,
      `${snapshot.chain}-cycle-${state.current.cycleIndex}`,
      snapshot,
      screenshotTargets,
    );
  }

  const current = state.current;
  current.betCloseTimeMs =
    snapshot.active?.duel?.betCloseTime ?? current.betCloseTimeMs;

  if (phase !== state.lastPhase) {
    state.lastPhase = phase;
    await recordContextEvent(
      context,
      `${snapshot.chain}-phase-${phase}`,
      snapshot,
      screenshotTargets,
    );
    if (phase === "RESOLUTION" && current.resolutionAtMs == null) {
      current.resolutionAtMs = nowMs;
    }
  }

  if (lifecycle !== state.lastLifecycle) {
    state.lastLifecycle = lifecycle;
    await recordContextEvent(
      context,
      `${snapshot.chain}-lifecycle-${lifecycle}`,
      snapshot,
      screenshotTargets,
    );
  }

  if (lifecycle === "OPEN" && current.openAtMs == null) {
    current.openAtMs = nowMs;
    await maybeRecordMilestone(
      context,
      `${snapshot.chain}-first-market-visible`,
      snapshot,
      screenshotTargets,
    );
  }

  if (
    hasTwoSidedQuotes(health) &&
    current.quotesAtMs == null &&
    lifecycle === "OPEN"
  ) {
    current.quotesAtMs = nowMs;
    await maybeRecordMilestone(
      context,
      `${snapshot.chain}-first-mm-quotes-visible`,
      snapshot,
      screenshotTargets,
    );
  }

  if (
    current.betCloseTimeMs != null &&
    lifecycle !== "OPEN" &&
    current.lockAtMs == null
  ) {
    current.lockAtMs = nowMs;
    await maybeRecordMilestone(
      context,
      `${snapshot.chain}-first-lock`,
      snapshot,
      screenshotTargets,
    );
  }

  if (proposalLifecycle(lifecycle) && current.proposalAtMs == null) {
    current.proposalAtMs = nowMs;
    await maybeRecordMilestone(
      context,
      `${snapshot.chain}-first-proposal`,
      snapshot,
      screenshotTargets,
    );
  }

  if (terminalLifecycle(lifecycle) && current.terminalAtMs == null) {
    current.terminalAtMs = nowMs;
  }

  if (
    !state.openLagIncident &&
    nowMs - current.startedAtMs > OPEN_LAG_BUDGET_MS &&
    current.openAtMs == null
  ) {
    state.openLagIncident = true;
    current.incidents.push("market_missing_after_open_budget");
    await recordIncident(
      context,
      snapshot.chain,
      "market_missing_after_open_budget",
      "market did not reach OPEN within the open-lag budget",
      snapshot,
      screenshotTargets,
    );
  }

  if (
    !state.quoteLagIncident &&
    current.openAtMs != null &&
    nowMs - current.openAtMs > QUOTE_LAG_BUDGET_MS &&
    current.quotesAtMs == null
  ) {
    state.quoteLagIncident = true;
    current.incidents.push("mm_quotes_missing_after_open_budget");
    await recordIncident(
      context,
      snapshot.chain,
      "mm_quotes_missing_after_open_budget",
      "market-maker quotes did not become visible within the quote-lag budget",
      snapshot,
      screenshotTargets,
    );
  }

  if (
    !state.lockLagIncident &&
    current.betCloseTimeMs != null &&
    nowMs > current.betCloseTimeMs + LOCK_LAG_BUDGET_MS &&
    (lifecycle === "OPEN" || hasAnyQuote(health))
  ) {
    state.lockLagIncident = true;
    current.incidents.push("quotes_or_open_after_bet_close");
    await recordIncident(
      context,
      snapshot.chain,
      "quotes_or_open_after_bet_close",
      "market remained quotable/open beyond the post-close budget",
      snapshot,
      screenshotTargets,
    );
  }

  if (
    !state.proposalLagIncident &&
    current.resolutionAtMs != null &&
    nowMs > current.resolutionAtMs + PROPOSAL_LAG_BUDGET_MS &&
    current.proposalAtMs == null
  ) {
    state.proposalLagIncident = true;
    current.incidents.push("proposal_missing_after_resolution_budget");
    await recordIncident(
      context,
      snapshot.chain,
      "proposal_missing_after_resolution_budget",
      "result proposal did not appear within the proposal-lag budget",
      snapshot,
      screenshotTargets,
    );
  }

  if (
    lifecycle === "OPEN" &&
    (health?.quoteAgeMs ?? null) != null &&
    Number(health?.quoteAgeMs ?? 0) > args.pollMs * 2
  ) {
    state.staleQuotePolls += 1;
  } else {
    state.staleQuotePolls = 0;
  }

  if (state.staleQuotePolls > 2) {
    current.incidents.push("persistent_stale_quote_health");
    await recordIncident(
      context,
      snapshot.chain,
      "persistent_stale_quote_health",
      "quote health remained stale for more than two polling intervals",
      snapshot,
      screenshotTargets,
    );
    state.staleQuotePolls = 0;
  }

  if (
    context.canaryTradesEnabled &&
    current.trade == null &&
    lifecycle === "OPEN" &&
    hasTwoSidedQuotes(health) &&
    shouldTradeCycle(current.cycleIndex)
  ) {
    try {
      const intent = current.cycleIndex % 2 === 1 ? "YES" : "NO";
      current.trade = await executeCanaryTrade(snapshot, intent);
      if (!current.trade.matched) {
        current.incidents.push("canary_trade_no_fill");
        await recordIncident(
          context,
          snapshot.chain,
          "canary_trade_no_fill",
          "canary trade landed but did not create matched exposure",
          { snapshot, trade: current.trade },
          screenshotTargets,
        );
      }
    } catch (error) {
      current.incidents.push("canary_trade_failed");
      await recordIncident(
        context,
        snapshot.chain,
        "canary_trade_failed",
        String(error),
        snapshot,
        screenshotTargets,
      );
    }
  }

  if (
    current.trade != null &&
    current.trade.matched &&
    current.terminalAtMs != null &&
    current.trade.claimAttemptedAtMs == null
  ) {
    try {
      const claim = await claimCanaryExposure(snapshot, current.trade);
      current.trade.claimAttemptedAtMs = Date.now();
      current.trade.syncTxRef = claim.syncTxRef;
      current.trade.claimTxRef = claim.claimTxRef;
      current.trade.clearedAtMs = claim.cleared ? Date.now() : null;
      current.trade.residual = claim.residual;
      if (claim.cleared) {
        await maybeRecordMilestone(
          context,
          `${snapshot.chain}-first-claim-clear`,
          { snapshot, trade: current.trade },
          screenshotTargets,
        );
      } else {
        current.incidents.push("claim_residual_not_cleared");
        await recordIncident(
          context,
          snapshot.chain,
          "claim_residual_not_cleared",
          "claim/refund completed but residual exposure remained",
          { snapshot, trade: current.trade, claim },
          screenshotTargets,
        );
      }
    } catch (error) {
      current.incidents.push("claim_failed");
      await recordIncident(
        context,
        snapshot.chain,
        "claim_failed",
        String(error),
        { snapshot, trade: current.trade },
        screenshotTargets,
      );
    }
  }
}

async function maybeRecordMilestone(
  context: StagedContext,
  key: string,
  payload: unknown,
  screenshotTargets: ScreenshotTarget[],
): Promise<void> {
  if (context.milestoneScreenshots.has(key)) {
    return;
  }
  context.milestoneScreenshots.add(key);
  await recordContextEvent(context, key, payload, screenshotTargets);
}

function shouldTradeCycle(cycleIndex: number): boolean {
  return cycleIndex <= 4 || cycleIndex % 4 === 0;
}

async function executeCanaryTrade(
  snapshot: ChainSnapshot,
  intent: CanaryIntent,
): Promise<TradeRecord> {
  if (!snapshot.active?.duel?.duelKey) {
    throw new Error(
      `${snapshot.chain} active duel key missing for canary trade`,
    );
  }
  if (snapshot.chain === "solana") {
    return executeSolanaCanaryTrade(snapshot, intent);
  }
  return executeEvmCanaryTrade(snapshot, intent);
}

function requiredEvmEnv(
  chain: Exclude<SupportedChain, "solana">,
  suffix: string,
): string {
  return requiredEnv(`HYPERBET_${chain.toUpperCase()}_STAGING_${suffix}`);
}

async function executeEvmCanaryTrade(
  snapshot: ChainSnapshot,
  intent: CanaryIntent,
): Promise<TradeRecord> {
  const chain = snapshot.chain as Exclude<SupportedChain, "solana">;
  const rpcUrl = requiredEvmEnv(chain, "RPC_URL");
  const privateKey = requiredEvmEnv(
    chain,
    "CANARY_PRIVATE_KEY",
  ) as `0x${string}`;
  const deployment = resolveBettingEvmDeploymentForChain(chain, "testnet");
  const clobAddress =
    (optionalEnv(
      `HYPERBET_${chain.toUpperCase()}_STAGING_GOLD_CLOB_ADDRESS`,
    ) as Address | null) ?? (deployment.goldClobAddress as Address);
  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({ transport: http(rpcUrl) });
  const walletClient = createWalletClient({
    account,
    transport: http(rpcUrl),
  });

  const duelKey =
    `0x${snapshot.active!.duel.duelKey.replace(/^0x/i, "")}` as Hash;
  const market = await publicClient.readContract({
    address: clobAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "getMarket",
    args: [duelKey, MARKET_KIND_DUEL_WINNER],
  });

  const bestBid = Number(
    (market as { bestBid?: bigint | number }).bestBid ?? 0,
  );
  const bestAsk = Number(
    (market as { bestAsk?: bigint | number }).bestAsk ?? 1000,
  );
  const side = intent === "YES" ? BUY_SIDE : SELL_SIDE;
  const price = intent === "YES" ? bestAsk : bestBid;
  if (
    (intent === "YES" && !(price > 0 && price < 1000)) ||
    (intent === "NO" && !(price > 0 && price < 1000))
  ) {
    throw new Error(`${chain} has no executable ${intent} quote`);
  }

  const amount = BigInt(
    optionalEnv(`PM_SOAK_${chain.toUpperCase()}_CANARY_AMOUNT`) ??
      DEFAULT_EVM_CANARY_AMOUNT.toString(),
  );
  const value = quoteOrderValue(side, price, amount);
  const txRef = await walletClient.writeContract({
    chain: undefined,
    account,
    address: clobAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "placeOrder",
    args: [
      duelKey,
      MARKET_KIND_DUEL_WINNER,
      side,
      price,
      amount,
      ORDER_FLAG_IOC,
    ],
    value,
  });
  await publicClient.waitForTransactionReceipt({ hash: txRef });

  const marketKey = await publicClient.readContract({
    address: clobAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "marketKey",
    args: [duelKey, MARKET_KIND_DUEL_WINNER],
  });
  const position = await publicClient.readContract({
    address: clobAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "positions",
    args: [marketKey as Hash, account.address],
  });
  const residual = normalizeEvmPosition(position);
  const matched = hasNonZeroValues(residual);

  return {
    intent,
    attemptedAtMs: Date.now(),
    amount: amount.toString(),
    side,
    price,
    txRef,
    matched,
    claimAttemptedAtMs: null,
    claimTxRef: null,
    syncTxRef: null,
    clearedAtMs: null,
    residual,
  };
}

function normalizeEvmPosition(value: unknown): Record<string, string> {
  const tuple = value as {
    aShares?: bigint;
    bShares?: bigint;
    aStake?: bigint;
    bStake?: bigint;
  };
  return {
    aShares: BigInt(tuple.aShares ?? 0n).toString(),
    bShares: BigInt(tuple.bShares ?? 0n).toString(),
    aStake: BigInt(tuple.aStake ?? 0n).toString(),
    bStake: BigInt(tuple.bStake ?? 0n).toString(),
  };
}

function hasNonZeroValues(record: Record<string, string>): boolean {
  return Object.values(record).some((value) => BigInt(value) > 0n);
}

async function claimEvmExposure(
  snapshot: ChainSnapshot,
  trade: TradeRecord,
): Promise<{
  syncTxRef: string | null;
  claimTxRef: string | null;
  cleared: boolean;
  residual: Record<string, string>;
}> {
  const chain = snapshot.chain as Exclude<SupportedChain, "solana">;
  const rpcUrl = requiredEvmEnv(chain, "RPC_URL");
  const privateKey = requiredEvmEnv(
    chain,
    "CANARY_PRIVATE_KEY",
  ) as `0x${string}`;
  const deployment = resolveBettingEvmDeploymentForChain(chain, "testnet");
  const clobAddress =
    (optionalEnv(
      `HYPERBET_${chain.toUpperCase()}_STAGING_GOLD_CLOB_ADDRESS`,
    ) as Address | null) ?? (deployment.goldClobAddress as Address);
  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({ transport: http(rpcUrl) });
  const walletClient = createWalletClient({
    account,
    transport: http(rpcUrl),
  });
  const duelKey =
    `0x${snapshot.active!.duel.duelKey.replace(/^0x/i, "")}` as Hash;
  const marketKey = await publicClient.readContract({
    address: clobAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "marketKey",
    args: [duelKey, MARKET_KIND_DUEL_WINNER],
  });
  const before = normalizeEvmPosition(
    await publicClient.readContract({
      address: clobAddress,
      abi: GOLD_CLOB_ABI,
      functionName: "positions",
      args: [marketKey as Hash, account.address],
    }),
  );
  if (!hasNonZeroValues(before)) {
    return {
      syncTxRef: null,
      claimTxRef: null,
      cleared: true,
      residual: before,
    };
  }

  let syncTxRef: string | null = null;
  try {
    syncTxRef = await walletClient.writeContract({
      chain: undefined,
      account,
      address: clobAddress,
      abi: GOLD_CLOB_ABI,
      functionName: "syncMarketFromOracle",
      args: [duelKey, MARKET_KIND_DUEL_WINNER],
    });
    await publicClient.waitForTransactionReceipt({ hash: syncTxRef as Hash });
  } catch {
    // sync is best effort here; claim may still succeed if the keeper already synced state
  }

  const claimTxRef = await walletClient.writeContract({
    chain: undefined,
    account,
    address: clobAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "claim",
    args: [duelKey, MARKET_KIND_DUEL_WINNER],
  });
  await publicClient.waitForTransactionReceipt({ hash: claimTxRef });
  const after = normalizeEvmPosition(
    await publicClient.readContract({
      address: clobAddress,
      abi: GOLD_CLOB_ABI,
      functionName: "positions",
      args: [marketKey as Hash, account.address],
    }),
  );
  return {
    syncTxRef,
    claimTxRef,
    cleared: !hasNonZeroValues(after),
    residual: after,
  };
}

function bnLikeToBigInt(value: unknown): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number") {
    return BigInt(value);
  }
  if (
    value &&
    typeof value === "object" &&
    "toString" in (value as { toString?: unknown })
  ) {
    return BigInt(String((value as { toString: () => string }).toString()));
  }
  return 0n;
}

async function buildSolanaRemainingAccounts(
  clobProgram: ReturnType<typeof createPrograms>["goldClobMarket"],
  marketState: SolanaPublicKey,
  side: number,
  price: number,
  amountLamports: bigint,
): Promise<AccountMeta[]> {
  const metas: AccountMeta[] = [];
  const marketAccount =
    await clobProgram.account.marketState.fetch(marketState);
  const oppositeSide = side === SIDE_BID ? SIDE_ASK : SIDE_BID;
  let remaining = amountLamports;
  let boundary =
    side === SIDE_BID
      ? Number(marketAccount.bestAsk ?? 1000)
      : Number(marketAccount.bestBid ?? 0);
  let matches = 0;

  while (remaining > 0n && matches < MAX_MATCH_ACCOUNTS) {
    const crosses =
      side === SIDE_BID
        ? boundary > 0 && boundary < 1000 && boundary <= price
        : boundary > 0 && boundary < 1000 && boundary >= price;
    if (!crosses) {
      break;
    }

    const levelPda = findPriceLevelPda(
      clobProgram.programId,
      marketState,
      oppositeSide,
      boundary,
    );
    const level = await clobProgram.account.priceLevel.fetchNullable(levelPda);
    if (!level) {
      break;
    }
    metas.push({ pubkey: levelPda, isSigner: false, isWritable: true });

    let currentHead = bnLikeToBigInt(level.headOrderId);
    let currentLevelOpen = bnLikeToBigInt(level.totalOpen);
    if (currentLevelOpen === 0n || currentHead === 0n) {
      boundary = side === SIDE_BID ? boundary + 1 : boundary - 1;
      matches += 1;
      continue;
    }

    while (remaining > 0n && currentHead > 0n && currentLevelOpen > 0n) {
      const orderPda = findOrderPda(
        clobProgram.programId,
        marketState,
        currentHead,
      );
      const order = await clobProgram.account.order.fetch(orderPda);
      const maker = order.maker as SolanaPublicKey;
      const makerBalancePda = findUserBalancePda(
        clobProgram.programId,
        marketState,
        maker,
      );
      metas.push(
        { pubkey: orderPda, isSigner: false, isWritable: true },
        { pubkey: makerBalancePda, isSigner: false, isWritable: true },
      );

      const orderRemaining =
        bnLikeToBigInt(order.amount) - bnLikeToBigInt(order.filled);
      if (orderRemaining <= 0n || !order.active) {
        break;
      }
      if (orderRemaining >= remaining) {
        remaining = 0n;
        break;
      }
      remaining -= orderRemaining;
      currentLevelOpen -= orderRemaining;
      currentHead = bnLikeToBigInt(order.nextOrderId);
      matches += 1;
      if (remaining > 0n && currentHead > 0n && currentLevelOpen > 0n) {
        metas.push({ pubkey: levelPda, isSigner: false, isWritable: true });
      }
    }

    boundary = side === SIDE_BID ? boundary + 1 : boundary - 1;
    matches += 1;
  }

  return metas;
}

async function executeSolanaCanaryTrade(
  snapshot: ChainSnapshot,
  intent: CanaryIntent,
): Promise<TradeRecord> {
  const rpcUrl = requiredEnv("HYPERBET_SOLANA_STAGING_RPC_URL");
  const trader = readKeypair(
    requiredEnv("HYPERBET_SOLANA_STAGING_CANARY_KEYPAIR"),
  );
  process.env.SOLANA_RPC_URL = rpcUrl;
  process.env.SOLANA_CLUSTER = "devnet";

  const programs = createPrograms(trader);
  const clobProgram = programs.goldClobMarket;
  const marketState = new PublicKey(
    snapshot.active?.markets.find(
      (candidate) => candidate.chainKey === "solana",
    )?.marketRef ?? "",
  );
  const duelKeyHex = snapshot.active?.duel?.duelKey?.replace(/^0x/i, "") ?? "";
  const duelState = findDuelStatePda(
    FIGHT_ORACLE_PROGRAM_ID,
    duelKeyHexToBytes(duelKeyHex),
  );
  const marketAccount =
    await clobProgram.account.marketState.fetch(marketState);
  const side = intent === "YES" ? SIDE_BID : SIDE_ASK;
  const price =
    intent === "YES"
      ? Number(marketAccount.bestAsk ?? 1000)
      : Number(marketAccount.bestBid ?? 0);
  if (!(price > 0 && price < 1000)) {
    throw new Error(`solana has no executable ${intent} quote`);
  }

  const amountLamports = BigInt(
    optionalEnv("PM_SOAK_SOLANA_CANARY_LAMPORTS") ??
      DEFAULT_SOLANA_CANARY_LAMPORTS.toString(),
  );
  const nextOrderId = bnLikeToBigInt(marketAccount.nextOrderId);
  const configPda = findMarketConfigPda(clobProgram.programId);
  const config = await clobProgram.account.marketConfig.fetch(configPda);
  const userBalance = findUserBalancePda(
    clobProgram.programId,
    marketState,
    trader.publicKey,
  );
  const remainingAccounts = await buildSolanaRemainingAccounts(
    clobProgram,
    marketState,
    side,
    price,
    amountLamports,
  );

  const txRef = await clobProgram.methods
    .placeOrder(
      new BN(nextOrderId.toString()),
      side,
      price,
      new BN(amountLamports.toString()),
      ORDER_BEHAVIOR_IOC,
    )
    .accountsPartial({
      marketState,
      duelState,
      userBalance,
      newOrder: findOrderPda(clobProgram.programId, marketState, nextOrderId),
      restingLevel: findPriceLevelPda(
        clobProgram.programId,
        marketState,
        side,
        price,
      ),
      config: configPda,
      treasury: config.treasury,
      marketMaker: config.marketMaker,
      vault: findClobVaultPda(clobProgram.programId, marketState),
      user: trader.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(remainingAccounts)
    .signers([trader])
    .rpc();

  const after =
    await clobProgram.account.userBalance.fetchNullable(userBalance);
  const residual = normalizeSolanaBalance(after);
  const matched = hasNonZeroValues(residual);

  return {
    intent,
    attemptedAtMs: Date.now(),
    amount: amountLamports.toString(),
    side,
    price,
    txRef,
    matched,
    claimAttemptedAtMs: null,
    claimTxRef: null,
    syncTxRef: null,
    clearedAtMs: null,
    residual,
  };
}

function normalizeSolanaBalance(balance: unknown): Record<string, string> {
  const typed = balance as {
    aShares?: unknown;
    bShares?: unknown;
    aLockedLamports?: unknown;
    bLockedLamports?: unknown;
    aStake?: unknown;
    bStake?: unknown;
  } | null;
  return {
    aShares: bnLikeToBigInt(typed?.aShares).toString(),
    bShares: bnLikeToBigInt(typed?.bShares).toString(),
    aStake: bnLikeToBigInt(typed?.aStake ?? typed?.aLockedLamports).toString(),
    bStake: bnLikeToBigInt(typed?.bStake ?? typed?.bLockedLamports).toString(),
  };
}

async function claimSolanaExposure(
  snapshot: ChainSnapshot,
  trade: TradeRecord,
): Promise<{
  syncTxRef: string | null;
  claimTxRef: string | null;
  cleared: boolean;
  residual: Record<string, string>;
}> {
  const rpcUrl = requiredEnv("HYPERBET_SOLANA_STAGING_RPC_URL");
  const trader = readKeypair(
    requiredEnv("HYPERBET_SOLANA_STAGING_CANARY_KEYPAIR"),
  );
  process.env.SOLANA_RPC_URL = rpcUrl;
  process.env.SOLANA_CLUSTER = "devnet";
  const programs = createPrograms(trader);
  const clobProgram = programs.goldClobMarket;
  const marketState = new PublicKey(
    snapshot.active?.markets.find(
      (candidate) => candidate.chainKey === "solana",
    )?.marketRef ?? "",
  );
  const duelKeyHex = snapshot.active?.duel?.duelKey?.replace(/^0x/i, "") ?? "";
  const duelState = findDuelStatePda(
    FIGHT_ORACLE_PROGRAM_ID,
    duelKeyHexToBytes(duelKeyHex),
  );
  const configPda = findMarketConfigPda(clobProgram.programId);
  const config = await clobProgram.account.marketConfig.fetch(configPda);
  const userBalance = findUserBalancePda(
    clobProgram.programId,
    marketState,
    trader.publicKey,
  );
  const before = normalizeSolanaBalance(
    await clobProgram.account.userBalance.fetchNullable(userBalance),
  );
  if (!hasNonZeroValues(before)) {
    return {
      syncTxRef: null,
      claimTxRef: null,
      cleared: true,
      residual: before,
    };
  }

  let syncTxRef: string | null = null;
  try {
    syncTxRef = await clobProgram.methods
      .syncMarketFromDuel()
      .accountsPartial({
        marketState,
        duelState,
      })
      .rpc();
  } catch {
    // best effort
  }

  const claimTxRef = await clobProgram.methods
    .claim()
    .accountsPartial({
      marketState,
      duelState,
      userBalance,
      config: configPda,
      marketMaker: config.marketMaker,
      vault: findClobVaultPda(clobProgram.programId, marketState),
      user: trader.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([trader])
    .rpc();

  const after = normalizeSolanaBalance(
    await clobProgram.account.userBalance.fetchNullable(userBalance),
  );
  return {
    syncTxRef,
    claimTxRef,
    cleared: !hasNonZeroValues(after),
    residual: after,
  };
}

async function claimCanaryExposure(
  snapshot: ChainSnapshot,
  trade: TradeRecord,
): Promise<{
  syncTxRef: string | null;
  claimTxRef: string | null;
  cleared: boolean;
  residual: Record<string, string>;
}> {
  if (snapshot.chain === "solana") {
    return claimSolanaExposure(snapshot, trade);
  }
  return claimEvmExposure(snapshot, trade);
}

let stopping = false;

async function shutdown(signal: string): Promise<void> {
  if (stopping) {
    return;
  }
  stopping = true;
  console.log(`[pm-soak] received ${signal}, stopping soak loop`);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

async function main(): Promise<void> {
  const args = parseArgs();
  writeJsonArtifact(args.artifactRoot, "metadata.json", {
    startedAt: nowIso(),
    mode: args.mode,
    runScope: args.runScope,
    follow: args.follow,
    chains: args.chains,
    durationMin: args.durationMin,
    pollMs: args.pollMs,
    artifactRoot: args.artifactRoot,
  });

  if (args.mode === "local") {
    await runLocalSoak(args);
    return;
  }

  await runStagedSoak(args);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
    .catch((error) => {
      console.error(`[pm-soak] failed: ${String(error)}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeScreenshotSession().catch(() => undefined);
      if ((process.exitCode ?? 0) !== 0) {
        process.exit(process.exitCode ?? 1);
      }
    });
}

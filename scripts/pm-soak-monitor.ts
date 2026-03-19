import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import BN from "../packages/hyperbet-solana/keeper/node_modules/bn.js/lib/bn.js";
import * as solanaWeb3 from "../packages/hyperbet-solana/keeper/node_modules/@solana/web3.js/lib/index.esm.js";
import * as viem from "../packages/hyperbet-bsc/keeper/node_modules/viem/_esm/index.js";
import * as viemAccounts from "../packages/hyperbet-bsc/keeper/node_modules/viem/_esm/accounts/index.js";

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

const execFileAsync = promisify(execFile);
const { PublicKey, SystemProgram } = solanaWeb3;
const { createPublicClient, createWalletClient, http } = viem;
const { privateKeyToAccount } = viemAccounts;

type AccountMeta = solanaWeb3.AccountMeta;
type Address = `0x${string}`;
type Hash = `0x${string}`;

const BUY_SIDE = 1;
const SELL_SIDE = 2;
const MARKET_KIND_DUEL_WINNER = 0;
const ORDER_FLAG_IOC = 0x02;
const BASELINE_DUEL_CYCLE_MS = 185_000;
const LOCAL_CYCLE_DRIFT_MS = 45_000;
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
  [key: string]: JsonValue | undefined;
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
  chain: SupportedChain;
  buildInfo: BuildInfo | null;
  status: KeeperStatusResponse | null;
  active: PredictionMarketsResponse | null;
  botHealth: BotHealthResponse | null;
  streamState: StreamState | null;
  fetchedAtMs: number;
};

type LocalSummary = {
  mode: "local";
  startedAt: string;
  completedAt: string;
  durationMs: number;
  pollMs: number;
  artifactRoot: string;
  cyclesObserved: number;
  cycleDurationsMs: number[];
  bothUiReachable: boolean;
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
  chains: SupportedChain[];
  incidents: Incident[];
  chainSummary: Record<SupportedChain, StagedChainSummary>;
  pass: boolean;
};

type MonitorArgs = {
  mode: MonitorMode;
  chains: SupportedChain[];
  durationMin: number;
  pollMs: number;
  artifactRoot: string;
};

type LocalContext = {
  artifactRoot: string;
  screenshotsEnabled: boolean;
  screenshotTargets: ScreenshotTarget[];
  incidents: Incident[];
  captureIndex: number;
};

type StagedContext = {
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
      String(mode === "local" ? DEFAULT_LOCAL_DURATION_MIN : DEFAULT_STAGED_DURATION_MIN),
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
    chains,
    durationMin,
    pollMs,
    artifactRoot,
  };
}

function getArg(args: string[], name: string, fallback: string): string {
  const prefix = `${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? fallback;
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

async function requestJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
    },
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${raw}`);
  }
  return JSON.parse(raw) as T;
}

function currentCycleId(streamState: StreamState | null, active: PredictionMarketsResponse | null): string {
  return (
    streamState?.cycle?.cycleId ||
    streamState?.cycle?.duelKeyHex ||
    streamState?.cycle?.duelKey ||
    active?.duel?.duelKey ||
    active?.duel?.duelId ||
    "unknown"
  );
}

function currentDuelKey(streamState: StreamState | null, active: PredictionMarketsResponse | null): string {
  return (
    streamState?.cycle?.duelKeyHex ||
    streamState?.cycle?.duelKey ||
    streamState?.duel?.duelKey ||
    active?.duel?.duelKey ||
    active?.duel?.duelId ||
    "unknown"
  );
}

function currentPhase(streamState: StreamState | null, active: PredictionMarketsResponse | null): string {
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

function proposalLifecycle(status: string | null | undefined): boolean {
  return status === "PROPOSED" || status === "CHALLENGED" || terminalLifecycle(status);
}

function hasTwoSidedQuotes(health: KeeperMarketHealth | null | undefined): boolean {
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

async function takeScreenshot(url: string, filePath: string): Promise<void> {
  await execFileAsync(
    "bunx",
    [
      "playwright",
      "screenshot",
      "--browser",
      "chromium",
      "--device",
      "Desktop Chrome",
      "--full-page",
      "--timeout",
      "30000",
      "--wait-for-timeout",
      "1500",
      url,
      filePath,
    ],
    {
      cwd: rootDir,
      env: process.env,
    },
  );
}

async function captureScreenshots(
  artifactRoot: string,
  label: string,
  targets: ScreenshotTarget[],
  screenshotsEnabled: boolean,
): Promise<string[]> {
  if (!screenshotsEnabled || targets.length === 0) {
    return [];
  }

  const written: string[] = [];
  const screenshotDir = path.join(artifactRoot, "screenshots");
  mkdirSync(screenshotDir, { recursive: true });
  for (const target of targets) {
    const filePath = path.join(screenshotDir, `${label}.${target.name}.png`);
    await takeScreenshot(target.url, filePath);
    written.push(filePath);
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
    const files = await captureScreenshots(
      context.artifactRoot,
      baseName,
      targets,
      context.screenshotsEnabled,
    );
    if (files.length > 0) {
      writeJsonArtifact(
        context.artifactRoot,
        path.join("events", `${baseName}.screenshots.json`),
        files,
      );
    }
  } catch (error) {
    writeJsonArtifact(
      context.artifactRoot,
      path.join("events", `${baseName}.screenshot-error.json`),
      { error: String(error) },
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
  const hyperscapes = optionalEnv("HYPERSCAPES_UI_URL");
  const hyperbet = optionalEnv("HYPERBET_UI_URL");
  if (hyperscapes) {
    targets.push({ name: "hyperscapes", url: hyperscapes });
  }
  if (hyperbet) {
    targets.push({ name: "hyperbet", url: hyperbet });
  }
  return targets;
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
  streamState: StreamState | null;
  active: PredictionMarketsResponse | null;
  status: KeeperStatusResponse | null;
  botHealth: BotHealthResponse | null;
  buildInfo: BuildInfo | null;
  fetchedAtMs: number;
}> {
  const fetchedAtMs = Date.now();
  const streamStateUrl = optionalEnv("STREAM_STATE_URL") ?? "http://127.0.0.1:8080/api/streaming/state";
  const activeMarketsUrl =
    optionalEnv("ACTIVE_MARKETS_URL") ??
    "http://127.0.0.1:8080/api/arena/prediction-markets/active";
  const statusUrl = optionalEnv("KEEPER_STATUS_URL") ?? "http://127.0.0.1:8080/status";
  const botHealthUrl =
    optionalEnv("KEEPER_BOT_HEALTH_URL") ?? "http://127.0.0.1:8080/api/keeper/bot-health";
  const buildInfoUrl = optionalEnv("HYPERBET_BUILD_INFO_URL");

  const [streamState, active, status, botHealth, buildInfo] = await Promise.all([
    requestJson<StreamState>(streamStateUrl),
    requestJson<PredictionMarketsResponse>(activeMarketsUrl),
    requestJson<KeeperStatusResponse>(statusUrl),
    requestJson<BotHealthResponse>(botHealthUrl),
    buildInfoUrl ? requestJson<BuildInfo>(buildInfoUrl) : Promise.resolve(null),
  ]);

  return { streamState, active, status, botHealth, buildInfo, fetchedAtMs };
}

function stagedKeeperUrls(chain: SupportedChain): {
  pagesUrl: string;
  keeperUrl: string;
} {
  const upper = chain.toUpperCase();
  return {
    pagesUrl: normalizeUrl(requiredEnv(`HYPERBET_${upper}_PAGES_STAGING_URL`)),
    keeperUrl: normalizeUrl(requiredEnv(`HYPERBET_${upper}_KEEPER_STAGING_URL`)),
  };
}

async function fetchStagedChainSnapshot(chain: SupportedChain): Promise<ChainSnapshot> {
  const urls = stagedKeeperUrls(chain);
  const fetchedAtMs = Date.now();
  const [buildInfo, status, active, botHealth, streamState] = await Promise.all([
    requestJson<BuildInfo>(`${urls.pagesUrl}/build-info.json`),
    requestJson<KeeperStatusResponse>(`${urls.keeperUrl}/status`),
    requestJson<PredictionMarketsResponse>(
      `${urls.keeperUrl}/api/arena/prediction-markets/active`,
    ),
    requestJson<BotHealthResponse>(`${urls.keeperUrl}/api/keeper/bot-health`),
    requestJson<StreamState>(`${urls.keeperUrl}/api/streaming/state`),
  ]);
  return {
    chain,
    buildInfo,
    status,
    active,
    botHealth,
    streamState,
    fetchedAtMs,
  };
}

async function runLocalSoak(args: MonitorArgs): Promise<void> {
  const context: LocalContext = {
    artifactRoot: args.artifactRoot,
    screenshotsEnabled: (process.env.PM_SOAK_SCREENSHOTS ?? "true") !== "false",
    screenshotTargets: localScreenshotTargets(),
    incidents: [],
    captureIndex: 0,
  };
  const startedAtMs = Date.now();
  const deadline = startedAtMs + args.durationMin * 60_000;

  const cycles: LocalCycleRecord[] = [];
  let currentCycle: LocalCycleRecord | null = null;
  let previousPhase = "";
  let idlePolls = 0;
  let pollIndex = 0;
  let bothUiReachable = true;

  await recordContextEvent(
    context,
    "local-start",
    {
      startedAt: nowIso(),
      durationMin: args.durationMin,
      pollMs: args.pollMs,
      baselineCycleMs: BASELINE_DUEL_CYCLE_MS,
    },
    context.screenshotTargets,
  );

  while (Date.now() < deadline) {
    pollIndex += 1;
    try {
      const snapshot = await fetchLocalSnapshot();
      writeJsonArtifact(
        context.artifactRoot,
        path.join("polls", `${String(pollIndex).padStart(5, "0")}.json`),
        snapshot,
      );

      const cycleId = currentCycleId(snapshot.streamState, snapshot.active);
      const duelKey = currentDuelKey(snapshot.streamState, snapshot.active);
      const phase = currentPhase(snapshot.streamState, snapshot.active);
      const marketCount = snapshot.active?.markets?.length ?? 0;

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
          snapshot,
          context.screenshotTargets,
        );
        throw new Error("local duel stream remained IDLE; seed local agents before running the soak");
      }

      if (!currentCycle || currentCycle.cycleId !== cycleId) {
        if (currentCycle) {
          currentCycle.endedAtMs = snapshot.fetchedAtMs;
          currentCycle.durationMs = currentCycle.endedAtMs - currentCycle.startedAtMs;
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
        await recordContextEvent(
          context,
          `local-cycle-${cycleId}`,
          snapshot,
          context.screenshotTargets,
        );
      }

      currentCycle.marketCountMax = Math.max(currentCycle.marketCountMax, marketCount);
      if (phase && phase !== previousPhase) {
        if (currentCycle.phases[currentCycle.phases.length - 1] !== phase) {
          currentCycle.phases.push(phase);
        }
        await recordContextEvent(
          context,
          `local-phase-${phase}`,
          snapshot,
          context.screenshotTargets,
        );
      }

      previousPhase = phase;

      if (snapshot.status?.ok === false || snapshot.botHealth?.ok === false) {
        await recordIncident(
          context,
          "local",
          "keeper_unhealthy",
          "local keeper status or bot-health endpoint reported not-ok",
          snapshot,
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
        { poll: pollIndex },
        context.screenshotTargets,
      );
    }

    await sleep(args.pollMs);
  }

  if (currentCycle) {
    currentCycle.endedAtMs = Date.now();
    currentCycle.durationMs = currentCycle.endedAtMs - currentCycle.startedAtMs;
    cycles.push(currentCycle);
  }

  const cycleDurationsMs = cycles
    .map((cycle) => cycle.durationMs)
    .filter((value): value is number => Number.isFinite(value));

  for (const cycle of cycles) {
    if (
      cycle.durationMs != null &&
      Math.abs(cycle.durationMs - BASELINE_DUEL_CYCLE_MS) > LOCAL_CYCLE_DRIFT_MS
    ) {
      cycle.incidents.push("cycle_drift");
    }
  }

  const pass =
    context.incidents.length === 0 &&
    cycles.length >= (args.durationMin >= DEFAULT_LOCAL_DURATION_MIN ? 8 : 1) &&
    cycleDurationsMs.every(
      (value) => Math.abs(value - BASELINE_DUEL_CYCLE_MS) <= LOCAL_CYCLE_DRIFT_MS,
    ) &&
    bothUiReachable;

  const summary: LocalSummary = {
    mode: "local",
    startedAt: new Date(startedAtMs).toISOString(),
    completedAt: nowIso(),
    durationMs: Date.now() - startedAtMs,
    pollMs: args.pollMs,
    artifactRoot: context.artifactRoot,
    cyclesObserved: cycles.length,
    cycleDurationsMs,
    bothUiReachable,
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
    throw new Error("local PM soak failed; inspect output/playwright/pm-soak summary and incident artifacts");
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
    artifactRoot: args.artifactRoot,
    screenshotsEnabled: (process.env.PM_SOAK_SCREENSHOTS ?? "true") !== "false",
    incidents: [],
    captureIndex: 0,
    milestoneScreenshots: new Set<string>(),
    canaryTradesEnabled: (process.env.PM_SOAK_ENABLE_CANARY_TRADES ?? "true") !== "false",
    chainScreenshots: {
      solana: args.chains.includes("solana") ? stagedPagesTarget("solana") : null,
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
    const snapshots = await Promise.allSettled(args.chains.map((chain) => fetchStagedChainSnapshot(chain)));
    const pollPayload: Record<string, unknown> = { fetchedAt: nowIso(), pollIndex };
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
      await processStagedSnapshot(args, context, stateByChain.get(chain)!, snapshot, screenshotsFor(chain));
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
      if (cycle.openAtMs != null) summary.openLagMs.push(cycle.openAtMs - cycle.startedAtMs);
      if (cycle.quotesAtMs != null && cycle.openAtMs != null) summary.quoteLagMs.push(cycle.quotesAtMs - cycle.openAtMs);
      if (cycle.lockAtMs != null && cycle.betCloseTimeMs != null) summary.lockLagMs.push(cycle.lockAtMs - cycle.betCloseTimeMs);
      if (cycle.proposalAtMs != null && cycle.resolutionAtMs != null) summary.proposalLagMs.push(cycle.proposalAtMs - cycle.resolutionAtMs);
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
          cycle.quotesAtMs != null && cycle.openAtMs != null ? cycle.quotesAtMs - cycle.openAtMs : "",
          cycle.lockAtMs != null && cycle.betCloseTimeMs != null ? cycle.lockAtMs - cycle.betCloseTimeMs : "",
          cycle.proposalAtMs != null && cycle.resolutionAtMs != null ? cycle.proposalAtMs - cycle.resolutionAtMs : "",
          cycle.trade ? "yes" : "no",
          cycle.trade?.matched ? "yes" : "no",
          cycle.trade?.clearedAtMs != null ? "yes" : "no",
          cycle.incidents.join("|"),
        ].join(","),
      );
    }
  }

  const requiredClaims = args.durationMin >= DEFAULT_STAGED_DURATION_MIN ? 3 : 0;
  const pass =
    context.incidents.length === 0 &&
    args.chains.every((chain) => {
      const summary = chainSummary[chain];
      return (
        summary.openLagMs.every((value) => value <= OPEN_LAG_BUDGET_MS) &&
        summary.quoteLagMs.every((value) => value <= QUOTE_LAG_BUDGET_MS) &&
        summary.lockLagMs.every((value) => value <= LOCK_LAG_BUDGET_MS) &&
        summary.proposalLagMs.every((value) => value <= PROPOSAL_LAG_BUDGET_MS) &&
        summary.claimClears >= requiredClaims
      );
    });

  const summary: StagedSummary = {
    mode: "staged",
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
  writeFileSync(path.join(context.artifactRoot, "cycles.csv"), `${csvRows.join("\n")}\n`);
  await recordContextEvent(
    context,
    "staged-final",
    summary,
    args.chains.flatMap((chain) => screenshotsFor(chain)),
  );

  if (!pass) {
    throw new Error("staged PM soak failed; inspect .ci-artifacts/pm-soak/summary.json and incident artifacts");
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
  const market = snapshot.active?.markets.find((candidate) => candidate.chainKey === snapshot.chain) ?? null;
  const statusChain =
    snapshot.status?.predictionMarkets?.chains?.find(
      (candidate) => candidate.chainKey === snapshot.chain,
    ) ?? null;
  const health =
    (statusChain?.health as KeeperMarketHealth | null | undefined) ??
    snapshot.botHealth?.health?.markets?.find((candidate) => candidate.chainKey === snapshot.chain) ??
    null;
  const lifecycle = statusChain?.lifecycleStatus ?? market?.lifecycleStatus ?? "UNKNOWN";
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
      betCloseTimeMs: snapshot.active?.duel?.betCloseTime ?? statusChain?.betCloseTime ?? null,
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
  current.betCloseTimeMs = snapshot.active?.duel?.betCloseTime ?? current.betCloseTimeMs;

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

  if (hasTwoSidedQuotes(health) && current.quotesAtMs == null && lifecycle === "OPEN") {
    current.quotesAtMs = nowMs;
    await maybeRecordMilestone(
      context,
      `${snapshot.chain}-first-mm-quotes-visible`,
      snapshot,
      screenshotTargets,
    );
  }

  if (current.betCloseTimeMs != null && lifecycle !== "OPEN" && current.lockAtMs == null) {
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

  if (!state.openLagIncident && nowMs - current.startedAtMs > OPEN_LAG_BUDGET_MS && current.openAtMs == null) {
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

  if (lifecycle === "OPEN" && (health?.quoteAgeMs ?? null) != null && Number(health?.quoteAgeMs ?? 0) > args.pollMs * 2) {
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
    throw new Error(`${snapshot.chain} active duel key missing for canary trade`);
  }
  if (snapshot.chain === "solana") {
    return executeSolanaCanaryTrade(snapshot, intent);
  }
  return executeEvmCanaryTrade(snapshot, intent);
}

function requiredEvmEnv(chain: Exclude<SupportedChain, "solana">, suffix: string): string {
  return requiredEnv(`HYPERBET_${chain.toUpperCase()}_STAGING_${suffix}`);
}

async function executeEvmCanaryTrade(
  snapshot: ChainSnapshot,
  intent: CanaryIntent,
): Promise<TradeRecord> {
  const chain = snapshot.chain as Exclude<SupportedChain, "solana">;
  const rpcUrl = requiredEvmEnv(chain, "RPC_URL");
  const privateKey = requiredEvmEnv(chain, "CANARY_PRIVATE_KEY") as `0x${string}`;
  const deployment = resolveBettingEvmDeploymentForChain(
    chain,
    "testnet",
  );
  const clobAddress =
    (optionalEnv(`HYPERBET_${chain.toUpperCase()}_STAGING_GOLD_CLOB_ADDRESS`) as Address | null) ??
    (deployment.goldClobAddress as Address);
  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({ transport: http(rpcUrl) });
  const walletClient = createWalletClient({
    account,
    transport: http(rpcUrl),
  });

  const duelKey = `0x${snapshot.active!.duel.duelKey.replace(/^0x/i, "")}` as Hash;
  const market = await publicClient.readContract({
    address: clobAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "getMarket",
    args: [duelKey, MARKET_KIND_DUEL_WINNER],
  });

  const bestBid = Number((market as { bestBid?: bigint | number }).bestBid ?? 0);
  const bestAsk = Number((market as { bestAsk?: bigint | number }).bestAsk ?? 1000);
  const side = intent === "YES" ? BUY_SIDE : SELL_SIDE;
  const price = intent === "YES" ? bestAsk : bestBid;
  if ((intent === "YES" && !(price > 0 && price < 1000)) || (intent === "NO" && !(price > 0 && price < 1000))) {
    throw new Error(`${chain} has no executable ${intent} quote`);
  }

  const amount = BigInt(optionalEnv(`PM_SOAK_${chain.toUpperCase()}_CANARY_AMOUNT`) ?? DEFAULT_EVM_CANARY_AMOUNT.toString());
  const value = quoteOrderValue(side, price, amount);
  const txRef = await walletClient.writeContract({
    chain: undefined,
    account,
    address: clobAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "placeOrder",
    args: [duelKey, MARKET_KIND_DUEL_WINNER, side, price, amount, ORDER_FLAG_IOC],
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
): Promise<{ syncTxRef: string | null; claimTxRef: string | null; cleared: boolean; residual: Record<string, string> }> {
  const chain = snapshot.chain as Exclude<SupportedChain, "solana">;
  const rpcUrl = requiredEvmEnv(chain, "RPC_URL");
  const privateKey = requiredEvmEnv(chain, "CANARY_PRIVATE_KEY") as `0x${string}`;
  const deployment = resolveBettingEvmDeploymentForChain(chain, "testnet");
  const clobAddress =
    (optionalEnv(`HYPERBET_${chain.toUpperCase()}_STAGING_GOLD_CLOB_ADDRESS`) as Address | null) ??
    (deployment.goldClobAddress as Address);
  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({ transport: http(rpcUrl) });
  const walletClient = createWalletClient({
    account,
    transport: http(rpcUrl),
  });
  const duelKey = `0x${snapshot.active!.duel.duelKey.replace(/^0x/i, "")}` as Hash;
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
  if (value && typeof value === "object" && "toString" in (value as { toString?: unknown })) {
    return BigInt(String((value as { toString: () => string }).toString()));
  }
  return 0n;
}

async function buildSolanaRemainingAccounts(
  clobProgram: ReturnType<typeof createPrograms>["goldClobMarket"],
  marketState: PublicKey,
  side: number,
  price: number,
  amountLamports: bigint,
): Promise<AccountMeta[]> {
  const metas: AccountMeta[] = [];
  const marketAccount = await clobProgram.account.marketState.fetch(marketState);
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
      const orderPda = findOrderPda(clobProgram.programId, marketState, currentHead);
      const order = await clobProgram.account.order.fetch(orderPda);
      const maker = order.maker as PublicKey;
      const makerBalancePda = findUserBalancePda(
        clobProgram.programId,
        marketState,
        maker,
      );
      metas.push(
        { pubkey: orderPda, isSigner: false, isWritable: true },
        { pubkey: makerBalancePda, isSigner: false, isWritable: true },
      );

      const orderRemaining = bnLikeToBigInt(order.amount) - bnLikeToBigInt(order.filled);
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
  const trader = readKeypair(requiredEnv("HYPERBET_SOLANA_STAGING_CANARY_KEYPAIR"));
  process.env.SOLANA_RPC_URL = rpcUrl;
  process.env.SOLANA_CLUSTER = "devnet";

  const programs = createPrograms(trader);
  const clobProgram = programs.goldClobMarket;
  const marketState = new PublicKey(
    snapshot.active?.markets.find((candidate) => candidate.chainKey === "solana")?.marketRef ?? "",
  );
  const duelKeyHex = snapshot.active?.duel?.duelKey?.replace(/^0x/i, "") ?? "";
  const duelState = findDuelStatePda(FIGHT_ORACLE_PROGRAM_ID, duelKeyHexToBytes(duelKeyHex));
  const marketAccount = await clobProgram.account.marketState.fetch(marketState);
  const side = intent === "YES" ? SIDE_BID : SIDE_ASK;
  const price =
    intent === "YES"
      ? Number(marketAccount.bestAsk ?? 1000)
      : Number(marketAccount.bestBid ?? 0);
  if (!(price > 0 && price < 1000)) {
    throw new Error(`solana has no executable ${intent} quote`);
  }

  const amountLamports = BigInt(
    optionalEnv("PM_SOAK_SOLANA_CANARY_LAMPORTS") ?? DEFAULT_SOLANA_CANARY_LAMPORTS.toString(),
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
      restingLevel: findPriceLevelPda(clobProgram.programId, marketState, side, price),
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

  const after = await clobProgram.account.userBalance.fetchNullable(userBalance);
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
): Promise<{ syncTxRef: string | null; claimTxRef: string | null; cleared: boolean; residual: Record<string, string> }> {
  const rpcUrl = requiredEnv("HYPERBET_SOLANA_STAGING_RPC_URL");
  const trader = readKeypair(requiredEnv("HYPERBET_SOLANA_STAGING_CANARY_KEYPAIR"));
  process.env.SOLANA_RPC_URL = rpcUrl;
  process.env.SOLANA_CLUSTER = "devnet";
  const programs = createPrograms(trader);
  const clobProgram = programs.goldClobMarket;
  const marketState = new PublicKey(
    snapshot.active?.markets.find((candidate) => candidate.chainKey === "solana")?.marketRef ?? "",
  );
  const duelKeyHex = snapshot.active?.duel?.duelKey?.replace(/^0x/i, "") ?? "";
  const duelState = findDuelStatePda(FIGHT_ORACLE_PROGRAM_ID, duelKeyHexToBytes(duelKeyHex));
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
    return { syncTxRef: null, claimTxRef: null, cleared: true, residual: before };
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
): Promise<{ syncTxRef: string | null; claimTxRef: string | null; cleared: boolean; residual: Record<string, string> }> {
  if (snapshot.chain === "solana") {
    return claimSolanaExposure(snapshot, trade);
  }
  return claimEvmExposure(snapshot, trade);
}

async function main(): Promise<void> {
  const args = parseArgs();
  writeJsonArtifact(args.artifactRoot, "metadata.json", {
    startedAt: nowIso(),
    mode: args.mode,
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

main().catch((error) => {
  console.error(`[pm-soak] failed: ${String(error)}`);
  process.exit(1);
});

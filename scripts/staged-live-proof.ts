import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  resolveArtifactRoot,
  rootDir,
  writeJsonArtifact,
} from "./ci-lib.js";
import {
  parseAcceptanceDeployment,
  resolveAcceptanceUrls,
  resolveEvmAcceptanceRuntime,
  resolveSolanaAcceptanceRuntime,
  type AcceptanceDeployment,
} from "./testnet-acceptance-env.js";
import {
  BETTING_DEPLOYMENTS,
  isBettingEvmDeploymentCanonicalReady,
} from "../packages/hyperbet-chain-registry/src/index.js";

type ProofMode = "read-only" | "canary-write";
type RunScope = "LIVE_INDICATOR" | "LIVE_CANARY";
type ProofTarget = "all" | "solana" | "bsc" | "avax" | "unified";
type SupportedChain = Exclude<ProofTarget, "all">;

type BuildInfo = {
  commitHash?: string | null;
  builtAt?: string | null;
};

type KeeperStatus = {
  ok?: boolean;
  proxies?: Record<string, boolean>;
  parsers?: Record<string, boolean>;
  predictionMarkets?: {
    marketCount?: number | null;
    chains?: Array<{ chainKey: string }> | null;
  };
};

type LifecycleMarket = {
  chainKey: string;
  duelKey: string | null;
  duelId: string | null;
  marketRef: string | null;
  lifecycleStatus: string;
  contractAddress?: string | null;
  programId?: string | null;
};

type PredictionMarketsResponse = {
  duel: {
    duelKey: string | null;
    duelId: string | null;
    phase: string | null;
    winner: string | null;
    betCloseTime: number | null;
  };
  markets: LifecycleMarket[];
};

type BotHealth = {
  ok?: boolean;
  markets?: unknown[];
};

type ChainUrls = {
  pagesUrl: string;
  keeperUrl: string;
  wsUrl: string;
};

type ReadOnlyChainResult = {
  chain: SupportedChain;
  buildInfo: BuildInfo;
  status: KeeperStatus;
  predictionMarkets: PredictionMarketsResponse;
  perpsMarkets: unknown;
  botHealth: BotHealth;
  streamState: unknown;
  duelContext: unknown;
  proxyResult: unknown;
  canonicalMarket: LifecycleMarket | null;
};

type CheckResult = {
  chain: string;
  ok: boolean;
  details: string;
};

type RedirectAuditResult = {
  sourceUrl: string;
  finalUrl: string | null;
  ok: boolean;
  preservedPath: boolean;
  preservedQuery: boolean;
  status: number | null;
};

type AuditResult = {
  target: string;
  ok: boolean;
  output: string;
};

type CanarySurfaceResult = Record<string, string | null>;

type ChainCanaryResult = {
  duelId: string;
  duelKeyHex: string;
  pm: CanarySurfaceResult;
  perps: CanarySurfaceResult;
  amm: CanarySurfaceResult;
};

type ProofSummary = {
  deployment: AcceptanceDeployment;
  mode: ProofMode;
  runScope: RunScope;
  target: ProofTarget;
  startedAt: string;
  completedAt?: string;
  gitSha: string | null;
  readOnly?: {
    solana?: ReadOnlyChainResult;
    bsc?: ReadOnlyChainResult;
    avax?: ReadOnlyChainResult;
  };
  canary?: {
    solana?: ChainCanaryResult;
    bsc?: ChainCanaryResult;
    avax?: ChainCanaryResult;
  };
  verifyChains?: CheckResult[];
  avaxEnvAudit?: {
    app: AuditResult;
    keeper: AuditResult;
  };
  unifiedEnvAudit?: {
    pages: AuditResult;
    keeper: AuditResult;
  };
  legacyRedirects?: {
    solana: RedirectAuditResult;
    bsc: RedirectAuditResult;
  };
};

const artifactRoot = resolveArtifactRoot("staged-live-proof");
const expectedCommit = process.env.GITHUB_SHA?.trim() || null;

function getOptionalArg(name: string): string | null {
  const prefix = `${name}=`;
  const match = process.argv.find((entry) => entry.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : null;
}

function resolveRunScope(mode: ProofMode): RunScope {
  const explicit = getOptionalArg("--run-scope");
  const envScope = process.env.RUN_SCOPE?.trim();
  const resolved = (
    explicit ??
    envScope ??
    (mode === "canary-write" ? "LIVE_CANARY" : "LIVE_INDICATOR")
  ).toUpperCase();
  if (resolved !== "LIVE_INDICATOR" && resolved !== "LIVE_CANARY") {
    throw new Error(
      `unsupported run scope ${resolved}; expected LIVE_INDICATOR or LIVE_CANARY`,
    );
  }
  if (mode === "read-only" && resolved !== "LIVE_INDICATOR") {
    throw new Error(`read-only proof requires run scope LIVE_INDICATOR`);
  }
  if (mode === "canary-write" && resolved !== "LIVE_CANARY") {
    throw new Error(`canary-write proof requires run scope LIVE_CANARY`);
  }
  return resolved as RunScope;
}

function parseArgs(): {
  deployment: AcceptanceDeployment;
  mode: ProofMode;
  target: ProofTarget;
  runScope: RunScope;
} {
  const args = process.argv.slice(2);
  const deploymentArg =
    args.find((arg) => arg.startsWith("--deployment="))?.slice("--deployment=".length) ??
    process.env.HYPERBET_ACCEPTANCE_DEPLOYMENT ??
    "testnet";
  const modeArg =
    args.find((arg) => arg.startsWith("--mode="))?.slice("--mode=".length) ??
    "read-only";
  const targetArg =
    args.find((arg) => arg.startsWith("--target="))?.slice("--target=".length) ??
    "all";

  if (modeArg !== "read-only" && modeArg !== "canary-write") {
    throw new Error(`unsupported proof mode ${modeArg}`);
  }
  if (
    targetArg !== "all" &&
    targetArg !== "solana" &&
    targetArg !== "bsc" &&
    targetArg !== "avax" &&
    targetArg !== "unified"
  ) {
    throw new Error(`unsupported proof target ${targetArg}`);
  }
  return {
    deployment: parseAcceptanceDeployment(deploymentArg),
    mode: modeArg,
    target: targetArg,
    runScope: resolveRunScope(modeArg),
  };
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (!value) {
    throw new Error(`Missing required env ${name}`);
  }
  return value;
}

function requireAnyEnv(names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim() ?? "";
    if (value) {
      return value;
    }
  }
  throw new Error(`Missing required env; expected one of ${names.join(", ")}`);
}

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/$/, "");
}

function assertUnifiedReadOnlySurface(
  chain: SupportedChain,
  status: KeeperStatus,
  predictionMarkets: PredictionMarketsResponse,
): void {
  const marketChains = Array.from(
    new Set(predictionMarkets.markets.map((market) => market.chainKey)),
  ).sort();
  const statusChains = Array.from(
    new Set((status.predictionMarkets?.chains ?? []).map((market) => market.chainKey)),
  ).sort();
  const expectedChains = ["bsc", "solana"];
  const combinedChains = Array.from(new Set([...marketChains, ...statusChains])).sort();

  if (combinedChains.length !== expectedChains.length) {
    throw new Error(
      `${chain} unified surface exposed unexpected chain count: ${combinedChains.join(", ") || "none"}`,
    );
  }
  if (expectedChains.some((expected, index) => combinedChains[index] !== expected)) {
    throw new Error(
      `${chain} unified surface exposed unexpected chains: ${combinedChains.join(", ")}`,
    );
  }

  const marketCount = status.predictionMarkets?.marketCount ?? predictionMarkets.markets.length;
  if (marketCount !== 2) {
    throw new Error(`${chain} unified surface reported marketCount=${marketCount}, expected 2`);
  }
}

async function verifyLegacyRedirect(
  sourceBaseUrl: string,
  unifiedBaseUrl: string,
  pathname: string,
  searchParams: URLSearchParams,
): Promise<RedirectAuditResult> {
  const source = new URL(`${normalizeUrl(sourceBaseUrl)}${pathname}`);
  source.search = searchParams.toString();
  try {
    const response = await fetch(source.toString(), { redirect: "follow" });
    const finalUrl = response.url || null;
    const final = finalUrl ? new URL(finalUrl) : null;
    const expectedBase = normalizeUrl(unifiedBaseUrl);
    return {
      sourceUrl: source.toString(),
      finalUrl,
      ok:
        response.ok &&
        finalUrl != null &&
        normalizeUrl(`${final.protocol}//${final.host}`) === expectedBase,
      preservedPath: final?.pathname === source.pathname,
      preservedQuery: final?.search === source.search,
      status: response.status,
    };
  } catch {
    return {
      sourceUrl: source.toString(),
      finalUrl: null,
      ok: false,
      preservedPath: false,
      preservedQuery: false,
      status: null,
    };
  }
}

async function verifyUnifiedLegacyRedirects(): Promise<{
  solana: RedirectAuditResult;
  bsc: RedirectAuditResult;
}> {
  const unifiedPagesUrl = requireEnv("ENOOMIAN_HYPERBET_PAGES_URL");
  const searchParams = new URLSearchParams({
    proof_redirect: "1",
    preserved: "true",
  });
  return {
    solana: await verifyLegacyRedirect(
      requireEnv("ENOOMIAN_HYPERBET_SOLANA_PAGES_URL"),
      unifiedPagesUrl,
      "/markets",
      searchParams,
    ),
    bsc: await verifyLegacyRedirect(
      requireEnv("ENOOMIAN_HYPERBET_BSC_PAGES_URL"),
      unifiedPagesUrl,
      "/markets",
      searchParams,
    ),
  };
}

function chainUrls(chain: SupportedChain, requireUnifiedUrls = false): ChainUrls {
  const urls = resolveAcceptanceUrls(
    chain,
    process.env,
    requireUnifiedUrls ? { requireUnified: true } : {},
  );
  return {
    pagesUrl: normalizeUrl(urls.pagesUrl),
    keeperUrl: normalizeUrl(urls.keeperUrl),
    wsUrl: normalizeUrl(urls.wsUrl),
  };
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

async function requestJson<T>(
  url: string,
  init?: RequestInit,
  artifactName?: string,
): Promise<T> {
  const response = await fetch(url, init);
  const raw = await response.text();
  if (artifactName) {
    writeJsonArtifact(artifactRoot, artifactName, {
      url,
      status: response.status,
      body: safeJson(raw),
    });
  }
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${raw}`);
  }
  return JSON.parse(raw) as T;
}

async function postJson<T>(
  url: string,
  body: unknown,
  artifactName: string,
  headers?: Record<string, string>,
): Promise<T> {
  return requestJson<T>(
    url,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(headers ?? {}),
      },
      body: JSON.stringify(body),
    },
    artifactName,
  );
}

function findCanonicalMarket(
  payload: PredictionMarketsResponse,
  chainKey: SupportedChain,
): LifecycleMarket | null {
  return payload.markets.find((market) => market.chainKey === chainKey) ?? null;
}

async function runReadOnly(
  chain: SupportedChain,
  requireUnifiedUrls = false,
): Promise<ReadOnlyChainResult> {
  const urls = chainUrls(chain, requireUnifiedUrls);
  const buildInfo = await requestJson<BuildInfo>(
    `${urls.pagesUrl}/build-info.json`,
    undefined,
    `${chain}/build-info.json`,
  );
  if (expectedCommit && buildInfo.commitHash !== expectedCommit) {
    throw new Error(
      `${chain} build-info mismatch: expected ${expectedCommit}, got ${buildInfo.commitHash ?? "missing"}`,
    );
  }

  const status = await requestJson<KeeperStatus>(
    `${urls.keeperUrl}/status`,
    undefined,
    `${chain}/status.json`,
  );
  if (!status.ok) {
    throw new Error(`${chain} /status reported not ok`);
  }

  const predictionMarkets = await requestJson<PredictionMarketsResponse>(
    `${urls.keeperUrl}/api/arena/prediction-markets/active`,
    undefined,
    `${chain}/prediction-markets.json`,
  );
  if (requireUnifiedUrls) {
    assertUnifiedReadOnlySurface(chain, status, predictionMarkets);
  }
  const perpsMarkets = await requestJson<unknown>(
    `${urls.keeperUrl}/api/perps/markets`,
    undefined,
    `${chain}/perps-markets.json`,
  );
  const botHealth = await requestJson<BotHealth>(
    `${urls.keeperUrl}/api/keeper/bot-health`,
    undefined,
    `${chain}/bot-health.json`,
  );
  const streamState = await requestJson<unknown>(
    `${urls.keeperUrl}/api/streaming/state`,
    undefined,
    `${chain}/stream-state.json`,
  );
  const duelContext = await requestJson<unknown>(
    `${urls.keeperUrl}/api/streaming/duel-context`,
    undefined,
    `${chain}/duel-context.json`,
  );
  const proxyResult =
    chain === "solana"
      ? await postJson<unknown>(
          `${urls.keeperUrl}/api/proxy/solana/rpc`,
          { jsonrpc: "2.0", id: 1, method: "getHealth", params: [] },
          `${chain}/proxy.json`,
        )
      : await postJson<unknown>(
          `${urls.keeperUrl}/api/proxy/evm/rpc?chain=${chain}`,
          { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] },
          `${chain}/proxy.json`,
        );

  return {
    chain,
    buildInfo,
    status,
    predictionMarkets,
    perpsMarkets,
    botHealth,
    streamState,
    duelContext,
    proxyResult,
    canonicalMarket: findCanonicalMarket(predictionMarkets, chain),
  };
}

function parseJsonStdout<T>(label: string, stdout: string): T {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error(`${label} produced no JSON output`);
  }
  const lines = trimmed.split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]) as T;
    } catch {
      continue;
    }
  }
  throw new Error(`${label} did not emit parseable JSON output`);
}

function runJsonCommand<T>(
  label: string,
  command: string,
  args: string[],
  env?: Record<string, string>,
): T {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  const combinedOutput = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  writeJsonArtifact(artifactRoot, `${label}.command.json`, {
    command,
    args,
    exitCode: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  });
  if (result.status !== 0) {
    throw new Error(
      `${label} failed with exit ${result.status ?? 1}${combinedOutput ? `\n${combinedOutput}` : ""}`,
    );
  }
  return parseJsonStdout<T>(label, result.stdout ?? "");
}

function runAudit(
  label: string,
  target: "app:avax" | "keeper:avax" | "pages:unified" | "keeper:unified",
  env: Record<string, string>,
  deployment: "production" | "staging" = "staging",
): AuditResult {
  const result = spawnSync(
    "node",
    [
      "--import",
      "tsx",
      "scripts/ci-env-audit.ts",
      `--target=${target}`,
      `--deployment=${deployment}`,
    ],
    {
      cwd: rootDir,
      env: { ...process.env, ...env },
      encoding: "utf8",
    },
  );
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  writeJsonArtifact(artifactRoot, `${label}.command.json`, {
    command: "node",
    args: [
      "--import",
      "tsx",
      "scripts/ci-env-audit.ts",
      `--target=${target}`,
      `--deployment=${deployment}`,
    ],
    exitCode: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  });
  return {
    target,
    ok: result.status === 0,
    output,
  };
}

function runVerifyChains(
  deployment: AcceptanceDeployment,
  readOnly: {
  solana?: ReadOnlyChainResult;
  bsc?: ReadOnlyChainResult;
  avax?: ReadOnlyChainResult;
},
): CheckResult[] {
  const env: Record<string, string> = {};
  const chains: string[] = [];

  if (readOnly.solana) {
    const runtime = resolveSolanaAcceptanceRuntime(process.env);
    chains.push("solana");
    env.SOLANA_VERIFY_RPC_URL = runtime.rpcUrl;
    env.SOLANA_VERIFY_GOLD_CLOB_PROGRAM_ID =
      readOnly.solana.canonicalMarket?.programId ||
      runtime.goldClobProgramId;
    env.SOLANA_VERIFY_PROGRAM_ID = env.SOLANA_VERIFY_GOLD_CLOB_PROGRAM_ID;
    env.SOLANA_VERIFY_GOLD_AMM_PROGRAM_ID = runtime.goldAmmProgramId;
    env.SOLANA_VERIFY_GOLD_PERPS_PROGRAM_ID = runtime.goldPerpsProgramId;
  }

  if (readOnly.bsc) {
    const runtime = resolveEvmAcceptanceRuntime("bsc", process.env);
    chains.push("bsc");
    env.HYPERBET_BSC_TESTNET_RPC_URL = runtime.rpcUrl;
    env.HYPERBET_BSC_TESTNET_DUEL_ORACLE_ADDRESS = runtime.duelOracleAddress;
    env.HYPERBET_BSC_TESTNET_GOLD_CLOB_ADDRESS =
      readOnly.bsc.canonicalMarket?.contractAddress || runtime.goldClobAddress;
    env.HYPERBET_BSC_TESTNET_GOLD_AMM_ROUTER_ADDRESS = runtime.goldAmmRouterAddress;
    env.HYPERBET_BSC_TESTNET_MUSD_TOKEN_ADDRESS = runtime.mUsdTokenAddress;
    env.HYPERBET_BSC_TESTNET_GOLD_TOKEN_ADDRESS = runtime.goldTokenAddress;
    env.HYPERBET_BSC_TESTNET_SKILL_ORACLE_ADDRESS = runtime.skillOracleAddress;
    env.HYPERBET_BSC_TESTNET_PERP_ENGINE_ADDRESS = runtime.perpEngineAddress;
  }

  if (readOnly.avax) {
    const runtime = resolveEvmAcceptanceRuntime("avax", process.env);
    chains.push("avax");
    env.HYPERBET_AVAX_TESTNET_RPC_URL = runtime.rpcUrl;
    env.HYPERBET_AVAX_TESTNET_DUEL_ORACLE_ADDRESS = runtime.duelOracleAddress;
    env.HYPERBET_AVAX_TESTNET_GOLD_CLOB_ADDRESS =
      readOnly.avax.canonicalMarket?.contractAddress || runtime.goldClobAddress;
    env.HYPERBET_AVAX_TESTNET_GOLD_AMM_ROUTER_ADDRESS = runtime.goldAmmRouterAddress;
    env.HYPERBET_AVAX_TESTNET_MUSD_TOKEN_ADDRESS = runtime.mUsdTokenAddress;
    env.HYPERBET_AVAX_TESTNET_GOLD_TOKEN_ADDRESS = runtime.goldTokenAddress;
    env.HYPERBET_AVAX_TESTNET_SKILL_ORACLE_ADDRESS = runtime.skillOracleAddress;
    env.HYPERBET_AVAX_TESTNET_PERP_ENGINE_ADDRESS = runtime.perpEngineAddress;
  }

  const results = runJsonCommand<CheckResult[]>(
    "verify-chains",
    "bun",
    [
      "--bun",
      "packages/market-maker-bot/src/verify-chains.ts",
      "--json",
      `--deployment=${deployment}`,
      `--chains=${chains.join(",")}`,
    ],
    env,
  );
  writeJsonArtifact(artifactRoot, "verify-chains.json", results);
  return results;
}

function runAvaxEnvAudits(requireUnifiedUrls = false): ProofSummary["avaxEnvAudit"] {
  const app = runAudit("avax-app-env-audit", "app:avax", {
    VITE_GAME_API_URL: chainUrls("avax", requireUnifiedUrls).keeperUrl,
    VITE_GAME_WS_URL: chainUrls("avax", requireUnifiedUrls).wsUrl,
    VITE_SOLANA_CLUSTER: "mainnet-beta",
    VITE_USE_GAME_RPC_PROXY: "true",
    VITE_USE_GAME_EVM_RPC_PROXY: "true",
    VITE_AVAX_CHAIN_ID: requireEnv("HYPERBET_AVAX_STAGING_CHAIN_ID"),
    VITE_AVAX_GOLD_CLOB_ADDRESS: requireEnv("HYPERBET_AVAX_STAGING_GOLD_CLOB_ADDRESS"),
  });
  const keeper = runAudit("avax-keeper-env-audit", "keeper:avax", {
    CI_AUDIT_REQUIRE_RUNTIME: "true",
    HYPERBET_KEEPER_URL: chainUrls("avax", requireUnifiedUrls).keeperUrl,
    RAILWAY_PROJECT_ID: requireEnv("HYPERBET_AVAX_RAILWAY_STAGING_PROJECT_ID"),
    RAILWAY_ENVIRONMENT_ID: requireEnv("HYPERBET_AVAX_RAILWAY_STAGING_ENVIRONMENT_ID"),
    RAILWAY_KEEPER_SERVICE_ID: requireEnv("HYPERBET_AVAX_RAILWAY_STAGING_KEEPER_SERVICE_ID"),
    AVAX_RPC_URL: requireEnv("HYPERBET_AVAX_STAGING_RPC_URL"),
    AVAX_GOLD_CLOB_ADDRESS: requireEnv("HYPERBET_AVAX_STAGING_GOLD_CLOB_ADDRESS"),
  });
  writeJsonArtifact(artifactRoot, "avax/env-audit.json", {
    app,
    keeper,
  });
  return { app, keeper };
}

function runUnifiedEnvAudit(): {
  pages: AuditResult;
  keeper: AuditResult;
} {
  const pagesUrl = requireEnv("ENOOMIAN_HYPERBET_PAGES_URL");
  const keeperUrl = requireEnv("ENOOMIAN_HYPERBET_KEEPER_URL");
  const keeperWsUrl = requireEnv("ENOOMIAN_HYPERBET_KEEPER_WS_URL");
  const bscChainId = requireAnyEnv([
    "ENOOMIAN_BSC_CHAIN_ID",
    "HYPERBET_BSC_STAGING_CHAIN_ID",
  ]);
  const bscClobAddress = requireAnyEnv([
    "ENOOMIAN_BSC_GOLD_CLOB_ADDRESS",
    "HYPERBET_BSC_STAGING_GOLD_CLOB_ADDRESS",
  ]);
  const pages = runAudit("unified-page-env-audit", "pages:unified", {
    ENOOMIAN_HYPERBET_PAGES_URL: pagesUrl,
    ENOOMIAN_HYPERBET_KEEPER_URL: keeperUrl,
    ENOOMIAN_HYPERBET_KEEPER_WS_URL: keeperWsUrl,
    VITE_GAME_API_URL: keeperUrl,
    VITE_GAME_WS_URL: keeperWsUrl,
    VITE_SOLANA_CLUSTER: "mainnet-beta",
    VITE_USE_GAME_RPC_PROXY: "true",
    VITE_USE_GAME_EVM_RPC_PROXY: "true",
    VITE_BSC_CHAIN_ID: String(bscChainId),
    VITE_BSC_GOLD_CLOB_ADDRESS: bscClobAddress,
    VITE_BASE_CHAIN_ID: "",
    VITE_BASE_GOLD_CLOB_ADDRESS: "",
    VITE_AVAX_CHAIN_ID: "",
    VITE_AVAX_GOLD_CLOB_ADDRESS: "",
  });
  const keeper = runAudit("unified-keeper-env-audit", "keeper:unified", {
    ENOOMIAN_HYPERBET_PAGES_URL: pagesUrl,
    ENOOMIAN_HYPERBET_KEEPER_URL: keeperUrl,
    ENOOMIAN_HYPERBET_KEEPER_WS_URL: keeperWsUrl,
    CI_AUDIT_REQUIRE_RUNTIME: "true",
    HYPERBET_KEEPER_URL: keeperUrl,
    RAILWAY_PROJECT_ID: requireEnv("ENOOMIAN_RAILWAY_PROJECT_ID"),
    RAILWAY_ENVIRONMENT_ID: requireEnv("ENOOMIAN_RAILWAY_ENVIRONMENT_ID"),
    RAILWAY_KEEPER_SERVICE_ID: requireEnv("ENOOMIAN_HYPERBET_KEEPER_SERVICE_ID"),
    SOLANA_RPC_URL: requireEnv("ENOOMIAN_SOLANA_RPC_URL"),
    BSC_RPC_URL: requireEnv("ENOOMIAN_BSC_RPC_URL"),
    BSC_GOLD_CLOB_ADDRESS: bscClobAddress,
    EVM_KEEPER_CHAINS: "bsc",
    AVAX_RPC_URL: "",
    AVAX_GOLD_CLOB_ADDRESS: "",
    BASE_RPC_URL: "",
    BASE_GOLD_CLOB_ADDRESS: "",
    BASE_DUEL_ORACLE_ADDRESS: "",
  });
  return { pages, keeper };
}

function writeCanaryArtifacts(
  chain: SupportedChain,
  result: ChainCanaryResult,
): void {
  writeJsonArtifact(artifactRoot, `${chain}/canary.json`, result);
  writeJsonArtifact(artifactRoot, `${chain}/canary.pm.json`, result.pm);
  writeJsonArtifact(artifactRoot, `${chain}/canary.perps.json`, result.perps);
  writeJsonArtifact(artifactRoot, `${chain}/canary.amm.json`, result.amm);
}

function runSolanaCanary(): ChainCanaryResult {
  const result = runJsonCommand<ChainCanaryResult>(
    "solana-canary",
    "bun",
    ["--bun", "packages/hyperbet-solana/keeper/src/staged-proof-solana.ts"],
  );
  writeCanaryArtifacts("solana", result);
  return result;
}

function runBscCanary(): ChainCanaryResult {
  const result = runJsonCommand<ChainCanaryResult>(
    "bsc-canary",
    "bun",
    ["--bun", "packages/hyperbet-bsc/keeper/src/staged-proof-bsc.ts"],
  );
  writeCanaryArtifacts("bsc", result);
  return result;
}

function runAvaxCanary(): ChainCanaryResult {
  const result = runJsonCommand<ChainCanaryResult>(
    "avax-canary",
    "bun",
    ["--bun", "packages/hyperbet-avax/keeper/src/staged-proof-avax.ts"],
  );
  writeCanaryArtifacts("avax", result);
  return result;
}

function summarizeCanarySurface(result: ChainCanaryResult): string {
  const pmLabel =
    result.pm.takerClaimTx ??
    result.pm.makerClaimTx ??
    result.pm.syncTx ??
    result.pm.takerOrderTx ??
    result.pm.makerOrderTx ??
    "missing";
  const perpsLabel =
    result.perps.closePositionTx ??
    result.perps.openPositionTx ??
    result.perps.updateOracleTx ??
    "missing";
  const ammLabel = result.amm.buyTx ?? result.amm.createMarketTx ?? "missing";
  return `pm=${pmLabel} perps=${perpsLabel} amm=${ammLabel}`;
}

function humanSummary(summary: ProofSummary): string {
  const lines = [
    `staged live proof: deployment=${summary.deployment} mode=${summary.mode} scope=${summary.runScope} target=${summary.target}`,
    `started=${summary.startedAt}`,
    `completed=${summary.completedAt ?? "in-progress"}`,
  ];

  if (summary.readOnly?.solana) {
    lines.push(
      `solana read-only ok: market=${summary.readOnly.solana.canonicalMarket?.marketRef ?? "missing"}`,
    );
  }
  if (summary.readOnly?.bsc) {
    lines.push(
      `bsc read-only ok: market=${summary.readOnly.bsc.canonicalMarket?.marketRef ?? "missing"}`,
    );
  }
  if (summary.readOnly?.avax) {
    lines.push(
      `avax read-only ok: market=${summary.readOnly.avax.canonicalMarket?.marketRef ?? "missing"}`,
    );
  }
  if (summary.canary?.solana) {
    lines.push(`solana canary ok: ${summarizeCanarySurface(summary.canary.solana)}`);
  }
  if (summary.canary?.bsc) {
    lines.push(`bsc canary ok: ${summarizeCanarySurface(summary.canary.bsc)}`);
  }
  if (summary.canary?.avax) {
    lines.push(`avax canary ok: ${summarizeCanarySurface(summary.canary.avax)}`);
  }
  if (summary.avaxEnvAudit) {
    lines.push(
      `avax env audit: app=${summary.avaxEnvAudit.app.ok} keeper=${summary.avaxEnvAudit.keeper.ok}`,
    );
  }
  if (summary.unifiedEnvAudit) {
    lines.push(
      `unified env audit: pages=${summary.unifiedEnvAudit.pages.ok} keeper=${summary.unifiedEnvAudit.keeper.ok}`,
    );
  }
  if (summary.legacyRedirects) {
    lines.push(
      `legacy redirects: solana=${summary.legacyRedirects.solana.ok} bsc=${summary.legacyRedirects.bsc.ok}`,
    );
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const { deployment, mode, target, runScope } = parseArgs();
  mkdirSync(artifactRoot, { recursive: true });

  const includeSolana =
    target === "all" || target === "solana" || target === "unified";
  const includeBsc = target === "all" || target === "bsc" || target === "unified";
  const includeAvax = target === "all" || target === "avax";

  const summary: ProofSummary = {
    deployment,
    mode,
    runScope,
    target,
    startedAt: new Date().toISOString(),
    gitSha: expectedCommit,
  };

  if (deployment === "staging" && mode === "canary-write" && target === "unified") {
    throw new Error("unified staging proof is read-only only; use target=solana or target=bsc");
  }

  if (target === "unified" && deployment === "staging") {
    summary.unifiedEnvAudit = runUnifiedEnvAudit();
    if (
      !summary.unifiedEnvAudit.pages.ok ||
      !summary.unifiedEnvAudit.keeper.ok
    ) {
      throw new Error("unified env audit failed");
    }
    summary.legacyRedirects = await verifyUnifiedLegacyRedirects();
    if (
      !summary.legacyRedirects.solana.ok ||
      !summary.legacyRedirects.solana.preservedPath ||
      !summary.legacyRedirects.solana.preservedQuery ||
      !summary.legacyRedirects.bsc.ok ||
      !summary.legacyRedirects.bsc.preservedPath ||
      !summary.legacyRedirects.bsc.preservedQuery
    ) {
      throw new Error("legacy unified redirect audit failed");
    }
  }

  if (includeSolana || includeBsc || includeAvax) {
    summary.readOnly = {};
    if (includeSolana) {
      summary.readOnly.solana = await runReadOnly("solana", target === "unified");
    }
    if (includeBsc) {
      summary.readOnly.bsc = await runReadOnly("bsc", target === "unified");
    }
    if (includeAvax) {
      summary.readOnly.avax = await runReadOnly("avax", target === "unified");
      if (deployment === "staging") {
        summary.avaxEnvAudit = runAvaxEnvAudits(target === "unified");
        if (!summary.avaxEnvAudit.app.ok || !summary.avaxEnvAudit.keeper.ok) {
          throw new Error(
            `avax env audit failed: app=${summary.avaxEnvAudit.app.ok} keeper=${summary.avaxEnvAudit.keeper.ok}`,
          );
        }
      }
    }
  }

  const verifyResults = runVerifyChains(deployment, summary.readOnly ?? {});
  summary.verifyChains = verifyResults;
  const unexpectedVerifyFailures = verifyResults.filter((result) => !result.ok);
  if (unexpectedVerifyFailures.length > 0) {
    throw new Error(
      `staged verify:chains failures: ${unexpectedVerifyFailures.map((result) => `${result.chain}:${result.details}`).join(", ")}`,
    );
  }

  if (mode === "canary-write") {
    summary.canary = {};
    if (includeSolana) {
      summary.canary.solana = runSolanaCanary();
    }
    if (includeBsc) {
      summary.canary.bsc = runBscCanary();
    }
    if (includeAvax) {
      if (!isBettingEvmDeploymentCanonicalReady(BETTING_DEPLOYMENTS.evm.avax)) {
        console.warn(
          "AVAX deployment is not canonical-ready; skipping AVAX canary writes.",
        );
      } else {
        summary.canary.avax = runAvaxCanary();
      }
    }
  }

  summary.completedAt = new Date().toISOString();
  writeJsonArtifact(artifactRoot, "summary.json", summary);
  console.log(humanSummary(summary));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}

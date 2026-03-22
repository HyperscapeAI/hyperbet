import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  resolveArtifactRoot,
  rootDir,
  writeJsonArtifact,
} from "./ci-lib";

type ProofMode = "read-only" | "canary-write";
type RunScope = "LIVE_INDICATOR" | "LIVE_CANARY";
type ProofTarget = "all" | "solana" | "bsc" | "avax";
type SupportedChain = Exclude<ProofTarget, "all">;

type BuildInfo = {
  commitHash?: string | null;
  builtAt?: string | null;
};

type KeeperStatus = {
  ok?: boolean;
  proxies?: Record<string, boolean>;
  parsers?: Record<string, boolean>;
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

type AuditResult = {
  target: string;
  ok: boolean;
  output: string;
};

type SolanaCanaryResult = {
  duelId: string;
  duelKeyHex: string;
  marketRef: string;
  upsertTx: string;
  placeOrderTx: string;
  cancelTx: string;
  syncTx: string;
  claimTx: string;
};

type BscCanaryResult = {
  duelId: string;
  duelKeyHex: string;
  marketRef: string;
  openTx: string;
  createMarketTx: string;
  placeOrderTx: string;
  cancelTx: string;
  syncTx: string;
  claimTx: string;
};

type AvaxCanaryResult = {
  duelId: string;
  duelKeyHex: string;
  marketRef: string;
  openTx: string;
  createMarketTx: string;
  placeOrderTx: string;
  cancelTx: string;
  syncTx: string;
  claimTx: string;
};

type ProofSummary = {
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
    solana?: SolanaCanaryResult;
    bsc?: BscCanaryResult;
    avax?: AvaxCanaryResult;
  };
  verifyChains?: CheckResult[];
  avaxEnvAudit?: {
    app: AuditResult;
    keeper: AuditResult;
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
  mode: ProofMode;
  target: ProofTarget;
  runScope: RunScope;
} {
  const args = process.argv.slice(2);
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
    targetArg !== "avax"
  ) {
    throw new Error(`unsupported proof target ${targetArg}`);
  }
  return {
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

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/$/, "");
}

function chainUrls(chain: SupportedChain): ChainUrls {
  if (chain === "solana") {
    return {
      pagesUrl: normalizeUrl(requireEnv("HYPERBET_SOLANA_PAGES_STAGING_URL")),
      keeperUrl: normalizeUrl(requireEnv("HYPERBET_SOLANA_KEEPER_STAGING_URL")),
      wsUrl: normalizeUrl(requireEnv("HYPERBET_SOLANA_KEEPER_STAGING_WS_URL")),
    };
  }

  if (chain === "avax") {
    return {
      pagesUrl: normalizeUrl(requireEnv("HYPERBET_AVAX_PAGES_STAGING_URL")),
      keeperUrl: normalizeUrl(requireEnv("HYPERBET_AVAX_KEEPER_STAGING_URL")),
      wsUrl: normalizeUrl(requireEnv("HYPERBET_AVAX_KEEPER_STAGING_WS_URL")),
    };
  }

  return {
    pagesUrl: normalizeUrl(requireEnv("HYPERBET_BSC_PAGES_STAGING_URL")),
    keeperUrl: normalizeUrl(requireEnv("HYPERBET_BSC_KEEPER_STAGING_URL")),
    wsUrl: normalizeUrl(requireEnv("HYPERBET_BSC_KEEPER_STAGING_WS_URL")),
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

async function runReadOnly(chain: SupportedChain): Promise<ReadOnlyChainResult> {
  const urls = chainUrls(chain);
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
  target: "app:avax" | "keeper:avax",
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

function runVerifyChains(readOnly: {
  solana?: ReadOnlyChainResult;
  bsc?: ReadOnlyChainResult;
  avax?: ReadOnlyChainResult;
}): CheckResult[] {
  const env: Record<string, string> = {};
  const chains: string[] = [];

  if (readOnly.solana) {
    chains.push("solana");
    env.SOLANA_VERIFY_RPC_URL = requireEnv("HYPERBET_SOLANA_STAGING_RPC_URL");
    if (readOnly.solana.canonicalMarket?.programId) {
      env.SOLANA_VERIFY_PROGRAM_ID = readOnly.solana.canonicalMarket.programId;
    }
  }

  if (readOnly.bsc) {
    chains.push("bsc");
    env.BSC_STAGING_RPC_URL = requireEnv("HYPERBET_BSC_STAGING_RPC_URL");
    if (readOnly.bsc.canonicalMarket?.contractAddress) {
      env.BSC_STAGING_GOLD_CLOB_ADDRESS = readOnly.bsc.canonicalMarket.contractAddress;
    }
  }

  if (readOnly.avax) {
    chains.push("avax");
    env.AVAX_STAGING_RPC_URL = requireEnv("HYPERBET_AVAX_STAGING_RPC_URL");
    if (readOnly.avax.canonicalMarket?.contractAddress) {
      env.AVAX_STAGING_GOLD_CLOB_ADDRESS = readOnly.avax.canonicalMarket.contractAddress;
    }
  }

  const results = runJsonCommand<CheckResult[]>(
    "verify-chains",
    "bun",
    [
      "--bun",
      "packages/market-maker-bot/src/verify-chains.ts",
      "--json",
      "--deployment=staging",
      `--chains=${chains.join(",")}`,
    ],
    env,
  );
  writeJsonArtifact(artifactRoot, "verify-chains.json", results);
  return results;
}

function runAvaxEnvAudits(): ProofSummary["avaxEnvAudit"] {
  const app = runAudit("avax-app-env-audit", "app:avax", {
    VITE_GAME_API_URL: chainUrls("avax").keeperUrl,
    VITE_GAME_WS_URL: chainUrls("avax").wsUrl,
    VITE_SOLANA_CLUSTER: "mainnet-beta",
    VITE_USE_GAME_RPC_PROXY: "true",
    VITE_USE_GAME_EVM_RPC_PROXY: "true",
    VITE_AVAX_CHAIN_ID: requireEnv("HYPERBET_AVAX_STAGING_CHAIN_ID"),
    VITE_AVAX_GOLD_CLOB_ADDRESS: requireEnv("HYPERBET_AVAX_STAGING_GOLD_CLOB_ADDRESS"),
  });
  const keeper = runAudit("avax-keeper-env-audit", "keeper:avax", {
    CI_AUDIT_REQUIRE_RUNTIME: "true",
    HYPERBET_KEEPER_URL: chainUrls("avax").keeperUrl,
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

function runSolanaCanary(): SolanaCanaryResult {
  const result = runJsonCommand<SolanaCanaryResult>(
    "solana-canary",
    "bun",
    ["--bun", "packages/hyperbet-solana/keeper/src/staged-proof-solana.ts"],
  );
  writeJsonArtifact(artifactRoot, "solana/canary.json", result);
  return result;
}

function runBscCanary(): BscCanaryResult {
  const result = runJsonCommand<BscCanaryResult>(
    "bsc-canary",
    "bun",
    ["--bun", "packages/hyperbet-bsc/keeper/src/staged-proof-bsc.ts"],
  );
  writeJsonArtifact(artifactRoot, "bsc/canary.json", result);
  return result;
}

function runAvaxCanary(): AvaxCanaryResult {
  const result = runJsonCommand<AvaxCanaryResult>(
    "avax-canary",
    "bun",
    ["--bun", "packages/hyperbet-avax/keeper/src/staged-proof-avax.ts"],
  );
  writeJsonArtifact(artifactRoot, "avax/canary.json", result);
  return result;
}

function humanSummary(summary: ProofSummary): string {
  const lines = [
    `staged live proof: mode=${summary.mode} scope=${summary.runScope} target=${summary.target}`,
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
    lines.push(`solana canary ok: claim=${summary.canary.solana.claimTx}`);
  }
  if (summary.canary?.bsc) {
    lines.push(`bsc canary ok: claim=${summary.canary.bsc.claimTx}`);
  }
  if (summary.canary?.avax) {
    lines.push(
      `avax canary ok: claim=${summary.canary.avax.claimTx}`,
    );
  }
  if (summary.avaxEnvAudit) {
    lines.push(
      `avax env audit: app=${summary.avaxEnvAudit.app.ok} keeper=${summary.avaxEnvAudit.keeper.ok}`,
    );
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const { mode, target, runScope } = parseArgs();
  mkdirSync(artifactRoot, { recursive: true });

  const includeSolana = target === "all" || target === "solana";
  const includeBsc = target === "all" || target === "bsc";
  const includeAvax = target === "all" || target === "avax";

  const summary: ProofSummary = {
    mode,
    runScope,
    target,
    startedAt: new Date().toISOString(),
    gitSha: expectedCommit,
  };

  if (includeSolana || includeBsc || includeAvax) {
    summary.readOnly = {};
    if (includeSolana) {
      summary.readOnly.solana = await runReadOnly("solana");
    }
    if (includeBsc) {
      summary.readOnly.bsc = await runReadOnly("bsc");
    }
    if (includeAvax) {
      summary.readOnly.avax = await runReadOnly("avax");
      summary.avaxEnvAudit = runAvaxEnvAudits();
      if (!summary.avaxEnvAudit.app.ok || !summary.avaxEnvAudit.keeper.ok) {
        throw new Error(
          `avax env audit failed: app=${summary.avaxEnvAudit.app.ok} keeper=${summary.avaxEnvAudit.keeper.ok}`,
        );
      }
    }
  }

  const verifyResults = runVerifyChains(summary.readOnly ?? {});
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
      summary.canary.avax = runAvaxCanary();
    }
  }

  summary.completedAt = new Date().toISOString();
  writeJsonArtifact(artifactRoot, "summary.json", summary);
  console.log(humanSummary(summary));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}

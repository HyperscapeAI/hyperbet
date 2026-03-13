import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  resolveArtifactRoot,
  writeJsonArtifact,
} from "./ci-lib";

type ProofMode = "read-only" | "canary-write";
type ProofTarget = "all" | "solana" | "bsc";
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

type AvaxFailClosedResult = {
  appAuditPassed: boolean;
  keeperAuditPassed: boolean;
  appAuditOutput: string;
  keeperAuditOutput: string;
  verification: CheckResult;
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

type ProofSummary = {
  mode: ProofMode;
  target: ProofTarget;
  startedAt: string;
  completedAt?: string;
  gitSha: string | null;
  readOnly?: {
    solana?: ReadOnlyChainResult;
    bsc?: ReadOnlyChainResult;
  };
  canary?: {
    solana?: SolanaCanaryResult;
    bsc?: BscCanaryResult;
  };
  verifyChains?: CheckResult[];
  avaxFailClosed?: AvaxFailClosedResult;
};

const artifactRoot = resolveArtifactRoot("staged-live-proof");
const expectedCommit = process.env.GITHUB_SHA?.trim() || null;

function parseArgs(): { mode: ProofMode; target: ProofTarget } {
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
  if (targetArg !== "all" && targetArg !== "solana" && targetArg !== "bsc") {
    throw new Error(`unsupported proof target ${targetArg}`);
  }
  return { mode: modeArg, target: targetArg };
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
          `${urls.keeperUrl}/api/proxy/evm/rpc?chain=bsc`,
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
    cwd: process.cwd(),
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

function runExpectedAuditFailure(
  target: "app:avax" | "keeper:avax",
  env: Record<string, string>,
  deployment: "production" | "staging" = "production",
): { passed: boolean; output: string } {
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
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      encoding: "utf8",
    },
  );
  return {
    passed: result.status !== 0,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim(),
  };
}

function runVerifyChains(readOnly: {
  solana?: ReadOnlyChainResult;
  bsc?: ReadOnlyChainResult;
}): CheckResult[] {
  const env: Record<string, string> = {};

  if (readOnly.solana) {
    env.SOLANA_VERIFY_RPC_URL = requireEnv("HYPERBET_SOLANA_STAGING_RPC_URL");
    if (readOnly.solana.canonicalMarket?.programId) {
      env.SOLANA_VERIFY_PROGRAM_ID = readOnly.solana.canonicalMarket.programId;
    }
  }

  if (readOnly.bsc) {
    env.BSC_STAGING_RPC_URL = requireEnv("HYPERBET_BSC_STAGING_RPC_URL");
    if (readOnly.bsc.canonicalMarket?.contractAddress) {
      env.BSC_STAGING_GOLD_CLOB_ADDRESS = readOnly.bsc.canonicalMarket.contractAddress;
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
      "--chains=solana,bsc",
    ],
    env,
  );
  writeJsonArtifact(artifactRoot, "verify-chains.json", results);
  return results;
}

function runProductionAvaxVerify(): CheckResult {
  const results = runJsonCommand<CheckResult[]>(
    "verify-chains-avax-production",
    "bun",
    [
      "--bun",
      "packages/market-maker-bot/src/verify-chains.ts",
      "--json",
      "--deployment=production",
      "--chains=avax",
    ],
  );
  writeJsonArtifact(artifactRoot, "verify-chains-avax-production.json", results);
  const avax = results.find((result) => result.chain === "avax");
  if (!avax) {
    throw new Error("missing AVAX verification result");
  }
  return avax;
}

function proveAvaxFailClosed(
  readOnly: { solana?: ReadOnlyChainResult },
): AvaxFailClosedResult {
  const appAudit = runExpectedAuditFailure("app:avax", {
    VITE_GAME_API_URL: readOnly.solana
      ? chainUrls("solana").keeperUrl
      : "https://staging.invalid",
    VITE_GAME_WS_URL: readOnly.solana
      ? chainUrls("solana").wsUrl
      : "wss://staging.invalid/ws",
    VITE_SOLANA_CLUSTER: "mainnet-beta",
    VITE_USE_GAME_RPC_PROXY: "true",
    VITE_USE_GAME_EVM_RPC_PROXY: "true",
    VITE_AVAX_CHAIN_ID: "43114",
  }, "production");
  const keeperAudit = runExpectedAuditFailure("keeper:avax", {
    CI_AUDIT_REQUIRE_RUNTIME: "true",
    HYPERBET_KEEPER_URL: "https://avax-stage.invalid",
    RAILWAY_PROJECT_ID: "staging",
    RAILWAY_ENVIRONMENT_ID: "production",
    RAILWAY_KEEPER_SERVICE_ID: "staging",
    AVAX_RPC_URL: "https://api.avax.network/ext/bc/C/rpc",
  }, "production");
  const verification = runProductionAvaxVerify();

  const summary: AvaxFailClosedResult = {
    appAuditPassed: appAudit.passed,
    keeperAuditPassed: keeperAudit.passed,
    appAuditOutput: appAudit.output,
    keeperAuditOutput: keeperAudit.output,
    verification,
  };
  writeJsonArtifact(artifactRoot, "avax-fail-closed.json", summary);
  return summary;
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
    ["--bun", "packages/hyperbet-evm/keeper/src/staged-proof-bsc.ts"],
  );
  writeJsonArtifact(artifactRoot, "bsc/canary.json", result);
  return result;
}

function humanSummary(summary: ProofSummary): string {
  const lines = [
    `staged live proof: mode=${summary.mode} target=${summary.target}`,
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
  if (summary.canary?.solana) {
    lines.push(`solana canary ok: claim=${summary.canary.solana.claimTx}`);
  }
  if (summary.canary?.bsc) {
    lines.push(`bsc canary ok: claim=${summary.canary.bsc.claimTx}`);
  }
  if (summary.avaxFailClosed) {
    lines.push(
      `avax fail-closed: app=${summary.avaxFailClosed.appAuditPassed} keeper=${summary.avaxFailClosed.keeperAuditPassed} verify=${summary.avaxFailClosed.verification.ok}`,
    );
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const { mode, target } = parseArgs();
  mkdirSync(artifactRoot, { recursive: true });

  const includeSolana = target === "all" || target === "solana";
  const includeBsc = target === "all" || target === "bsc";

  const summary: ProofSummary = {
    mode,
    target,
    startedAt: new Date().toISOString(),
    gitSha: expectedCommit,
  };

  if (includeSolana || includeBsc) {
    summary.readOnly = {};
    if (includeSolana) {
      summary.readOnly.solana = await runReadOnly("solana");
    }
    if (includeBsc) {
      summary.readOnly.bsc = await runReadOnly("bsc");
    }
  }

  const verifyResults = runVerifyChains(summary.readOnly ?? {});
  summary.verifyChains = verifyResults;
  const unexpectedVerifyFailures = verifyResults.filter(
    (result) => !result.ok && result.chain !== "avax",
  );
  if (unexpectedVerifyFailures.length > 0) {
    throw new Error(
      `staged verify:chains failures: ${unexpectedVerifyFailures.map((result) => `${result.chain}:${result.details}`).join(", ")}`,
    );
  }

  summary.avaxFailClosed = proveAvaxFailClosed(summary.readOnly ?? {});
  if (
    !summary.avaxFailClosed.appAuditPassed ||
    !summary.avaxFailClosed.keeperAuditPassed ||
    summary.avaxFailClosed.verification.ok
  ) {
    throw new Error("AVAX fail-closed proof did not hold");
  }

  if (mode === "canary-write") {
    summary.canary = {};
    if (includeSolana) {
      summary.canary.solana = runSolanaCanary();
    }
    if (includeBsc) {
      summary.canary.bsc = runBscCanary();
    }
  }

  summary.completedAt = new Date().toISOString();
  writeJsonArtifact(artifactRoot, "summary.json", summary);
  console.log(humanSummary(summary));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}

import {
  normalizeSolanaCluster,
  resolveBettingEvmRuntimeEnv,
  resolveBettingSolanaDeployment,
  type BettingSolanaCluster,
} from "../packages/hyperbet-chain-registry/src/index.ts";

export type AcceptanceDeployment = "staging" | "testnet";
export type AcceptanceDuelSource =
  | "synthetic_publish"
  | "real_hyperscapes";
export type AcceptanceEvmChain = "bsc" | "avax";
export type AcceptanceChain = "solana" | AcceptanceEvmChain;

type EnvMap = Record<string, string | undefined>;

export function firstNonEmptyValue(
  ...values: Array<string | null | undefined>
): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return null;
}

export function firstNonEmptyEnv(
  env: EnvMap,
  names: readonly string[],
): string | null {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) {
      return value;
    }
  }
  return null;
}

export function parseAcceptanceDeployment(
  value: string | null | undefined,
  fallback: AcceptanceDeployment = "testnet",
): AcceptanceDeployment {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (normalized === "testnet" || normalized === "staging") {
    return normalized;
  }
  throw new Error(`Unsupported non-mainnet deployment mode: ${value}`);
}

export function parseAcceptanceDuelSource(
  value: string | null | undefined,
  fallback: AcceptanceDuelSource = "synthetic_publish",
): AcceptanceDuelSource {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (
    normalized === "synthetic_publish" ||
    normalized === "real_hyperscapes"
  ) {
    return normalized;
  }
  throw new Error(`Unsupported acceptance duel source: ${value}`);
}

export function resolveAcceptanceDuelSource(
  env: EnvMap = process.env,
): AcceptanceDuelSource {
  return parseAcceptanceDuelSource(
    firstNonEmptyEnv(env, [
      "E2E_DUEL_SOURCE",
      "ACCEPTANCE_DUEL_SOURCE",
      "HYPERBET_ACCEPTANCE_DUEL_SOURCE",
    ]),
  );
}

function evmChainCandidates(
  chain: AcceptanceEvmChain,
  suffix: string,
): string[] {
  const upper = chain.toUpperCase();
  return [
    `HYPERBET_${upper}_TESTNET_${suffix}`,
    `HYPERBET_${upper}_STAGING_${suffix}`,
    `${upper}_TESTNET_${suffix}`,
    `${upper}_STAGING_${suffix}`,
  ];
}

function solanaCandidates(suffix: string): string[] {
  return [
    `HYPERBET_SOLANA_TESTNET_${suffix}`,
    `HYPERBET_SOLANA_STAGING_${suffix}`,
  ];
}

function solanaDefaultRpc(cluster: BettingSolanaCluster): string {
  return cluster === "testnet"
    ? "https://api.testnet.solana.com"
    : "https://api.devnet.solana.com";
}

function evmAlchemyRpc(
  chain: AcceptanceEvmChain,
  env: EnvMap,
): string | null {
  const upper = chain.toUpperCase();
  const explicit = firstNonEmptyEnv(env, [
    `${upper}_ALCHEMY_RPC_URL`,
    `ALCHEMY_${upper}_RPC_URL`,
  ]);
  if (explicit) {
    return explicit;
  }
  const apiKey = firstNonEmptyEnv(env, [
    `${upper}_ALCHEMY_API_KEY`,
    "ALCHEMY_API_KEY",
  ]);
  if (!apiKey) {
    return null;
  }
  if (chain === "bsc") {
    return `https://bnb-testnet.g.alchemy.com/v2/${apiKey}`;
  }
  return `https://avax-fuji.g.alchemy.com/v2/${apiKey}`;
}

function solanaAlchemyRpc(
  cluster: BettingSolanaCluster,
  env: EnvMap,
): string | null {
  const explicit = firstNonEmptyEnv(env, [
    "SOLANA_ALCHEMY_RPC_URL",
    "ALCHEMY_SOLANA_RPC_URL",
  ]);
  if (explicit) {
    return explicit;
  }
  const apiKey = firstNonEmptyEnv(env, [
    "SOLANA_ALCHEMY_API_KEY",
    "ALCHEMY_API_KEY",
  ]);
  if (!apiKey) {
    return null;
  }
  const network = cluster === "mainnet-beta" ? "mainnet" : "devnet";
  return `https://solana-${network}.g.alchemy.com/v2/${apiKey}`;
}

export function resolveAcceptanceUrls(
  chain: AcceptanceChain,
  env: EnvMap = process.env,
): { pagesUrl: string; keeperUrl: string; wsUrl: string } {
  const candidates =
    chain === "solana"
      ? {
          pages: ["HYPERBET_SOLANA_PAGES_TESTNET_URL", "HYPERBET_SOLANA_PAGES_STAGING_URL"],
          keeper: [
            "HYPERBET_SOLANA_KEEPER_TESTNET_URL",
            "HYPERBET_SOLANA_KEEPER_STAGING_URL",
          ],
          ws: [
            "HYPERBET_SOLANA_KEEPER_TESTNET_WS_URL",
            "HYPERBET_SOLANA_KEEPER_STAGING_WS_URL",
          ],
        }
      : {
          pages: [
            `HYPERBET_${chain.toUpperCase()}_PAGES_TESTNET_URL`,
            `HYPERBET_${chain.toUpperCase()}_PAGES_STAGING_URL`,
          ],
          keeper: [
            `HYPERBET_${chain.toUpperCase()}_KEEPER_TESTNET_URL`,
            `HYPERBET_${chain.toUpperCase()}_KEEPER_STAGING_URL`,
          ],
          ws: [
            `HYPERBET_${chain.toUpperCase()}_KEEPER_TESTNET_WS_URL`,
            `HYPERBET_${chain.toUpperCase()}_KEEPER_STAGING_WS_URL`,
          ],
        };

  const pagesUrl = firstNonEmptyEnv(env, candidates.pages);
  const keeperUrl = firstNonEmptyEnv(env, candidates.keeper);
  const wsUrl = firstNonEmptyEnv(env, candidates.ws);
  if (!pagesUrl || !keeperUrl || !wsUrl) {
    throw new Error(
      `Missing local acceptance URLs for ${chain}: pages=${pagesUrl ? "ok" : "missing"} keeper=${keeperUrl ? "ok" : "missing"} ws=${wsUrl ? "ok" : "missing"}`,
    );
  }
  return {
    pagesUrl: pagesUrl.replace(/\/$/, ""),
    keeperUrl: keeperUrl.replace(/\/$/, ""),
    wsUrl: wsUrl.replace(/\/$/, ""),
  };
}

export function resolveEvmAcceptanceRuntime(
  chain: AcceptanceEvmChain,
  env: EnvMap = process.env,
): {
  chainId: number;
  rpcUrl: string;
  keeperUrl: string | null;
  duelOracleAddress: string;
  goldClobAddress: string;
  goldAmmRouterAddress: string;
  mUsdTokenAddress: string;
  goldTokenAddress: string;
  skillOracleAddress: string;
  perpEngineAddress: string;
  perpMarginTokenAddress: string;
  canaryPrivateKey: string | null;
  matcherPrivateKey: string | null;
  reporterPrivateKey: string | null;
  adminPrivateKey: string | null;
  marketOperatorPrivateKey: string | null;
  pauserPrivateKey: string | null;
} {
  const runtime = resolveBettingEvmRuntimeEnv(chain, "testnet", env);
  const upper = chain.toUpperCase();
  const alchemyRpcUrl = evmAlchemyRpc(chain, env);
  return {
    chainId: runtime.deployment.chainId,
    rpcUrl:
      firstNonEmptyValue(
        alchemyRpcUrl,
        firstNonEmptyEnv(env, [
          `HYPERBET_${upper}_TESTNET_RPC_URL`,
          `HYPERBET_${upper}_STAGING_RPC_URL`,
          `EVM_${upper}_RPC_URL`,
          `${upper}_TESTNET_RPC`,
          `${upper}_STAGING_RPC`,
          `${upper}_RPC_URL`,
        ]),
        runtime.rpcUrl,
      ) ?? runtime.rpcUrl,
    keeperUrl: firstNonEmptyEnv(env, [
      `HYPERBET_${upper}_KEEPER_TESTNET_URL`,
      `HYPERBET_${upper}_KEEPER_STAGING_URL`,
    ]),
    duelOracleAddress:
      firstNonEmptyEnv(env, [
        ...evmChainCandidates(chain, "DUEL_ORACLE_ADDRESS"),
        `ORACLE_CONTRACT_ADDRESS_${upper}`,
        `ORACLE_CONTRACT_ADDRESS_${upper}_STAGING`,
      ]) ?? runtime.duelOracleAddress,
    goldClobAddress:
      firstNonEmptyEnv(env, [
        ...evmChainCandidates(chain, "GOLD_CLOB_ADDRESS"),
        `CLOB_CONTRACT_ADDRESS_${upper}`,
        `CLOB_CONTRACT_ADDRESS_${upper}_STAGING`,
      ]) ?? runtime.goldClobAddress,
    goldAmmRouterAddress:
      firstNonEmptyEnv(env, [
        ...evmChainCandidates(chain, "GOLD_AMM_ROUTER_ADDRESS"),
        `AMM_ROUTER_ADDRESS_${upper}`,
        `AMM_ROUTER_ADDRESS_${upper}_STAGING`,
      ]) ?? runtime.goldAmmRouterAddress,
    mUsdTokenAddress:
      firstNonEmptyEnv(env, [
        ...evmChainCandidates(chain, "MUSD_TOKEN_ADDRESS"),
        `MUSD_TOKEN_ADDRESS_${upper}`,
        `MUSD_TOKEN_ADDRESS_${upper}_STAGING`,
      ]) ?? runtime.mUsdTokenAddress,
    goldTokenAddress:
      firstNonEmptyEnv(env, [
        ...evmChainCandidates(chain, "GOLD_TOKEN_ADDRESS"),
        `GOLD_TOKEN_ADDRESS_${upper}`,
        `GOLD_TOKEN_ADDRESS_${upper}_STAGING`,
      ]) ?? runtime.deployment.goldTokenAddress,
    skillOracleAddress:
      firstNonEmptyEnv(env, [
        ...evmChainCandidates(chain, "SKILL_ORACLE_ADDRESS"),
        `SKILL_ORACLE_ADDRESS_${upper}`,
        `SKILL_ORACLE_ADDRESS_${upper}_STAGING`,
      ]) ?? runtime.deployment.skillOracleAddress,
    perpEngineAddress:
      firstNonEmptyEnv(env, [
        ...evmChainCandidates(chain, "PERP_ENGINE_ADDRESS"),
        `PERP_ENGINE_ADDRESS_${upper}`,
        `PERP_ENGINE_ADDRESS_${upper}_STAGING`,
      ]) ?? runtime.deployment.perpEngineAddress,
    perpMarginTokenAddress:
      firstNonEmptyEnv(env, [
        ...evmChainCandidates(chain, "PERP_MARGIN_TOKEN_ADDRESS"),
        `PERP_MARGIN_TOKEN_ADDRESS_${upper}`,
        `PERP_MARGIN_TOKEN_ADDRESS_${upper}_STAGING`,
        ...evmChainCandidates(chain, "GOLD_TOKEN_ADDRESS"),
      ]) ?? runtime.deployment.goldTokenAddress,
    canaryPrivateKey: firstNonEmptyEnv(env, [
      `HYPERBET_${upper}_TESTNET_CANARY_PRIVATE_KEY`,
      `HYPERBET_${upper}_STAGING_CANARY_PRIVATE_KEY`,
      "CANARY_PRIVATE_KEY",
    ]),
    matcherPrivateKey: firstNonEmptyEnv(env, [
      `HYPERBET_${upper}_TESTNET_MATCHER_PRIVATE_KEY`,
      `HYPERBET_${upper}_STAGING_MATCHER_PRIVATE_KEY`,
      "MATCHER_PRIVATE_KEY",
    ]),
    reporterPrivateKey: firstNonEmptyEnv(env, [
      `HYPERBET_${upper}_TESTNET_REPORTER_PRIVATE_KEY`,
      `HYPERBET_${upper}_STAGING_REPORTER_PRIVATE_KEY`,
      "TESTNET_REPORTER_PRIVATE_KEY",
    ]),
    adminPrivateKey: firstNonEmptyEnv(env, [
      `HYPERBET_${upper}_TESTNET_ADMIN_PRIVATE_KEY`,
      `HYPERBET_${upper}_STAGING_ADMIN_PRIVATE_KEY`,
      "TESTNET_ADMIN_PRIVATE_KEY",
    ]),
    marketOperatorPrivateKey: firstNonEmptyEnv(env, [
      `HYPERBET_${upper}_TESTNET_MARKET_OPERATOR_PRIVATE_KEY`,
      `HYPERBET_${upper}_STAGING_MARKET_OPERATOR_PRIVATE_KEY`,
      "TESTNET_MARKET_OPERATOR_PRIVATE_KEY",
      "TESTNET_ADMIN_PRIVATE_KEY",
    ]),
    pauserPrivateKey: firstNonEmptyEnv(env, [
      `HYPERBET_${upper}_TESTNET_PAUSER_PRIVATE_KEY`,
      `HYPERBET_${upper}_STAGING_PAUSER_PRIVATE_KEY`,
      "TESTNET_PAUSER_PRIVATE_KEY",
    ]),
  };
}

export function resolveSolanaAcceptanceRuntime(
  env: EnvMap = process.env,
): {
  cluster: BettingSolanaCluster;
  rpcUrl: string;
  keeperUrl: string | null;
  pagesUrl: string | null;
  wsUrl: string | null;
  streamPublishKey: string | null;
  fightOracleProgramId: string;
  goldClobProgramId: string;
  goldAmmProgramId: string;
  goldPerpsProgramId: string;
  anchorWallet: string | null;
  oracleAuthorityKeypair: string | null;
  canaryKeypair: string | null;
  marketMakerKeypair: string | null;
} {
  const cluster = normalizeSolanaCluster(
    firstNonEmptyEnv(env, [
      ...solanaCandidates("CLUSTER"),
      "SOLANA_CLUSTER",
    ]) ?? "devnet",
  );
  const deployment = resolveBettingSolanaDeployment(cluster);
  const alchemyRpcUrl = solanaAlchemyRpc(cluster, env);
  return {
    cluster,
    rpcUrl:
      firstNonEmptyEnv(env, [
        ...(alchemyRpcUrl ? [alchemyRpcUrl] : []),
        ...solanaCandidates("RPC_URL"),
        "SOLANA_RPC_URL",
      ]) ?? solanaDefaultRpc(cluster),
    keeperUrl: firstNonEmptyEnv(env, [
      "HYPERBET_SOLANA_KEEPER_TESTNET_URL",
      "HYPERBET_SOLANA_KEEPER_STAGING_URL",
    ]),
    pagesUrl: firstNonEmptyEnv(env, [
      "HYPERBET_SOLANA_PAGES_TESTNET_URL",
      "HYPERBET_SOLANA_PAGES_STAGING_URL",
    ]),
    wsUrl: firstNonEmptyEnv(env, [
      "HYPERBET_SOLANA_KEEPER_TESTNET_WS_URL",
      "HYPERBET_SOLANA_KEEPER_STAGING_WS_URL",
    ]),
    streamPublishKey: firstNonEmptyEnv(env, [
      "HYPERBET_SOLANA_TESTNET_STREAM_PUBLISH_KEY",
      "HYPERBET_SOLANA_STAGING_STREAM_PUBLISH_KEY",
    ]),
    fightOracleProgramId:
      firstNonEmptyEnv(env, [
        "HYPERBET_SOLANA_TESTNET_FIGHT_ORACLE_PROGRAM_ID",
        "HYPERBET_SOLANA_STAGING_FIGHT_ORACLE_PROGRAM_ID",
        "STAGE_A_FIGHT_ORACLE_PROGRAM_ID",
      ]) ?? deployment.fightOracleProgramId,
    goldClobProgramId:
      firstNonEmptyEnv(env, [
        "HYPERBET_SOLANA_TESTNET_GOLD_CLOB_PROGRAM_ID",
        "HYPERBET_SOLANA_STAGING_GOLD_CLOB_PROGRAM_ID",
        "STAGE_A_GOLD_CLOB_MARKET_PROGRAM_ID",
      ]) ?? deployment.goldClobMarketProgramId,
    goldAmmProgramId:
      firstNonEmptyEnv(env, [
        "HYPERBET_SOLANA_TESTNET_GOLD_AMM_PROGRAM_ID",
        "HYPERBET_SOLANA_STAGING_GOLD_AMM_PROGRAM_ID",
        "STAGE_A_GOLD_AMM_PROGRAM_ID",
      ]) ?? deployment.goldAmmMarketProgramId,
    goldPerpsProgramId:
      firstNonEmptyEnv(env, [
        "HYPERBET_SOLANA_TESTNET_GOLD_PERPS_PROGRAM_ID",
        "HYPERBET_SOLANA_STAGING_GOLD_PERPS_PROGRAM_ID",
        "STAGE_A_GOLD_PERPS_PROGRAM_ID",
      ]) ?? deployment.goldPerpsMarketProgramId,
    anchorWallet: firstNonEmptyEnv(env, ["ANCHOR_WALLET", "SOLANA_STAGE_A_WALLET_PATH"]),
    oracleAuthorityKeypair: firstNonEmptyEnv(env, [
      "HYPERBET_SOLANA_TESTNET_ORACLE_AUTHORITY_KEYPAIR",
      "HYPERBET_SOLANA_STAGING_ORACLE_AUTHORITY_KEYPAIR",
      "ORACLE_AUTHORITY_KEYPAIR",
    ]),
    canaryKeypair: firstNonEmptyEnv(env, [
      "HYPERBET_SOLANA_TESTNET_CANARY_KEYPAIR",
      "HYPERBET_SOLANA_STAGING_CANARY_KEYPAIR",
      "SOLANA_CANARY_KEYPAIR",
    ]),
    marketMakerKeypair: firstNonEmptyEnv(env, [
      "HYPERBET_SOLANA_TESTNET_MARKET_MAKER_KEYPAIR",
      "HYPERBET_SOLANA_STAGING_MARKET_MAKER_KEYPAIR",
      "MARKET_MAKER_KEYPAIR",
    ]),
  };
}

type SolanaAcceptanceRuntime = ReturnType<typeof resolveSolanaAcceptanceRuntime>;

function dedupeUrls(urls: Array<string>): Array<string> {
  const seen = new Set<string>();
  const ordered: Array<string> = [];
  for (const url of urls) {
    const normalized = url.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    ordered.push(normalized);
  }
  return ordered;
}

export async function isSolanaRpcReachable(
  rpcUrl: string,
  timeoutMs = 5_000,
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getVersion",
        params: [],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return false;
    }
    const payload = (await response.json()) as {
      result?: unknown;
      error?: { message?: string };
    };
    return payload.result !== undefined && payload.error === undefined;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolveReachableSolanaAcceptanceRuntime(
  env: EnvMap = process.env,
): Promise<SolanaAcceptanceRuntime> {
  const runtime = resolveSolanaAcceptanceRuntime(env);
  const fallbackRpc = solanaDefaultRpc(runtime.cluster);
  const rpcCandidates = dedupeUrls([runtime.rpcUrl, fallbackRpc]);
  for (const rpcUrl of rpcCandidates) {
    if (await isSolanaRpcReachable(rpcUrl)) {
      return {
        ...runtime,
        rpcUrl,
      };
    }
  }
  return runtime;
}

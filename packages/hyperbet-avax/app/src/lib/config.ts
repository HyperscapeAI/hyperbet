import {
  type BettingAppEnvironment,
  type BettingEvmNetwork,
  resolveBettingEvmDefaults,
} from "../../../deployments";

// ============================================================================
// Environment Configuration
// ============================================================================

export type Environment =
  | "devnet"
  | "testnet"
  | "mainnet-beta"
  | "localnet"
  | "e2e"
  | "stream-ui";

const ENVIRONMENT_ALIASES: Record<string, Environment> = {
  development: "devnet",
  dev: "devnet",
  devnet: "devnet",
  testnet: "testnet",
  production: "mainnet-beta",
  prod: "mainnet-beta",
  mainnet: "mainnet-beta",
  "mainnet-beta": "mainnet-beta",
  local: "localnet",
  localnet: "localnet",
  e2e: "e2e",
  "stream-ui": "stream-ui",
};

function readEnvString(name: string): string | undefined {
  const rawValue = import.meta.env[name];
  if (typeof rawValue !== "string") return undefined;
  const trimmed = rawValue.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readEnvNumber(name: string, fallback: number): number {
  const rawValue = readEnvString(name);
  if (!rawValue) return fallback;
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readEnvBoolean(name: string, fallback: boolean): boolean {
  const rawValue = readEnvString(name);
  if (!rawValue) return fallback;
  if (rawValue === "true") return true;
  if (rawValue === "false") return false;
  return fallback;
}

function parseEnvList(rawValue: string | undefined): string[] {
  if (!rawValue) return [];
  return rawValue
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function uniqueList(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    unique.push(value);
  }
  return unique;
}

function resolveEnvironment(): Environment {
  // VITE_SOLANA_CLUSTER is used across all chain packages to set the app environment
  const explicitCluster = readEnvString("VITE_SOLANA_CLUSTER")?.toLowerCase();
  if (explicitCluster && ENVIRONMENT_ALIASES[explicitCluster]) {
    return ENVIRONMENT_ALIASES[explicitCluster];
  }

  const viteMode = readEnvString("MODE")?.toLowerCase();
  if (viteMode && ENVIRONMENT_ALIASES[viteMode]) {
    return ENVIRONMENT_ALIASES[viteMode];
  }

  return "devnet";
}

export const ACTIVE_ENV: Environment = resolveEnvironment();

function isPrivateIpv4Host(hostname: string): boolean {
  if (/^10\./.test(hostname)) return true;
  if (/^192\.168\./.test(hostname)) return true;
  const match = hostname.match(/^172\.(\d{1,3})\./);
  if (!match) return false;
  const octet = Number.parseInt(match[1], 10);
  return Number.isFinite(octet) && octet >= 16 && octet <= 31;
}

function isLocalHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname.endsWith(".local") ||
    isPrivateIpv4Host(hostname)
  );
}

function isPublicBrowserRuntime(): boolean {
  if (typeof window === "undefined") return false;
  const hostname = window.location.hostname.toLowerCase();
  return !isLocalHostname(hostname);
}

function resolveRuntimeEnvironment(buildEnv: Environment): Environment {
  if (!isPublicBrowserRuntime()) {
    return buildEnv;
  }
  if (buildEnv === "localnet" || buildEnv === "e2e") {
    return "mainnet-beta";
  }
  return buildEnv;
}

export const RUNTIME_ENV: Environment = resolveRuntimeEnvironment(ACTIVE_ENV);

function asDeploymentEnvironment(
  environment: Environment,
): BettingAppEnvironment {
  return environment;
}

function defaultRpcUrlForEvmNetwork(network: BettingEvmNetwork): string {
  switch (network) {
    case "avax":
      return "https://api.avax.network/ext/bc/C/rpc";
    case "avaxFuji":
      return "https://api.avax-test.network/ext/bc/C/rpc";
    default:
      return "https://api.avax.network/ext/bc/C/rpc";
  }
}

function buildEvmConfig(
  environment: Environment,
): Pick<
  EnvConfig,
  | "avaxRpcUrl"
  | "avaxChainId"
  | "avaxGoldClobAddress"
  | "avaxGoldTokenAddress"
> {
  const defaults = resolveBettingEvmDefaults(
    asDeploymentEnvironment(environment),
  );
  return {
    avaxRpcUrl: defaultRpcUrlForEvmNetwork(defaults.avax.networkKey),
    avaxChainId: defaults.avax.chainId,
    avaxGoldClobAddress: defaults.avax.goldClobAddress,
    avaxGoldTokenAddress: defaults.avax.goldTokenAddress,
  };
}

export interface EnvConfig {
  betWindowSeconds: number;
  newRoundBetWindowSeconds: number;
  autoSeedDelaySeconds: number;
  marketMakerSeedGold: number;
  betFeeBps: number;
  binaryMarketMakerWallet?: string;
  binaryTradeTreasuryWallet?: string;
  binaryTradeMarketMakerWallet?: string;
  goldDecimals: number;
  enableAutoSeed: boolean;
  gameApiUrl: string;
  gameWsUrl: string;
  streamUrl: string;
  uiSyncDelayMs: number;
  refreshIntervalMs: number;
  walletConnectProjectId: string;

  // EVM
  avaxRpcUrl: string;
  avaxChainId: number;
  avaxGoldClobAddress: string;
  avaxGoldTokenAddress: string;
}

const DEFAULT_STREAM_URL = "https://www.twitch.tv/hyperscapeai";
const DEFAULT_STREAM_FALLBACK_URL = "";
const DEFAULT_GAME_API_URL = "http://127.0.0.1:5555";
const DEFAULT_PRODUCTION_GAME_API_URL = "https://api.hyperbet.win";

const baseConfig: Partial<EnvConfig> = {
  betWindowSeconds: 300,
  newRoundBetWindowSeconds: 300,
  autoSeedDelaySeconds: 10,
  marketMakerSeedGold: 1,
  betFeeBps: 100,
  binaryMarketMakerWallet: "",
  binaryTradeTreasuryWallet: "",
  binaryTradeMarketMakerWallet: "",
  goldDecimals: 6,
  enableAutoSeed: true,
  gameApiUrl: DEFAULT_GAME_API_URL,
  gameWsUrl: `${DEFAULT_GAME_API_URL.replace(/^http/, "ws")}/ws`,
  streamUrl: DEFAULT_STREAM_URL,
  refreshIntervalMs: 5000,

  walletConnectProjectId: (
    import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || ""
  ).trim(),
};

const ENV_CONFIGS: Record<Environment, EnvConfig> = {
  devnet: {
    ...baseConfig,
    ...buildEvmConfig("devnet"),
    uiSyncDelayMs: 0,
  } as EnvConfig,
  testnet: {
    ...baseConfig,
    ...buildEvmConfig("testnet"),
    uiSyncDelayMs: 0,
  } as EnvConfig,
  localnet: {
    ...baseConfig,
    ...buildEvmConfig("localnet"),
    streamUrl: "",
    uiSyncDelayMs: 0,
  } as EnvConfig,
  e2e: {
    ...baseConfig,
    ...buildEvmConfig("e2e"),
    streamUrl: "",
    enableAutoSeed: false,
    refreshIntervalMs: 1500,
    uiSyncDelayMs: 0,
  } as EnvConfig,
  "stream-ui": {
    ...baseConfig,
    ...buildEvmConfig("stream-ui"),
    streamUrl: "",
    enableAutoSeed: false,
    refreshIntervalMs: 60000,
    uiSyncDelayMs: 0,
  } as EnvConfig,
  "mainnet-beta": {
    ...baseConfig,
    ...buildEvmConfig("mainnet-beta"),
    gameApiUrl: DEFAULT_PRODUCTION_GAME_API_URL,
    gameWsUrl: `${DEFAULT_PRODUCTION_GAME_API_URL.replace(/^http/, "ws")}/ws`,
    uiSyncDelayMs: 0,
  } as EnvConfig,
};

if (
  typeof window !== "undefined" &&
  ACTIVE_ENV !== RUNTIME_ENV &&
  typeof console !== "undefined"
) {
  console.warn(
    `[config] forcing runtime env '${RUNTIME_ENV}' on public host (build env '${ACTIVE_ENV}')`,
  );
}

const baseEnvConfig = ENV_CONFIGS[RUNTIME_ENV];
const envGameApiUrl = readEnvString("VITE_GAME_API_URL");
const resolvedGameApiUrl = envGameApiUrl ?? baseEnvConfig.gameApiUrl;
const envGameWsUrl = readEnvString("VITE_GAME_WS_URL");
const resolvedGameWsUrl =
  envGameWsUrl ?? `${resolvedGameApiUrl.replace(/^http/, "ws")}/ws`;
const defaultPrimaryStreamUrl =
  readEnvString("VITE_STREAM_URL") ?? baseEnvConfig.streamUrl;
const resolvedStreamSources = (() => {
  const fromListVar = parseEnvList(readEnvString("VITE_STREAM_SOURCES"));
  if (fromListVar.length > 0) {
    return uniqueList(fromListVar);
  }
  const envFallbackUrl = readEnvString("VITE_STREAM_FALLBACK_URL");
  const fallbackUrl =
    envFallbackUrl ??
    (defaultPrimaryStreamUrl ? DEFAULT_STREAM_FALLBACK_URL : "");
  return uniqueList([defaultPrimaryStreamUrl, fallbackUrl ?? ""]).filter(
    (value) => value.length > 0,
  );
})();
const resolvedStreamUrl = resolvedStreamSources[0] ?? "";

export const CONFIG: EnvConfig = {
  ...baseEnvConfig,
  betWindowSeconds: readEnvNumber(
    "VITE_BET_WINDOW_SECONDS",
    baseEnvConfig.betWindowSeconds,
  ),
  newRoundBetWindowSeconds: readEnvNumber(
    "VITE_NEW_ROUND_BET_WINDOW_SECONDS",
    baseEnvConfig.newRoundBetWindowSeconds,
  ),
  autoSeedDelaySeconds: readEnvNumber(
    "VITE_AUTO_SEED_DELAY_SECONDS",
    baseEnvConfig.autoSeedDelaySeconds,
  ),
  marketMakerSeedGold: readEnvNumber(
    "VITE_MARKET_MAKER_SEED_GOLD",
    baseEnvConfig.marketMakerSeedGold,
  ),
  betFeeBps: readEnvNumber("VITE_BET_FEE_BPS", baseEnvConfig.betFeeBps),
  binaryMarketMakerWallet:
    readEnvString("VITE_BINARY_MARKET_MAKER_WALLET") ??
    baseEnvConfig.binaryMarketMakerWallet,
  binaryTradeTreasuryWallet:
    readEnvString("VITE_BINARY_TRADE_TREASURY_WALLET") ??
    baseEnvConfig.binaryTradeTreasuryWallet,
  binaryTradeMarketMakerWallet:
    readEnvString("VITE_BINARY_TRADE_MARKET_MAKER_WALLET") ??
    baseEnvConfig.binaryTradeMarketMakerWallet,
  goldDecimals: readEnvNumber("VITE_GOLD_DECIMALS", baseEnvConfig.goldDecimals),
  enableAutoSeed: readEnvBoolean(
    "VITE_ENABLE_AUTO_SEED",
    baseEnvConfig.enableAutoSeed,
  ),
  gameApiUrl: resolvedGameApiUrl,
  gameWsUrl: resolvedGameWsUrl,
  streamUrl: resolvedStreamUrl,
  uiSyncDelayMs: readEnvNumber(
    "VITE_UI_SYNC_DELAY_MS",
    baseEnvConfig.uiSyncDelayMs,
  ),
  refreshIntervalMs: readEnvNumber(
    "VITE_REFRESH_INTERVAL_MS",
    baseEnvConfig.refreshIntervalMs,
  ),
  avaxRpcUrl: readEnvString("VITE_AVAX_RPC_URL") ?? baseEnvConfig.avaxRpcUrl,
  avaxChainId: readEnvNumber("VITE_AVAX_CHAIN_ID", baseEnvConfig.avaxChainId),
  avaxGoldClobAddress:
    readEnvString("VITE_AVAX_GOLD_CLOB_ADDRESS") ??
    baseEnvConfig.avaxGoldClobAddress,
  avaxGoldTokenAddress:
    readEnvString("VITE_AVAX_GOLD_TOKEN_ADDRESS") ??
    baseEnvConfig.avaxGoldTokenAddress,
  walletConnectProjectId:
    readEnvString("VITE_WALLETCONNECT_PROJECT_ID") ??
    baseEnvConfig.walletConnectProjectId,
};

export const DEFAULT_BET_WINDOW_SECONDS = CONFIG.betWindowSeconds;
export const DEFAULT_NEW_ROUND_BET_WINDOW_SECONDS =
  CONFIG.newRoundBetWindowSeconds;
export const DEFAULT_AUTO_SEED_DELAY_SECONDS = CONFIG.autoSeedDelaySeconds;
export const DEFAULT_SEED_GOLD_AMOUNT = CONFIG.marketMakerSeedGold;
export const DEFAULT_BET_FEE_BPS = CONFIG.betFeeBps;
export const GOLD_DECIMALS = CONFIG.goldDecimals;
export const DEFAULT_REFRESH_INTERVAL_MS = CONFIG.refreshIntervalMs;

export function toBaseUnits(amount: number, decimals = GOLD_DECIMALS): bigint {
  return BigInt(Math.floor(amount * 10 ** decimals));
}

export const STREAM_URL: string = CONFIG.streamUrl;
export const STREAM_URLS: string[] = resolvedStreamSources;
export const GAME_API_URL: string = CONFIG.gameApiUrl;
export const GAME_WS_URL: string = CONFIG.gameWsUrl;
export const UI_SYNC_DELAY_MS: number = CONFIG.uiSyncDelayMs;

const USE_GAME_EVM_RPC_PROXY = readEnvBoolean(
  "VITE_USE_GAME_EVM_RPC_PROXY",
  RUNTIME_ENV === "mainnet-beta",
);

const configuredManualMarketControls = readEnvBoolean(
  "VITE_ENABLE_MANUAL_MARKET_ADMIN_CONTROLS",
  RUNTIME_ENV === "localnet" || RUNTIME_ENV === "e2e",
);
export const ENABLE_MANUAL_MARKET_ADMIN_CONTROLS = isPublicBrowserRuntime()
  ? false
  : configuredManualMarketControls;

export function buildArenaWriteHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
  };
}

export function getFixedMatchId(): number | null {
  const id = import.meta.env.VITE_ACTIVE_MATCH_ID;
  if (!id) return null;
  const parsed = Number(id);
  return Number.isFinite(parsed) ? parsed : null;
}

// ============================================================================
// EVM Chain Configuration
// ============================================================================

function shouldUseGameEvmRpcProxy(): boolean {
  return USE_GAME_EVM_RPC_PROXY && RUNTIME_ENV !== "localnet";
}

export function getEvmRpcUrl(chain: "avax"): string {
  if (shouldUseGameEvmRpcProxy()) {
    return `${GAME_API_URL}/api/proxy/evm/rpc?chain=${encodeURIComponent(chain)}`;
  }
  return CONFIG.avaxRpcUrl;
}

export const AVAX_RPC_URL: string = getEvmRpcUrl("avax");
export const AVAX_CHAIN_ID: number = CONFIG.avaxChainId;
export const AVAX_GOLD_CLOB_ADDRESS: string = CONFIG.avaxGoldClobAddress;
export const AVAX_GOLD_TOKEN_ADDRESS: string = CONFIG.avaxGoldTokenAddress;

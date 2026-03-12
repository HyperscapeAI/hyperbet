export type BettingSolanaCluster =
  | "localnet"
  | "devnet"
  | "testnet"
  | "mainnet-beta";
export type BettingAppEnvironment = BettingSolanaCluster | "e2e" | "stream-ui";
export type BettingEvmNetwork =
  | "bscTestnet"
  | "bsc"
  | "baseSepolia"
  | "base"
  | "avaxFuji"
  | "avax";
export type BettingEvmChain = "bsc" | "base" | "avax";
export type BettingChainKey = "solana" | BettingEvmChain;
export type RecordedBetChain = "SOLANA" | "BSC" | "BASE" | "AVAX";
export type BettingTargetKind = "testnet" | "mainnet";
export type PredictionMarketLifecycleStatus =
  | "PENDING"
  | "OPEN"
  | "LOCKED"
  | "RESOLVED"
  | "CANCELLED"
  | "UNKNOWN";
export type PredictionMarketWinner = "NONE" | "A" | "B";

export interface NativeCurrencyConfig {
  name: string;
  symbol: string;
  decimals: number;
}

export interface ChainFeatureFlags {
  predictionMarkets: boolean;
  perps: boolean;
}

export interface BettingSolanaDeployment {
  cluster: BettingSolanaCluster;
  fightOracleProgramId: string;
  goldClobMarketProgramId: string;
  goldPerpsMarketProgramId: string;
  goldMint: string;
  usdcMint: string;
}

export interface BettingEvmDeployment {
  networkKey: BettingEvmNetwork;
  chain: BettingEvmChain;
  chainId: number;
  label: string;
  targetKind: BettingTargetKind;
  rpcEnvVar: string;
  duelOracleAddress: string;
  goldClobAddress: string;
  adminAddress: string;
  marketOperatorAddress: string;
  treasuryAddress: string;
  marketMakerAddress: string;
  deploymentVersion: string;
  goldTokenAddress: string;
  nativeCurrency: NativeCurrencyConfig;
  blockExplorerUrl: string;
  featureFlags: ChainFeatureFlags;
}

export interface BettingDeploymentManifest {
  solana: Record<BettingSolanaCluster, BettingSolanaDeployment>;
  evm: Record<BettingEvmNetwork, BettingEvmDeployment>;
}

export interface EvmChainRuntimeConfig {
  chainKey: BettingEvmChain;
  chainId: number;
  rpcUrl: string;
  goldClobAddress: string;
  goldTokenAddress: string;
  deployment: BettingEvmDeployment;
}

export interface ExternalBetRecordPayload {
  bettorWallet: string;
  chain?: string | null;
  chainKey?: string | null;
  sourceAsset?: string | null;
  sourceAmount?: number | string | bigint | null;
  goldAmount?: number | string | bigint | null;
  feeBps?: number | string | bigint | null;
  txSignature?: string | null;
  marketPda?: string | null;
  marketRef?: string | null;
  duelKey?: string | null;
  duelId?: string | null;
  inviteCode?: string | null;
  externalBetRef?: string | null;
}

export interface PredictionMarketLifecycleRecord {
  chainKey: BettingChainKey;
  duelKey: string | null;
  duelId: string | null;
  marketId: string | null;
  marketRef: string | null;
  lifecycleStatus: PredictionMarketLifecycleStatus;
  winner: PredictionMarketWinner;
  betCloseTime: number | null;
  contractAddress: string | null;
  programId: string | null;
  txRef: string | null;
  syncedAt: number | null;
  metadata?: Record<string, unknown>;
}

export const BETTING_SOLANA_CLUSTERS: BettingSolanaCluster[] = [
  "localnet",
  "devnet",
  "testnet",
  "mainnet-beta",
] as const;

export const BETTING_EVM_NETWORKS: BettingEvmNetwork[] = [
  "bscTestnet",
  "bsc",
  "baseSepolia",
  "base",
  "avaxFuji",
  "avax",
] as const;

export const BETTING_EVM_CHAIN_ORDER: BettingEvmChain[] = [
  "bsc",
  "base",
  "avax",
] as const;

const DEFAULT_FEATURE_FLAGS: ChainFeatureFlags = {
  predictionMarkets: true,
  perps: false,
};

const SOLANA_DEPLOYMENTS: Record<BettingSolanaCluster, BettingSolanaDeployment> =
  {
    localnet: {
      cluster: "localnet",
      fightOracleProgramId: "6tpRysBFd1yXRipYEYwAw9jxEoVHk15kVXfkDGFLMqcD",
      goldClobMarketProgramId: "ARVJNJp49VZnkB8QBYZAAFJmufvtVSPhnuuenwwSLwpi",
      goldPerpsMarketProgramId: "HbXhqEFevpkfYdZCN6YmJGRmQmj9vsBun2ZHjeeaLRik",
      goldMint: "DK9nBUMfdu4XprPRWeh8f6KnQiGWD8Z4xz3yzs9gpump",
      usdcMint: "",
    },
    devnet: {
      cluster: "devnet",
      fightOracleProgramId: "6tpRysBFd1yXRipYEYwAw9jxEoVHk15kVXfkDGFLMqcD",
      goldClobMarketProgramId: "ARVJNJp49VZnkB8QBYZAAFJmufvtVSPhnuuenwwSLwpi",
      goldPerpsMarketProgramId: "HbXhqEFevpkfYdZCN6YmJGRmQmj9vsBun2ZHjeeaLRik",
      goldMint: "DK9nBUMfdu4XprPRWeh8f6KnQiGWD8Z4xz3yzs9gpump",
      usdcMint: "",
    },
    testnet: {
      cluster: "testnet",
      fightOracleProgramId: "6tpRysBFd1yXRipYEYwAw9jxEoVHk15kVXfkDGFLMqcD",
      goldClobMarketProgramId: "ARVJNJp49VZnkB8QBYZAAFJmufvtVSPhnuuenwwSLwpi",
      goldPerpsMarketProgramId: "HbXhqEFevpkfYdZCN6YmJGRmQmj9vsBun2ZHjeeaLRik",
      goldMint: "",
      usdcMint: "",
    },
    "mainnet-beta": {
      cluster: "mainnet-beta",
      fightOracleProgramId: "6tpRysBFd1yXRipYEYwAw9jxEoVHk15kVXfkDGFLMqcD",
      goldClobMarketProgramId: "ARVJNJp49VZnkB8QBYZAAFJmufvtVSPhnuuenwwSLwpi",
      goldPerpsMarketProgramId: "HbXhqEFevpkfYdZCN6YmJGRmQmj9vsBun2ZHjeeaLRik",
      goldMint: "DK9nBUMfdu4XprPRWeh8f6KnQiGWD8Z4xz3yzs9gpump",
      usdcMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    },
  };

const EVM_DEPLOYMENTS: Record<BettingEvmNetwork, BettingEvmDeployment> = {
  bscTestnet: {
    networkKey: "bscTestnet",
    chain: "bsc",
    chainId: 97,
    label: "BSC Testnet",
    targetKind: "testnet",
    rpcEnvVar: "BSC_TESTNET_RPC",
    duelOracleAddress: "",
    goldClobAddress: "",
    adminAddress: "",
    marketOperatorAddress: "",
    treasuryAddress: "",
    marketMakerAddress: "",
    deploymentVersion: "v2",
    goldTokenAddress: "",
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    blockExplorerUrl: "https://testnet.bscscan.com",
    featureFlags: DEFAULT_FEATURE_FLAGS,
  },
  bsc: {
    networkKey: "bsc",
    chain: "bsc",
    chainId: 56,
    label: "BNB Smart Chain",
    targetKind: "mainnet",
    rpcEnvVar: "BSC_MAINNET_RPC",
    duelOracleAddress: "0x8F582bc1D34Ca6dA12ac46B7c7Fdec02f2465961",
    goldClobAddress: "0x443C09B1E7bb7bA3392b02500772B185654A6F33",
    adminAddress: "0x7908b93DF1A91A5e1B83a4538107Db3c9131eED8",
    marketOperatorAddress: "0x7908b93DF1A91A5e1B83a4538107Db3c9131eED8",
    treasuryAddress: "0x0262dC245f38d614d508D8BD680c69E3B6D26F4c",
    marketMakerAddress: "0x1B6C8799998f0a55CA69E6b2886C489861045cFd",
    deploymentVersion: "v2",
    goldTokenAddress: "",
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    blockExplorerUrl: "https://bscscan.com",
    featureFlags: DEFAULT_FEATURE_FLAGS,
  },
  baseSepolia: {
    networkKey: "baseSepolia",
    chain: "base",
    chainId: 84532,
    label: "Base Sepolia",
    targetKind: "testnet",
    rpcEnvVar: "BASE_SEPOLIA_RPC",
    duelOracleAddress: "",
    goldClobAddress: "",
    adminAddress: "",
    marketOperatorAddress: "",
    treasuryAddress: "",
    marketMakerAddress: "",
    deploymentVersion: "v2",
    goldTokenAddress: "",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    blockExplorerUrl: "https://sepolia.basescan.org",
    featureFlags: DEFAULT_FEATURE_FLAGS,
  },
  base: {
    networkKey: "base",
    chain: "base",
    chainId: 8453,
    label: "Base",
    targetKind: "mainnet",
    rpcEnvVar: "BASE_MAINNET_RPC",
    duelOracleAddress: "0x63BF7f48A2795832C2b5f78172A1C6BE655F3a72",
    goldClobAddress: "0xb8c66D6895Bafd1B0027F2c0865865043064437C",
    adminAddress: "0x7908b93DF1A91A5e1B83a4538107Db3c9131eED8",
    marketOperatorAddress: "0x7908b93DF1A91A5e1B83a4538107Db3c9131eED8",
    treasuryAddress: "0x0262dC245f38d614d508D8BD680c69E3B6D26F4c",
    marketMakerAddress: "0x1B6C8799998f0a55CA69E6b2886C489861045cFd",
    deploymentVersion: "v2",
    goldTokenAddress: "",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    blockExplorerUrl: "https://basescan.org",
    featureFlags: DEFAULT_FEATURE_FLAGS,
  },
  avaxFuji: {
    networkKey: "avaxFuji",
    chain: "avax",
    chainId: 43113,
    label: "Avalanche Fuji",
    targetKind: "testnet",
    rpcEnvVar: "AVAX_FUJI_RPC",
    duelOracleAddress: "",
    goldClobAddress: "",
    adminAddress: "",
    marketOperatorAddress: "",
    treasuryAddress: "",
    marketMakerAddress: "",
    deploymentVersion: "v2",
    goldTokenAddress: "",
    nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 },
    blockExplorerUrl: "https://testnet.snowtrace.io",
    featureFlags: DEFAULT_FEATURE_FLAGS,
  },
  avax: {
    networkKey: "avax",
    chain: "avax",
    chainId: 43114,
    label: "Avalanche C-Chain",
    targetKind: "mainnet",
    rpcEnvVar: "AVAX_MAINNET_RPC",
    duelOracleAddress: "",
    goldClobAddress: "",
    adminAddress: "",
    marketOperatorAddress: "",
    treasuryAddress: "",
    marketMakerAddress: "",
    deploymentVersion: "v2",
    goldTokenAddress: "",
    nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 },
    blockExplorerUrl: "https://snowtrace.io",
    featureFlags: DEFAULT_FEATURE_FLAGS,
  },
};

export const BETTING_DEPLOYMENTS: BettingDeploymentManifest = {
  solana: SOLANA_DEPLOYMENTS,
  evm: EVM_DEPLOYMENTS,
};

export function normalizeSolanaCluster(cluster: string): BettingSolanaCluster {
  switch (cluster.trim().toLowerCase()) {
    case "local":
    case "localnet":
    case "e2e":
      return "localnet";
    case "dev":
    case "devnet":
    case "stream-ui":
      return "devnet";
    case "test":
    case "testnet":
      return "testnet";
    case "mainnet":
    case "mainnet-beta":
    case "prod":
    case "production":
      return "mainnet-beta";
    default:
      throw new Error(`Unsupported Solana cluster '${cluster}'`);
  }
}

export function resolveBettingSolanaDeployment(
  cluster: string,
): BettingSolanaDeployment {
  return BETTING_DEPLOYMENTS.solana[normalizeSolanaCluster(cluster)];
}

export function resolveBettingEvmDeployment(
  network: BettingEvmNetwork,
): BettingEvmDeployment {
  return BETTING_DEPLOYMENTS.evm[network];
}

export function defaultRpcUrlForEvmNetwork(network: BettingEvmNetwork): string {
  switch (network) {
    case "bsc":
      return "https://bsc-dataseed.binance.org";
    case "bscTestnet":
      return "https://data-seed-prebsc-1-s1.binance.org:8545";
    case "base":
      return "https://mainnet.base.org";
    case "baseSepolia":
      return "https://sepolia.base.org";
    case "avax":
      return "https://api.avax.network/ext/bc/C/rpc";
    case "avaxFuji":
      return "https://api.avax-test.network/ext/bc/C/rpc";
  }
}

export function resolveBettingEvmDefaults(environment: BettingAppEnvironment): {
  bsc: BettingEvmDeployment;
  base: BettingEvmDeployment;
  avax: BettingEvmDeployment;
} {
  if (environment === "mainnet-beta") {
    return {
      bsc: BETTING_DEPLOYMENTS.evm.bsc,
      base: BETTING_DEPLOYMENTS.evm.base,
      avax: BETTING_DEPLOYMENTS.evm.avax,
    };
  }

  return {
    bsc: BETTING_DEPLOYMENTS.evm.bscTestnet,
    base: BETTING_DEPLOYMENTS.evm.baseSepolia,
    avax: BETTING_DEPLOYMENTS.evm.avaxFuji,
  };
}

export function resolveBettingEvmDeploymentForChain(
  chainKey: BettingEvmChain,
  environment: BettingAppEnvironment,
): BettingEvmDeployment {
  const defaults = resolveBettingEvmDefaults(environment);
  return defaults[chainKey];
}

export function getEvmRuntimeConfig(
  chainKey: BettingEvmChain,
  environment: BettingAppEnvironment,
  overrides: Partial<
    Pick<EvmChainRuntimeConfig, "chainId" | "rpcUrl" | "goldClobAddress" | "goldTokenAddress">
  > = {},
): EvmChainRuntimeConfig {
  const deployment = resolveBettingEvmDeploymentForChain(chainKey, environment);
  return {
    chainKey,
    chainId: overrides.chainId ?? deployment.chainId,
    rpcUrl: overrides.rpcUrl ?? defaultRpcUrlForEvmNetwork(deployment.networkKey),
    goldClobAddress: overrides.goldClobAddress ?? deployment.goldClobAddress,
    goldTokenAddress: overrides.goldTokenAddress ?? deployment.goldTokenAddress,
    deployment,
  };
}

export function normalizeChainKey(
  value: string | null | undefined,
  fallback: BettingChainKey = "solana",
): BettingChainKey {
  const normalized = value?.trim().toLowerCase();
  switch (normalized) {
    case "sol":
    case "solana":
      return "solana";
    case "bsc":
    case "bnb":
      return "bsc";
    case "base":
      return "base";
    case "avax":
    case "avalanche":
      return "avax";
    default:
      return fallback;
  }
}

export function isEvmChainKey(
  chainKey: BettingChainKey,
): chainKey is BettingEvmChain {
  return chainKey !== "solana";
}

export function toRecordedBetChain(chainKey: BettingChainKey): RecordedBetChain {
  switch (chainKey) {
    case "bsc":
      return "BSC";
    case "base":
      return "BASE";
    case "avax":
      return "AVAX";
    case "solana":
    default:
      return "SOLANA";
  }
}

export function resolveLifecycleFromEvmStatus(
  status: number | string | null | undefined,
): PredictionMarketLifecycleStatus {
  const numeric =
    typeof status === "number"
      ? status
      : typeof status === "string"
        ? Number.parseInt(status, 10)
        : Number.NaN;
  switch (numeric) {
    case 1:
      return "OPEN";
    case 2:
      return "LOCKED";
    case 3:
      return "RESOLVED";
    case 4:
      return "CANCELLED";
    case 0:
      return "PENDING";
    default:
      return "UNKNOWN";
  }
}

export function resolveLifecycleFromStreamPhase(
  phase: string | null | undefined,
): PredictionMarketLifecycleStatus {
  switch (phase?.toUpperCase()) {
    case "ANNOUNCEMENT":
      return "OPEN";
    case "COUNTDOWN":
    case "FIGHTING":
      return "LOCKED";
    case "RESOLUTION":
      return "RESOLVED";
    case "IDLE":
      return "PENDING";
    default:
      return "UNKNOWN";
  }
}

export function resolveWinnerFromEvmStatus(
  winner: number | string | null | undefined,
): PredictionMarketWinner {
  const numeric =
    typeof winner === "number"
      ? winner
      : typeof winner === "string"
        ? Number.parseInt(winner, 10)
        : Number.NaN;
  switch (numeric) {
    case 1:
      return "A";
    case 2:
      return "B";
    default:
      return "NONE";
  }
}

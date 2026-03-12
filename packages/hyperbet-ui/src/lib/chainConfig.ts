import {
  BETTING_EVM_CHAIN_ORDER,
  type BettingEvmChain,
} from "@hyperbet/chain-registry";
import type { Chain } from "wagmi/chains";

import { CONFIG, getEvmRpcUrl } from "./config";

export type ChainId = "solana" | BettingEvmChain;

export type EvmChainConfig = {
  chainId: BettingEvmChain;
  evmChainId: number;
  name: string;
  shortName: string;
  rpcUrl: string;
  goldClobAddress: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  blockExplorer: string;
  wagmiChain: Chain;
  color: string;
  icon: string;
};

const CHAIN_UI_META: Partial<
  Record<BettingEvmChain, { shortName: string; color: string; icon: string }>
> = {
  bsc: { shortName: "BSC", color: "#F0B90B", icon: "💎" },
  base: { shortName: "Base", color: "#0052FF", icon: "🔵" },
  avax: { shortName: "AVAX", color: "#E84142", icon: "🔺" },
};

function createCustomChain(config: {
  chainId: number;
  name: string;
  rpcUrl: string;
  blockExplorer: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  testnet: boolean;
}): Chain {
  return {
    id: config.chainId,
    name: config.name,
    nativeCurrency: config.nativeCurrency,
    rpcUrls: {
      default: { http: [config.rpcUrl] },
      public: { http: [config.rpcUrl] },
    },
    blockExplorers: {
      default: {
        name: "Explorer",
        url: config.blockExplorer,
      },
    },
    testnet: config.testnet,
  } as Chain;
}

function formatChainName(
  chainKey: BettingEvmChain,
  runtimeChainId: number,
  deploymentChainId: number,
  deploymentLabel: string,
  fallbackShortName: string,
): string {
  if (runtimeChainId === deploymentChainId) {
    return deploymentLabel;
  }
  return `${fallbackShortName} Local (${runtimeChainId})`;
}

function getRuntimeChainConfig(chainKey: BettingEvmChain): EvmChainConfig | null {
  const runtime = CONFIG.evmChains[chainKey];
  if (!runtime) return null;

  const uiMeta = CHAIN_UI_META[chainKey];
  const shortName = uiMeta?.shortName ?? chainKey.toUpperCase();
  const name = formatChainName(
    chainKey,
    runtime.chainId,
    runtime.deployment.chainId,
    runtime.deployment.label,
    shortName,
  );
  const blockExplorer =
    runtime.chainId === runtime.deployment.chainId
      ? runtime.deployment.blockExplorerUrl
      : getEvmRpcUrl(chainKey);
  const isTestnet =
    runtime.deployment.targetKind === "testnet" ||
    runtime.chainId !== runtime.deployment.chainId;

  return {
    chainId: chainKey,
    evmChainId: runtime.chainId,
    name,
    shortName,
    rpcUrl: getEvmRpcUrl(chainKey),
    goldClobAddress: runtime.goldClobAddress,
    nativeCurrency: runtime.deployment.nativeCurrency,
    blockExplorer,
    wagmiChain: createCustomChain({
      chainId: runtime.chainId,
      name,
      rpcUrl: getEvmRpcUrl(chainKey),
      blockExplorer,
      nativeCurrency: runtime.deployment.nativeCurrency,
      testnet: isTestnet,
    }),
    color: uiMeta?.color ?? "#71717A",
    icon: uiMeta?.icon ?? "◌",
  };
}

function hasConfiguredContracts(config: EvmChainConfig | null): config is EvmChainConfig {
  return Boolean(config?.goldClobAddress.trim().length);
}

function allRuntimeEvmChains(): EvmChainConfig[] {
  return BETTING_EVM_CHAIN_ORDER.map((chainKey) => getRuntimeChainConfig(chainKey))
    .filter((config): config is EvmChainConfig => config !== null);
}

export function getEnabledEvmChains(): EvmChainConfig[] {
  return allRuntimeEvmChains().filter((config) => hasConfiguredContracts(config));
}

export function getEvmChainConfig(
  chainId: BettingEvmChain,
): EvmChainConfig | null {
  const config = getRuntimeChainConfig(chainId);
  return hasConfiguredContracts(config) ? config : null;
}

export function getAvailableChains(): ChainId[] {
  const chains: ChainId[] = ["solana"];
  for (const chain of getEnabledEvmChains()) {
    chains.push(chain.chainId);
  }
  return chains;
}

export function getWagmiChains(): [Chain, ...Chain[]] {
  const chains = getEnabledEvmChains();
  const fallback = chains.length > 0 ? chains : allRuntimeEvmChains();
  const wagmiChains = fallback.map((chain) => chain.wagmiChain);
  return wagmiChains as [Chain, ...Chain[]];
}

export const CHAIN_DISPLAY: Record<
  ChainId,
  { name: string; shortName: string; icon: string; color: string }
> = {
  solana: {
    name: "Solana",
    shortName: "SOL",
    icon: "☀️",
    color: "#9945FF",
  },
  bsc: {
    name: getRuntimeChainConfig("bsc")?.name ?? "BNB Smart Chain",
    shortName: getRuntimeChainConfig("bsc")?.shortName ?? "BSC",
    icon: getRuntimeChainConfig("bsc")?.icon ?? "💎",
    color: getRuntimeChainConfig("bsc")?.color ?? "#F0B90B",
  },
  base: {
    name: getRuntimeChainConfig("base")?.name ?? "Base",
    shortName: getRuntimeChainConfig("base")?.shortName ?? "Base",
    icon: getRuntimeChainConfig("base")?.icon ?? "🔵",
    color: getRuntimeChainConfig("base")?.color ?? "#0052FF",
  },
  avax: {
    name: getRuntimeChainConfig("avax")?.name ?? "Avalanche",
    shortName: getRuntimeChainConfig("avax")?.shortName ?? "AVAX",
    icon: getRuntimeChainConfig("avax")?.icon ?? "🔺",
    color: getRuntimeChainConfig("avax")?.color ?? "#E84142",
  },
};

export const LARGEST_MARKET_CACHE_KEY = "goldArena_largestMarketChain";

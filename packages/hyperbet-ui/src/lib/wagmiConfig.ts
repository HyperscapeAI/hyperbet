/**
 * Wagmi configuration for EVM wallet support.
 * Chains are configured based on env variables.
 */

import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { getWagmiChains, getEnabledEvmChains } from "./chainConfig";
import { CONFIG } from "./config";

const chains = getWagmiChains();
const enabledEvmChains = getEnabledEvmChains();
const fallbackRpcUrl =
  enabledEvmChains[0]?.rpcUrl ?? chains[0]?.rpcUrls.default.http[0] ?? "";

// Build transport map from enabled chains
const transports: Record<number, ReturnType<typeof http>> = {};
for (const evmChain of enabledEvmChains) {
  transports[evmChain.evmChainId] = http(evmChain.rpcUrl);
}
// Fallback for any chain that didn't get explicitly mapped
for (const chain of chains) {
  if (!transports[chain.id]) {
    transports[chain.id] = http(fallbackRpcUrl);
  }
}

const walletConnectProjectId = CONFIG.walletConnectProjectId.trim();
const hasWalletConnectProjectId =
  walletConnectProjectId.length > 0 &&
  walletConnectProjectId.toLowerCase() !== "demo";

export const wagmiConfig = hasWalletConnectProjectId
  ? getDefaultConfig({
      appName: "GoldArena",
      projectId: walletConnectProjectId,
      chains,
      transports,
    })
  : createConfig({
      chains,
      transports,
      connectors: [injected()],
    });

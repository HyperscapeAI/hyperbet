import { createChainProvider } from "@hyperbet/ui/lib/ChainContext";
import { getEnabledEvmChains } from "@hyperbet/ui/lib/chainConfig";

export { useChain } from "@hyperbet/ui/lib/ChainContext";

const enabledEvmChains = getEnabledEvmChains().map((chain) => chain.chainId);
const defaultEvmChain = enabledEvmChains[0] ?? "bsc";

export const ChainProvider = createChainProvider({
  e2eDefaultChain: defaultEvmChain,
  chains: enabledEvmChains.length ? enabledEvmChains : [defaultEvmChain],
});

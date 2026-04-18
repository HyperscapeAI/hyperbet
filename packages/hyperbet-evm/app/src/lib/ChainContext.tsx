import { createChainProvider } from "@hyperbet/ui/lib/ChainContext";
import { getAvailableChains } from "@hyperbet/ui/lib/chainConfig";

export { useChain } from "@hyperbet/ui/lib/ChainContext";

export const ChainProvider = createChainProvider({
  e2eDefaultChain: "solana",
  chains: getAvailableChains(),
});

import { createChainProvider } from "@hyperbet/ui/lib/ChainContext";
import { getAvailableChains } from "@hyperbet/ui/lib/chainConfig";

export { useChain } from "@hyperbet/ui/lib/ChainContext";

const e2eAvailableChains =
  import.meta.env.MODE === "e2e"
    ? (["solana", "bsc"] as const)
    : getAvailableChains();

export const ChainProvider = createChainProvider({
  e2eDefaultChain: "solana",
  chains: [...e2eAvailableChains],
});

import { createChainProvider } from "@hyperbet/ui/lib/ChainContext";

export { useChain } from "@hyperbet/ui/lib/ChainContext";

export const ChainProvider = createChainProvider({
  e2eDefaultChain: "bsc",
  chains: ["bsc"],
});

import { ChainProvider } from "./lib/ChainContext";
import { createHybridAppRoot } from "@hyperbet/ui/createHybridAppRoot";
import { CONFIG, getRpcUrl, getWsUrl } from "@hyperbet/ui/lib/config";
import { wagmiConfig } from "@hyperbet/ui/lib/wagmiConfig";
import { App } from "./App";
import { StreamUIApp } from "./StreamUIApp";

const UnifiedAppRoot = createHybridAppRoot({
  ChainProvider,
  wagmiConfig: wagmiConfig as any,
  App,
  StreamUIApp,
  getSolanaRpcUrl: getRpcUrl,
  getSolanaWsUrl: getWsUrl,
  getSolanaCluster: () => CONFIG.cluster,
  isStreamUi: import.meta.env.MODE === "stream-ui",
  themeId: "evm",
  themeStorageKey: "hyperbet-evm-theme",
});

export default function AppRoot() {
  return <UnifiedAppRoot />;
}

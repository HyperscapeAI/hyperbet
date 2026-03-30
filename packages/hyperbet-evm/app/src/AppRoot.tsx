import { ChainProvider } from "./lib/ChainContext";
import { createEvmAppRoot } from "@hyperbet/ui";
import { wagmiConfig } from "@hyperbet/ui/lib/wagmiConfig";
import { App } from "./App";
import { StreamUIApp } from "./StreamUIApp";

export default createEvmAppRoot({
  ChainProvider,
  wagmiConfig: wagmiConfig as any,
  App,
  StreamUIApp,
  themeId: "evm",
  themeStorageKey: "hyperbet-evm-theme",
});

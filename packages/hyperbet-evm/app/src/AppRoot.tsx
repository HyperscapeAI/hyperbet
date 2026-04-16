import { type ComponentProps } from "react";
import { type WagmiProvider } from "wagmi";
import { ChainProvider } from "./lib/ChainContext";
import { createEvmAppRoot } from "@hyperbet/ui";
import { wagmiConfig } from "@hyperbet/ui/lib/wagmiConfig";
import { App } from "./App";
import { StreamUIApp } from "./StreamUIApp";

type WagmiConfig = ComponentProps<typeof WagmiProvider>["config"];

export default createEvmAppRoot({
  ChainProvider,
  wagmiConfig: wagmiConfig as WagmiConfig,
  App,
  StreamUIApp,
  themeId: "evm",
  themeStorageKey: "hyperbet-evm-theme",
});

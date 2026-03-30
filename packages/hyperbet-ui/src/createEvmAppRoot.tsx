/**
 * EVM-only app root factory — no Solana imports whatsoever.
 * Use this in hyperbet-avax and hyperbet-bsc so that Vite never crawls
 * @solana/* dependencies and hits the @noble/hashes v1/v2 conflict.
 */
import {
  type CSSProperties,
  type ComponentProps,
  type ComponentType,
  type ReactNode,
  useMemo,
} from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RainbowKitProvider,
  darkTheme,
  lightTheme,
} from "@rainbow-me/rainbowkit";
import { WagmiProvider } from "wagmi";

import "@rainbow-me/rainbowkit/styles.css";
import {
  HyperbetThemeProvider,
  useHyperbetTheme,
  type HyperbetThemeId,
} from "./lib/theme";

type WagmiConfig = ComponentProps<typeof WagmiProvider>["config"];

export interface CreateEvmAppRootOptions {
  ChainProvider: ComponentType<{ children: ReactNode }>;
  wagmiConfig: WagmiConfig;
  App: ComponentType;
  StreamUIApp: ComponentType;
  isStreamUi?: boolean;
  themeId?: HyperbetThemeId;
  themeStorageKey?: string;
}

export function createEvmAppRoot({
  ChainProvider,
  wagmiConfig,
  App,
  StreamUIApp,
  isStreamUi = import.meta.env.MODE === "stream-ui",
  themeId = "evm",
  themeStorageKey,
}: CreateEvmAppRootOptions): ComponentType {
  function EvmProviders({ children }: { children: ReactNode }) {
    const queryClient = useMemo(() => new QueryClient(), []);
    const { appearance, themeDefinition } = useHyperbetTheme();
    const rainbowTheme = useMemo(
      () =>
        appearance === "light"
          ? lightTheme({
              accentColor: themeDefinition.accentColor,
              accentColorForeground: themeDefinition.accentColorForeground,
              borderRadius: "large",
              overlayBlur: "small",
            })
          : darkTheme({
              accentColor: themeDefinition.accentColor,
              accentColorForeground: themeDefinition.accentColorForeground,
              borderRadius: "large",
              overlayBlur: "small",
            }),
      [appearance, themeDefinition],
    );

    return (
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>
          <RainbowKitProvider theme={rainbowTheme}>
            <div
              data-hyperbet-theme={themeId}
              style={themeDefinition.colorVariables as CSSProperties}
            >
              <ChainProvider>{children}</ChainProvider>
            </div>
          </RainbowKitProvider>
        </WagmiProvider>
      </QueryClientProvider>
    );
  }

  return function EvmAppRoot() {
    const appContent = isStreamUi ? <StreamUIApp /> : <App />;

    return (
      <HyperbetThemeProvider themeId={themeId} storageKey={themeStorageKey}>
        <EvmProviders>{appContent}</EvmProviders>
      </HyperbetThemeProvider>
    );
  };
}

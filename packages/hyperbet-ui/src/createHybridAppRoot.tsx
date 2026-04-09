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
import { SolanaProvider } from "@solana/react-hooks";
import { WagmiProvider } from "wagmi";

import "@rainbow-me/rainbowkit/styles.css";
import {
  AppWalletProvider,
  createFrameworkClient,
  createHeadlessWalletConnectorsFromEnv,
  type SolanaCluster,
} from "./lib/solanaRuntime";
import {
  HyperbetThemeProvider,
  useHyperbetTheme,
  type HyperbetThemeId,
} from "./lib/theme";

type WagmiConfig = ComponentProps<typeof WagmiProvider>["config"];

export interface CreateHybridAppRootOptions {
  ChainProvider: ComponentType<{ children: ReactNode }>;
  wagmiConfig: WagmiConfig;
  App: ComponentType;
  StreamUIApp: ComponentType;
  getSolanaRpcUrl: () => string;
  getSolanaWsUrl: () => string | undefined;
  getSolanaCluster?: () => SolanaCluster;
  isStreamUi?: boolean;
  themeId?: HyperbetThemeId;
  themeStorageKey?: string;
  solanaWalletStorageKey?: string;
}

export function createHybridAppRoot({
  ChainProvider,
  wagmiConfig,
  App,
  StreamUIApp,
  getSolanaRpcUrl,
  getSolanaWsUrl,
  getSolanaCluster = () => "devnet",
  isStreamUi = import.meta.env.MODE === "stream-ui",
  themeId = "evm",
  themeStorageKey,
  solanaWalletStorageKey = "hyperbet-solana:last-wallet",
}: CreateHybridAppRootOptions): ComponentType {
  function HybridProviders({ children }: { children: ReactNode }) {
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

    const frameworkClient = useMemo(
      () =>
        createFrameworkClient({
          getRpcUrl: getSolanaRpcUrl,
          getWsUrl: getSolanaWsUrl,
          getCluster: getSolanaCluster,
        }),
      [getSolanaCluster, getSolanaRpcUrl, getSolanaWsUrl],
    );
    const headlessAutoConnectorId =
      createHeadlessWalletConnectorsFromEnv().find(
        (entry) => entry.autoConnect,
      )?.connector.id ?? null;

    return (
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>
          <RainbowKitProvider theme={rainbowTheme}>
            <SolanaProvider
              client={frameworkClient}
              walletPersistence={{
                autoConnect: true,
                storageKey: solanaWalletStorageKey,
              }}
            >
              <AppWalletProvider
                headlessAutoConnectorId={headlessAutoConnectorId}
                rpcUrl={getSolanaRpcUrl()}
                wsUrl={getSolanaWsUrl()}
              >
                <div
                  data-hyperbet-theme={themeId}
                  style={themeDefinition.colorVariables as CSSProperties}
                >
                  <ChainProvider>{children}</ChainProvider>
                </div>
              </AppWalletProvider>
            </SolanaProvider>
          </RainbowKitProvider>
        </WagmiProvider>
      </QueryClientProvider>
    );
  }

  return function HybridAppRoot() {
    const appContent = isStreamUi ? <StreamUIApp /> : <App />;

    return (
      <HyperbetThemeProvider themeId={themeId} storageKey={themeStorageKey}>
        <HybridProviders>{appContent}</HybridProviders>
      </HyperbetThemeProvider>
    );
  };
}

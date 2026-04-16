import {
  lazy,
  Suspense,
  useMemo,
  type ComponentProps,
  type ComponentType,
  type ReactNode,
} from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { WagmiProvider } from "wagmi";

// Avoids deep structural type errors from minor viem version mismatches.
type WagmiConfig = ComponentProps<typeof WagmiProvider>["config"];

import "@rainbow-me/rainbowkit/styles.css";

import type { HeadlessWalletDescriptor } from "./lib/appRootTypes";
export type { HeadlessWalletDescriptor } from "./lib/appRootTypes";

// Lazy-loaded so EVM-only packages never trigger @solana/* dep scanning.
const SolanaProviders = lazy(() =>
  import("./SolanaProviders").then((m) => ({ default: m.SolanaProviders })),
);

export type CreateHyperbetAppRootOptions = {
  getRpcUrl: () => string;
  getWsUrl: () => string | undefined;
  createHeadlessWalletsFromEnv: () => HeadlessWalletDescriptor[];
  ChainProvider: ComponentType<{ children: ReactNode }>;
  wagmiConfig?: WagmiConfig;
  App: ComponentType;
  StreamUIApp: ComponentType;
  isStreamUi?: boolean;
};

export function createHyperbetAppRoot({
  getRpcUrl,
  getWsUrl,
  createHeadlessWalletsFromEnv,
  ChainProvider,
  wagmiConfig,
  App,
  StreamUIApp,
  isStreamUi = import.meta.env.MODE === "stream-ui",
}: CreateHyperbetAppRootOptions): ComponentType {
  const queryClient = new QueryClient();

  return function HyperbetAppRoot() {
    const endpoint = getRpcUrl();
    const wsEndpoint = getWsUrl();
    const headlessWallets = useMemo(() => createHeadlessWalletsFromEnv(), []);

    const autoConnectWallet = headlessWallets.find(
      (entry) => entry.autoConnect,
    );
    if (autoConnectWallet) {
      const adapter = autoConnectWallet.adapter as { name?: string };
      if (adapter.name) {
        localStorage.setItem("walletName", JSON.stringify(adapter.name));
      }
    }

    const appContent = isStreamUi ? <StreamUIApp /> : <App />;

    const innerContent = endpoint ? (
      <Suspense fallback={null}>
        <SolanaProviders
          endpoint={endpoint}
          wsEndpoint={wsEndpoint}
          headlessWallets={headlessWallets}
        >
          {appContent}
        </SolanaProviders>
      </Suspense>
    ) : (
      appContent
    );

    const content = <ChainProvider>{innerContent}</ChainProvider>;

    return (
      <QueryClientProvider client={queryClient}>
        {wagmiConfig ? (
          <WagmiProvider config={wagmiConfig}>
            <RainbowKitProvider
              theme={darkTheme({
                accentColor: "#eab308",
                borderRadius: "large",
              })}
            >
              {content}
            </RainbowKitProvider>
          </WagmiProvider>
        ) : (
          content
        )}
      </QueryClientProvider>
    );
  };
}

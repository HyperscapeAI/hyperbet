import { useMemo } from "react";
import { Buffer } from "buffer";
import { SolanaProvider } from "@solana/react-hooks";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AppWalletProvider } from "./lib/appWallet";
import { createFrameworkClient } from "./lib/frameworkClient";
import { createHeadlessWalletConnectorsFromEnv } from "./lib/headlessWallet";
import { App } from "./App";
import { StreamUIApp } from "./StreamUIApp";

const IS_STREAM_UI = import.meta.env.MODE === "stream-ui";

if (!(globalThis as { Buffer?: typeof Buffer }).Buffer) {
  (globalThis as { Buffer?: typeof Buffer }).Buffer = Buffer;
}

const queryClient = new QueryClient();

export default function AppRoot() {
  const headlessWallets = useMemo(
    () => createHeadlessWalletConnectorsFromEnv(),
    [],
  );
  const frameworkClient = useMemo(() => createFrameworkClient(), []);
  const autoConnectHeadlessConnectorId =
    headlessWallets.find((entry) => entry.autoConnect)?.connector.id ?? null;

  return (
    <SolanaProvider
      client={frameworkClient}
      walletPersistence={{
        autoConnect: true,
        storageKey: "hyperbet-solana:last-wallet",
      }}
    >
      <QueryClientProvider client={queryClient}>
        <AppWalletProvider
          headlessAutoConnectorId={autoConnectHeadlessConnectorId}
        >
          {IS_STREAM_UI ? <StreamUIApp /> : <App />}
        </AppWalletProvider>
      </QueryClientProvider>
    </SolanaProvider>
  );
}

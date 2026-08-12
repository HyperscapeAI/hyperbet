import { useEffect, useMemo, useRef, useState } from "react";
import { Buffer } from "buffer";
import { SolanaProvider } from "@solana/react-hooks";
import { watchWalletStandardConnectors } from "@solana/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AppWalletProvider, SpectatorAppWalletProvider } from "./lib/appWallet";
import { CONFIG } from "./lib/config";
import { createFrameworkClient } from "./lib/frameworkClient";
import { createHeadlessWalletConnectorsFromEnv } from "./lib/headlessWallet";
import { App } from "./App";
import { StreamUIApp } from "./StreamUIApp";

const IS_STREAM_UI = import.meta.env.MODE === "stream-ui";

if (!(globalThis as { Buffer?: typeof Buffer }).Buffer) {
  (globalThis as { Buffer?: typeof Buffer }).Buffer = Buffer;
}

const queryClient = new QueryClient();

function AppContent() {
  return IS_STREAM_UI ? <StreamUIApp /> : <App />;
}

function TransactionWalletRoot() {
  const [walletScanVersion, setWalletScanVersion] = useState(0);
  const headlessWallets = useMemo(
    () => createHeadlessWalletConnectorsFromEnv(),
    [],
  );
  const frameworkClient = useMemo(
    () => createFrameworkClient(),
    [walletScanVersion],
  );
  const knownConnectorIdsRef = useRef<string>("");
  const autoConnectHeadlessConnectorId =
    headlessWallets.find((entry) => entry.autoConnect)?.connector.id ?? null;

  useEffect(() => {
    const stopWatchingWallets = watchWalletStandardConnectors((connectors) => {
      const nextConnectorIds = connectors
        .map((connector) => connector.id)
        .sort()
        .join("|");
      if (nextConnectorIds === knownConnectorIdsRef.current) return;
      knownConnectorIdsRef.current = nextConnectorIds;

      const walletStatus = frameworkClient.store.getState().wallet.status;
      if (walletStatus === "disconnected") {
        setWalletScanVersion((value) => value + 1);
      }
    });

    const delayedRescanId = window.setTimeout(() => {
      const walletStatus = frameworkClient.store.getState().wallet.status;
      if (walletStatus === "disconnected") {
        setWalletScanVersion((value) => value + 1);
      }
    }, 500);

    return () => {
      stopWatchingWallets();
      window.clearTimeout(delayedRescanId);
    };
  }, [frameworkClient]);

  return (
    <SolanaProvider
      client={frameworkClient}
      walletPersistence={{
        autoConnect: true,
        storageKey: "hyperbet-solana:last-wallet",
      }}
    >
      <AppWalletProvider
        headlessAutoConnectorId={autoConnectHeadlessConnectorId}
      >
        <AppContent />
      </AppWalletProvider>
    </SolanaProvider>
  );
}

export default function AppRoot() {
  return (
    <QueryClientProvider client={queryClient}>
      {CONFIG.transactionsEnabled ? (
        <TransactionWalletRoot />
      ) : (
        <SpectatorAppWalletProvider>
          <AppContent />
        </SpectatorAppWalletProvider>
      )}
    </QueryClientProvider>
  );
}

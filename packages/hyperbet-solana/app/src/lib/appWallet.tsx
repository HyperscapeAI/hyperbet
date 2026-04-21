import type { ReactNode } from "react";

import { getRpcUrl, getWsUrl } from "./config";
import {
  AppWalletProvider as SharedAppWalletProvider,
  useAppConnection,
  useAppWallet,
  useAppWalletModal,
} from "@hyperbet/ui/lib/solanaRuntime";

export type { AppWallet } from "@hyperbet/ui/lib/solanaRuntime";

export type AppWalletConnection = ReturnType<typeof useAppConnection>;
export type AppWalletModalState = ReturnType<typeof useAppWalletModal>;

export function AppWalletProvider({
  children,
  headlessAutoConnectorId,
}: {
  children: ReactNode;
  headlessAutoConnectorId: string | null;
}) {
  return (
    <SharedAppWalletProvider
      headlessAutoConnectorId={headlessAutoConnectorId}
      rpcUrl={getRpcUrl()}
      wsUrl={getWsUrl()}
    >
      {children}
    </SharedAppWalletProvider>
  );
}

export { useAppConnection, useAppWallet, useAppWalletModal };

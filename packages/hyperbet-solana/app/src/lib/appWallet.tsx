import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { useWalletConnection, useWalletModalState } from "@solana/react-hooks";
import type { WalletConnector, WalletSession } from "@solana/client";
import type { Address } from "@solana/kit";
import {
  Connection,
  PublicKey,
  type Transaction,
  type VersionedTransaction,
} from "@solana/web3.js";

import { getRpcUrl, getWsUrl } from "./config";

type WalletLike = {
  id: string;
  name: string;
  icon?: string;
  ready: boolean;
};

export type AppWallet = {
  address: Address | null;
  connect: () => Promise<void>;
  connected: boolean;
  connecting: boolean;
  disconnect: () => Promise<void>;
  publicKey: PublicKey | null;
  session: WalletSession | null;
  select: (connectorId: string | null) => void;
  signAllTransactions?: <T extends Array<Transaction | VersionedTransaction>>(
    txs: T,
  ) => Promise<T>;
  signTransaction?: <T extends Transaction | VersionedTransaction>(
    tx: T,
  ) => Promise<T>;
  wallet: WalletLike | null;
  wallets: WalletLike[];
};

type AppWalletConnection = {
  connection: Connection;
};

type AppWalletModalState = {
  setVisible: (visible: boolean) => void;
  visible: boolean;
};

type AppWalletContextValue = {
  modal: AppWalletModalState;
  wallet: AppWallet;
};

const AppWalletContext = createContext<AppWalletContextValue | null>(null);

const SPECTATOR_WALLET: AppWallet = {
  address: null,
  connect: async () => {},
  connected: false,
  connecting: false,
  disconnect: async () => {},
  publicKey: null,
  session: null,
  select: () => {},
  signAllTransactions: undefined,
  signTransaction: undefined,
  wallet: null,
  wallets: [],
};

const SPECTATOR_CONTEXT: AppWalletContextValue = {
  modal: {
    setVisible: () => {},
    visible: false,
  },
  wallet: SPECTATOR_WALLET,
};

const connectionCache = new Map<string, Connection>();

function getSharedConnection(rpcUrl: string, wsUrl: string): Connection {
  const cacheKey = `${rpcUrl}|${wsUrl}`;
  const cached = connectionCache.get(cacheKey);
  if (cached) return cached;

  const connection = new Connection(rpcUrl, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    wsEndpoint: wsUrl,
  });
  connectionCache.set(cacheKey, connection);
  return connection;
}

function walletReady(connector: WalletConnector): boolean {
  return connector.ready !== false;
}

function walletSessionPublicKey(
  session: WalletSession | null | undefined,
): PublicKey | null {
  if (!session) return null;
  return new PublicKey(session.account.publicKey);
}

function createAppWallet(
  connectionState: ReturnType<typeof useWalletConnection>,
  modalState: ReturnType<typeof useWalletModalState>,
): AppWallet {
  const session = connectionState.wallet ?? null;
  const publicKey = walletSessionPublicKey(session);
  const wallets = connectionState.connectors.map((connector) => ({
    id: connector.id,
    name: connector.name,
    icon: connector.icon,
    ready: walletReady(connector),
  }));
  const activeWallet = connectionState.currentConnector
    ? {
        id: connectionState.currentConnector.id,
        name: connectionState.currentConnector.name,
        icon: connectionState.currentConnector.icon,
        ready: walletReady(connectionState.currentConnector),
      }
    : null;

  const signTransaction = session?.signTransaction
    ? async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> =>
        (await session.signTransaction!(
          tx as unknown as Parameters<
            NonNullable<WalletSession["signTransaction"]>
          >[0],
        )) as unknown as T
    : undefined;

  const signAllTransactions = signTransaction
    ? async <T extends Array<Transaction | VersionedTransaction>>(
        txs: T,
      ): Promise<T> => {
        const signed: Array<Transaction | VersionedTransaction> = [];
        for (const tx of txs) {
          signed.push(await signTransaction(tx));
        }
        return signed as T;
      }
    : undefined;

  return {
    address: session?.account.address ?? null,
    connect: async () => {
      if (connectionState.connectorId) {
        await connectionState.connect(connectionState.connectorId);
        return;
      }
      modalState.open();
    },
    connected: connectionState.connected,
    connecting: connectionState.connecting,
    disconnect: async () => {
      await connectionState.disconnect();
    },
    publicKey,
    session,
    select: (connectorId) => modalState.select(connectorId),
    signAllTransactions,
    signTransaction,
    wallet: activeWallet,
    wallets,
  };
}

function WalletSelectionModal({
  state,
}: {
  state: ReturnType<typeof useWalletModalState>;
}) {
  if (!state.isOpen) return null;

  return (
    <div className="wallet-modal-overlay" onClick={state.close}>
      <div className="wallet-modal-container">
        <div
          className="wallet-modal-wrapper"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            aria-label="Close wallet selector"
            className="wallet-modal-button-close"
            onClick={state.close}
            type="button"
          >
            <span aria-hidden="true">x</span>
          </button>
          <h2 className="wallet-modal-title">Connect Solana Wallet</h2>
          <ul className="wallet-modal-list">
            {state.connectors.map((connector) => {
              const disabled = state.connecting;
              return (
                <li key={connector.id}>
                  <button
                    className="wallet-button"
                    disabled={disabled}
                    onClick={() =>
                      void state.connect(connector.id, {
                        allowInteractiveFallback: true,
                      })
                    }
                    type="button"
                  >
                    {connector.icon ? (
                      <span className="wallet-button-start-icon">
                        <img alt="" src={connector.icon} />
                      </span>
                    ) : null}
                    <span className="wallet-button-label">
                      {connector.name}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

export function AppWalletProvider({
  children,
  headlessAutoConnectorId,
}: {
  children: ReactNode;
  headlessAutoConnectorId: string | null;
}) {
  const connectionState = useWalletConnection();
  const modalState = useWalletModalState();

  useEffect(() => {
    if (!headlessAutoConnectorId) return;
    if (connectionState.connected || connectionState.connecting) return;
    const connector = connectionState.connectors.find(
      (entry) => entry.id === headlessAutoConnectorId,
    );
    if (!connector || !walletReady(connector)) return;
    void connectionState.connect(headlessAutoConnectorId, {
      allowInteractiveFallback: false,
      autoConnect: true,
    });
  }, [
    connectionState.connected,
    connectionState.connect,
    connectionState.connecting,
    connectionState.connectors,
    headlessAutoConnectorId,
  ]);

  const value = useMemo<AppWalletContextValue>(
    () => ({
      modal: {
        setVisible: (visible) => {
          if (visible) {
            modalState.open();
          } else {
            modalState.close();
          }
        },
        visible: modalState.isOpen,
      },
      wallet: createAppWallet(connectionState, modalState),
    }),
    [connectionState, modalState],
  );

  return (
    <AppWalletContext.Provider value={value}>
      {children}
      <WalletSelectionModal state={modalState} />
    </AppWalletContext.Provider>
  );
}

export function SpectatorAppWalletProvider({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <AppWalletContext.Provider value={SPECTATOR_CONTEXT}>
      {children}
    </AppWalletContext.Provider>
  );
}

export function useAppConnection(): AppWalletConnection {
  const rpcUrl = getRpcUrl();
  const wsUrl = getWsUrl() ?? rpcUrl.replace(/^http/i, "ws");
  return useMemo(
    () => ({ connection: getSharedConnection(rpcUrl, wsUrl) }),
    [rpcUrl, wsUrl],
  );
}

export function useAppWallet(): AppWallet {
  const context = useContext(AppWalletContext);
  if (!context) {
    throw new Error("useAppWallet must be used inside AppWalletProvider.");
  }
  return context.wallet;
}

export function useAppWalletModal(): AppWalletModalState {
  const context = useContext(AppWalletContext);
  if (!context) {
    throw new Error("useAppWalletModal must be used inside AppWalletProvider.");
  }
  return context.modal;
}

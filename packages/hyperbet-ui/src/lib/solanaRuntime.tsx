import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  createClient,
  defaultWalletConnectors,
  type WalletConnector,
  type WalletSession,
} from "@solana/client";
import { connectorKit } from "@solana/client/connectorkit";
import { type Address } from "@solana/kit";
import {
  useWalletConnection,
  useWalletModalState,
} from "@solana/react-hooks";
import {
  Connection,
  Keypair,
  PublicKey,
  type Transaction,
  type VersionedTransaction,
} from "@solana/web3.js";
import { Buffer } from "buffer";
import bs58 from "bs58";

export type SolanaCluster = "localnet" | "devnet" | "testnet" | "mainnet-beta";

type SolanaRuntimeEnv = {
  headlessWalletName: string;
  headlessWalletAutoConnect: boolean;
  headlessWalletSecretKey: string;
  headlessWalletsJson: string;
};

const DEFAULT_HEADLESS_WALLET_NAME = "Headless Test Wallet";
const HEADLESS_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Crect width='40' height='40' rx='8' fill='%230d58a6'/%3E%3Cpath d='M10 20h20M10 14h20M10 26h20' stroke='white' stroke-width='2'/%3E%3C/svg%3E";

type HeadlessWalletEntry = {
  name?: string;
  secretKey: string;
  autoConnect?: boolean;
};

export type HeadlessWalletDescriptor = {
  autoConnect: boolean;
  connector: WalletConnector;
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
  wallet: {
    id: string;
    name: string;
    icon?: string;
    ready: boolean;
  } | null;
  wallets: Array<{
    id: string;
    name: string;
    icon?: string;
    ready: boolean;
  }>;
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

type WalletConnectionState = ReturnType<typeof useWalletConnection>;
type WalletModalState = ReturnType<typeof useWalletModalState>;

const AppConnectionContext = createContext<AppWalletConnection | null>(null);
const AppWalletContext = createContext<AppWalletContextValue | null>(null);

const connectionCache = new Map<string, Connection>();

function readEnvString(name: string): string {
  const rawValue = import.meta.env[name];
  return typeof rawValue === "string" ? rawValue.trim() : "";
}

function readEnvBoolean(name: string, fallback: boolean): boolean {
  const rawValue = readEnvString(name);
  if (!rawValue) return fallback;
  if (rawValue === "true") return true;
  if (rawValue === "false") return false;
  return fallback;
}

function validateSecretKeyBytes(bytes: Uint8Array): Uint8Array {
  if (bytes.length !== 32 && bytes.length !== 64) {
    throw new Error(
      `Headless wallet secret key must be 32 or 64 bytes (received ${bytes.length})`,
    );
  }
  return bytes;
}

function parseSecretKey(secret: string): Uint8Array {
  const trimmed = secret.trim();
  if (!trimmed) {
    throw new Error("Headless wallet secret key is empty");
  }

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (
      !Array.isArray(parsed) ||
      !parsed.every(
        (value) => Number.isInteger(value) && value >= 0 && value <= 255,
      )
    ) {
      throw new Error("Invalid JSON byte array secret key");
    }
    return validateSecretKeyBytes(Uint8Array.from(parsed));
  }

  if (trimmed.includes(",")) {
    const values = trimmed.split(",").map((value) => Number(value.trim()));
    if (
      values.length === 0 ||
      !values.every(
        (value) => Number.isInteger(value) && value >= 0 && value <= 255,
      )
    ) {
      throw new Error("Invalid comma-separated byte secret key");
    }
    return validateSecretKeyBytes(Uint8Array.from(values));
  }

  try {
    const decoded = bs58.decode(trimmed);
    if (decoded.length === 32 || decoded.length === 64) {
      return validateSecretKeyBytes(decoded);
    }
  } catch {
    // Continue to other formats.
  }

  try {
    if (/^[A-Za-z0-9+/=\s]+$/.test(trimmed)) {
      const decoded = Uint8Array.from(Buffer.from(trimmed, "base64"));
      if (decoded.length === 32 || decoded.length === 64) {
        return validateSecretKeyBytes(decoded);
      }
    }
  } catch {
    // Continue to error.
  }

  throw new Error(
    "Unsupported secret key format (expected JSON array, comma-separated bytes, bs58, or base64)",
  );
}

function parseHeadlessWalletEntries(): HeadlessWalletEntry[] {
  const env: SolanaRuntimeEnv = {
    headlessWalletName:
      readEnvString("VITE_HEADLESS_WALLET_NAME") ||
      DEFAULT_HEADLESS_WALLET_NAME,
    headlessWalletAutoConnect: readEnvBoolean(
      "VITE_HEADLESS_WALLET_AUTO_CONNECT",
      false,
    ),
    headlessWalletSecretKey: readEnvString("VITE_HEADLESS_WALLET_SECRET_KEY"),
    headlessWalletsJson: readEnvString("VITE_HEADLESS_WALLETS"),
  };

  if (!env.headlessWalletsJson) {
    if (!env.headlessWalletSecretKey) return [];
    return [
      {
        name: env.headlessWalletName,
        secretKey: env.headlessWalletSecretKey,
        autoConnect: env.headlessWalletAutoConnect,
      },
    ];
  }

  try {
    const parsed = JSON.parse(env.headlessWalletsJson) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error("VITE_HEADLESS_WALLETS must be a JSON array");
    }

    return parsed
      .map((value, index) => {
        if (typeof value === "string") {
          return {
            name: `${DEFAULT_HEADLESS_WALLET_NAME} ${index + 1}`,
            secretKey: value,
            autoConnect: index === 0 && env.headlessWalletAutoConnect,
          };
        }

        if (value && typeof value === "object") {
          const candidate = value as Partial<HeadlessWalletEntry>;
          return {
            name:
              typeof candidate.name === "string" ? candidate.name : undefined,
            secretKey:
              typeof candidate.secretKey === "string"
                ? candidate.secretKey
                : "",
            autoConnect:
              typeof candidate.autoConnect === "boolean"
                ? candidate.autoConnect
                : false,
          };
        }

        return {
          name: undefined,
          secretKey: "",
          autoConnect: false,
        };
      })
      .filter((entry) => entry.secretKey.trim().length > 0);
  } catch (error) {
    console.error(
      "[headless-wallet] Failed to parse VITE_HEADLESS_WALLETS:",
      (error as Error).message,
    );
    return [];
  }
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

function resolveConnectorKitNetwork(cluster: SolanaCluster) {
  if (cluster === "mainnet-beta") return "mainnet-beta" as const;
  if (cluster === "devnet" || cluster === "testnet" || cluster === "localnet") {
    return cluster;
  }
  return "devnet" as const;
}

function dedupeConnectors(connectors: readonly WalletConnector[]) {
  const seen = new Set<string>();
  const unique: WalletConnector[] = [];
  for (const connector of connectors) {
    if (seen.has(connector.id)) continue;
    seen.add(connector.id);
    unique.push(connector);
  }
  return unique;
}

function createHeadlessSession(
  connectorId: string,
  connectorName: string,
  keypair: Keypair,
  onDisconnect: () => Promise<void>,
): WalletSession {
  const signTransaction: NonNullable<WalletSession["signTransaction"]> = async (
    transaction,
  ) => {
    const web3Transaction = transaction as unknown as
      | Transaction
      | VersionedTransaction;
    if ("version" in web3Transaction) {
      web3Transaction.sign([keypair]);
    } else {
      web3Transaction.partialSign(keypair);
    }
    return transaction;
  };

  return {
    account: {
      address: keypair.publicKey.toBase58() as Address,
      label: connectorName,
      publicKey: keypair.publicKey.toBytes(),
    },
    connector: {
      canAutoConnect: true,
      icon: HEADLESS_ICON,
      id: connectorId,
      kind: "headless",
      name: connectorName,
      ready: true,
    },
    disconnect: onDisconnect,
    signMessage: async (message: Uint8Array) =>
      ed25519.sign(message, keypair.secretKey.slice(0, 32)),
    signTransaction,
  };
}

function createHeadlessConnector(
  secretKey: Uint8Array,
  name: string,
  index: number,
): WalletConnector {
  const fixedKeypair =
    secretKey.length === 32
      ? Keypair.fromSeed(secretKey)
      : Keypair.fromSecretKey(secretKey);
  let activeSession: WalletSession | null = null;
  const id = `headless:${index}:${fixedKeypair.publicKey.toBase58()}`;

  const disconnect = async () => {
    activeSession = null;
  };

  return {
    canAutoConnect: true,
    connect: async () => {
      activeSession =
        activeSession ??
        createHeadlessSession(
          id,
          name,
          Keypair.fromSecretKey(fixedKeypair.secretKey),
          disconnect,
        );
      return activeSession;
    },
    disconnect,
    icon: HEADLESS_ICON,
    id,
    isSupported: () => true,
    kind: "headless",
    name,
    ready: true,
  };
}

export function createHeadlessWalletConnectorsFromEnv(): HeadlessWalletDescriptor[] {
  const entries = parseHeadlessWalletEntries();
  if (entries.length === 0) return [];

  return entries
    .map((entry, index) => {
      try {
        const secret = parseSecretKey(entry.secretKey);
        const name =
          entry.name?.trim() || `${DEFAULT_HEADLESS_WALLET_NAME} ${index + 1}`;
        return {
          autoConnect: Boolean(entry.autoConnect),
          connector: createHeadlessConnector(secret, name, index),
        };
      } catch (error) {
        console.warn(
          "[headless-wallet] skipping invalid wallet entry:",
          (error as Error).message,
        );
        return null;
      }
    })
    .filter(
      (entry): entry is HeadlessWalletDescriptor => entry !== null,
    );
}

export function isHeadlessWalletEnabled(): boolean {
  return createHeadlessWalletConnectorsFromEnv().length > 0;
}

export function shouldAutoConnectHeadlessWallet(): boolean {
  return createHeadlessWalletConnectorsFromEnv().some((entry) =>
    Boolean(entry.autoConnect),
  );
}

export function createFrameworkClient({
  getRpcUrl,
  getWsUrl,
  getCluster,
}: {
  getRpcUrl: () => string;
  getWsUrl: () => string | undefined;
  getCluster: () => SolanaCluster;
}) {
  const headlessConnectors = createHeadlessWalletConnectorsFromEnv().map(
    (entry) => entry.connector,
  );
  const detectedConnectors = defaultWalletConnectors();
  const interactiveConnectors = connectorKit({
    defaultConfig: {
      appName: "Hyperbet Solana",
      appUrl:
        typeof window !== "undefined"
          ? window.location.origin
          : "https://hyperbet.ai",
      autoConnect: true,
      enableMobile: true,
      network: resolveConnectorKitNetwork(getCluster()),
    },
  });

  return createClient({
    endpoint: getRpcUrl(),
    websocketEndpoint: getWsUrl(),
    walletConnectors: dedupeConnectors([
      ...headlessConnectors,
      ...detectedConnectors,
      ...interactiveConnectors,
    ]),
  });
}

export function AppWalletProvider({
  children,
  headlessAutoConnectorId,
  rpcUrl,
  wsUrl,
}: {
  children: ReactNode;
  headlessAutoConnectorId: string | null;
  rpcUrl: string;
  wsUrl?: string;
}) {
  const connection = useMemo(
    () => ({
      connection: getSharedConnection(
        rpcUrl,
        wsUrl ?? rpcUrl.replace(/^http/i, "ws"),
      ),
    }),
    [rpcUrl, wsUrl],
  );
  const connectionState: WalletConnectionState = useWalletConnection();
  const modalState: WalletModalState = useWalletModalState();

  useEffect(() => {
    if (!headlessAutoConnectorId) return;
    if (connectionState.connected || connectionState.connecting) return;
    const connector = connectionState.connectors.find(
      (entry: WalletConnectionState["connectors"][number]) =>
        entry.id === headlessAutoConnectorId,
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

  const wallet = useMemo<AppWallet>(() => {
    const signTransaction = connectionState.wallet?.signTransaction
      ? async <T extends Transaction | VersionedTransaction>(
          tx: T,
        ): Promise<T> =>
          (await connectionState.wallet!.signTransaction!(
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
      address: connectionState.wallet?.account.address ?? null,
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
      publicKey: walletSessionPublicKey(connectionState.wallet),
      session: connectionState.wallet ?? null,
      select: (connectorId) => modalState.select(connectorId),
      signAllTransactions,
      signTransaction,
      wallet: connectionState.currentConnector
        ? {
            id: connectionState.currentConnector.id,
            name: connectionState.currentConnector.name,
            icon: connectionState.currentConnector.icon,
            ready: walletReady(connectionState.currentConnector),
          }
        : null,
      wallets: connectionState.connectors.map(
        (connector: WalletConnectionState["connectors"][number]) => ({
          id: connector.id,
          name: connector.name,
          icon: connector.icon,
          ready: walletReady(connector),
        }),
      ),
    };
  }, [connectionState, modalState]);

  const modal = useMemo<AppWalletModalState>(
    () => ({
      setVisible: (visible) => {
        if (visible) {
          modalState.open();
        } else {
          modalState.close();
        }
      },
      visible: modalState.isOpen,
    }),
    [modalState],
  );

  return (
    <AppConnectionContext.Provider value={connection}>
      <AppWalletContext.Provider value={{ modal, wallet }}>
        {children}
        {modalState.isOpen ? (
          <div className="wallet-modal-overlay" onClick={modalState.close}>
            <div className="wallet-modal-container">
              <div
                className="wallet-modal-wrapper"
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  aria-label="Close wallet selector"
                  className="wallet-modal-button-close"
                  onClick={modalState.close}
                  type="button"
                >
                  <span aria-hidden="true">x</span>
                </button>
                <h2 className="wallet-modal-title">Connect Solana Wallet</h2>
                <ul className="wallet-modal-list">
                  {modalState.connectors.map(
                    (connector: WalletModalState["connectors"][number]) => {
                    const disabled = modalState.connecting;
                    return (
                      <li key={connector.id}>
                        <button
                          className="wallet-button"
                          disabled={disabled}
                          onClick={() =>
                            void modalState.connect(connector.id, {
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
                    },
                  )}
                </ul>
              </div>
            </div>
          </div>
        ) : null}
      </AppWalletContext.Provider>
    </AppConnectionContext.Provider>
  );
}

export function useAppConnection(): AppWalletConnection {
  const context = useContext(AppConnectionContext);
  if (!context) {
    throw new Error("useAppConnection must be used inside AppWalletProvider.");
  }
  return context;
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

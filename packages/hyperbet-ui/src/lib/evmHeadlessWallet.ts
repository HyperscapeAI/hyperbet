import { ed25519 } from "@noble/curves/ed25519.js";
import {
  BaseSignInMessageSignerWalletAdapter,
  WalletName,
  WalletNotConnectedError,
  WalletReadyState,
  isVersionedTransaction,
} from "@solana/wallet-adapter-base";
import type {
  SolanaSignInInput,
  SolanaSignInOutput,
} from "@solana/wallet-standard-features";
import { createSignInMessage } from "@solana/wallet-standard-util";
import type {
  Transaction,
  TransactionVersion,
  VersionedTransaction,
} from "@solana/web3.js";
import { Keypair } from "@solana/web3.js";

import { CONFIG } from "./config";

import bs58 from "bs58";

const DEFAULT_HEADLESS_WALLET_NAME = "Headless Test Wallet";
const HEADLESS_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Crect width='40' height='40' rx='8' fill='%230d58a6'/%3E%3Cpath d='M10 20h20M10 14h20M10 26h20' stroke='white' stroke-width='2'/%3E%3C/svg%3E";

function validateSecretKeyBytes(bytes: Uint8Array): Uint8Array {
  if (bytes.length !== 32 && bytes.length !== 64) {
    throw new Error(
      `Headless wallet secret key must be 32 or 64 bytes (received ${bytes.length})`,
    );
  }
  return bytes;
}

function keypairFromSecret(secretKey: Uint8Array): Keypair {
  return secretKey.length === 32
    ? Keypair.fromSeed(secretKey)
    : Keypair.fromSecretKey(secretKey);
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

type HeadlessWalletEntry = {
  name?: string;
  secretKey: string;
  autoConnect?: boolean;
};

export type HeadlessWalletDescriptor = {
  adapter: HeadlessKeypairWalletAdapter;
  autoConnect: boolean;
};

function parseHeadlessWalletEntries(): HeadlessWalletEntry[] {
  const fromJson = CONFIG.headlessWalletsJson.trim();
  if (!fromJson) {
    const legacySecret = CONFIG.headlessWalletSecretKey.trim();
    if (!legacySecret) return [];
    return [
      {
        name: getHeadlessWalletName(),
        secretKey: legacySecret,
        autoConnect: CONFIG.headlessWalletAutoConnect,
      },
    ];
  }

  try {
    const parsed = JSON.parse(fromJson) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error("VITE_HEADLESS_WALLETS must be a JSON array");
    }

    return parsed
      .map((value, index) => {
        if (typeof value === "string") {
          return {
            name: `${DEFAULT_HEADLESS_WALLET_NAME} ${index + 1}`,
            secretKey: value,
            autoConnect: index === 0 && CONFIG.headlessWalletAutoConnect,
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

export class HeadlessKeypairWalletAdapter extends BaseSignInMessageSignerWalletAdapter {
  name: WalletName<string>;
  url = "https://solana.com";
  icon = HEADLESS_ICON;
  supportedTransactionVersions: ReadonlySet<TransactionVersion> = new Set([
    "legacy",
    0,
  ]);

  private readonly fixedKeypair: Keypair;
  private activeKeypair: Keypair | null = null;

  constructor(secretKey: Uint8Array, name = DEFAULT_HEADLESS_WALLET_NAME) {
    super();
    this.fixedKeypair = keypairFromSecret(secretKey);
    this.name = name as WalletName<string>;
  }

  get connecting(): boolean {
    return false;
  }

  get publicKey() {
    return this.activeKeypair?.publicKey ?? null;
  }

  get readyState() {
    return WalletReadyState.Loadable;
  }

  async connect(): Promise<void> {
    this.activeKeypair = Keypair.fromSecretKey(this.fixedKeypair.secretKey);
    this.emit("connect", this.activeKeypair.publicKey);
  }

  async disconnect(): Promise<void> {
    this.activeKeypair = null;
    this.emit("disconnect");
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(
    transaction: T,
  ): Promise<T> {
    if (!this.activeKeypair) throw new WalletNotConnectedError();

    if (isVersionedTransaction(transaction)) {
      transaction.sign([this.activeKeypair]);
    } else {
      transaction.partialSign(this.activeKeypair);
    }

    return transaction;
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    if (!this.activeKeypair) throw new WalletNotConnectedError();
    return ed25519.sign(message, this.activeKeypair.secretKey.slice(0, 32));
  }

  async signIn(input: SolanaSignInInput = {}): Promise<SolanaSignInOutput> {
    const keypair = (this.activeKeypair ||= Keypair.fromSecretKey(
      this.fixedKeypair.secretKey,
    ));

    const domain = input.domain || window.location.host;
    const address = input.address || keypair.publicKey.toBase58();
    const signedMessage = createSignInMessage({
      ...input,
      domain,
      address,
    });
    const signature = ed25519.sign(
      signedMessage,
      keypair.secretKey.slice(0, 32),
    );

    this.emit("connect", keypair.publicKey);

    return {
      account: {
        address,
        publicKey: keypair.publicKey.toBytes(),
        chains: [],
        features: [],
      },
      signedMessage,
      signature,
    };
  }
}

function getHeadlessWalletName(): string {
  return CONFIG.headlessWalletName || DEFAULT_HEADLESS_WALLET_NAME;
}

export function isHeadlessWalletEnabled(): boolean {
  return parseHeadlessWalletEntries().length > 0;
}

export function shouldAutoConnectHeadlessWallet(): boolean {
  return parseHeadlessWalletEntries().some((entry) =>
    Boolean(entry.autoConnect),
  );
}

export function createHeadlessWalletsFromEnv(): HeadlessWalletDescriptor[] {
  const entries = parseHeadlessWalletEntries();
  if (entries.length === 0) return [];

  return entries
    .map((entry, index) => {
      try {
        const secret = parseSecretKey(entry.secretKey);
        const name =
          entry.name?.trim() || `${DEFAULT_HEADLESS_WALLET_NAME} ${index + 1}`;
        return {
          adapter: new HeadlessKeypairWalletAdapter(secret, name),
          autoConnect: Boolean(entry.autoConnect),
        } as HeadlessWalletDescriptor;
      } catch (error) {
        console.error(
          `[headless-wallet] Failed to load wallet #${index + 1}:`,
          (error as Error).message,
        );
        return null;
      }
    })
    .filter((entry): entry is HeadlessWalletDescriptor => entry !== null);
}

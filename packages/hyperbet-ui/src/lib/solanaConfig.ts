export type SolanaCluster = "localnet" | "devnet" | "testnet" | "mainnet-beta";

const DEFAULT_LOCAL_GAME_API_URL = "http://127.0.0.1:5555";
// Production uses the current origin unless an explicit keeper URL is supplied.
// This avoids silently routing money-related traffic to a stale deployment.
const DEFAULT_PRODUCTION_GAME_API_URL = "";

function readEnv(name: string): string | undefined {
  const value = import.meta.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNonNegativeNumber(name: string, fallback: number): number {
  const raw = readEnv(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function resolveSolanaCluster(): SolanaCluster {
  const raw = (
    readEnv("VITE_SOLANA_CLUSTER") ??
    readEnv("MODE") ??
    "devnet"
  ).toLowerCase();
  if (raw === "local" || raw === "localnet" || raw === "e2e") {
    return "localnet";
  }
  if (raw === "testnet") return "testnet";
  if (raw === "mainnet" || raw === "mainnet-beta" || raw === "production") {
    return "mainnet-beta";
  }
  return "devnet";
}

export const SOLANA_CLUSTER = resolveSolanaCluster();
export const GAME_API_URL =
  readEnv("VITE_GAME_API_URL") ??
  (SOLANA_CLUSTER === "mainnet-beta"
    ? DEFAULT_PRODUCTION_GAME_API_URL
    : DEFAULT_LOCAL_GAME_API_URL);
export const UI_SYNC_DELAY_MS = readNonNegativeNumber(
  "VITE_UI_SYNC_DELAY_MS",
  0,
);

export function buildArenaWriteHeaders(): Record<string, string> {
  return { "Content-Type": "application/json" };
}

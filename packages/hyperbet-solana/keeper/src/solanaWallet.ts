import { PublicKey } from "@solana/web3.js";

export function normalizeSolanaWalletKey(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    return new PublicKey(trimmed).toBase58();
  } catch {
    return trimmed;
  }
}

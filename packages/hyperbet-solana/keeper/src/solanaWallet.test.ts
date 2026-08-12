import { describe, expect, test } from "bun:test";
import { PublicKey } from "@solana/web3.js";
import { normalizeSolanaWalletKey } from "./solanaWallet";

describe("Solana wallet identity", () => {
  test("preserves canonical case-sensitive base58 addresses", () => {
    const wallet = "DScqtGwFoDTme2Rzdjpdb2w7CtuKc6Z8KF7hMhbx8ugQ";
    expect(normalizeSolanaWalletKey(`  ${wallet}  `)).toBe(wallet);
    expect(normalizeSolanaWalletKey(wallet)).not.toBe(wallet.toLowerCase());
  });

  test("does not collapse differently cased valid base58 keys", () => {
    const lowerInitial = "yTMK1ojMtxErmr6T8GeRQqhy7h4ZPHxDedddkVcmFhj";
    const upperInitial = "YTMK1ojMtxErmr6T8GeRQqhy7h4ZPHxDedddkVcmFhj";
    expect(() => new PublicKey(lowerInitial)).not.toThrow();
    expect(() => new PublicKey(upperInitial)).not.toThrow();
    expect(normalizeSolanaWalletKey(lowerInitial)).not.toBe(
      normalizeSolanaWalletKey(upperInitial),
    );
  });
});

import type { AppWallet } from "./appWallet";

export type TransactionWallet = Pick<
  AppWallet,
  "publicKey" | "signTransaction" | "signAllTransactions"
>;

/**
 * Remove every signing capability from spectator-only browser sessions.
 * Market data remains readable, but transaction components receive neither a
 * public key nor either signing function even if wallet persistence reconnects
 * a previously selected wallet in the background.
 */
export function resolveTransactionWallet(
  wallet: AppWallet,
  transactionsEnabled: boolean,
): TransactionWallet {
  if (transactionsEnabled) return wallet;
  return {
    publicKey: null,
    signTransaction: undefined,
    signAllTransactions: undefined,
  };
}

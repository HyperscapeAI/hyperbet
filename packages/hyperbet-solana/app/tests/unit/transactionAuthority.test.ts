import { describe, expect, mock, test } from "bun:test";

import type { AppWallet } from "../../src/lib/appWallet";
import { resolveTransactionWallet } from "../../src/lib/transactionAuthority";

describe("spectator transaction authority", () => {
  const wallet = {
    publicKey: { toBase58: () => "connected-wallet" },
    signTransaction: mock(),
    signAllTransactions: mock(),
  } as unknown as AppWallet;

  test("preserves the wallet only when transactions are explicitly enabled", () => {
    expect(resolveTransactionWallet(wallet, true)).toBe(wallet);
  });

  test("strips identity and every signing function in read-only mode", () => {
    expect(resolveTransactionWallet(wallet, false)).toEqual({
      publicKey: null,
      signTransaction: undefined,
      signAllTransactions: undefined,
    });
  });
});

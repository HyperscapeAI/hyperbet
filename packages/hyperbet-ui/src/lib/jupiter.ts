import { CONFIG } from "./config";
import { WalletContextState } from "@solana/wallet-adapter-react";
import { Connection, VersionedTransaction } from "@solana/web3.js";

import { confirmSignatureViaRpc, sendRawTransactionViaRpc } from "./solanaRpc";

const DEFAULT_JUPITER_BASE_URL = CONFIG.jupiterBaseUrl;

type QuoteResponse = {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  slippageBps: number;
  routePlan: unknown[];
};

export async function getJupiterQuote(params: {
  inputMint: string;
  outputMint: string;
  amount: bigint;
  slippageBps?: number;
}): Promise<QuoteResponse> {
  const url = new URL(`${DEFAULT_JUPITER_BASE_URL}/swap/v1/quote`);
  url.searchParams.set("inputMint", params.inputMint);
  url.searchParams.set("outputMint", params.outputMint);
  url.searchParams.set("amount", params.amount.toString());
  url.searchParams.set("slippageBps", String(params.slippageBps ?? 100));
  url.searchParams.set("restrictIntermediateTokens", "true");

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Jupiter quote failed: ${res.status} ${res.statusText}`);
  }

  return (await res.json()) as QuoteResponse;
}

export async function swapToGoldViaJupiter(params: {
  connection: Connection;
  wallet: WalletContextState;
  quote: QuoteResponse;
}): Promise<string> {
  const { connection, wallet, quote } = params;

  if (!wallet.publicKey || !wallet.signTransaction) {
    throw new Error("Wallet must be connected to swap");
  }

  const res = await fetch(`${DEFAULT_JUPITER_BASE_URL}/swap/v1/swap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: wallet.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: "auto",
    }),
  });

  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`Jupiter swap build failed: ${msg}`);
  }

  const json = (await res.json()) as { swapTransaction: string };

  const tx = VersionedTransaction.deserialize(
    Buffer.from(json.swapTransaction, "base64"),
  );

  const signed = await wallet.signTransaction(tx);
  const signature = await sendRawTransactionViaRpc(connection, signed);
  await confirmSignatureViaRpc(connection, signature);
  return signature;
}

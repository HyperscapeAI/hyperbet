import type { BettingChainKey } from "@hyperbet/chain-registry";

import { GAME_API_URL, buildArenaWriteHeaders } from "./config";
import { getStoredInviteCode } from "./invite";

export interface RecordPredictionMarketTradeInput {
  chainKey: BettingChainKey;
  bettorWallet: string;
  sourceAsset: string;
  sourceAmount: number;
  goldAmount?: number;
  feeBps: number;
  txSignature: string;
  marketRef?: string | null;
  duelKey?: string | null;
  duelId?: string | null;
}

function sanitizeNumber(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

export async function recordPredictionMarketTrade(
  input: RecordPredictionMarketTradeInput,
): Promise<boolean> {
  if (!GAME_API_URL || !input.bettorWallet.trim() || !input.txSignature.trim()) {
    return false;
  }

  const inviteCode = getStoredInviteCode();
  const payload = {
    chainKey: input.chainKey,
    chain: input.chainKey.toUpperCase(),
    bettorWallet: input.bettorWallet.trim(),
    sourceAsset: input.sourceAsset.trim() || "GOLD",
    sourceAmount: sanitizeNumber(input.sourceAmount),
    goldAmount: sanitizeNumber(input.goldAmount ?? input.sourceAmount),
    feeBps: sanitizeNumber(input.feeBps),
    txSignature: input.txSignature.trim(),
    marketPda: input.marketRef?.trim() || null,
    marketRef: input.marketRef?.trim() || null,
    duelKey: input.duelKey?.trim() || null,
    duelId: input.duelId?.trim() || null,
    inviteCode,
    externalBetRef: `${input.chainKey}:${input.txSignature.trim()}`,
  };

  try {
    const response = await fetch(
      `${GAME_API_URL.replace(/\/$/, "")}/api/arena/bet/record-external`,
      {
        method: "POST",
        headers: buildArenaWriteHeaders(),
        body: JSON.stringify(payload),
      },
    );
    return response.ok;
  } catch (error) {
    console.warn("[prediction-market-tracking] failed to record trade", error);
    return false;
  }
}

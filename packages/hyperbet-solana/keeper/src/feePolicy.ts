export const MAX_LAUNCH_TRADE_FEE_BPS = 500;
export const MAX_LAUNCH_WINNINGS_FEE_BPS = 500;

export type LaunchFeePolicy = {
  tradeTreasuryFeeBps: number;
  tradeMarketMakerFeeBps: number;
  winningsMarketMakerFeeBps: number;
};

export type ApprovedLaunchFeePolicyInput = {
  approval: string | undefined;
  tradeTreasuryFeeBps: string | undefined;
  tradeMarketMakerFeeBps: string | undefined;
  winningsMarketMakerFeeBps: string | undefined;
};

function parseBasisPoints(
  name: string,
  value: string | number | undefined,
  fallback: number,
): number {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

export function resolveLaunchFeePolicy(input: {
  tradeTreasuryFeeBps?: string | number;
  tradeMarketMakerFeeBps?: string | number;
  winningsMarketMakerFeeBps?: string | number;
}): LaunchFeePolicy {
  const policy = {
    tradeTreasuryFeeBps: parseBasisPoints(
      "TRADE_TREASURY_FEE_BPS",
      input.tradeTreasuryFeeBps,
      100,
    ),
    tradeMarketMakerFeeBps: parseBasisPoints(
      "TRADE_MARKET_MAKER_FEE_BPS",
      input.tradeMarketMakerFeeBps,
      100,
    ),
    winningsMarketMakerFeeBps: parseBasisPoints(
      "WINNINGS_MARKET_MAKER_FEE_BPS",
      input.winningsMarketMakerFeeBps,
      200,
    ),
  };

  if (policy.tradeTreasuryFeeBps <= 0) {
    throw new Error(
      "TRADE_TREASURY_FEE_BPS must be greater than zero for the launch fee policy",
    );
  }

  const totalTradeFeeBps =
    policy.tradeTreasuryFeeBps + policy.tradeMarketMakerFeeBps;
  if (totalTradeFeeBps > MAX_LAUNCH_TRADE_FEE_BPS) {
    throw new Error(
      `Combined trade fees must not exceed ${MAX_LAUNCH_TRADE_FEE_BPS} bps`,
    );
  }
  if (policy.winningsMarketMakerFeeBps > MAX_LAUNCH_WINNINGS_FEE_BPS) {
    throw new Error(
      `Winnings fees must not exceed ${MAX_LAUNCH_WINNINGS_FEE_BPS} bps`,
    );
  }

  return policy;
}

export function resolveApprovedLaunchFeePolicy(
  input: ApprovedLaunchFeePolicyInput,
): LaunchFeePolicy {
  if (input.approval?.trim() !== "true") {
    throw new Error(
      "SOLANA_LAUNCH_FEE_POLICY_APPROVED must be exactly 'true' on mainnet",
    );
  }
  for (const [name, value] of [
    ["TRADE_TREASURY_FEE_BPS", input.tradeTreasuryFeeBps],
    ["TRADE_MARKET_MAKER_FEE_BPS", input.tradeMarketMakerFeeBps],
    ["WINNINGS_MARKET_MAKER_FEE_BPS", input.winningsMarketMakerFeeBps],
  ] as const) {
    if (!value?.trim()) {
      throw new Error(`${name} must be explicitly configured on mainnet`);
    }
  }
  return resolveLaunchFeePolicy(input);
}

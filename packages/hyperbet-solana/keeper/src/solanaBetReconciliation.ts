import { pointsForLamports } from "./nativeAmount";
import { quoteCostLamports } from "./solanaBetAccounting";
import {
  normalizeLifecycleFact,
  type SolanaLifecycleFact,
} from "./solanaLifecycleIndexer";

export type IndexedLifecycleFact = {
  signature: string;
  factIndex: number;
  fact: SolanaLifecycleFact;
};

export type BetExecutionBaseline = {
  betId: string;
  txSignature: string;
  marketPda: string;
  wallet: string;
  orderId: string;
  side: 1 | 2;
  limitPrice: number;
  orderAmountUnits: string;
  initialMatchedAmountUnits: string;
  initialRestingAmountUnits: string;
  initialReleasedAmountUnits: string;
  initialCollateralLamports: string;
  initialExecutedCostLamports: string;
  initialTradeFeeLamports: string;
  initialRewardEligibleLamports: string;
};

export type ReconciledBetExecution = {
  betId: string;
  matchedAmountUnits: string;
  restingAmountUnits: string;
  releasedAmountUnits: string;
  executedCostLamports: string;
  tradeFeeLamports: string;
  refundLamports: string;
  rewardEligibleLamports: string;
  rewardPointsTotal: number;
  initialRewardPoints: number;
};

function unsigned(value: string, label: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${label} must be an unsigned integer`);
  }
  return BigInt(value);
}

function sumFactValue(
  facts: IndexedLifecycleFact[],
  field:
    | "amountUnits"
    | "releasedAmountUnits"
    | "amountLamports"
    | "feeLamports"
    | "refundLamports",
): bigint {
  return facts.reduce((sum, envelope) => {
    const value = envelope.fact[field];
    if (value === undefined) {
      throw new Error(`${envelope.fact.kind} fact is missing ${field}`);
    }
    return sum + unsigned(value, `${envelope.fact.kind} ${field}`);
  }, 0n);
}

export function reconcileBetExecutionFromIndexedFacts(input: {
  baseline: BetExecutionBaseline;
  facts: IndexedLifecycleFact[];
}): ReconciledBetExecution {
  const baseline = input.baseline;
  const orderAmount = unsigned(baseline.orderAmountUnits, "order amount");
  const initialMatched = unsigned(
    baseline.initialMatchedAmountUnits,
    "initial matched amount",
  );
  const initialResting = unsigned(
    baseline.initialRestingAmountUnits,
    "initial resting amount",
  );
  const initialReleased = unsigned(
    baseline.initialReleasedAmountUnits,
    "initial released amount",
  );
  const initialCollateral = unsigned(
    baseline.initialCollateralLamports,
    "initial collateral",
  );
  const initialExecuted = unsigned(
    baseline.initialExecutedCostLamports,
    "initial executed cost",
  );
  const initialTradeFee = unsigned(
    baseline.initialTradeFeeLamports,
    "initial trade fee",
  );
  const initialRewardEligible = unsigned(
    baseline.initialRewardEligibleLamports,
    "initial reward eligibility",
  );
  if (
    orderAmount <= 0n ||
    orderAmount % 1_000n !== 0n ||
    initialMatched + initialResting + initialReleased !== orderAmount ||
    initialRewardEligible !== initialExecuted + initialTradeFee
  ) {
    throw new Error("initial bet execution accounting invariant failed");
  }
  const signedLimitCost = quoteCostLamports(
    baseline.side,
    baseline.limitPrice,
    orderAmount,
  );
  if (signedLimitCost === null || initialCollateral > signedLimitCost) {
    throw new Error("initial collateral exceeds the signed limit cost");
  }
  const initialRefund = signedLimitCost - initialCollateral;

  const normalized = input.facts.map(
    (envelope): IndexedLifecycleFact => ({
      ...envelope,
      fact: normalizeLifecycleFact(envelope.fact),
    }),
  );
  const placements = normalized.filter(
    ({ fact }) =>
      fact.kind === "ORDER_PLACED" &&
      fact.marketPda === baseline.marketPda &&
      fact.orderId === baseline.orderId,
  );
  if (
    placements.length !== 1 ||
    placements[0]?.signature !== baseline.txSignature ||
    placements[0]?.fact.wallet !== baseline.wallet ||
    placements[0]?.fact.side !== baseline.side ||
    placements[0]?.fact.price !== baseline.limitPrice ||
    placements[0]?.fact.amountUnits !== orderAmount.toString()
  ) {
    throw new Error("indexed order placement contradicts the recorded bet");
  }

  const takerExecutions = normalized.filter(
    ({ fact }) =>
      fact.kind === "TAKER_EXECUTION" &&
      fact.marketPda === baseline.marketPda &&
      fact.orderId === baseline.orderId,
  );
  for (const { fact } of takerExecutions) {
    if (
      fact.wallet !== baseline.wallet ||
      fact.side !== baseline.side ||
      fact.price !== baseline.limitPrice
    ) {
      throw new Error("indexed taker execution contradicts the recorded bet");
    }
  }
  const initialTakerExecutions = takerExecutions.filter(
    ({ signature }) => signature === baseline.txSignature,
  );
  if (initialTakerExecutions.length > 1) {
    throw new Error("recorded bet transaction has ambiguous taker execution");
  }
  const initialTaker = initialTakerExecutions[0];
  if (initialTaker) {
    if (
      initialTaker.fact.amountUnits !== initialMatched.toString() ||
      initialTaker.fact.releasedAmountUnits !== initialReleased.toString() ||
      initialTaker.fact.amountLamports !== initialExecuted.toString() ||
      initialTaker.fact.feeLamports !== initialTradeFee.toString() ||
      initialTaker.fact.refundLamports !== initialRefund.toString()
    ) {
      throw new Error(
        "indexed initial execution contradicts immutable place-order accounting",
      );
    }
  } else if (
    initialMatched !== 0n ||
    initialReleased !== 0n ||
    initialExecuted !== 0n ||
    initialTradeFee !== 0n ||
    initialRefund !== 0n
  ) {
    throw new Error("indexed initial execution evidence is missing");
  }

  const makerMatches = normalized.filter(
    ({ fact }) =>
      fact.kind === "ORDER_MATCHED" &&
      fact.marketPda === baseline.marketPda &&
      fact.makerOrderId === baseline.orderId,
  );
  let makerExecutedCost = 0n;
  for (const { fact } of makerMatches) {
    const amount = unsigned(fact.amountUnits!, "maker matched amount");
    const cost = quoteCostLamports(baseline.side, fact.price!, amount);
    if (cost === null) {
      throw new Error("indexed maker fill cannot be priced exactly");
    }
    makerExecutedCost += cost;
  }

  const releases = normalized.filter(
    ({ fact }) =>
      (fact.kind === "ORDER_CANCELLED" ||
        fact.kind === "RESTING_ORDER_RECLAIMED") &&
      fact.marketPda === baseline.marketPda &&
      fact.orderId === baseline.orderId,
  );
  const matchedAmount =
    sumFactValue(takerExecutions, "amountUnits") +
    sumFactValue(makerMatches, "amountUnits");
  const releasedAmount =
    sumFactValue(takerExecutions, "releasedAmountUnits") +
    sumFactValue(releases, "amountUnits");
  if (
    matchedAmount + releasedAmount > orderAmount ||
    matchedAmount < initialMatched ||
    releasedAmount < initialReleased
  ) {
    throw new Error("indexed order units violate conservation");
  }
  const restingAmount = orderAmount - matchedAmount - releasedAmount;
  const executedCost =
    sumFactValue(takerExecutions, "amountLamports") + makerExecutedCost;
  const tradeFee = sumFactValue(takerExecutions, "feeLamports");
  const refund =
    sumFactValue(takerExecutions, "refundLamports") +
    sumFactValue(releases, "amountLamports");
  const rewardEligible = executedCost + tradeFee;
  if (
    executedCost < initialExecuted ||
    tradeFee < initialTradeFee ||
    refund < initialRefund ||
    rewardEligible < initialRewardEligible
  ) {
    throw new Error("indexed execution totals regress immutable accounting");
  }

  return {
    betId: baseline.betId,
    matchedAmountUnits: matchedAmount.toString(),
    restingAmountUnits: restingAmount.toString(),
    releasedAmountUnits: releasedAmount.toString(),
    executedCostLamports: executedCost.toString(),
    tradeFeeLamports: tradeFee.toString(),
    refundLamports: refund.toString(),
    rewardEligibleLamports: rewardEligible.toString(),
    rewardPointsTotal: pointsForLamports(rewardEligible.toString()),
    initialRewardPoints: pointsForLamports(initialRewardEligible.toString()),
  };
}

const PRICE_SCALE = 1_000n;

export type SolanaManagedOrderAction = "CANCEL" | "RECLAIM" | "CLOSE_FILLED";

export type SolanaManagedOrderSnapshot = {
  marketState: string;
  id: bigint;
  side: 1 | 2;
  price: number;
  maker: string;
  amount: bigint;
  filled: bigint;
  previousOrderId: bigint;
  nextOrderId: bigint;
  active: boolean;
  continuationPending: boolean;
};

export type SolanaManagedOrderPlan = {
  action: SolanaManagedOrderAction;
  marketState: string;
  orderId: bigint;
  side: 1 | 2;
  outcomeSide: "YES" | "NO";
  outcomePriceMillis: number;
  programPriceMillis: number;
  originalUnits: bigint;
  filledUnits: bigint;
  remainingUnits: bigint;
  refundableCollateralLamports: bigint;
  returnedOrderAccountRentLamports: bigint;
  grossWalletCreditLamports: bigint;
  previousOrderId: bigint;
  nextOrderId: bigint;
  adjacentOrderIds: bigint[];
  continuationPending: boolean;
};

export type SolanaManagedPriceLevelSnapshot = {
  marketState: string;
  side: 1 | 2;
  price: number;
  headOrderId: bigint;
  tailOrderId: bigint;
  totalOpen: bigint;
};

function canonicalAddress(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized !== value) {
    throw new Error(`${label} must be a canonical non-empty address`);
  }
  return normalized;
}

export function buildSolanaManagedOrderPlan(input: {
  marketStatus: string;
  marketState: string;
  wallet: string;
  order: SolanaManagedOrderSnapshot;
  orderAccountLamports: bigint;
}): SolanaManagedOrderPlan {
  const marketState = canonicalAddress(input.marketState, "Market");
  const wallet = canonicalAddress(input.wallet, "Wallet");
  const orderMarket = canonicalAddress(input.order.marketState, "Order market");
  const maker = canonicalAddress(input.order.maker, "Order maker");
  if (orderMarket !== marketState) {
    throw new Error("Order does not belong to the active market");
  }
  if (maker !== wallet) {
    throw new Error("Only the order maker can manage this order");
  }
  if (input.order.id < 0n) {
    throw new Error("Order ID cannot be negative");
  }
  if (input.orderAccountLamports <= 0n) {
    throw new Error("Order account rent must be a positive lamport amount");
  }
  if (input.order.side !== 1 && input.order.side !== 2) {
    throw new Error("Order side must be 1 or 2");
  }
  if (
    !Number.isInteger(input.order.price) ||
    input.order.price <= 0 ||
    input.order.price >= 1_000
  ) {
    throw new Error("Order price must be an integer from 1 to 999");
  }
  if (
    input.order.amount <= 0n ||
    input.order.filled < 0n ||
    input.order.filled > input.order.amount
  ) {
    throw new Error("Order contains an invalid filled amount");
  }
  if (input.order.previousOrderId < 0n || input.order.nextOrderId < 0n) {
    throw new Error("Linked order IDs cannot be negative");
  }
  if (
    input.order.previousOrderId === input.order.id ||
    input.order.nextOrderId === input.order.id ||
    (input.order.previousOrderId !== 0n &&
      input.order.previousOrderId === input.order.nextOrderId)
  ) {
    throw new Error("Order contains an invalid linked-list reference");
  }
  if (
    input.order.continuationPending &&
    (input.order.previousOrderId !== 0n || input.order.nextOrderId !== 0n)
  ) {
    throw new Error("Continuation-pending order cannot have book neighbors");
  }

  const commonPlan = {
    marketState,
    orderId: input.order.id,
    side: input.order.side,
    outcomeSide: input.order.side === 1 ? ("YES" as const) : ("NO" as const),
    outcomePriceMillis:
      input.order.side === 1 ? input.order.price : 1_000 - input.order.price,
    programPriceMillis: input.order.price,
    originalUnits: input.order.amount,
    filledUnits: input.order.filled,
    returnedOrderAccountRentLamports: input.orderAccountLamports,
  };

  if (!input.order.active) {
    if (input.order.filled !== input.order.amount) {
      throw new Error("Inactive order is not fully filled");
    }
    if (
      input.order.previousOrderId !== 0n ||
      input.order.nextOrderId !== 0n ||
      input.order.continuationPending
    ) {
      throw new Error("Filled order is still linked to active book state");
    }
    return {
      action: "CLOSE_FILLED",
      ...commonPlan,
      remainingUnits: 0n,
      refundableCollateralLamports: 0n,
      grossWalletCreditLamports: input.orderAccountLamports,
      previousOrderId: 0n,
      nextOrderId: 0n,
      adjacentOrderIds: [],
      continuationPending: false,
    };
  }
  if (input.order.filled >= input.order.amount) {
    throw new Error("Active order has no remaining amount to manage");
  }

  const normalizedStatus = input.marketStatus.trim().toLowerCase();
  const action =
    normalizedStatus === "open"
      ? "CANCEL"
      : ["locked", "resolved", "cancelled"].includes(normalizedStatus)
        ? "RECLAIM"
        : null;
  if (!action) {
    throw new Error("Market status is not safe for order management");
  }

  const remainingUnits = input.order.amount - input.order.filled;
  const priceComponent =
    input.order.side === 1
      ? BigInt(input.order.price)
      : PRICE_SCALE - BigInt(input.order.price);
  const collateralNumerator = remainingUnits * priceComponent;
  if (collateralNumerator % PRICE_SCALE !== 0n) {
    throw new Error("Remaining order violates the program precision rule");
  }
  const refundableCollateralLamports = collateralNumerator / PRICE_SCALE;
  if (refundableCollateralLamports <= 0n) {
    throw new Error("Remaining collateral is below one lamport");
  }
  const grossWalletCreditLamports =
    refundableCollateralLamports + input.orderAccountLamports;

  const adjacentOrderIds = input.order.continuationPending
    ? []
    : [input.order.previousOrderId, input.order.nextOrderId].filter(
        (orderId) => orderId !== 0n,
      );

  return {
    action,
    ...commonPlan,
    remainingUnits,
    refundableCollateralLamports,
    returnedOrderAccountRentLamports: input.orderAccountLamports,
    grossWalletCreditLamports,
    previousOrderId: input.order.previousOrderId,
    nextOrderId: input.order.nextOrderId,
    adjacentOrderIds,
    continuationPending: input.order.continuationPending,
  };
}

export function sameSolanaManagedOrderQuote(
  left: SolanaManagedOrderPlan,
  right: SolanaManagedOrderPlan,
): boolean {
  return (
    left.action === right.action &&
    left.marketState === right.marketState &&
    left.orderId === right.orderId &&
    left.side === right.side &&
    left.programPriceMillis === right.programPriceMillis &&
    left.filledUnits === right.filledUnits &&
    left.remainingUnits === right.remainingUnits &&
    left.refundableCollateralLamports === right.refundableCollateralLamports &&
    left.returnedOrderAccountRentLamports ===
      right.returnedOrderAccountRentLamports &&
    left.grossWalletCreditLamports === right.grossWalletCreditLamports &&
    left.previousOrderId === right.previousOrderId &&
    left.nextOrderId === right.nextOrderId &&
    left.continuationPending === right.continuationPending &&
    left.adjacentOrderIds.length === right.adjacentOrderIds.length &&
    left.adjacentOrderIds.every(
      (orderId, index) => orderId === right.adjacentOrderIds[index],
    )
  );
}

export function assertSolanaManagedOrderBookLinks(input: {
  plan: SolanaManagedOrderPlan;
  priceLevel: SolanaManagedPriceLevelSnapshot;
  adjacentOrders: readonly SolanaManagedOrderSnapshot[];
}): void {
  const { plan, priceLevel, adjacentOrders } = input;
  if (plan.action === "CLOSE_FILLED") {
    throw new Error("Filled-order cleanup does not use price-level accounts");
  }
  if (
    priceLevel.marketState !== plan.marketState ||
    priceLevel.side !== plan.side ||
    priceLevel.price !== plan.programPriceMillis
  ) {
    throw new Error("Price level no longer matches the selected order");
  }
  if (
    priceLevel.headOrderId < 0n ||
    priceLevel.tailOrderId < 0n ||
    priceLevel.totalOpen < 0n
  ) {
    throw new Error("Price level contains an invalid negative value");
  }
  if (plan.continuationPending) {
    if (adjacentOrders.length !== 0) {
      throw new Error(
        "Continuation-pending order cannot include book neighbors",
      );
    }
    return;
  }
  if (priceLevel.totalOpen < plan.remainingUnits) {
    throw new Error("Price level no longer contains the selected order amount");
  }
  if (adjacentOrders.length !== plan.adjacentOrderIds.length) {
    throw new Error("Linked order account count changed");
  }

  if (plan.previousOrderId === 0n && priceLevel.headOrderId !== plan.orderId) {
    throw new Error("Price-level head no longer references the selected order");
  }
  if (plan.nextOrderId === 0n && priceLevel.tailOrderId !== plan.orderId) {
    throw new Error("Price-level tail no longer references the selected order");
  }

  adjacentOrders.forEach((order, index) => {
    const expectedOrderId = plan.adjacentOrderIds[index];
    if (
      order.marketState !== plan.marketState ||
      order.id !== expectedOrderId ||
      order.side !== plan.side ||
      order.price !== plan.programPriceMillis ||
      !order.active ||
      order.continuationPending
    ) {
      throw new Error(
        "A linked order account no longer matches the active book",
      );
    }
  });

  if (plan.previousOrderId !== 0n) {
    const previousOrder = adjacentOrders[0];
    if (!previousOrder || previousOrder.nextOrderId !== plan.orderId) {
      throw new Error("Previous order no longer links to the selected order");
    }
  }
  if (plan.nextOrderId !== 0n) {
    const nextOrder = adjacentOrders[plan.previousOrderId === 0n ? 0 : 1];
    if (!nextOrder || nextOrder.previousOrderId !== plan.orderId) {
      throw new Error("Next order no longer links to the selected order");
    }
  }
}

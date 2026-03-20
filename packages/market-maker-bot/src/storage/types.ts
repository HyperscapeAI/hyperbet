export type ManagedOrderStatus =
  | "OPEN"
  | "CANCELLED"
  | "FILLED"
  | "QUARANTINED"
  | "ORPHANED";

export type OrderRecord = {
  orderKey: string;
  chainKey: string;
  duelKey: string;
  marketKey: string;
  side: number;
  orderId: number;
  price: number;
  amount: number;
  placedAt: number;
  status: ManagedOrderStatus;
  nonce: number | null;
  txSignature: string | null;
  lastSeenOnChainAt: number | null;
  lastReconciledAt: number | null;
  quarantineReason: string | null;
  metadata: Record<string, unknown>;
};

export type OrderEventRecord = {
  id: number;
  orderKey: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: number;
};

export type ReconciliationCursor = {
  cursorKey: string;
  cursorValue: string;
  updatedAt: number;
};

export type ClaimBacklogStatus = "PENDING" | "PROCESSING" | "RESOLVED";

export type ClaimBacklogItem = {
  backlogKey: string;
  chainKey: string;
  duelKey: string;
  marketKey: string;
  status: ClaimBacklogStatus;
  attempts: number;
  nextAttemptAt: number;
  lastAttemptAt: number | null;
  resolvedAt: number | null;
  lastError: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: number | null;
  payload: Record<string, unknown>;
};

export type OutboxStatus = "PENDING" | "LEASED" | "DONE";

export type OutboxItem = {
  id: number;
  topic: string;
  status: OutboxStatus;
  availableAt: number;
  leasedAt: number | null;
  leaseOwner: string | null;
  leaseExpiresAt: number | null;
  attempts: number;
  chainKey: string | null;
  duelKey: string | null;
  marketKey: string | null;
  orderKey: string | null;
  lastError: string | null;
  payload: Record<string, unknown>;
};

export type ReconciliationResult = {
  recoveredOrders: OrderRecord[];
  quarantinedOrders: OrderRecord[];
  orphanedOrders: OrderRecord[];
  claimBacklog: ClaimBacklogItem[];
};

export type ClaimBacklogInput = Omit<
  ClaimBacklogItem,
  | "attempts"
  | "lastAttemptAt"
  | "resolvedAt"
  | "lastError"
  | "leaseOwner"
  | "leaseExpiresAt"
> & {
  attempts?: number;
  lastAttemptAt?: number | null;
  resolvedAt?: number | null;
  lastError?: string | null;
  leaseOwner?: string | null;
  leaseExpiresAt?: number | null;
};

export type OutboxInput = Omit<
  OutboxItem,
  "id" | "leasedAt" | "leaseOwner" | "leaseExpiresAt" | "attempts" | "lastError"
> & {
  leasedAt?: number | null;
  leaseOwner?: string | null;
  leaseExpiresAt?: number | null;
  attempts?: number;
  lastError?: string | null;
};

export type AmmPositionRecord = {
  positionKey: string;
  chainKey: string;
  marketRef: string;
  betId: string;
  creator: string;
  yesBalance: string;
  noBalance: string;
  costBasis: string;
  settled: boolean;
  updatedAt: number;
};

export type MarketMakerStateStore = {
  ensureReady(): Promise<void>;
  close(): Promise<void>;
  listActiveOrders(): Promise<OrderRecord[]>;
  getOrder(orderKey: string): Promise<OrderRecord | null>;
  upsertOrder(order: OrderRecord): Promise<void>;
  appendOrderEvent(orderKey: string, eventType: string, payload?: Record<string, unknown>): Promise<void>;
  markOrderStatus(
    orderKey: string,
    status: ManagedOrderStatus,
    updates?: Partial<Pick<OrderRecord, "amount" | "price" | "lastSeenOnChainAt" | "lastReconciledAt" | "txSignature" | "quarantineReason" | "metadata">>,
  ): Promise<void>;
  listDueClaimBacklog(now: number): Promise<ClaimBacklogItem[]>;
  leaseClaimBacklog(
    now: number,
    limit: number,
    leaseOwner: string,
    leaseDurationMs: number,
  ): Promise<ClaimBacklogItem[]>;
  upsertClaimBacklog(item: ClaimBacklogInput): Promise<void>;
  markClaimBacklogAttempt(
    backlogKey: string,
    updates: {
      status: ClaimBacklogStatus;
      attempts: number;
      nextAttemptAt: number;
      lastAttemptAt: number;
      lastError?: string | null;
      resolvedAt?: number | null;
    },
  ): Promise<void>;
  enqueueOutbox(item: OutboxInput): Promise<number>;
  leaseOutbox(
    now: number,
    limit: number,
    leaseOwner: string,
    leaseDurationMs: number,
  ): Promise<OutboxItem[]>;
  completeOutbox(id: number): Promise<void>;
  failOutbox(id: number, lastError: string, availableAt: number): Promise<void>;
  getCursor(cursorKey: string): Promise<ReconciliationCursor | null>;
  setCursor(cursorKey: string, cursorValue: string, updatedAt?: number): Promise<void>;
  listAmmPositions(): Promise<AmmPositionRecord[]>;
  upsertAmmPosition(record: AmmPositionRecord): Promise<void>;
};

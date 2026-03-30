import type {
  AmmPositionRecord,
  ClaimBacklogInput,
  ClaimBacklogItem,
  MarketMakerStateStore,
  OrderEventRecord,
  OrderRecord,
  OutboxInput,
  OutboxItem,
  ReconciliationCursor,
} from "./types.ts";

export class InMemoryMarketMakerStateStore implements MarketMakerStateStore {
  private readonly orders = new Map<string, OrderRecord>();
  private readonly orderEvents: OrderEventRecord[] = [];
  private readonly claimBacklog = new Map<string, ClaimBacklogItem>();
  private readonly outbox = new Map<number, OutboxItem>();
  private readonly cursors = new Map<string, ReconciliationCursor>();
  private readonly ammPositions = new Map<string, AmmPositionRecord>();
  private nextOutboxId = 1;
  private nextEventId = 1;

  async ensureReady() {}

  async close() {}

  async listActiveOrders(): Promise<OrderRecord[]> {
    return [...this.orders.values()].filter(
      (order) => order.status === "OPEN" || order.status === "ORPHANED",
    );
  }

  async getOrder(orderKey: string): Promise<OrderRecord | null> {
    return this.orders.get(orderKey) ?? null;
  }

  async upsertOrder(order: OrderRecord): Promise<void> {
    this.orders.set(order.orderKey, structuredClone(order));
  }

  async appendOrderEvent(
    orderKey: string,
    eventType: string,
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    this.orderEvents.push({
      id: this.nextEventId++,
      orderKey,
      eventType,
      payload: structuredClone(payload),
      createdAt: Date.now(),
    });
  }

  async markOrderStatus(
    orderKey: string,
    status: OrderRecord["status"],
    updates: Partial<
      Pick<
        OrderRecord,
        | "amount"
        | "price"
        | "lastSeenOnChainAt"
        | "lastReconciledAt"
        | "txSignature"
        | "quarantineReason"
        | "metadata"
      >
    > = {},
  ): Promise<void> {
    const current = this.orders.get(orderKey);
    if (!current) return;
    this.orders.set(orderKey, {
      ...current,
      ...updates,
      metadata: updates.metadata ?? current.metadata,
      status,
    });
  }

  async listDueClaimBacklog(now: number): Promise<ClaimBacklogItem[]> {
    return [...this.claimBacklog.values()].filter(
      (item) =>
        item.status !== "RESOLVED" &&
        item.nextAttemptAt <= now &&
        (item.leaseExpiresAt == null || item.leaseExpiresAt <= now),
    );
  }

  async leaseClaimBacklog(
    now: number,
    limit: number,
    leaseOwner: string,
    leaseDurationMs: number,
  ): Promise<ClaimBacklogItem[]> {
    const items = [...this.claimBacklog.values()]
      .filter(
        (item) =>
          item.status !== "RESOLVED" &&
          item.nextAttemptAt <= now &&
          (item.leaseExpiresAt == null || item.leaseExpiresAt <= now),
      )
      .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)
      .slice(0, limit);
    const leaseExpiresAt = now + leaseDurationMs;
    for (const item of items) {
      this.claimBacklog.set(item.backlogKey, {
        ...item,
        status: "PROCESSING",
        leaseOwner,
        leaseExpiresAt,
      });
    }
    return items.map((item) => ({
      ...item,
      status: "PROCESSING",
      leaseOwner,
      leaseExpiresAt,
    }));
  }

  async upsertClaimBacklog(item: ClaimBacklogInput): Promise<void> {
    const current = this.claimBacklog.get(item.backlogKey);
    this.claimBacklog.set(item.backlogKey, {
      attempts: item.attempts ?? current?.attempts ?? 0,
      lastAttemptAt: item.lastAttemptAt ?? current?.lastAttemptAt ?? null,
      resolvedAt: item.resolvedAt ?? current?.resolvedAt ?? null,
      lastError: item.lastError ?? current?.lastError ?? null,
      leaseOwner: item.leaseOwner ?? current?.leaseOwner ?? null,
      leaseExpiresAt: item.leaseExpiresAt ?? current?.leaseExpiresAt ?? null,
      ...structuredClone(item),
    });
  }

  async markClaimBacklogAttempt(
    backlogKey: string,
    updates: {
      status: ClaimBacklogItem["status"];
      attempts: number;
      nextAttemptAt: number;
      lastAttemptAt: number;
      lastError?: string | null;
      resolvedAt?: number | null;
    },
  ): Promise<void> {
    const current = this.claimBacklog.get(backlogKey);
    if (!current) return;
    this.claimBacklog.set(backlogKey, {
      ...current,
      ...updates,
      lastError: updates.lastError ?? current.lastError,
      resolvedAt: updates.resolvedAt ?? current.resolvedAt,
      leaseOwner: null,
      leaseExpiresAt: null,
    });
  }

  async enqueueOutbox(item: OutboxInput): Promise<number> {
    const id = this.nextOutboxId++;
    this.outbox.set(id, {
      id,
      leasedAt: item.leasedAt ?? null,
      leaseOwner: item.leaseOwner ?? null,
      leaseExpiresAt: item.leaseExpiresAt ?? null,
      attempts: item.attempts ?? 0,
      lastError: item.lastError ?? null,
      ...structuredClone(item),
    });
    return id;
  }

  async leaseOutbox(
    now: number,
    limit: number,
    leaseOwner: string,
    leaseDurationMs: number,
  ): Promise<OutboxItem[]> {
    const items = [...this.outbox.values()]
      .filter(
        (item) =>
          item.status !== "DONE" &&
          item.availableAt <= now &&
          (item.leaseExpiresAt == null || item.leaseExpiresAt <= now),
      )
      .sort((a, b) => a.availableAt - b.availableAt)
      .slice(0, limit);
    const leaseExpiresAt = now + leaseDurationMs;
    for (const item of items) {
      this.outbox.set(item.id, {
        ...item,
        status: "LEASED",
        leasedAt: now,
        leaseOwner,
        leaseExpiresAt,
        attempts: item.attempts + 1,
      });
    }
    return items.map((item) => ({
      ...item,
      status: "LEASED",
      leasedAt: now,
      leaseOwner,
      leaseExpiresAt,
      attempts: item.attempts + 1,
    }));
  }

  async completeOutbox(id: number): Promise<void> {
    const item = this.outbox.get(id);
    if (!item) return;
    this.outbox.set(id, {
      ...item,
      status: "DONE",
      leaseOwner: null,
      leaseExpiresAt: null,
    });
  }

  async failOutbox(id: number, lastError: string, availableAt: number): Promise<void> {
    const item = this.outbox.get(id);
    if (!item) return;
    this.outbox.set(id, {
      ...item,
      status: "PENDING",
      availableAt,
      lastError,
      leaseOwner: null,
      leaseExpiresAt: null,
    });
  }

  async getCursor(cursorKey: string): Promise<ReconciliationCursor | null> {
    return this.cursors.get(cursorKey) ?? null;
  }

  async setCursor(
    cursorKey: string,
    cursorValue: string,
    updatedAt = Date.now(),
  ): Promise<void> {
    this.cursors.set(cursorKey, {
      cursorKey,
      cursorValue,
      updatedAt,
    });
  }

  async listAmmPositions(): Promise<AmmPositionRecord[]> {
    return [...this.ammPositions.values()];
  }

  async upsertAmmPosition(record: AmmPositionRecord): Promise<void> {
    this.ammPositions.set(record.positionKey, structuredClone(record));
  }
}

export function createInMemoryMarketMakerStateStore() {
  return new InMemoryMarketMakerStateStore();
}

import { describe, expect, it } from "vitest";

import { createTestMarketMakerStateStore } from "./index.ts";

describe("in-memory market maker state store", () => {
  it("leases outbox work to a single worker at a time", async () => {
    const store = createTestMarketMakerStateStore();
    await store.enqueueOutbox({
      topic: "cancel_orphan_evm_order",
      status: "PENDING",
      availableAt: 1_000,
      chainKey: "bsc",
      duelKey: "duel-1",
      marketKey: "market-1",
      orderKey: "order-1",
      payload: {},
    });

    const firstLease = await store.leaseOutbox(1_000, 10, "worker-a", 60_000);
    const secondLease = await store.leaseOutbox(1_000, 10, "worker-b", 60_000);

    expect(firstLease).toHaveLength(1);
    expect(firstLease[0]?.leaseOwner).toBe("worker-a");
    expect(secondLease).toHaveLength(0);
  });

  it("leases claim backlog work to a single worker at a time", async () => {
    const store = createTestMarketMakerStateStore();
    await store.upsertClaimBacklog({
      backlogKey: "claim-1",
      chainKey: "bsc",
      duelKey: "duel-1",
      marketKey: "market-1",
      status: "PENDING",
      nextAttemptAt: 1_000,
      payload: {},
    });

    const firstLease = await store.leaseClaimBacklog(1_000, 10, "worker-a", 60_000);
    const secondLease = await store.leaseClaimBacklog(1_000, 10, "worker-b", 60_000);

    expect(firstLease).toHaveLength(1);
    expect(firstLease[0]?.status).toBe("PROCESSING");
    expect(firstLease[0]?.leaseOwner).toBe("worker-a");
    expect(secondLease).toHaveLength(0);
  });
});

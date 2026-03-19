import { createInMemoryMarketMakerStateStore } from "./memory.ts";
import { createPostgresMarketMakerStateStore } from "./postgres.ts";

export { createInMemoryMarketMakerStateStore } from "./memory.ts";
export type {
  ClaimBacklogItem,
  ClaimBacklogInput,
  ManagedOrderStatus,
  MarketMakerStateStore,
  OrderRecord,
  OrderEventRecord,
  OutboxInput,
  OutboxItem,
  ReconciliationCursor,
  ReconciliationResult,
} from "./types.ts";

export function createDefaultMarketMakerStateStore(connectionString?: string) {
  const url = connectionString || process.env.MM_DATABASE_URL || "";
  if (!url) {
    console.info("[storage] MM_DATABASE_URL not set, falling back to in-memory store");
    return createInMemoryMarketMakerStateStore();
  }
  return createPostgresMarketMakerStateStore(url);
}

export function createTestMarketMakerStateStore() {
  return createInMemoryMarketMakerStateStore();
}

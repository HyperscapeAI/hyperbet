import { createRequire } from "node:module";

import type {
  AmmPositionRecord,
  ClaimBacklogInput,
  ClaimBacklogItem,
  MarketMakerStateStore,
  ManagedOrderStatus,
  OrderRecord,
  OutboxInput,
  OutboxItem,
  ReconciliationCursor,
} from "./types.ts";

const require = createRequire(import.meta.url);

type Queryable = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }>;
  end?: () => Promise<void>;
};

const STORAGE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS orders (
  order_key TEXT PRIMARY KEY,
  chain_key TEXT NOT NULL,
  duel_key TEXT NOT NULL,
  market_key TEXT NOT NULL,
  side INTEGER NOT NULL,
  order_id BIGINT NOT NULL,
  price INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  placed_at BIGINT NOT NULL,
  status TEXT NOT NULL,
  nonce INTEGER,
  tx_signature TEXT,
  last_seen_on_chain_at BIGINT,
  last_reconciled_at BIGINT,
  quarantine_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(chain_key, duel_key, side, order_id)
);
CREATE TABLE IF NOT EXISTS order_events (
  id BIGSERIAL PRIMARY KEY,
  order_key TEXT NOT NULL REFERENCES orders(order_key) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS reconciliation_cursors (
  cursor_key TEXT PRIMARY KEY,
  cursor_value TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS claim_backlog (
  backlog_key TEXT PRIMARY KEY,
  chain_key TEXT NOT NULL,
  duel_key TEXT NOT NULL,
  market_key TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at BIGINT NOT NULL,
  last_attempt_at BIGINT,
  resolved_at BIGINT,
  last_error TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE claim_backlog ADD COLUMN IF NOT EXISTS lease_owner TEXT;
ALTER TABLE claim_backlog ADD COLUMN IF NOT EXISTS lease_expires_at BIGINT;
CREATE TABLE IF NOT EXISTS outbox (
  id BIGSERIAL PRIMARY KEY,
  topic TEXT NOT NULL,
  status TEXT NOT NULL,
  available_at BIGINT NOT NULL,
  leased_at BIGINT,
  attempts INTEGER NOT NULL DEFAULT 0,
  chain_key TEXT,
  duel_key TEXT,
  market_key TEXT,
  order_key TEXT,
  last_error TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS lease_owner TEXT;
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS lease_expires_at BIGINT;
CREATE TABLE IF NOT EXISTS amm_positions (
  position_key TEXT PRIMARY KEY,
  chain_key TEXT NOT NULL,
  market_ref TEXT NOT NULL,
  bet_id TEXT NOT NULL,
  creator TEXT NOT NULL,
  yes_balance TEXT NOT NULL DEFAULT '0',
  no_balance TEXT NOT NULL DEFAULT '0',
  cost_basis TEXT NOT NULL DEFAULT '0',
  settled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at BIGINT NOT NULL
);
`;

function parseOrderRecord(row: Record<string, any>): OrderRecord {
  return {
    orderKey: row.order_key,
    chainKey: row.chain_key,
    duelKey: row.duel_key,
    marketKey: row.market_key,
    side: Number(row.side),
    orderId: Number(row.order_id),
    price: Number(row.price),
    amount: Number(row.amount),
    placedAt: Number(row.placed_at),
    status: row.status as ManagedOrderStatus,
    nonce: row.nonce == null ? null : Number(row.nonce),
    txSignature: row.tx_signature,
    lastSeenOnChainAt:
      row.last_seen_on_chain_at == null ? null : Number(row.last_seen_on_chain_at),
    lastReconciledAt:
      row.last_reconciled_at == null ? null : Number(row.last_reconciled_at),
    quarantineReason: row.quarantine_reason,
    metadata: row.metadata ?? {},
  };
}

function parseClaimBacklog(row: Record<string, any>): ClaimBacklogItem {
  return {
    backlogKey: row.backlog_key,
    chainKey: row.chain_key,
    duelKey: row.duel_key,
    marketKey: row.market_key,
    status: row.status,
    attempts: Number(row.attempts),
    nextAttemptAt: Number(row.next_attempt_at),
    lastAttemptAt:
      row.last_attempt_at == null ? null : Number(row.last_attempt_at),
    resolvedAt: row.resolved_at == null ? null : Number(row.resolved_at),
    lastError: row.last_error,
    leaseOwner: row.lease_owner,
    leaseExpiresAt:
      row.lease_expires_at == null ? null : Number(row.lease_expires_at),
    payload: row.payload ?? {},
  };
}

function parseOutbox(row: Record<string, any>): OutboxItem {
  return {
    id: Number(row.id),
    topic: row.topic,
    status: row.status,
    availableAt: Number(row.available_at),
    leasedAt: row.leased_at == null ? null : Number(row.leased_at),
    leaseOwner: row.lease_owner,
    leaseExpiresAt:
      row.lease_expires_at == null ? null : Number(row.lease_expires_at),
    attempts: Number(row.attempts),
    chainKey: row.chain_key,
    duelKey: row.duel_key,
    marketKey: row.market_key,
    orderKey: row.order_key,
    lastError: row.last_error,
    payload: row.payload ?? {},
  };
}

export class PostgresMarketMakerStateStore implements MarketMakerStateStore {
  private ready = false;

  constructor(private readonly pool: Queryable) {}

  async ensureReady(): Promise<void> {
    if (this.ready) return;
    await this.pool.query(STORAGE_SCHEMA_SQL);
    this.ready = true;
  }

  async close(): Promise<void> {
    await this.pool.end?.();
  }

  async listActiveOrders(): Promise<OrderRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM orders
       WHERE status IN ('OPEN', 'ORPHANED')
       ORDER BY placed_at ASC`,
    );
    return result.rows.map(parseOrderRecord);
  }

  async getOrder(orderKey: string): Promise<OrderRecord | null> {
    const result = await this.pool.query(
      `SELECT * FROM orders WHERE order_key = $1`,
      [orderKey],
    );
    return result.rows[0] ? parseOrderRecord(result.rows[0]) : null;
  }

  async upsertOrder(order: OrderRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO orders (
        order_key,
        chain_key,
        duel_key,
        market_key,
        side,
        order_id,
        price,
        amount,
        placed_at,
        status,
        nonce,
        tx_signature,
        last_seen_on_chain_at,
        last_reconciled_at,
        quarantine_reason,
        metadata
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb
      )
      ON CONFLICT (order_key) DO UPDATE SET
        market_key = EXCLUDED.market_key,
        price = EXCLUDED.price,
        amount = EXCLUDED.amount,
        status = EXCLUDED.status,
        nonce = EXCLUDED.nonce,
        tx_signature = EXCLUDED.tx_signature,
        last_seen_on_chain_at = EXCLUDED.last_seen_on_chain_at,
        last_reconciled_at = EXCLUDED.last_reconciled_at,
        quarantine_reason = EXCLUDED.quarantine_reason,
        metadata = EXCLUDED.metadata`,
      [
        order.orderKey,
        order.chainKey,
        order.duelKey,
        order.marketKey,
        order.side,
        order.orderId,
        order.price,
        order.amount,
        order.placedAt,
        order.status,
        order.nonce,
        order.txSignature,
        order.lastSeenOnChainAt,
        order.lastReconciledAt,
        order.quarantineReason,
        JSON.stringify(order.metadata ?? {}),
      ],
    );
  }

  async appendOrderEvent(
    orderKey: string,
    eventType: string,
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO order_events (order_key, event_type, payload, created_at)
       VALUES ($1, $2, $3::jsonb, $4)`,
      [orderKey, eventType, JSON.stringify(payload), Date.now()],
    );
  }

  async markOrderStatus(
    orderKey: string,
    status: ManagedOrderStatus,
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
    await this.pool.query(
      `UPDATE orders
       SET status = $2,
           amount = COALESCE($3, amount),
           price = COALESCE($4, price),
           last_seen_on_chain_at = COALESCE($5, last_seen_on_chain_at),
           last_reconciled_at = COALESCE($6, last_reconciled_at),
           tx_signature = COALESCE($7, tx_signature),
           quarantine_reason = $8,
           metadata = COALESCE($9::jsonb, metadata)
       WHERE order_key = $1`,
      [
        orderKey,
        status,
        updates.amount ?? null,
        updates.price ?? null,
        updates.lastSeenOnChainAt ?? null,
        updates.lastReconciledAt ?? null,
        updates.txSignature ?? null,
        updates.quarantineReason ?? null,
        updates.metadata ? JSON.stringify(updates.metadata) : null,
      ],
    );
  }

  async listDueClaimBacklog(now: number): Promise<ClaimBacklogItem[]> {
    const result = await this.pool.query(
      `SELECT * FROM claim_backlog
       WHERE status <> 'RESOLVED'
         AND next_attempt_at <= $1
         AND (lease_expires_at IS NULL OR lease_expires_at <= $1)
       ORDER BY next_attempt_at ASC`,
      [now],
    );
    return result.rows.map(parseClaimBacklog);
  }

  async leaseClaimBacklog(
    now: number,
    limit: number,
    leaseOwner: string,
    leaseDurationMs: number,
  ): Promise<ClaimBacklogItem[]> {
    const result = await this.pool.query(
      `WITH due AS (
         SELECT backlog_key
         FROM claim_backlog
         WHERE status <> 'RESOLVED'
           AND next_attempt_at <= $1
           AND (lease_expires_at IS NULL OR lease_expires_at <= $1)
         ORDER BY next_attempt_at ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       UPDATE claim_backlog backlog
       SET status = 'PROCESSING',
           lease_owner = $3,
           lease_expires_at = $4
       FROM due
       WHERE backlog.backlog_key = due.backlog_key
       RETURNING backlog.*`,
      [now, limit, leaseOwner, now + leaseDurationMs],
    );
    return result.rows.map(parseClaimBacklog);
  }

  async upsertClaimBacklog(item: ClaimBacklogInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO claim_backlog (
        backlog_key,
        chain_key,
        duel_key,
        market_key,
        status,
        attempts,
        next_attempt_at,
        last_attempt_at,
        resolved_at,
        last_error,
        lease_owner,
        lease_expires_at,
        payload
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb
      )
      ON CONFLICT (backlog_key) DO UPDATE SET
        status = EXCLUDED.status,
        attempts = EXCLUDED.attempts,
        next_attempt_at = EXCLUDED.next_attempt_at,
        last_attempt_at = EXCLUDED.last_attempt_at,
        resolved_at = EXCLUDED.resolved_at,
        last_error = EXCLUDED.last_error,
        lease_owner = EXCLUDED.lease_owner,
        lease_expires_at = EXCLUDED.lease_expires_at,
        payload = EXCLUDED.payload`,
      [
        item.backlogKey,
        item.chainKey,
        item.duelKey,
        item.marketKey,
        item.status,
        item.attempts ?? 0,
        item.nextAttemptAt,
        item.lastAttemptAt ?? null,
        item.resolvedAt ?? null,
        item.lastError ?? null,
        item.leaseOwner ?? null,
        item.leaseExpiresAt ?? null,
        JSON.stringify(item.payload ?? {}),
      ],
    );
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
    await this.pool.query(
      `UPDATE claim_backlog
       SET status = $2,
           attempts = $3,
           next_attempt_at = $4,
           last_attempt_at = $5,
           last_error = $6,
           resolved_at = $7,
           lease_owner = NULL,
           lease_expires_at = NULL
       WHERE backlog_key = $1`,
      [
        backlogKey,
        updates.status,
        updates.attempts,
        updates.nextAttemptAt,
        updates.lastAttemptAt,
        updates.lastError ?? null,
        updates.resolvedAt ?? null,
      ],
    );
  }

  async enqueueOutbox(item: OutboxInput): Promise<number> {
    const result = await this.pool.query(
      `INSERT INTO outbox (
        topic,
        status,
        available_at,
        leased_at,
        lease_owner,
        lease_expires_at,
        attempts,
        chain_key,
        duel_key,
        market_key,
        order_key,
        last_error,
        payload
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb
      ) RETURNING id`,
      [
        item.topic,
        item.status,
        item.availableAt,
        item.leasedAt ?? null,
        item.leaseOwner ?? null,
        item.leaseExpiresAt ?? null,
        item.attempts ?? 0,
        item.chainKey,
        item.duelKey,
        item.marketKey,
        item.orderKey,
        item.lastError ?? null,
        JSON.stringify(item.payload ?? {}),
      ],
    );
    return Number(result.rows[0]?.id ?? 0);
  }

  async leaseOutbox(
    now: number,
    limit: number,
    leaseOwner: string,
    leaseDurationMs: number,
  ): Promise<OutboxItem[]> {
    const result = await this.pool.query(
      `WITH due AS (
         SELECT id
         FROM outbox
         WHERE status <> 'DONE'
           AND available_at <= $1
           AND (lease_expires_at IS NULL OR lease_expires_at <= $1)
         ORDER BY available_at ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       UPDATE outbox item
       SET status = 'LEASED',
           leased_at = $1,
           lease_owner = $3,
           lease_expires_at = $4,
           attempts = item.attempts + 1
       FROM due
       WHERE item.id = due.id
       RETURNING item.*`,
      [now, limit, leaseOwner, now + leaseDurationMs],
    );
    return result.rows.map(parseOutbox);
  }

  async completeOutbox(id: number): Promise<void> {
    await this.pool.query(
      `UPDATE outbox
       SET status = 'DONE',
           lease_owner = NULL,
           lease_expires_at = NULL
       WHERE id = $1`,
      [id],
    );
  }

  async failOutbox(id: number, lastError: string, availableAt: number): Promise<void> {
    await this.pool.query(
      `UPDATE outbox
       SET status = 'PENDING',
           available_at = $2,
           last_error = $3,
           lease_owner = NULL,
           lease_expires_at = NULL
       WHERE id = $1`,
      [id, availableAt, lastError],
    );
  }

  async getCursor(cursorKey: string): Promise<ReconciliationCursor | null> {
    const result = await this.pool.query(
      `SELECT * FROM reconciliation_cursors WHERE cursor_key = $1`,
      [cursorKey],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      cursorKey: row.cursor_key,
      cursorValue: row.cursor_value,
      updatedAt: Number(row.updated_at),
    };
  }

  async setCursor(
    cursorKey: string,
    cursorValue: string,
    updatedAt = Date.now(),
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO reconciliation_cursors (cursor_key, cursor_value, updated_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (cursor_key) DO UPDATE SET
         cursor_value = EXCLUDED.cursor_value,
         updated_at = EXCLUDED.updated_at`,
      [cursorKey, cursorValue, updatedAt],
    );
  }

  async listAmmPositions(): Promise<AmmPositionRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM amm_positions ORDER BY updated_at DESC`,
    );
    return result.rows.map((row: Record<string, any>) => ({
      positionKey: row.position_key,
      chainKey: row.chain_key,
      marketRef: row.market_ref,
      betId: row.bet_id,
      creator: row.creator,
      yesBalance: row.yes_balance,
      noBalance: row.no_balance,
      costBasis: row.cost_basis,
      settled: row.settled,
      updatedAt: Number(row.updated_at),
    }));
  }

  async upsertAmmPosition(record: AmmPositionRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO amm_positions (
        position_key, chain_key, market_ref, bet_id, creator,
        yes_balance, no_balance, cost_basis, settled, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (position_key) DO UPDATE SET
        yes_balance = EXCLUDED.yes_balance,
        no_balance = EXCLUDED.no_balance,
        cost_basis = EXCLUDED.cost_basis,
        settled = EXCLUDED.settled,
        updated_at = EXCLUDED.updated_at`,
      [
        record.positionKey,
        record.chainKey,
        record.marketRef,
        record.betId,
        record.creator,
        record.yesBalance,
        record.noBalance,
        record.costBasis,
        record.settled,
        record.updatedAt,
      ],
    );
  }
}

export function createPostgresMarketMakerStateStore(connectionString: string) {
  if (!connectionString.trim()) {
    throw new Error("MM_DATABASE_URL is required for durable MM storage");
  }
  const { Pool } = requirePg();
  const pool = new Pool({
    connectionString,
  }) as Queryable;
  return new PostgresMarketMakerStateStore(pool);
}

function requirePg(): { Pool: new (input: Record<string, unknown>) => Queryable } {
  // Import lazily so tests can inject the memory store without touching the pg runtime.
  const mod = require("pg");
  return mod;
}

/**
 * SQLite persistence for the keeper service.
 *
 * Strategy: load-on-start + write-through.
 * All existing in-memory Maps are populated from the DB at startup.
 * Every mutation calls one of the save* functions below so data survives
 * restarts. Rate-limit buckets, parsers and SSE clients remain ephemeral.
 */
import { Database } from "bun:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RecordedBetChain } from "@hyperbet/chain-registry";
import type { AgentRating } from "./trueskill";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.KEEPER_DB_PATH?.trim()
  ? process.env.KEEPER_DB_PATH.trim()
  : path.resolve(__dirname, "..", "keeper.sqlite");

export type DbBetRecord = {
  id: string;
  bettorWallet: string;
  chain: RecordedBetChain;
  sourceAsset: string;
  sourceAmount: number;
  goldAmount: number;
  feeBps: number;
  txSignature: string;
  marketPda: string | null;
  duelKey: string | null;
  duelId: string | null;
  inviteCode: string | null;
  externalBetRef: string | null;
  recordedAt: number;
};

export type DbWalletPoints = {
  selfPoints: number;
  winPoints: number;
  referralPoints: number;
  stakingPoints: number;
};

export type DbPointsEventRecord = {
  id: number;
  wallet: string;
  eventType: string;
  status: string;
  totalPoints: number;
  referenceType: string | null;
  referenceId: string | null;
  relatedWallet: string | null;
  createdAt: number;
};

export type DbWalletGoldState = {
  goldBalance: number;
  goldHoldDays: number;
  updatedAt: number;
};

export type DbAgentRating = AgentRating & {
  agentId: string;
  updatedAt: number;
};

export type DbPerpsOracleSnapshot = {
  agentId: string;
  marketId: number;
  spotIndex: number;
  conservativeSkill: number;
  mu: number;
  sigma: number;
  recordedAt: number;
};

export type DbPerpsMarketStatus = "ACTIVE" | "CLOSE_ONLY" | "ARCHIVED";

export type DbPerpsMarketRecord = {
  agentId: string;
  marketId: number;
  rank: number | null;
  name: string;
  provider: string;
  model: string;
  wins: number;
  losses: number;
  winRate: number;
  combatLevel: number;
  currentStreak: number;
  status: DbPerpsMarketStatus;
  lastSeenAt: number;
  deprecatedAt: number | null;
  updatedAt: number;
};

// ── DB singleton ──────────────────────────────────────────────────────────────

const db = new Database(DB_PATH, { create: true });
db.run("PRAGMA journal_mode = WAL");
db.run("PRAGMA synchronous = NORMAL");
db.run("PRAGMA foreign_keys = ON");

// ── Schema ────────────────────────────────────────────────────────────────────

db.run(`CREATE TABLE IF NOT EXISTS bets (
  id TEXT PRIMARY KEY,
  bettor_wallet TEXT NOT NULL,
  chain TEXT NOT NULL,
  source_asset TEXT NOT NULL,
  source_amount REAL NOT NULL DEFAULT 0,
  gold_amount REAL NOT NULL DEFAULT 0,
  fee_bps INTEGER NOT NULL DEFAULT 0,
  tx_signature TEXT NOT NULL DEFAULT '',
  market_pda TEXT,
  duel_key TEXT,
  duel_id TEXT,
  invite_code TEXT,
  external_bet_ref TEXT,
  recorded_at INTEGER NOT NULL
)`);
try {
  db.run("ALTER TABLE bets ADD COLUMN duel_key TEXT");
} catch {
  // Column already exists.
}
try {
  db.run("ALTER TABLE bets ADD COLUMN duel_id TEXT");
} catch {
  // Column already exists.
}
db.run(`CREATE TABLE IF NOT EXISTS bets_duplicate_conflicts (
  original_id TEXT PRIMARY KEY,
  chain TEXT NOT NULL,
  tx_signature TEXT NOT NULL DEFAULT '',
  external_bet_ref TEXT,
  recorded_at INTEGER NOT NULL,
  reason TEXT NOT NULL,
  archived_at INTEGER NOT NULL
)`);

type DuplicateBetKeyRow = {
  value: string;
};

type DuplicateChainTxKeyRow = {
  chain: string;
  txSignature: string;
};

type DuplicateBetCandidate = {
  rowid: number;
  id: string;
  chain: string;
  txSignature: string;
  externalBetRef: string | null;
  recordedAt: number;
};

function resolveDuplicateRecordedBets(): void {
  const quarantinedCount = db.transaction(() => {
    const archivedAt = Date.now();
    let quarantined = 0;
    const archiveConflict = db.prepare(
      `INSERT OR REPLACE INTO bets_duplicate_conflicts (
        original_id,
        chain,
        tx_signature,
        external_bet_ref,
        recorded_at,
        reason,
        archived_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const deleteBet = db.prepare(`DELETE FROM bets WHERE rowid = ?`);
    const loadRowsByChainTx = db.prepare(
      `SELECT
         rowid,
         id,
         chain,
         tx_signature AS txSignature,
         external_bet_ref AS externalBetRef,
         recorded_at AS recordedAt
       FROM bets
      WHERE chain = ? AND tx_signature = ?
      ORDER BY recorded_at ASC, rowid ASC`,
    );
    const loadRowsByExternalRef = db.prepare(
      `SELECT
         rowid,
         id,
         chain,
         tx_signature AS txSignature,
         external_bet_ref AS externalBetRef,
         recorded_at AS recordedAt
       FROM bets
      WHERE external_bet_ref = ?
      ORDER BY recorded_at ASC, rowid ASC`,
    );
    const quarantineRows = (
      rows: DuplicateBetCandidate[],
      reasonPrefix: string,
    ) => {
      if (rows.length <= 1) return;
      const [canonical, ...duplicates] = rows;
      for (const duplicate of duplicates) {
        archiveConflict.run(
          duplicate.id,
          duplicate.chain,
          duplicate.txSignature,
          duplicate.externalBetRef,
          duplicate.recordedAt,
          `${reasonPrefix}; canonical_id=${canonical.id}`,
          archivedAt,
        );
        deleteBet.run(duplicate.rowid);
        quarantined += 1;
      }
    };

    const duplicateChainTxSignatures = db
      .prepare(
        `SELECT chain, tx_signature AS txSignature
           FROM bets
          WHERE tx_signature <> ''
          GROUP BY chain, tx_signature
         HAVING COUNT(*) > 1`,
      )
      .all() as DuplicateChainTxKeyRow[];
    for (const row of duplicateChainTxSignatures) {
      quarantineRows(
        loadRowsByChainTx.all(row.chain, row.txSignature) as DuplicateBetCandidate[],
        `duplicate chain+tx_signature (${row.chain}:${row.txSignature})`,
      );
    }

    const duplicateExternalRefs = db
      .prepare(
        `SELECT external_bet_ref AS value
           FROM bets
          WHERE external_bet_ref IS NOT NULL
          GROUP BY external_bet_ref
         HAVING COUNT(*) > 1`,
      )
      .all() as DuplicateBetKeyRow[];
    for (const row of duplicateExternalRefs) {
      quarantineRows(
        loadRowsByExternalRef.all(row.value) as DuplicateBetCandidate[],
        `duplicate external_bet_ref (${row.value})`,
      );
    }

    return quarantined;
  })();

  if (quarantinedCount > 0) {
    console.warn(
      `[keeper-db] Quarantined ${quarantinedCount} duplicate recorded bet row(s) into bets_duplicate_conflicts before enforcing uniqueness.`,
    );
  }
}

resolveDuplicateRecordedBets();

db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_bets_external_bet_ref_unique
  ON bets (external_bet_ref)
  WHERE external_bet_ref IS NOT NULL`);

db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_bets_chain_tx_signature_unique
  ON bets (chain, tx_signature)
  WHERE tx_signature <> ''`);

db.run(`CREATE TABLE IF NOT EXISTS wallet_display (
  normalized_wallet TEXT PRIMARY KEY,
  display_name TEXT NOT NULL
)`);

db.run(`CREATE TABLE IF NOT EXISTS wallet_points (
  wallet TEXT PRIMARY KEY,
  self_points REAL NOT NULL DEFAULT 0,
  win_points REAL NOT NULL DEFAULT 0,
  referral_points REAL NOT NULL DEFAULT 0,
  staking_points REAL NOT NULL DEFAULT 0
)`);

db.run(`CREATE TABLE IF NOT EXISTS points_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'CONFIRMED',
  total_points REAL NOT NULL DEFAULT 0,
  reference_type TEXT,
  reference_id TEXT,
  related_wallet TEXT,
  created_at INTEGER NOT NULL
)`);

db.run(`CREATE INDEX IF NOT EXISTS idx_points_events_wallet_time
  ON points_events (wallet, created_at DESC)`);

db.run(`CREATE INDEX IF NOT EXISTS idx_points_events_type_time
  ON points_events (event_type, created_at DESC)`);

db.run(`CREATE TABLE IF NOT EXISTS wallet_gold_state (
  wallet TEXT PRIMARY KEY,
  gold_balance REAL NOT NULL DEFAULT 0,
  gold_hold_days INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
)`);

db.run(`CREATE TABLE IF NOT EXISTS wallet_canonical (
  wallet TEXT PRIMARY KEY,
  canonical TEXT NOT NULL
)`);

db.run(`CREATE TABLE IF NOT EXISTS identity_members (
  canonical TEXT NOT NULL,
  member TEXT NOT NULL,
  PRIMARY KEY (canonical, member)
)`);

db.run(`CREATE TABLE IF NOT EXISTS invite_codes (
  wallet TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE
)`);

db.run(`CREATE TABLE IF NOT EXISTS referrals (
  wallet TEXT PRIMARY KEY,
  referrer_wallet TEXT NOT NULL,
  invite_code TEXT NOT NULL
)`);

db.run(`CREATE TABLE IF NOT EXISTS invited_wallets (
  referrer TEXT NOT NULL,
  invitee TEXT NOT NULL,
  PRIMARY KEY (referrer, invitee)
)`);

db.run(`CREATE TABLE IF NOT EXISTS referral_fees (
  wallet TEXT PRIMARY KEY,
  fee_share_gold REAL NOT NULL DEFAULT 0,
  treasury_fees REAL NOT NULL DEFAULT 0
)`);

db.run(`CREATE TABLE IF NOT EXISTS agent_ratings (
  agent_id TEXT PRIMARY KEY,
  mu REAL NOT NULL,
  sigma REAL NOT NULL,
  games_played INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
)`);

db.run(`CREATE TABLE IF NOT EXISTS perps_oracle_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  market_id INTEGER NOT NULL,
  spot_index REAL NOT NULL,
  conservative_skill REAL NOT NULL,
  mu REAL NOT NULL,
  sigma REAL NOT NULL,
  recorded_at INTEGER NOT NULL
)`);

db.run(`CREATE INDEX IF NOT EXISTS idx_perps_oracle_snapshots_agent_time
  ON perps_oracle_snapshots (agent_id, recorded_at DESC)`);

db.run(`CREATE INDEX IF NOT EXISTS idx_perps_oracle_snapshots_market_time
  ON perps_oracle_snapshots (market_id, recorded_at DESC)`);

db.run(`CREATE TABLE IF NOT EXISTS perps_markets (
  agent_id TEXT PRIMARY KEY,
  market_id INTEGER NOT NULL UNIQUE,
  rank INTEGER,
  name TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  win_rate REAL NOT NULL DEFAULT 0,
  combat_level INTEGER NOT NULL DEFAULT 0,
  current_streak INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  last_seen_at INTEGER NOT NULL DEFAULT 0,
  deprecated_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT 0
)`);

db.run(`CREATE INDEX IF NOT EXISTS idx_perps_markets_status_seen
  ON perps_markets (status, last_seen_at DESC)`);

// ── Prepared statements ───────────────────────────────────────────────────────

const insertBet = db.prepare(`INSERT OR IGNORE INTO bets
  (id, bettor_wallet, chain, source_asset, source_amount, gold_amount,
   fee_bps, tx_signature, market_pda, duel_key, duel_id, invite_code, external_bet_ref, recorded_at)
  VALUES ($id, $bettorWallet, $chain, $sourceAsset, $sourceAmount, $goldAmount,
          $feeBps, $txSignature, $marketPda, $duelKey, $duelId, $inviteCode, $externalBetRef, $recordedAt)`);

const upsertWalletDisplay =
  db.prepare(`INSERT INTO wallet_display (normalized_wallet, display_name)
  VALUES ($normalized, $display)
  ON CONFLICT(normalized_wallet) DO UPDATE SET display_name = excluded.display_name`);

const upsertWalletPoints = db.prepare(`INSERT INTO wallet_points
  (wallet, self_points, win_points, referral_points, staking_points)
  VALUES ($wallet, $selfPoints, $winPoints, $referralPoints, $stakingPoints)
  ON CONFLICT(wallet) DO UPDATE SET
    self_points = excluded.self_points,
    win_points = excluded.win_points,
    referral_points = excluded.referral_points,
    staking_points = excluded.staking_points`);

const insertPointsEvent = db.prepare(`INSERT INTO points_events
  (wallet, event_type, status, total_points, reference_type, reference_id, related_wallet, created_at)
  VALUES ($wallet, $eventType, $status, $totalPoints, $referenceType, $referenceId, $relatedWallet, $createdAt)`);

const upsertWalletGoldState = db.prepare(`INSERT INTO wallet_gold_state
  (wallet, gold_balance, gold_hold_days, updated_at)
  VALUES ($wallet, $goldBalance, $goldHoldDays, $updatedAt)
  ON CONFLICT(wallet) DO UPDATE SET
    gold_balance = excluded.gold_balance,
    gold_hold_days = excluded.gold_hold_days,
    updated_at = excluded.updated_at`);

const upsertWalletCanonical =
  db.prepare(`INSERT INTO wallet_canonical (wallet, canonical)
  VALUES ($wallet, $canonical)
  ON CONFLICT(wallet) DO UPDATE SET canonical = excluded.canonical`);

const insertIdentityMember =
  db.prepare(`INSERT OR IGNORE INTO identity_members (canonical, member)
  VALUES ($canonical, $member)`);

const deleteIdentityMembersForCanonical = db.prepare(
  `DELETE FROM identity_members WHERE canonical = $canonical`,
);

const upsertInviteCode = db.prepare(`INSERT INTO invite_codes (wallet, code)
  VALUES ($wallet, $code)
  ON CONFLICT(wallet) DO UPDATE SET code = excluded.code`);

const upsertReferral =
  db.prepare(`INSERT INTO referrals (wallet, referrer_wallet, invite_code)
  VALUES ($wallet, $referrerWallet, $inviteCode)
  ON CONFLICT(wallet) DO UPDATE SET
    referrer_wallet = excluded.referrer_wallet,
    invite_code = excluded.invite_code`);

const insertInvitedWallet =
  db.prepare(`INSERT OR IGNORE INTO invited_wallets (referrer, invitee)
  VALUES ($referrer, $invitee)`);

const upsertReferralFees =
  db.prepare(`INSERT INTO referral_fees (wallet, fee_share_gold, treasury_fees)
  VALUES ($wallet, $feeShareGold, $treasuryFees)
  ON CONFLICT(wallet) DO UPDATE SET
    fee_share_gold = excluded.fee_share_gold,
    treasury_fees = excluded.treasury_fees`);

const upsertAgentRating = db.prepare(`INSERT INTO agent_ratings
  (agent_id, mu, sigma, games_played, updated_at)
  VALUES ($agentId, $mu, $sigma, $gamesPlayed, $updatedAt)
  ON CONFLICT(agent_id) DO UPDATE SET
    mu = excluded.mu,
    sigma = excluded.sigma,
    games_played = excluded.games_played,
    updated_at = excluded.updated_at`);

const insertPerpsOracleSnapshot = db.prepare(`INSERT INTO perps_oracle_snapshots
  (agent_id, market_id, spot_index, conservative_skill, mu, sigma, recorded_at)
  VALUES ($agentId, $marketId, $spotIndex, $conservativeSkill, $mu, $sigma, $recordedAt)`);

const upsertPerpsMarket = db.prepare(`INSERT INTO perps_markets
  (agent_id, market_id, rank, name, provider, model, wins, losses, win_rate,
   combat_level, current_streak, status, last_seen_at, deprecated_at, updated_at)
  VALUES ($agentId, $marketId, $rank, $name, $provider, $model, $wins, $losses, $winRate,
          $combatLevel, $currentStreak, $status, $lastSeenAt, $deprecatedAt, $updatedAt)
  ON CONFLICT(agent_id) DO UPDATE SET
    market_id = excluded.market_id,
    rank = excluded.rank,
    name = excluded.name,
    provider = excluded.provider,
    model = excluded.model,
    wins = excluded.wins,
    losses = excluded.losses,
    win_rate = excluded.win_rate,
    combat_level = excluded.combat_level,
    current_streak = excluded.current_streak,
    status = excluded.status,
    last_seen_at = excluded.last_seen_at,
    deprecated_at = excluded.deprecated_at,
    updated_at = excluded.updated_at`);

// ── Load (hydrate in-memory state from DB at startup) ─────────────────────────

export type HydratedState = {
  bets: DbBetRecord[];
  walletDisplay: Map<string, string>;
  pointsByWallet: Map<string, DbWalletPoints>;
  pointsEvents: DbPointsEventRecord[];
  walletGoldState: Map<string, DbWalletGoldState>;
  canonicalByWallet: Map<string, string>;
  identityMembers: Map<string, Set<string>>;
  inviteCodeByWallet: Map<string, string>;
  walletByInviteCode: Map<string, string>;
  referredByWallet: Map<string, { wallet: string; code: string }>;
  invitedWalletsByWallet: Map<string, Set<string>>;
  referralFeeShareGoldByWallet: Map<string, number>;
  treasuryFeesFromReferralsByWallet: Map<string, number>;
};

export function loadAll(betLimit = 5000): HydratedState {
  const bets = (
    db
      .prepare(
        `SELECT id, bettor_wallet, chain, source_asset, source_amount, gold_amount,
          fee_bps, tx_signature, market_pda, duel_key, duel_id, invite_code, external_bet_ref, recorded_at
         FROM bets ORDER BY recorded_at DESC LIMIT ?`,
      )
      .all(betLimit) as Array<Record<string, unknown>>
  ).map(
    (row): DbBetRecord => ({
      id: String(row.id),
      bettorWallet: String(row.bettor_wallet),
      chain: String(row.chain) as DbBetRecord["chain"],
      sourceAsset: String(row.source_asset),
      sourceAmount: Number(row.source_amount),
      goldAmount: Number(row.gold_amount),
      feeBps: Number(row.fee_bps),
      txSignature: String(row.tx_signature),
      marketPda: row.market_pda != null ? String(row.market_pda) : null,
      duelKey: row.duel_key != null ? String(row.duel_key) : null,
      duelId: row.duel_id != null ? String(row.duel_id) : null,
      inviteCode: row.invite_code != null ? String(row.invite_code) : null,
      externalBetRef:
        row.external_bet_ref != null ? String(row.external_bet_ref) : null,
      recordedAt: Number(row.recorded_at),
    }),
  );

  const walletDisplay = new Map<string, string>();
  for (const row of db
    .prepare("SELECT normalized_wallet, display_name FROM wallet_display")
    .all() as Array<Record<string, string>>) {
    walletDisplay.set(row.normalized_wallet, row.display_name);
  }

  const pointsByWallet = new Map<string, DbWalletPoints>();
  for (const row of db
    .prepare(
      "SELECT wallet, self_points, win_points, referral_points, staking_points FROM wallet_points",
    )
    .all() as Array<Record<string, unknown>>) {
    pointsByWallet.set(String(row.wallet), {
      selfPoints: Number(row.self_points),
      winPoints: Number(row.win_points),
      referralPoints: Number(row.referral_points),
      stakingPoints: Number(row.staking_points),
    });
  }

  const pointsEvents = (
    db
      .prepare(
        `SELECT id, wallet, event_type, status, total_points, reference_type, reference_id, related_wallet, created_at
         FROM points_events
         ORDER BY created_at DESC, id DESC`,
      )
      .all() as Array<Record<string, unknown>>
  ).map(
    (row): DbPointsEventRecord => ({
      id: Number(row.id),
      wallet: String(row.wallet),
      eventType: String(row.event_type),
      status: String(row.status),
      totalPoints: Number(row.total_points),
      referenceType:
        row.reference_type == null ? null : String(row.reference_type),
      referenceId: row.reference_id == null ? null : String(row.reference_id),
      relatedWallet:
        row.related_wallet == null ? null : String(row.related_wallet),
      createdAt: Number(row.created_at),
    }),
  );

  const walletGoldState = new Map<string, DbWalletGoldState>();
  for (const row of db
    .prepare(
      "SELECT wallet, gold_balance, gold_hold_days, updated_at FROM wallet_gold_state",
    )
    .all() as Array<Record<string, unknown>>) {
    walletGoldState.set(String(row.wallet), {
      goldBalance: Number(row.gold_balance),
      goldHoldDays: Number(row.gold_hold_days),
      updatedAt: Number(row.updated_at),
    });
  }

  const canonicalByWallet = new Map<string, string>();
  for (const row of db
    .prepare("SELECT wallet, canonical FROM wallet_canonical")
    .all() as Array<Record<string, string>>) {
    canonicalByWallet.set(row.wallet, row.canonical);
  }

  const identityMembers = new Map<string, Set<string>>();
  for (const row of db
    .prepare("SELECT canonical, member FROM identity_members")
    .all() as Array<Record<string, string>>) {
    const set = identityMembers.get(row.canonical) ?? new Set<string>();
    set.add(row.member);
    identityMembers.set(row.canonical, set);
  }

  const inviteCodeByWallet = new Map<string, string>();
  const walletByInviteCode = new Map<string, string>();
  for (const row of db
    .prepare("SELECT wallet, code FROM invite_codes")
    .all() as Array<Record<string, string>>) {
    inviteCodeByWallet.set(row.wallet, row.code);
    walletByInviteCode.set(row.code, row.wallet);
  }

  const referredByWallet = new Map<string, { wallet: string; code: string }>();
  for (const row of db
    .prepare("SELECT wallet, referrer_wallet, invite_code FROM referrals")
    .all() as Array<Record<string, string>>) {
    referredByWallet.set(row.wallet, {
      wallet: row.referrer_wallet,
      code: row.invite_code,
    });
  }

  const invitedWalletsByWallet = new Map<string, Set<string>>();
  for (const row of db
    .prepare("SELECT referrer, invitee FROM invited_wallets")
    .all() as Array<Record<string, string>>) {
    const set = invitedWalletsByWallet.get(row.referrer) ?? new Set<string>();
    set.add(row.invitee);
    invitedWalletsByWallet.set(row.referrer, set);
  }

  const referralFeeShareGoldByWallet = new Map<string, number>();
  const treasuryFeesFromReferralsByWallet = new Map<string, number>();
  for (const row of db
    .prepare("SELECT wallet, fee_share_gold, treasury_fees FROM referral_fees")
    .all() as Array<Record<string, unknown>>) {
    referralFeeShareGoldByWallet.set(
      String(row.wallet),
      Number(row.fee_share_gold),
    );
    treasuryFeesFromReferralsByWallet.set(
      String(row.wallet),
      Number(row.treasury_fees),
    );
  }

  console.log(
    `[db] loaded ${bets.length} bets, ${walletDisplay.size} wallets, ${pointsByWallet.size} point records from ${DB_PATH}`,
  );

  return {
    bets,
    walletDisplay,
    pointsByWallet,
    pointsEvents,
    walletGoldState,
    canonicalByWallet,
    identityMembers,
    inviteCodeByWallet,
    walletByInviteCode,
    referredByWallet,
    invitedWalletsByWallet,
    referralFeeShareGoldByWallet,
    treasuryFeesFromReferralsByWallet,
  };
}

// ── Save helpers (called after each mutation) ─────────────────────────────────

export function saveBet(bet: DbBetRecord): boolean {
  const result = insertBet.run({
    $id: bet.id,
    $bettorWallet: bet.bettorWallet,
    $chain: bet.chain,
    $sourceAsset: bet.sourceAsset,
    $sourceAmount: bet.sourceAmount,
    $goldAmount: bet.goldAmount,
    $feeBps: bet.feeBps,
    $txSignature: bet.txSignature,
    $marketPda: bet.marketPda,
    $duelKey: bet.duelKey,
    $duelId: bet.duelId,
    $inviteCode: bet.inviteCode,
    $externalBetRef: bet.externalBetRef,
    $recordedAt: bet.recordedAt,
  }) as { changes?: number };
  return Number(result.changes ?? 0) > 0;
}

export function saveWalletDisplay(normalized: string, display: string): void {
  upsertWalletDisplay.run({ $normalized: normalized, $display: display });
}

export function saveWalletPoints(wallet: string, points: DbWalletPoints): void {
  upsertWalletPoints.run({
    $wallet: wallet,
    $selfPoints: points.selfPoints,
    $winPoints: points.winPoints,
    $referralPoints: points.referralPoints,
    $stakingPoints: points.stakingPoints,
  });
}

export function savePointsEvent(
  event: Omit<DbPointsEventRecord, "id">,
): number {
  const result = insertPointsEvent.run({
    $wallet: event.wallet,
    $eventType: event.eventType,
    $status: event.status,
    $totalPoints: event.totalPoints,
    $referenceType: event.referenceType,
    $referenceId: event.referenceId,
    $relatedWallet: event.relatedWallet,
    $createdAt: event.createdAt,
  }) as { lastInsertRowid?: number | bigint };

  return Number(result.lastInsertRowid ?? 0);
}

export function saveWalletGoldState(
  wallet: string,
  state: DbWalletGoldState,
): void {
  upsertWalletGoldState.run({
    $wallet: wallet,
    $goldBalance: state.goldBalance,
    $goldHoldDays: state.goldHoldDays,
    $updatedAt: state.updatedAt,
  });
}

export function saveWalletCanonical(wallet: string, canonical: string): void {
  upsertWalletCanonical.run({ $wallet: wallet, $canonical: canonical });
}

/** Replace all members for a canonical identity (used after a merge). */
export function saveIdentityMembers(
  canonical: string,
  members: Set<string>,
): void {
  const doSave = db.transaction(() => {
    deleteIdentityMembersForCanonical.run({ $canonical: canonical });
    for (const member of members) {
      insertIdentityMember.run({ $canonical: canonical, $member: member });
    }
  });
  doSave();
}

export function deleteIdentityMembers(canonical: string): void {
  deleteIdentityMembersForCanonical.run({ $canonical: canonical });
}

export function saveInviteCode(wallet: string, code: string): void {
  upsertInviteCode.run({ $wallet: wallet, $code: code });
}

export function saveReferral(
  wallet: string,
  referrerWallet: string,
  inviteCode: string,
): void {
  upsertReferral.run({
    $wallet: wallet,
    $referrerWallet: referrerWallet,
    $inviteCode: inviteCode,
  });
}

export function saveInvitedWallet(referrer: string, invitee: string): void {
  insertInvitedWallet.run({ $referrer: referrer, $invitee: invitee });
}

export function saveReferralFees(
  wallet: string,
  feeShareGold: number,
  treasuryFees: number,
): void {
  upsertReferralFees.run({
    $wallet: wallet,
    $feeShareGold: feeShareGold,
    $treasuryFees: treasuryFees,
  });
}

export function loadAgentRatings(): Record<string, AgentRating> {
  const ratings: Record<string, AgentRating> = {};
  for (const row of db
    .prepare(
      "SELECT agent_id, mu, sigma, games_played FROM agent_ratings ORDER BY updated_at DESC",
    )
    .all() as Array<Record<string, unknown>>) {
    ratings[String(row.agent_id)] = {
      mu: Number(row.mu),
      sigma: Number(row.sigma),
      gamesPlayed: Number(row.games_played),
    };
  }
  return ratings;
}

export function loadPerpsOracleSnapshots(
  agentId?: string,
  limit = 100,
): DbPerpsOracleSnapshot[] {
  const rows = agentId
    ? (db
        .prepare(
          `SELECT agent_id, market_id, spot_index, conservative_skill, mu, sigma, recorded_at
           FROM perps_oracle_snapshots
           WHERE agent_id = ?
           ORDER BY recorded_at DESC
           LIMIT ?`,
        )
        .all(agentId, limit) as Array<Record<string, unknown>>)
    : (db
        .prepare(
          `SELECT agent_id, market_id, spot_index, conservative_skill, mu, sigma, recorded_at
           FROM perps_oracle_snapshots
           ORDER BY recorded_at DESC
           LIMIT ?`,
        )
        .all(limit) as Array<Record<string, unknown>>);

  return rows.map(
    (row): DbPerpsOracleSnapshot => ({
      agentId: String(row.agent_id),
      marketId: Number(row.market_id),
      spotIndex: Number(row.spot_index),
      conservativeSkill: Number(row.conservative_skill),
      mu: Number(row.mu),
      sigma: Number(row.sigma),
      recordedAt: Number(row.recorded_at),
    }),
  );
}

export function loadPerpsMarkets(
  status?: DbPerpsMarketStatus,
): DbPerpsMarketRecord[] {
  const rows = status
    ? (db
        .prepare(
          `SELECT agent_id, market_id, rank, name, provider, model, wins, losses, win_rate,
                  combat_level, current_streak, status, last_seen_at, deprecated_at, updated_at
           FROM perps_markets
           WHERE status = ?
           ORDER BY COALESCE(rank, 2147483647) ASC, name ASC`,
        )
        .all(status) as Array<Record<string, unknown>>)
    : (db
        .prepare(
          `SELECT agent_id, market_id, rank, name, provider, model, wins, losses, win_rate,
                  combat_level, current_streak, status, last_seen_at, deprecated_at, updated_at
           FROM perps_markets
           ORDER BY
             CASE status
               WHEN 'ACTIVE' THEN 0
               WHEN 'CLOSE_ONLY' THEN 1
               ELSE 2
             END,
             COALESCE(rank, 2147483647) ASC,
             name ASC`,
        )
        .all() as Array<Record<string, unknown>>);

  return rows.map(
    (row): DbPerpsMarketRecord => ({
      agentId: String(row.agent_id),
      marketId: Number(row.market_id),
      rank: row.rank == null ? null : Number(row.rank),
      name: String(row.name ?? ""),
      provider: String(row.provider ?? ""),
      model: String(row.model ?? ""),
      wins: Number(row.wins ?? 0),
      losses: Number(row.losses ?? 0),
      winRate: Number(row.win_rate ?? 0),
      combatLevel: Number(row.combat_level ?? 0),
      currentStreak: Number(row.current_streak ?? 0),
      status: String(row.status) as DbPerpsMarketStatus,
      lastSeenAt: Number(row.last_seen_at ?? 0),
      deprecatedAt:
        row.deprecated_at == null ? null : Number(row.deprecated_at),
      updatedAt: Number(row.updated_at ?? 0),
    }),
  );
}

export function saveAgentRating(
  agentId: string,
  rating: AgentRating,
  updatedAt = Date.now(),
): void {
  upsertAgentRating.run({
    $agentId: agentId,
    $mu: rating.mu,
    $sigma: rating.sigma,
    $gamesPlayed: rating.gamesPlayed,
    $updatedAt: updatedAt,
  });
}

export function saveAgentRatings(
  ratings: Record<string, AgentRating>,
  updatedAt = Date.now(),
): void {
  const persistRatings = db.transaction(
    (entries: Array<[string, AgentRating]>, persistedAt: number) => {
      for (const [agentId, rating] of entries) {
        upsertAgentRating.run({
          $agentId: agentId,
          $mu: rating.mu,
          $sigma: rating.sigma,
          $gamesPlayed: rating.gamesPlayed,
          $updatedAt: persistedAt,
        });
      }
    },
  );

  persistRatings(Object.entries(ratings), updatedAt);
}

export function savePerpsOracleSnapshot(snapshot: DbPerpsOracleSnapshot): void {
  insertPerpsOracleSnapshot.run({
    $agentId: snapshot.agentId,
    $marketId: snapshot.marketId,
    $spotIndex: snapshot.spotIndex,
    $conservativeSkill: snapshot.conservativeSkill,
    $mu: snapshot.mu,
    $sigma: snapshot.sigma,
    $recordedAt: snapshot.recordedAt,
  });
}

export function savePerpsMarket(record: DbPerpsMarketRecord): void {
  upsertPerpsMarket.run({
    $agentId: record.agentId,
    $marketId: record.marketId,
    $rank: record.rank,
    $name: record.name,
    $provider: record.provider,
    $model: record.model,
    $wins: record.wins,
    $losses: record.losses,
    $winRate: record.winRate,
    $combatLevel: record.combatLevel,
    $currentStreak: record.currentStreak,
    $status: record.status,
    $lastSeenAt: record.lastSeenAt,
    $deprecatedAt: record.deprecatedAt,
    $updatedAt: record.updatedAt,
  });
}

export function closeDb(): void {
  db.close();
}

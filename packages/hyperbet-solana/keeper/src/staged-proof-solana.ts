import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import BN from "bn.js";
import { PublicKey, SystemProgram } from "@solana/web3.js";

import {
  FIGHT_ORACLE_PROGRAM_ID,
  createPrograms,
  duelKeyHexToBytes,
  findClobVaultPda,
  findDuelStatePda,
  findMarketConfigPda,
  findOrderPda,
  findOracleConfigPda,
  findPriceLevelPda,
  findUserBalancePda,
  readKeypair,
  SIDE_ASK,
} from "./common";

type PredictionMarketsResponse = {
  duel: {
    duelKey: string | null;
    duelId: string | null;
  };
  markets: Array<{
    chainKey: string;
    marketRef: string | null;
    lifecycleStatus: string;
  }>;
};

type SolanaCanaryResult = {
  duelId: string;
  duelKeyHex: string;
  marketRef: string;
  upsertTx: string;
  placeOrderTx: string;
  cancelTx: string;
  syncTx: string;
  claimTx: string;
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (!value) {
    throw new Error(`Missing required env ${name}`);
  }
  return value;
}

function buildControlledCycle(
  duelId: string,
  duelKeyHex: string,
): Record<string, unknown> {
  const now = Date.now();
  return {
    cycle: {
      cycleId: `staged-proof-solana-${duelId}`,
      phase: "ANNOUNCEMENT",
      duelId,
      duelKeyHex,
      cycleStartTime: now - 90_000,
      phaseStartTime: now - 5_000,
      phaseEndTime: now + 300_000,
      betOpenTime: now - 15_000,
      betCloseTime: now + 300_000,
      fightStartTime: now + 60_000,
      duelEndTime: null,
      countdown: 300,
      timeRemaining: 300_000,
      winnerId: null,
      winnerName: null,
      winReason: null,
      seed: null,
      replayHash: null,
      agent1: {
        id: "staged-solana-agent-a",
        name: "Stage Agent A",
        provider: "Hyperscape",
        model: "stage-alpha",
        hp: 90,
        maxHp: 100,
        combatLevel: 90,
        wins: 10,
        losses: 2,
        damageDealtThisFight: 12,
        inventory: [],
        monologues: [],
      },
      agent2: {
        id: "staged-solana-agent-b",
        name: "Stage Agent B",
        provider: "OpenRouter",
        model: "stage-beta",
        hp: 88,
        maxHp: 100,
        combatLevel: 88,
        wins: 8,
        losses: 4,
        damageDealtThisFight: 9,
        inventory: [],
        monologues: [],
      },
    },
    leaderboard: [],
    cameraTarget: null,
  };
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${raw}`);
  }
  return JSON.parse(raw) as T;
}

async function waitFor<T>(
  label: string,
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 120_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError = `${label} did not become ready`;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (predicate(value)) {
        return value;
      }
      lastError = `${label} predicate not satisfied`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(lastError);
}

function findCanonicalMarket(payload: PredictionMarketsResponse) {
  return payload.markets.find((market) => market.chainKey === "solana") ?? null;
}

function shaParticipant(label: string): number[] {
  return Array.from(createHash("sha256").update(label).digest());
}

async function publishControlledState(duelId: string, duelKeyHex: string): Promise<void> {
  const keeperUrl = requireEnv("HYPERBET_SOLANA_KEEPER_STAGING_URL").replace(/\/$/, "");
  const publishKey = requireEnv("HYPERBET_SOLANA_STAGING_STREAM_PUBLISH_KEY");
  await requestJson(
    `${keeperUrl}/api/streaming/state/publish`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-arena-write-key": publishKey,
      },
      body: JSON.stringify(buildControlledCycle(duelId, duelKeyHex)),
    },
  );
}

async function main(): Promise<void> {
  const previousRpcUrl = process.env.SOLANA_RPC_URL;
  const previousCluster = process.env.SOLANA_CLUSTER;
  process.env.SOLANA_RPC_URL = requireEnv("HYPERBET_SOLANA_STAGING_RPC_URL");
  process.env.SOLANA_CLUSTER = "mainnet-beta";

  try {
    const duelId = requireEnv("HYPERBET_STAGED_PROOF_DUEL_ID");
    const duelKeyHex = requireEnv("HYPERBET_STAGED_PROOF_DUEL_KEY")
      .replace(/^0x/i, "")
      .toLowerCase();
    const duelKey = duelKeyHexToBytes(duelKeyHex);
    const authority = readKeypair(
      requireEnv("HYPERBET_SOLANA_STAGING_ORACLE_AUTHORITY_KEYPAIR"),
    );
    const trader = readKeypair(requireEnv("HYPERBET_SOLANA_STAGING_CANARY_KEYPAIR"));
    const keeperUrl = requireEnv("HYPERBET_SOLANA_KEEPER_STAGING_URL").replace(/\/$/, "");

    const authorityPrograms = createPrograms(authority);
    const traderPrograms = createPrograms(trader);
    const fightOracle = authorityPrograms.fightOracle;
    const clobProgram = traderPrograms.lvrMarket;
    const duelState = findDuelStatePda(FIGHT_ORACLE_PROGRAM_ID, duelKey);
    const oracleConfig = findOracleConfigPda(FIGHT_ORACLE_PROGRAM_ID);

    const now = Math.floor(Date.now() / 1000);
    const upsertTx = await fightOracle.methods
      .upsertDuel(
        Array.from(duelKey),
        shaParticipant("stage-solana-agent-a"),
        shaParticipant("stage-solana-agent-b"),
        new BN((now - 15).toString()),
        new BN((now + 300).toString()),
        new BN((now + 360).toString()),
        "staged-live-proof-open",
        { bettingOpen: {} },
      )
      .accountsPartial({
        reporter: authority.publicKey,
        oracleConfig,
        duelState,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    await publishControlledState(duelId, duelKeyHex);

    const lifecycle = await waitFor(
      "solana lifecycle open",
      async () =>
        requestJson<PredictionMarketsResponse>(
          `${keeperUrl}/api/arena/prediction-markets/active`,
        ),
      (payload) => {
        const market = findCanonicalMarket(payload);
        return (
          payload.duel.duelKey === duelKeyHex &&
          market?.marketRef != null &&
          market.lifecycleStatus === "OPEN"
        );
      },
    );

    const market = findCanonicalMarket(lifecycle);
    if (!market?.marketRef) {
      throw new Error("solana marketRef missing after lifecycle open");
    }

    const marketState = new PublicKey(market.marketRef);
    const marketAccount = await clobProgram.account.marketState.fetch(marketState);
    const configPda = findMarketConfigPda(clobProgram.programId);
    const config = await clobProgram.account.marketConfig.fetch(configPda);
    const userBalance = findUserBalancePda(
      clobProgram.programId,
      marketState,
      trader.publicKey,
    );
    const nextOrderId = BigInt(marketAccount.nextOrderId.toString());
    const placeOrderTx = await clobProgram.methods
      .placeOrder(
        new BN(nextOrderId.toString()),
        SIDE_ASK,
        999,
        new BN(
          (process.env.HYPERBET_SOLANA_STAGING_CANARY_ORDER_LAMPORTS ?? "1000000").trim(),
        ),
      )
      .accountsPartial({
        marketState,
        duelState,
        userBalance,
        newOrder: findOrderPda(clobProgram.programId, marketState, nextOrderId),
        restingLevel: findPriceLevelPda(clobProgram.programId, marketState, SIDE_ASK, 999),
        config: configPda,
        treasury: config.treasury,
        marketMaker: config.marketMaker,
        vault: findClobVaultPda(clobProgram.programId, marketState),
        user: trader.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();

    const cancelTx = await fightOracle.methods
      .cancelDuel(Array.from(duelKey), "staged-live-proof-cancelled")
      .accountsPartial({
        reporter: authority.publicKey,
        oracleConfig,
        duelState,
      })
      .signers([authority])
      .rpc();

    const syncTx = await traderPrograms.lvrMarket.methods
      .syncMarketFromDuel()
      .accountsPartial({
        marketState,
        duelState,
      })
      .rpc();

    await waitFor(
      "solana lifecycle cancelled",
      async () =>
        requestJson<PredictionMarketsResponse>(
          `${keeperUrl}/api/arena/prediction-markets/active`,
        ),
      (payload) => findCanonicalMarket(payload)?.lifecycleStatus === "CANCELLED",
    );

    const claimTx = await traderPrograms.lvrMarket.methods
      .claim()
      .accountsPartial({
        marketState,
        duelState,
        userBalance,
        config: configPda,
        marketMaker: config.marketMaker,
        vault: findClobVaultPda(clobProgram.programId, marketState),
        user: trader.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();

    const balanceAfter =
      await traderPrograms.lvrMarket.account.userBalance.fetchNullable(userBalance);
    const aShares = BigInt(balanceAfter?.aShares?.toString?.() ?? "0");
    const bShares = BigInt(balanceAfter?.bShares?.toString?.() ?? "0");
    if (aShares !== 0n || bShares !== 0n) {
      throw new Error(`solana claim cleanup incomplete: ${aShares}:${bShares}`);
    }

    const result: SolanaCanaryResult = {
      duelId,
      duelKeyHex,
      marketRef: market.marketRef,
      upsertTx,
      placeOrderTx,
      cancelTx,
      syncTx,
      claimTx,
    };
    console.log(JSON.stringify(result));
  } finally {
    if (previousRpcUrl === undefined) {
      delete process.env.SOLANA_RPC_URL;
    } else {
      process.env.SOLANA_RPC_URL = previousRpcUrl;
    }
    if (previousCluster === undefined) {
      delete process.env.SOLANA_CLUSTER;
    } else {
      process.env.SOLANA_CLUSTER = previousCluster;
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}

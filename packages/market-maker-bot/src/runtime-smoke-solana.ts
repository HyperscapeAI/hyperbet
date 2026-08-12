import { strict as assert } from "node:assert";

import * as anchor from "@coral-xyz/anchor";
import type { Program } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";

import fightOracleIdl from "../../hyperbet-solana/anchor/target/idl/fight_oracle.json" with { type: "json" };
import duelMarketIdl from "../../hyperbet-solana/anchor/target/idl/duel_market.json" with { type: "json" };
import {
  airdrop,
  createOpenMarketFixture,
  deriveOrderPda,
  derivePriceLevelPda,
  deriveUserBalancePda,
  duelStatusLocked,
  ensureOracleReady,
  finalizeDuelResult,
  marketSideA,
  placeClobOrder,
  proposeDuelResult,
  SIDE_ASK,
  SIDE_BID,
  sleep,
  syncMarketFromDuel,
  upsertDuel,
  writableAccount,
} from "../../hyperbet-solana/anchor/tests/clob-test-helpers.ts";

function duelKeyHex(duelKey: readonly number[]): string {
  return `0x${Buffer.from(duelKey).toString("hex")}`;
}

function unitsToRawAmount(units: number): bigint {
  return BigInt(Math.max(1, Math.floor(units))) * 1_000n;
}

function invalidateBotCaches(mm: any) {
  mm.lastPredictionMarkets = null;
  mm.lastPredictionMarketsAt = 0;
  mm.lastDuelSignal = null;
  mm.lastDuelSignalAt = 0;
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const authority = (provider.wallet as anchor.Wallet & { payer?: Keypair }).payer;
  if (!authority) {
    throw new Error("Anchor wallet does not expose a payer keypair");
  }

  const fightProgram = new anchor.Program(
    fightOracleIdl as anchor.Idl,
    provider,
  ) as Program<any>;
  const clobProgram = new anchor.Program(
    duelMarketIdl as anchor.Idl,
    provider,
  ) as Program<any>;
  await ensureOracleReady(fightProgram as never, authority);

  const treasury = Keypair.generate();
  const marketMaker = Keypair.generate();
  const counterparty = Keypair.generate();
  await airdrop(provider.connection, authority.publicKey, 20);
  await airdrop(provider.connection, treasury.publicKey, 2);
  await airdrop(provider.connection, marketMaker.publicKey, 2);
  await airdrop(provider.connection, counterparty.publicKey, 5);

  const fixtureNow = Math.floor(Date.now() / 1000);
  const betOpenTs = fixtureNow - 30;
  const betCloseTs = fixtureNow + 5;
  const duelStartTs = betCloseTs + 60;
  const fixture = await createOpenMarketFixture(fightProgram, clobProgram, authority, {
    treasury: treasury.publicKey,
    marketMaker: marketMaker.publicKey,
    betOpenTs,
    betCloseTs,
    duelStartTs,
  });
  const currentDuelKeyHex = duelKeyHex(fixture.duelKey);

  let lifecycleStatus: "OPEN" | "RESOLVED" = "OPEN";
  let duelPhase = "FIGHTING";

  process.env.MM_ENV = "localnet";
  process.env.MM_ENABLE_BSC = "false";
  process.env.MM_ENABLE_BASE = "false";
  process.env.MM_ENABLE_AVAX = "false";
  process.env.MM_ENABLE_SOLANA = "true";
  process.env.MM_MARKETS_CACHE_MS = "0";
  process.env.MM_DUEL_SIGNAL_CACHE_MS = "0";
  process.env.MM_DUEL_SIGNAL_FETCH_TIMEOUT_MS = "50";
  process.env.MM_PREDICTION_MARKETS_API_URL =
    "http://127.0.0.1:5555/api/arena/prediction-markets/active";
  process.env.MM_DUEL_STATE_API_URL = "http://127.0.0.1:5555/api/streaming/state";
  process.env.SOLANA_RPC_URL = process.env.ANCHOR_PROVIDER_URL || "http://127.0.0.1:8899";
  process.env.SOLANA_PRIVATE_KEY = JSON.stringify(Array.from(authority.secretKey));
  process.env.FIGHT_ORACLE_PROGRAM_ID = fightProgram.programId.toBase58();
  process.env.DUEL_MARKET_PROGRAM_ID = clobProgram.programId.toBase58();

  globalThis.fetch = (async (url: string | URL | Request) => {
    const resolved = String(url);
    if (resolved.includes("/api/arena/prediction-markets/active")) {
      return {
        ok: true,
        json: async () => ({
          duel: {
            duelKey: currentDuelKeyHex,
            duelId: "solana-smoke",
            phase: duelPhase,
            betCloseTime: Date.now() + 60_000,
          },
          markets: [
            {
              chainKey: "solana",
              duelKey: currentDuelKeyHex,
              duelId: "solana-smoke",
              marketRef: fixture.marketState.toBase58(),
              lifecycleStatus,
              programId: clobProgram.programId.toBase58(),
            },
          ],
          updatedAt: Date.now(),
        }),
      } as Response;
    }

    return {
      ok: true,
      json: async () => ({
        cycle: {
          phase: duelPhase,
          winnerId: lifecycleStatus === "RESOLVED" ? "agent-a" : null,
          agent1: { id: "agent-a", hp: 90, maxHp: 100 },
          agent2: { id: "agent-b", hp: 30, maxHp: 100 },
        },
      }),
    } as Response;
  }) as typeof fetch;

  const { CrossChainMarketMaker } = await import("./index.ts");
  const { createTestMarketMakerStateStore } = await import("./storage/index.ts");
  const mm = new CrossChainMarketMaker({
    stateStore: createTestMarketMakerStateStore(),
  });

  await mm.marketMakeCycle();
  const solanaOrders = mm.getActiveOrders().filter((order) => order.chainKey === "solana");
  assert.equal(solanaOrders.length, 2, "bot should place bid and ask quotes");

  const botBidOrder = solanaOrders.find((order) => order.side === SIDE_BID);
  assert.ok(botBidOrder, "bot bid order should exist");

  const currentMarketState = await clobProgram.account.marketState.fetch(
    fixture.marketState,
  );
  const nextOrderId = BigInt(currentMarketState.nextOrderId.toString());
  const botUserBalance = deriveUserBalancePda(
    clobProgram.programId,
    fixture.marketState,
    authority.publicKey,
  );
  const botBidOrderPda = deriveOrderPda(
    clobProgram.programId,
    fixture.marketState,
    botBidOrder.orderId,
  );
  const botBidPriceLevel = derivePriceLevelPda(
    clobProgram.programId,
    fixture.marketState,
    SIDE_BID,
    botBidOrder.price,
  );

  await placeClobOrder(clobProgram, {
    marketState: fixture.marketState,
    duelState: fixture.duelState,
    config: fixture.config,
    treasury: fixture.treasury,
    marketMaker: fixture.marketMaker,
    vault: fixture.vault,
    user: counterparty,
    orderId: nextOrderId,
    side: SIDE_ASK,
    price: botBidOrder.price,
    amount: unitsToRawAmount(botBidOrder.amount),
    remainingAccounts: [
      writableAccount(botBidPriceLevel),
      writableAccount(botBidOrderPda),
      writableAccount(botUserBalance),
    ],
  });

  const filledBalance = await clobProgram.account.userBalance.fetch(botUserBalance);
  assert.ok(
    BigInt(filledBalance.aShares.toString()) > 0n,
    "bot should hold winning shares after the cross",
  );
  (mm as any).activeOrders.length = 0;

  while (true) {
    const slot = await provider.connection.getSlot("confirmed");
    const blockTime = (await provider.connection.getBlockTime(slot)) ?? 0;
    if (blockTime >= betCloseTs + 1) break;
    await sleep(1_000);
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  await upsertDuel(fightProgram, authority, fixture.duelKey, {
    status: duelStatusLocked(),
    betOpenTs,
    betCloseTs,
    duelStartTs,
  });
  await syncMarketFromDuel(clobProgram as never, fixture.marketState, fixture.duelState);
  await proposeDuelResult(fightProgram, authority, fixture.duelKey, {
    winner: marketSideA(),
    duelEndTs: nowSeconds,
    seed: 77,
  });
  await sleep(61_000);
  await finalizeDuelResult(fightProgram, authority, fixture.duelKey);
  await syncMarketFromDuel(clobProgram as never, fixture.marketState, fixture.duelState);

  lifecycleStatus = "RESOLVED";
  duelPhase = "RESOLUTION";
  invalidateBotCaches(mm);
  await mm.marketMakeCycle();

  const claimedBalance = await clobProgram.account.userBalance.fetchNullable(botUserBalance);
  if (claimedBalance) {
    assert.equal(
      BigInt(claimedBalance.aShares.toString()),
      0n,
      "claim should clear winner shares",
    );
    assert.equal(
      BigInt(claimedBalance.bShares.toString()),
      0n,
      "claim should leave no loser shares",
    );
  }
  assert.ok(
    mm.getActiveOrders().every((order) => order.chainKey !== "solana"),
    "resolved market should leave no open Solana orders",
  );

  console.log("solana runtime smoke complete");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import * as assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";

import {
  SIDE_ASK,
  SIDE_BID,
  airdrop,
  claimClobWinnings,
  createOpenMarketFixture,
  finalizeDuelResult,
  hasProgramError,
  marketSideA,
  placeClobOrder,
  proposeDuelResult,
  syncMarketFromDuel,
  writableAccount,
} from "../tests/clob-test-helpers";

type ScenarioResult = {
  name: string;
  details: Record<string, string | number | boolean>;
};

type RoleWallets = {
  treasury: Keypair;
  marketMaker: Keypair;
  makerOne: Keypair;
  makerTwo: Keypair;
  taker: Keypair;
  mevBot: Keypair;
  retailBot: Keypair;
  arbBot: Keypair;
  arbCounterpartyAsk: Keypair;
  arbCounterpartyBid: Keypair;
  attacker: Keypair;
};

const ORDER_AMOUNT = 1_000_000;
const STARTING_SOL = 8;

function loadAuthority(walletPath: string): Keypair {
  const secret = JSON.parse(readFileSync(walletPath, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function loadProgramIdl(workspaceDir: string, name: string): anchor.Idl {
  return JSON.parse(
    readFileSync(join(workspaceDir, "target", "idl", `${name}.json`), "utf8"),
  ) as anchor.Idl;
}

async function balanceLamports(
  connection: anchor.web3.Connection,
  wallet: Keypair,
): Promise<number> {
  return connection.getBalance(wallet.publicKey, "confirmed");
}

async function fundRoles(
  connection: anchor.web3.Connection,
  roles: RoleWallets,
): Promise<void> {
  await Promise.all(
    Object.values(roles).map((wallet) =>
      airdrop(connection, wallet.publicKey, STARTING_SOL),
    ),
  );
}

async function runLowLiquidityScenario(
  fightProgram: Program<any>,
  clobProgram: Program<any>,
  authority: Keypair,
  roles: RoleWallets,
): Promise<ScenarioResult> {
  const market = await createOpenMarketFixture(
    fightProgram,
    clobProgram,
    authority,
    {
      treasury: roles.treasury.publicKey,
      marketMaker: roles.marketMaker.publicKey,
    },
  );

  const firstAsk = await placeClobOrder(clobProgram, {
    marketState: market.marketState,
    duelState: market.duelState,
    config: market.config,
    treasury: market.treasury,
    marketMaker: market.marketMaker,
    vault: market.vault,
    user: roles.makerOne,
    orderId: 1,
    side: SIDE_ASK,
    price: 650,
    amount: ORDER_AMOUNT,
  });

  const secondAsk = await placeClobOrder(clobProgram, {
    marketState: market.marketState,
    duelState: market.duelState,
    config: market.config,
    treasury: market.treasury,
    marketMaker: market.marketMaker,
    vault: market.vault,
    user: roles.makerTwo,
    orderId: 2,
    side: SIDE_ASK,
    price: 650,
    amount: ORDER_AMOUNT,
    remainingAccounts: [writableAccount(firstAsk.order)],
  });

  const takerBid = await placeClobOrder(clobProgram, {
    marketState: market.marketState,
    duelState: market.duelState,
    config: market.config,
    treasury: market.treasury,
    marketMaker: market.marketMaker,
    vault: market.vault,
    user: roles.taker,
    orderId: 3,
    side: SIDE_BID,
    price: 650,
    amount: ORDER_AMOUNT,
    remainingAccounts: [
      writableAccount(firstAsk.restingLevel),
      writableAccount(firstAsk.order),
      writableAccount(firstAsk.userBalance),
    ],
  });

  const priceLevel = await clobProgram.account.priceLevel.fetch(
    firstAsk.restingLevel,
  );
  const makerOneOrder = await clobProgram.account.order.fetch(firstAsk.order);
  const makerTwoOrder = await clobProgram.account.order.fetch(secondAsk.order);
  const takerBalance = await clobProgram.account.userBalance.fetch(
    takerBid.userBalance,
  );

  assert.equal(priceLevel.headOrderId.toString(), "2");
  assert.equal(priceLevel.totalOpen.toString(), ORDER_AMOUNT.toString());
  assert.equal(makerOneOrder.filled.toString(), ORDER_AMOUNT.toString());
  assert.equal(makerTwoOrder.active, true);
  assert.equal(takerBalance.aShares.toString(), ORDER_AMOUNT.toString());

  return {
    name: "low_liquidity_fifo",
    details: {
      remainingOpenLamports: priceLevel.totalOpen.toString(),
      headOrderId: priceLevel.headOrderId.toString(),
      makerOneFilledLamports: makerOneOrder.filled.toString(),
      makerTwoResting: makerTwoOrder.active,
      takerAShares: takerBalance.aShares.toString(),
    },
  };
}

async function runMevScenario(
  fightProgram: Program<any>,
  clobProgram: Program<any>,
  authority: Keypair,
  roles: RoleWallets,
): Promise<ScenarioResult> {
  const market = await createOpenMarketFixture(
    fightProgram,
    clobProgram,
    authority,
    {
      treasury: roles.treasury.publicKey,
      marketMaker: roles.marketMaker.publicKey,
    },
  );

  const staleAsk = await placeClobOrder(clobProgram, {
    marketState: market.marketState,
    duelState: market.duelState,
    config: market.config,
    treasury: market.treasury,
    marketMaker: market.marketMaker,
    vault: market.vault,
    user: roles.makerOne,
    orderId: 1,
    side: SIDE_ASK,
    price: 450,
    amount: ORDER_AMOUNT,
  });

  const mevFill = await placeClobOrder(clobProgram, {
    marketState: market.marketState,
    duelState: market.duelState,
    config: market.config,
    treasury: market.treasury,
    marketMaker: market.marketMaker,
    vault: market.vault,
    user: roles.mevBot,
    orderId: 2,
    side: SIDE_BID,
    price: 450,
    amount: ORDER_AMOUNT,
    remainingAccounts: [
      writableAccount(staleAsk.restingLevel),
      writableAccount(staleAsk.order),
      writableAccount(staleAsk.userBalance),
    ],
  });

  const retailRestingOrder = await placeClobOrder(clobProgram, {
    marketState: market.marketState,
    duelState: market.duelState,
    config: market.config,
    treasury: market.treasury,
    marketMaker: market.marketMaker,
    vault: market.vault,
    user: roles.retailBot,
    orderId: 3,
    side: SIDE_BID,
    price: 450,
    amount: ORDER_AMOUNT,
  });

  const mevBalance = await clobProgram.account.userBalance.fetch(
    mevFill.userBalance,
  );
  const retailBalance = await clobProgram.account.userBalance.fetch(
    retailRestingOrder.userBalance,
  );
  const marketState = await clobProgram.account.marketState.fetch(
    market.marketState,
  );

  assert.equal(mevBalance.aShares.toString(), ORDER_AMOUNT.toString());
  assert.equal(retailBalance.aShares.toString(), "0");
  assert.equal(marketState.bestBid, 450);

  return {
    name: "mev_quote_sniping",
    details: {
      snipedPrice: 450,
      mevCapturedAShares: mevBalance.aShares.toString(),
      retailRestingBid: marketState.bestBid,
      retailCapturedAShares: retailBalance.aShares.toString(),
    },
  };
}

async function runArbitrageScenario(
  fightProgram: Program<any>,
  clobProgram: Program<any>,
  authority: Keypair,
  roles: RoleWallets,
): Promise<ScenarioResult> {
  const market = await createOpenMarketFixture(
    fightProgram,
    clobProgram,
    authority,
    {
      treasury: roles.treasury.publicKey,
      marketMaker: roles.marketMaker.publicKey,
    },
  );

  const richBid = await placeClobOrder(clobProgram, {
    marketState: market.marketState,
    duelState: market.duelState,
    config: market.config,
    treasury: market.treasury,
    marketMaker: market.marketMaker,
    vault: market.vault,
    user: roles.arbCounterpartyBid,
    orderId: 1,
    side: SIDE_BID,
    price: 700,
    amount: ORDER_AMOUNT,
  });

  await placeClobOrder(clobProgram, {
    marketState: market.marketState,
    duelState: market.duelState,
    config: market.config,
    treasury: market.treasury,
    marketMaker: market.marketMaker,
    vault: market.vault,
    user: roles.arbBot,
    orderId: 2,
    side: SIDE_ASK,
    price: 700,
    amount: ORDER_AMOUNT,
    remainingAccounts: [
      writableAccount(richBid.restingLevel),
      writableAccount(richBid.order),
      writableAccount(richBid.userBalance),
    ],
  });

  const cheapAsk = await placeClobOrder(clobProgram, {
    marketState: market.marketState,
    duelState: market.duelState,
    config: market.config,
    treasury: market.treasury,
    marketMaker: market.marketMaker,
    vault: market.vault,
    user: roles.arbCounterpartyAsk,
    orderId: 3,
    side: SIDE_ASK,
    price: 300,
    amount: ORDER_AMOUNT,
  });

  const arbBuyA = await placeClobOrder(clobProgram, {
    marketState: market.marketState,
    duelState: market.duelState,
    config: market.config,
    treasury: market.treasury,
    marketMaker: market.marketMaker,
    vault: market.vault,
    user: roles.arbBot,
    orderId: 4,
    side: SIDE_BID,
    price: 300,
    amount: ORDER_AMOUNT,
    remainingAccounts: [
      writableAccount(cheapAsk.restingLevel),
      writableAccount(cheapAsk.order),
      writableAccount(cheapAsk.userBalance),
    ],
  });

  const arbBalanceBeforeResolution = await balanceLamports(
    clobProgram.provider.connection,
    roles.arbBot,
  );
  const arbUserBalance = await clobProgram.account.userBalance.fetch(
    arbBuyA.userBalance,
  );
  const combinedStake =
    BigInt(arbUserBalance.aStake.toString()) +
    BigInt(arbUserBalance.bStake.toString());

  assert.equal(arbUserBalance.aShares.toString(), ORDER_AMOUNT.toString());
  assert.equal(arbUserBalance.bShares.toString(), ORDER_AMOUNT.toString());
  assert.ok(
    combinedStake < BigInt(ORDER_AMOUNT),
    `expected discounted dual exposure, got combined stake ${combinedStake}`,
  );

  const now = Math.floor(Date.now() / 1000);
  await proposeDuelResult(fightProgram, authority, market.duelKey, {
    winner: marketSideA(),
    duelEndTs: now + 7200,
    seed: 77,
    metadataUri: "https://hyperbet.local/arbitrage",
  });
  await finalizeDuelResult(fightProgram, authority, market.duelKey);
  await syncMarketFromDuel(clobProgram, market.marketState, market.duelState);
  await claimClobWinnings(clobProgram, {
    marketState: market.marketState,
    duelState: market.duelState,
    config: market.config,
    marketMaker: market.marketMaker,
    vault: market.vault,
    user: roles.arbBot,
  });

  const arbBalanceAfterClaim = await balanceLamports(
    clobProgram.provider.connection,
    roles.arbBot,
  );
  const settledUserBalance = await clobProgram.account.userBalance.fetch(
    arbBuyA.userBalance,
  );
  assert.equal(settledUserBalance.aShares.toString(), "0");
  assert.equal(settledUserBalance.bShares.toString(), "0");

  return {
    name: "crossed_book_arbitrage",
    details: {
      combinedStakeLamports: combinedStake.toString(),
      theoreticalGrossEdgeLamports: (
        BigInt(ORDER_AMOUNT) - combinedStake
      ).toString(),
      balanceBeforeResolution: arbBalanceBeforeResolution,
      balanceAfterClaim: arbBalanceAfterClaim,
      settlementCleared: true,
    },
  };
}

async function runAttackScenario(
  fightProgram: Program<any>,
  clobProgram: Program<any>,
  authority: Keypair,
  roles: RoleWallets,
): Promise<ScenarioResult> {
  const market = await createOpenMarketFixture(
    fightProgram,
    clobProgram,
    authority,
    {
      treasury: roles.treasury.publicKey,
      marketMaker: roles.marketMaker.publicKey,
    },
  );

  const now = Math.floor(Date.now() / 1000);
  try {
    await proposeDuelResult(fightProgram, roles.attacker, market.duelKey, {
      winner: marketSideA(),
      duelEndTs: now + 3600,
      metadataUri: "https://hyperbet.local/unauthorized",
    });
    throw new Error("unauthorized oracle proposal unexpectedly succeeded");
  } catch (error) {
    assert.ok(
      hasProgramError(error, "Unauthorized"),
      `expected unauthorized oracle proposal rejection, got ${String(error)}`,
    );
  }

  return {
    name: "unauthorized_oracle_attack",
    details: {
      rejected: true,
      expectedError: "Unauthorized",
    },
  };
}

async function main(): Promise<void> {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const workspaceDir = join(scriptDir, "..");
  const outputDir =
    process.env.HYPERBET_SIMULATION_OUTPUT_DIR ||
    join(process.cwd(), "simulations");
  const walletPath =
    process.env.ANCHOR_WALLET ?? `${process.env.HOME}/.config/solana/id.json`;

  const authority = loadAuthority(walletPath);
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const fightProgram = new anchor.Program(
    loadProgramIdl(workspaceDir, "fight_oracle"),
    provider,
  ) as Program<any>;
  const clobProgram = new anchor.Program(
    loadProgramIdl(workspaceDir, "gold_clob_market"),
    provider,
  ) as Program<any>;

  const roles: RoleWallets = {
    treasury: Keypair.generate(),
    marketMaker: Keypair.generate(),
    makerOne: Keypair.generate(),
    makerTwo: Keypair.generate(),
    taker: Keypair.generate(),
    mevBot: Keypair.generate(),
    retailBot: Keypair.generate(),
    arbBot: Keypair.generate(),
    arbCounterpartyAsk: Keypair.generate(),
    arbCounterpartyBid: Keypair.generate(),
    attacker: Keypair.generate(),
  };

  await fundRoles(provider.connection, roles);
  const initialBalances = Object.fromEntries(
    await Promise.all(
      Object.entries(roles).map(async ([name, wallet]) => [
        name,
        await balanceLamports(provider.connection, wallet),
      ]),
    ),
  );

  const scenarios = [
    await runLowLiquidityScenario(fightProgram, clobProgram, authority, roles),
    await runMevScenario(fightProgram, clobProgram, authority, roles),
    await runArbitrageScenario(fightProgram, clobProgram, authority, roles),
    await runAttackScenario(fightProgram, clobProgram, authority, roles),
  ];

  const finalBalances = Object.fromEntries(
    await Promise.all(
      Object.entries(roles).map(async ([name, wallet]) => [
        name,
        await balanceLamports(provider.connection, wallet),
      ]),
    ),
  );

  mkdirSync(outputDir, { recursive: true });
  const reportPath = join(outputDir, "solana-localnet-adversarial-report.json");
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        authority: authority.publicKey.toBase58(),
        scenarios,
        initialBalances,
        finalBalances,
      },
      null,
      2,
    ),
  );

  console.log(
    `solana adversarial simulation complete: ${scenarios.length} scenarios -> ${reportPath}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

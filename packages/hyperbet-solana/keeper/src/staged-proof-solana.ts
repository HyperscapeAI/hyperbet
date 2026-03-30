import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import BN from "bn.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { type AccountMeta, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  firstNonEmptyValue,
  resolveReachableSolanaAcceptanceRuntime,
} from "../../../../scripts/testnet-acceptance-env";

import {
  createPrograms,
  DUEL_WINNER_MARKET_KIND,
  duelKeyHexToBytes,
  findAmmBetPda,
  findAmmConfigPda,
  findAmmMintNoPda,
  findAmmMintYesPda,
  findClobVaultPda,
  findDuelStatePda,
  findMarketPda,
  findMarketConfigPda,
  findOrderPda,
  findOracleConfigPda,
  findPerpsConfigPda,
  findPerpsMarketPda,
  findPerpsPositionPda,
  findPriceLevelPda,
  findUserBalancePda,
  ORDER_BEHAVIOR_GTC,
  SIDE_ASK,
  SIDE_BID,
  readKeypair,
  resolveFightOracleProgramId,
} from "./common";

type SolanaPmCanaryResult = {
  marketRef: string;
  upsertTx: string;
  makerOrderTx: string;
  takerOrderTx: string;
  cancelTx: string;
  syncTx: string;
  makerClaimTx: string;
  takerClaimTx: string;
};

type SolanaPerpsCanaryResult = {
  marketId: string;
  marketPda: string;
  updateOracleTx: string;
  depositInsuranceTx: string | null;
  openPositionTx: string;
  closePositionTx: string;
};

type SolanaAmmCanaryResult = {
  betId: string;
  marketRef: string;
  createBetTx: string | null;
  initBetTx: string | null;
  ataSetupTx: string | null;
  buyTx: string;
  reserveYesBefore: string;
  reserveYesAfter: string;
  reserveNoBefore: string;
  reserveNoAfter: string;
};

type SolanaCanaryResult = {
  duelId: string;
  duelKeyHex: string;
  pm: SolanaPmCanaryResult;
  perps: SolanaPerpsCanaryResult;
  amm: SolanaAmmCanaryResult;
};

type MarketStateAccount = {
  bestBid?: unknown;
  bestAsk?: unknown;
  nextOrderId?: unknown;
};

type PriceLevelAccount = {
  totalOpen?: unknown;
  headOrderId?: unknown;
  tailOrderId?: unknown;
};

type OrderAccount = {
  maker?: PublicKey;
  amount?: unknown;
  filled?: unknown;
  nextOrderId?: unknown;
  active?: boolean;
};

type InsuranceFundingSource = {
  label: string;
  keypair: ReturnType<typeof readKeypair>;
  program: Awaited<ReturnType<typeof createPrograms>>["goldPerpsMarket"];
  reserveLamports: bigint;
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (!value) {
    throw new Error(`Missing required env ${name}`);
  }
  return value;
}

function maybeEnv(name: string): string | null {
  const value = process.env[name]?.trim() ?? "";
  return value || null;
}

function maybeAcceptanceEnv(suffix: string): string | null {
  return firstNonEmptyValue(
    process.env[`HYPERBET_SOLANA_TESTNET_${suffix}`],
    process.env[`HYPERBET_SOLANA_STAGING_${suffix}`],
    process.env[suffix],
  );
}

function asBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  if (typeof value === "string") return BigInt(value);
  if (value && typeof value === "object" && "toString" in value) {
    return BigInt(String(value));
  }
  throw new Error(`Cannot convert value to bigint: ${String(value)}`);
}

function lamportsToSolString(value: bigint): string {
  const whole = value / 1_000_000_000n;
  const fraction = value % 1_000_000_000n;
  return `${whole}.${fraction.toString().padStart(9, "0")}`;
}

function maxBigInt(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

function derivePerpsMarketId(duelKeyHex: string): bigint {
  const seed = BigInt(`0x${duelKeyHex.slice(0, 16)}`);
  return (seed % 9_000_000_000n) + 1_000_000_000n;
}

function deriveAmmBetId(duelKeyHex: string): bigint {
  const digest = BigInt(`0x${duelKeyHex.slice(0, 16)}`);
  const timeComponent = BigInt(Date.now()) << 16n;
  return (timeComponent ^ digest) & ((1n << 63n) - 1n);
}

function shaParticipant(label: string): number[] {
  return Array.from(createHash("sha256").update(label).digest());
}

async function buildPlaceOrderRemainingAccounts(args: {
  clobProgram: Awaited<ReturnType<typeof createPrograms>>["goldClobMarket"];
  marketState: PublicKey;
  side: number;
  price: number;
  amount: bigint;
}): Promise<AccountMeta[]> {
  const metas: AccountMeta[] = [];
  const clobAccounts = args.clobProgram.account as Record<
    string,
    { fetch: (pubkey: PublicKey) => Promise<Record<string, unknown>>; fetchNullable: (pubkey: PublicKey) => Promise<Record<string, unknown> | null> }
  >;
  const marketAccount = (await clobAccounts.marketState.fetch(
    args.marketState,
  )) as MarketStateAccount;
  const oppositeSide = args.side === SIDE_BID ? SIDE_ASK : SIDE_BID;
  let remaining = args.amount;
  let boundary =
    args.side === SIDE_BID
      ? Number(marketAccount.bestAsk ?? 1000)
      : Number(marketAccount.bestBid ?? 0);
  let matches = 0;

  while (remaining > 0n && matches < 100) {
    const crosses =
      args.side === SIDE_BID
        ? boundary <= args.price && boundary > 0 && boundary < 1000
        : boundary >= args.price && boundary > 0 && boundary < 1000;
    if (!crosses) break;

    const levelPda = findPriceLevelPda(
      args.clobProgram.programId,
      args.marketState,
      oppositeSide,
      boundary,
    );
    const level = (await clobAccounts.priceLevel.fetchNullable(
      levelPda,
    )) as PriceLevelAccount | null;
    if (!level) break;

    metas.push({
      pubkey: levelPda,
      isSigner: false,
      isWritable: true,
    });

    let currentHead = asBigInt(level.headOrderId ?? 0);
    let currentLevelOpen = asBigInt(level.totalOpen ?? 0);
    if (currentHead === 0n || currentLevelOpen === 0n) {
      boundary = args.side === SIDE_BID ? boundary + 1 : boundary - 1;
      matches += 1;
      continue;
    }

    while (remaining > 0n && currentHead > 0n && currentLevelOpen > 0n) {
      const orderPda = findOrderPda(
        args.clobProgram.programId,
        args.marketState,
        currentHead,
      );
      const order = (await clobAccounts.order.fetch(orderPda)) as OrderAccount;
      const makerBalancePda = findUserBalancePda(
        args.clobProgram.programId,
        args.marketState,
        order.maker as PublicKey,
      );

      metas.push(
        { pubkey: orderPda, isSigner: false, isWritable: true },
        { pubkey: makerBalancePda, isSigner: false, isWritable: true },
      );

      const orderRemaining = asBigInt(order.amount ?? 0) - asBigInt(order.filled ?? 0);
      if (orderRemaining <= 0n || !order.active) {
        break;
      }

      if (orderRemaining >= remaining) {
        remaining = 0n;
        break;
      }

      remaining -= orderRemaining;
      currentLevelOpen -= orderRemaining;
      currentHead = asBigInt(order.nextOrderId ?? 0);
      matches += 1;
      if (remaining > 0n && currentHead > 0n && currentLevelOpen > 0n) {
        metas.push({
          pubkey: levelPda,
          isSigner: false,
          isWritable: true,
        });
      }
    }

    boundary = args.side === SIDE_BID ? boundary + 1 : boundary - 1;
    matches += 1;
  }

  const restingLevelPda = findPriceLevelPda(
    args.clobProgram.programId,
    args.marketState,
    args.side,
    args.price,
  );
  const restingLevel = (await clobAccounts.priceLevel.fetchNullable(
    restingLevelPda,
  )) as PriceLevelAccount | null;
  if (restingLevel && asBigInt(restingLevel.tailOrderId ?? 0) > 0n) {
    metas.push({
      pubkey: findOrderPda(
        args.clobProgram.programId,
        args.marketState,
        asBigInt(restingLevel.tailOrderId ?? 0),
      ),
      isSigner: false,
      isWritable: true,
    });
  }

  return metas;
}

async function ensureAssociatedTokenAccounts(args: {
  connection: Awaited<ReturnType<typeof createPrograms>>["connection"];
  payer: PublicKey;
  signers: Parameters<Awaited<ReturnType<typeof createPrograms>>["provider"]["sendAndConfirm"]>[1];
  provider: Awaited<ReturnType<typeof createPrograms>>["provider"];
  owner: PublicKey;
  mintYes: PublicKey;
  mintNo: PublicKey;
}): Promise<{ destinationYes: PublicKey; destinationNo: PublicKey; ataSetupTx: string | null }> {
  const destinationYes = getAssociatedTokenAddressSync(args.mintYes, args.owner, true);
  const destinationNo = getAssociatedTokenAddressSync(args.mintNo, args.owner, true);
  const instructions = [];
  const [yesInfo, noInfo] = await Promise.all([
    args.connection.getAccountInfo(destinationYes, "confirmed"),
    args.connection.getAccountInfo(destinationNo, "confirmed"),
  ]);

  if (!yesInfo) {
    instructions.push(
      createAssociatedTokenAccountInstruction(
        args.payer,
        destinationYes,
        args.owner,
        args.mintYes,
      ),
    );
  }
  if (!noInfo) {
    instructions.push(
      createAssociatedTokenAccountInstruction(
        args.payer,
        destinationNo,
        args.owner,
        args.mintNo,
      ),
    );
  }

  let ataSetupTx: string | null = null;
  if (instructions.length > 0) {
    const tx = new Transaction().add(...instructions);
    ataSetupTx = await args.provider.sendAndConfirm(tx, args.signers);
  }

  return { destinationYes, destinationNo, ataSetupTx };
}

async function ensureRentExemptSystemAccount(args: {
  connection: Awaited<ReturnType<typeof createPrograms>>["connection"];
  payer: PublicKey;
  signers: Parameters<Awaited<ReturnType<typeof createPrograms>>["provider"]["sendAndConfirm"]>[1];
  provider: Awaited<ReturnType<typeof createPrograms>>["provider"];
  target: PublicKey;
}): Promise<void> {
  const minimumBalance =
    await args.connection.getMinimumBalanceForRentExemption(0);
  const currentBalance = await args.connection.getBalance(args.target, "confirmed");
  if (currentBalance >= minimumBalance) {
    return;
  }

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: args.payer,
      toPubkey: args.target,
      lamports: minimumBalance - currentBalance,
    }),
  );
  await args.provider.sendAndConfirm(tx, args.signers);
}

async function topUpPerpsInsurance(args: {
  marketIdBn: BN;
  marketPda: PublicKey;
  targetInsuranceLamports: bigint;
  authorityProgram: Awaited<ReturnType<typeof createPrograms>>["goldPerpsMarket"];
  fundingSources: InsuranceFundingSource[];
}): Promise<string[]> {
  const insuranceTxs: string[] = [];
  const marketBefore = await args.authorityProgram.account.marketState.fetch(
    args.marketPda,
  );
  let remaining =
    args.targetInsuranceLamports - asBigInt(marketBefore.insuranceFund);
  console.error(
    `[solana-canary] perps insurance before=${lamportsToSolString(asBigInt(marketBefore.insuranceFund))} target=${lamportsToSolString(args.targetInsuranceLamports)} remaining=${lamportsToSolString(remaining > 0n ? remaining : 0n)}`,
  );
  if (remaining <= 0n) {
    return insuranceTxs;
  }

  for (const source of args.fundingSources) {
    if (remaining <= 0n) {
      break;
    }
    const balance = BigInt(
      await source.program.provider.connection.getBalance(
        source.keypair.publicKey,
        "confirmed",
      ),
    );
    const available =
      balance > source.reserveLamports ? balance - source.reserveLamports : 0n;
    console.error(
      `[solana-canary] insurance source=${source.label} balance=${lamportsToSolString(balance)} reserve=${lamportsToSolString(source.reserveLamports)} available=${lamportsToSolString(available)}`,
    );
    if (available <= 0n) {
      continue;
    }
    const depositAmount = available >= remaining ? remaining : available;
    const tx = await source.program.methods
      .depositInsurance(args.marketIdBn, new BN(depositAmount.toString()))
      .accountsPartial({
        market: args.marketPda,
        payer: source.keypair.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([source.keypair])
      .rpc();
    insuranceTxs.push(tx);
    console.error(
      `[solana-canary] insurance deposit source=${source.label} amount=${lamportsToSolString(depositAmount)} tx=${tx}`,
    );
    remaining -= depositAmount;
  }

  if (remaining > 0n) {
    throw new Error(
      `solana perps insurance shortfall: need ${remaining.toString()} lamports (${lamportsToSolString(remaining)} SOL) more after local wallet aggregation`,
    );
  }

  return insuranceTxs;
}

async function main(): Promise<void> {
  const previousEnv = {
    SOLANA_RPC_URL: process.env.SOLANA_RPC_URL,
    SOLANA_CLUSTER: process.env.SOLANA_CLUSTER,
    FIGHT_ORACLE_PROGRAM_ID: process.env.FIGHT_ORACLE_PROGRAM_ID,
    GOLD_CLOB_MARKET_PROGRAM_ID: process.env.GOLD_CLOB_MARKET_PROGRAM_ID,
    GOLD_AMM_MARKET_PROGRAM_ID: process.env.GOLD_AMM_MARKET_PROGRAM_ID,
    GOLD_PERPS_MARKET_PROGRAM_ID: process.env.GOLD_PERPS_MARKET_PROGRAM_ID,
  };

  const runtime = await resolveReachableSolanaAcceptanceRuntime(process.env);
  process.env.SOLANA_RPC_URL = runtime.rpcUrl;
  process.env.SOLANA_CLUSTER = runtime.cluster;
  process.env.FIGHT_ORACLE_PROGRAM_ID = runtime.fightOracleProgramId;
  process.env.GOLD_CLOB_MARKET_PROGRAM_ID = runtime.goldClobProgramId;
  process.env.GOLD_AMM_MARKET_PROGRAM_ID = runtime.goldAmmProgramId;
  process.env.GOLD_PERPS_MARKET_PROGRAM_ID = runtime.goldPerpsProgramId;

  try {
    const duelId = requireEnv("HYPERBET_STAGED_PROOF_DUEL_ID");
    const duelKeyHex = requireEnv("HYPERBET_STAGED_PROOF_DUEL_KEY")
      .replace(/^0x/i, "")
      .toLowerCase();
    const duelKey = duelKeyHexToBytes(duelKeyHex);
    const authorityKeypairPath = runtime.anchorWallet ?? runtime.oracleAuthorityKeypair;
    if (!authorityKeypairPath || !runtime.canaryKeypair || !runtime.marketMakerKeypair) {
      throw new Error("Solana acceptance wallet env is incomplete");
    }
    const authority = readKeypair(authorityKeypairPath);
    const trader = readKeypair(runtime.canaryKeypair);
    const matcher = readKeypair(runtime.marketMakerKeypair);

    const authorityPrograms = createPrograms(authority);
    const traderPrograms = createPrograms(trader);
    const matcherPrograms = createPrograms(matcher);
    const oracleFundingKeypair =
      runtime.oracleAuthorityKeypair &&
      runtime.oracleAuthorityKeypair !== authorityKeypairPath
        ? readKeypair(runtime.oracleAuthorityKeypair)
        : null;
    const oracleFundingPrograms = oracleFundingKeypair
      ? createPrograms(oracleFundingKeypair)
      : null;
    const fightOracleProgramId = resolveFightOracleProgramId();
    const fightOracle = authorityPrograms.fightOracle;
    const clobProgram = traderPrograms.goldClobMarket;
    const perpsAuthorityProgram = authorityPrograms.goldPerpsMarket;
    const perpsTraderProgram = traderPrograms.goldPerpsMarket;
    const ammAuthorityProgram = authorityPrograms.goldAmmMarket;
    const ammTraderProgram = traderPrograms.goldAmmMarket;

    if (!ammAuthorityProgram || !ammTraderProgram) {
      throw new Error("Solana AMM program is not configured for staged proof");
    }

    const duelState = findDuelStatePda(fightOracleProgramId, duelKey);
    const oracleConfig = findOracleConfigPda(fightOracleProgramId);

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

    const marketState = findMarketPda(clobProgram.programId, duelState);
    const configPda = findMarketConfigPda(clobProgram.programId);
    const vaultPda = findClobVaultPda(clobProgram.programId, marketState);
    const existingMarket =
      await authorityPrograms.goldClobMarket.account.marketState.fetchNullable(marketState);
    if (!existingMarket) {
      await authorityPrograms.goldClobMarket.methods
        .initializeMarket(Array.from(duelKey), DUEL_WINNER_MARKET_KIND)
        .accountsPartial({
          operator: authority.publicKey,
          config: configPda,
          duelState,
          marketState,
          vault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();
    }
    await ensureRentExemptSystemAccount({
      connection: authorityPrograms.connection,
      payer: authority.publicKey,
      signers: [authority],
      provider: authorityPrograms.provider,
      target: vaultPda,
    });

    const marketAccount = await clobProgram.account.marketState.fetch(marketState);
    const config = await clobProgram.account.marketConfig.fetch(configPda);
    const takerUserBalance = findUserBalancePda(
      clobProgram.programId,
      marketState,
      trader.publicKey,
    );
    const makerUserBalance = findUserBalancePda(
      matcherPrograms.goldClobMarket.programId,
      marketState,
      matcher.publicKey,
    );
    const makerAmount = BigInt(
      (
        maybeAcceptanceEnv("CANARY_ORDER_LAMPORTS") ??
        "1000000"
      ).trim(),
    );
    const makerOrderId = BigInt(marketAccount.nextOrderId.toString());
    const makerOrderTx = await matcherPrograms.goldClobMarket.methods
      .placeOrder(
        new BN(makerOrderId.toString()),
        SIDE_ASK,
        600,
        new BN(makerAmount.toString()),
        ORDER_BEHAVIOR_GTC,
      )
      .accountsPartial({
        marketState,
        duelState,
        userBalance: makerUserBalance,
        newOrder: findOrderPda(clobProgram.programId, marketState, makerOrderId),
        restingLevel: findPriceLevelPda(clobProgram.programId, marketState, SIDE_ASK, 600),
        config: configPda,
        treasury: config.treasury,
        marketMaker: config.marketMaker,
        vault: vaultPda,
        user: matcher.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([matcher])
      .rpc();

    const refreshedMarket = await clobProgram.account.marketState.fetch(marketState);
    const takerOrderId = BigInt(refreshedMarket.nextOrderId.toString());
    const remainingAccounts = await buildPlaceOrderRemainingAccounts({
      clobProgram,
      marketState,
      side: SIDE_BID,
      price: 600,
      amount: makerAmount,
    });
    const takerOrderTx = await clobProgram.methods
      .placeOrder(
        new BN(takerOrderId.toString()),
        SIDE_BID,
        600,
        new BN(makerAmount.toString()),
        ORDER_BEHAVIOR_GTC,
      )
      .accountsPartial({
        marketState,
        duelState,
        userBalance: takerUserBalance,
        newOrder: findOrderPda(clobProgram.programId, marketState, takerOrderId),
        restingLevel: findPriceLevelPda(clobProgram.programId, marketState, SIDE_BID, 600),
        config: configPda,
        treasury: config.treasury,
        marketMaker: config.marketMaker,
        vault: vaultPda,
        user: trader.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(remainingAccounts)
      .signers([trader])
      .rpc();

    const makerBalanceAfterMatch =
      await matcherPrograms.goldClobMarket.account.userBalance.fetchNullable(makerUserBalance);
    const takerBalanceAfterMatch =
      await traderPrograms.goldClobMarket.account.userBalance.fetchNullable(takerUserBalance);
    if (
      asBigInt(makerBalanceAfterMatch?.bShares ?? 0) <= 0n ||
      asBigInt(takerBalanceAfterMatch?.aShares ?? 0) <= 0n
    ) {
      throw new Error("solana PM matched trade did not create expected maker/taker exposure");
    }

    const cancelTx = await fightOracle.methods
      .cancelDuel(Array.from(duelKey), "staged-live-proof-cancelled")
      .accountsPartial({
        authority: authority.publicKey,
        oracleConfig,
        duelState,
      })
      .signers([authority])
      .rpc();

    const syncTx = await traderPrograms.goldClobMarket.methods
      .syncMarketFromDuel()
      .accountsPartial({
        marketState,
        duelState,
      })
      .rpc();

    const cancelledMarket = await clobProgram.account.marketState.fetch(marketState);
    if (!("cancelled" in (cancelledMarket.status as Record<string, unknown>))) {
      throw new Error("solana PM market did not enter cancelled status");
    }

    const makerClaimTx = await matcherPrograms.goldClobMarket.methods
      .claim()
      .accountsPartial({
        marketState,
        duelState,
        userBalance: makerUserBalance,
        config: configPda,
        marketMaker: config.marketMaker,
        vault: vaultPda,
        user: matcher.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([matcher])
      .rpc();

    const takerClaimTx = await traderPrograms.goldClobMarket.methods
      .claim()
      .accountsPartial({
        marketState,
        duelState,
        userBalance: takerUserBalance,
        config: configPda,
        marketMaker: config.marketMaker,
        vault: vaultPda,
        user: trader.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();

    const makerBalanceAfterClaim =
      await matcherPrograms.goldClobMarket.account.userBalance.fetchNullable(makerUserBalance);
    const takerBalanceAfterClaim =
      await traderPrograms.goldClobMarket.account.userBalance.fetchNullable(takerUserBalance);
    const makerAShares = asBigInt(makerBalanceAfterClaim?.aShares ?? 0);
    const makerBShares = asBigInt(makerBalanceAfterClaim?.bShares ?? 0);
    const takerAShares = asBigInt(takerBalanceAfterClaim?.aShares ?? 0);
    const takerBShares = asBigInt(takerBalanceAfterClaim?.bShares ?? 0);
    if (
      makerAShares !== 0n ||
      makerBShares !== 0n ||
      takerAShares !== 0n ||
      takerBShares !== 0n
    ) {
      throw new Error(
        `solana claim cleanup incomplete: maker=${makerAShares}:${makerBShares} taker=${takerAShares}:${takerBShares}`,
      );
    }

    const configuredPerpsMarketId = maybeAcceptanceEnv("CANARY_PERPS_MARKET_ID");
    const perpsMarketId =
      configuredPerpsMarketId !== null
        ? BigInt(configuredPerpsMarketId.trim())
        : derivePerpsMarketId(duelKeyHex);
    const perpsMarketIdBn = new BN(perpsMarketId.toString());
    const perpsConfigPda = findPerpsConfigPda(perpsAuthorityProgram.programId);
    const perpsMarketPda = findPerpsMarketPda(
      perpsAuthorityProgram.programId,
      perpsMarketId,
    );
    const perpsPositionPda = findPerpsPositionPda(
      perpsTraderProgram.programId,
      trader.publicKey,
      perpsMarketId,
    );
    const perpsConfig =
      await perpsAuthorityProgram.account.configState.fetchNullable(perpsConfigPda);
    if (!perpsConfig) {
      throw new Error("solana perps config missing for staged proof");
    }
    const configuredSpotIndex = maybeAcceptanceEnv("CANARY_PERPS_SPOT_INDEX");
    const defaultSpotIndex =
      (asBigInt(perpsConfig.minOracleSpotIndex) +
        asBigInt(perpsConfig.maxOracleSpotIndex)) / 2n;

    const buildUpdateOracleInstruction = () =>
      perpsAuthorityProgram.methods
        .updateMarketOracle(
          perpsMarketIdBn,
          new BN(
            (configuredSpotIndex ?? defaultSpotIndex.toString()).trim(),
          ),
          new BN(
            (maybeAcceptanceEnv("CANARY_PERPS_MU") ?? "1000000000").trim(),
          ),
          new BN(
            (maybeAcceptanceEnv("CANARY_PERPS_SIGMA") ?? "100000000").trim(),
          ),
        )
        .accountsPartial({
          config: perpsConfigPda,
          market: perpsMarketPda,
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .instruction();

    const sendPerpsTx = async (args: {
      marginDelta: bigint;
      sizeDelta: bigint;
    }): Promise<string> => {
      const tx = new Transaction().add(
        await buildUpdateOracleInstruction(),
        await perpsTraderProgram.methods
          .modifyPosition(
            perpsMarketIdBn,
            new BN(args.marginDelta.toString()),
            new BN(args.sizeDelta.toString()),
            new BN(0),
          )
          .accountsPartial({
            config: perpsConfigPda,
            market: perpsMarketPda,
            position: perpsPositionPda,
            trader: trader.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .instruction(),
      );
      tx.feePayer = authority.publicKey;
      return authorityPrograms.provider.sendAndConfirm(tx, [authority, trader]);
    };

    let updateOracleTx = await perpsAuthorityProgram.methods
      .updateMarketOracle(
        perpsMarketIdBn,
        new BN(
          (configuredSpotIndex ?? defaultSpotIndex.toString()).trim(),
        ),
        new BN(
          (maybeAcceptanceEnv("CANARY_PERPS_MU") ?? "1000000000").trim(),
        ),
        new BN(
          (maybeAcceptanceEnv("CANARY_PERPS_SIGMA") ?? "100000000").trim(),
        ),
      )
      .accountsPartial({
        config: perpsConfigPda,
        market: perpsMarketPda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    const perpsMinInsuranceLamports = BigInt(
      (
        maybeAcceptanceEnv("CANARY_PERPS_MIN_INSURANCE_LAMPORTS") ?? "12000000000"
      ).trim(),
    );
    const insuranceFundingSources: InsuranceFundingSource[] = [
      {
        label: "authority",
        keypair: authority,
        program: perpsAuthorityProgram,
        reserveLamports: 1_200_000_000n,
      },
      {
        label: "canary",
        keypair: trader,
        program: perpsTraderProgram,
        reserveLamports: 100_000_000n,
      },
      {
        label: "market-maker",
        keypair: matcher,
        program: matcherPrograms.goldPerpsMarket,
        reserveLamports: 50_000_000n,
      },
    ];
    if (oracleFundingPrograms) {
      insuranceFundingSources.push({
        label: "oracle-authority",
        keypair: oracleFundingKeypair!,
        program: oracleFundingPrograms.goldPerpsMarket,
        reserveLamports: 10_000_000n,
      });
    }
    const depositInsuranceTxs = await topUpPerpsInsurance({
      marketIdBn: perpsMarketIdBn,
      marketPda: perpsMarketPda,
      targetInsuranceLamports: perpsMinInsuranceLamports,
      authorityProgram: perpsAuthorityProgram,
      fundingSources: insuranceFundingSources,
    });
    const depositInsuranceTx =
      depositInsuranceTxs.length > 0 ? depositInsuranceTxs.at(-1) ?? null : null;

    const existingPosition =
      await perpsTraderProgram.account.positionState.fetchNullable(perpsPositionPda);
    const existingSize = asBigInt(existingPosition?.size ?? 0);
    if (existingSize !== 0n) {
      await sendPerpsTx({
        marginDelta: 0n,
        sizeDelta: -existingSize,
      });
    }

    const perpsSizeDelta = BigInt(
      (
        maybeAcceptanceEnv("CANARY_PERPS_SIZE_LAMPORTS") ?? "500000000"
      ).trim(),
    );
    const configuredPerpsMarginDelta = BigInt(
      (
        maybeAcceptanceEnv("CANARY_PERPS_MARGIN_LAMPORTS") ?? "0"
      ).trim(),
    );
    const tradeFeeBps =
      asBigInt(perpsConfig.tradeTreasuryFeeBps) +
      asBigInt(perpsConfig.tradeMarketMakerFeeBps);
    const minOpenMargin =
      ((perpsSizeDelta < 0n ? -perpsSizeDelta : perpsSizeDelta) * tradeFeeBps) /
        10_000n +
      asBigInt(perpsConfig.minMarginLamports) +
      1_000_000n;
    const perpsMarginDelta = maxBigInt(configuredPerpsMarginDelta, minOpenMargin);
    const openPositionTx = await sendPerpsTx({
      marginDelta: perpsMarginDelta,
      sizeDelta: perpsSizeDelta,
    });

    const openedPosition = await perpsTraderProgram.account.positionState.fetch(
      perpsPositionPda,
    );
    if (asBigInt(openedPosition.size) !== perpsSizeDelta) {
      throw new Error("solana perps canary failed to open expected position size");
    }

    const closePositionTx = await sendPerpsTx({
      marginDelta: 0n,
      sizeDelta: -perpsSizeDelta,
    });

    const closedPosition =
      await perpsTraderProgram.account.positionState.fetchNullable(perpsPositionPda);
    if (closedPosition && asBigInt(closedPosition.size) !== 0n) {
      throw new Error("solana perps canary position did not close to zero");
    }

    const perpsMarketAfter = await perpsAuthorityProgram.account.marketState.fetch(
      perpsMarketPda,
    );
    if (
      !perpsMarketAfter.initialized ||
      Number(perpsMarketAfter.status) !== 0 ||
      asBigInt(perpsMarketAfter.badDebt) !== 0n
    ) {
      throw new Error("solana perps canary left market in unhealthy state");
    }

    const ammConfigPda = findAmmConfigPda(ammAuthorityProgram.programId);
    const ammConfig =
      await (ammAuthorityProgram.account as any).ammConfig.fetchNullable(ammConfigPda);
    if (!ammConfig) {
      throw new Error("solana AMM config missing for staged proof");
    }

    const betId = deriveAmmBetId(duelKeyHex);
    const betIdBn = new BN(betId.toString());
    const betPda = findAmmBetPda(ammAuthorityProgram.programId, betId, authority.publicKey);
    const mintYes = findAmmMintYesPda(
      ammAuthorityProgram.programId,
      betId,
      authority.publicKey,
    );
    const mintNo = findAmmMintNoPda(
      ammAuthorityProgram.programId,
      betId,
      authority.publicKey,
    );

    let createBetTx: string | null = null;
    let initBetTx: string | null = null;
    const existingBet = await (ammAuthorityProgram.account as any).bet.fetchNullable(betPda);
    if (!existingBet) {
      const initialLiquidity = BigInt(
        (
          maybeAcceptanceEnv("CANARY_AMM_INITIAL_LIQUIDITY") ?? "10000000"
        ).trim(),
      );
      const expirationAt = now + 900;
      createBetTx = await ammAuthorityProgram.methods
        .createBetAccount(
          betIdBn,
          new BN(initialLiquidity.toString()),
          false,
          `staged-live-proof-${duelId}`,
          new BN(expirationAt.toString()),
          Array.from(duelKey),
        )
        .accountsPartial({
          signer: authority.publicKey,
          ammConfig: ammConfigPda,
          bet: betPda,
          mintYes,
          mintNo,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      initBetTx = await ammAuthorityProgram.methods
        .initBetAccount(betIdBn)
        .accountsPartial({
          signer: authority.publicKey,
          bet: betPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();
    }

    const betBefore = await (ammAuthorityProgram.account as any).bet.fetch(betPda);
    const expirationAt = Number(asBigInt(betBefore.expirationAt));
    if (!betBefore.isInitialized || expirationAt <= now) {
      throw new Error("solana AMM canary bet is not initialized and tradable");
    }

    const { destinationYes, destinationNo, ataSetupTx } =
      await ensureAssociatedTokenAccounts({
        connection: traderPrograms.connection,
        payer: trader.publicKey,
        provider: traderPrograms.provider,
        signers: [trader],
        owner: trader.publicKey,
        mintYes,
        mintNo,
      });

    const reserveYesBefore = asBigInt(betBefore.reserves[0]);
    const reserveNoBefore = asBigInt(betBefore.reserves[1]);
    const ammTradeAmount = BigInt(
      (maybeAcceptanceEnv("CANARY_AMM_BUY_LAMPORTS") ?? "1000000").trim(),
    );
    const buyTx = await ammTraderProgram.methods
      .buy(betIdBn, 0, new BN(ammTradeAmount.toString()))
      .accountsPartial({
        signer: trader.publicKey,
        ammConfig: ammConfigPda,
        bet: betPda,
        mintYes,
        mintNo,
        destinationYes,
        destinationNo,
        treasury: new PublicKey(ammConfig.treasury),
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([trader])
      .rpc();

    const betAfter = await (ammAuthorityProgram.account as any).bet.fetch(betPda);
    const reserveYesAfter = asBigInt(betAfter.reserves[0]);
    const reserveNoAfter = asBigInt(betAfter.reserves[1]);
    if (reserveYesBefore === reserveYesAfter && reserveNoBefore === reserveNoAfter) {
      throw new Error("solana AMM canary trade did not move reserves");
    }

    const yesBalance = await traderPrograms.connection.getTokenAccountBalance(
      destinationYes,
      "confirmed",
    );
    if (BigInt(yesBalance.value.amount) <= 0n) {
      throw new Error("solana AMM canary trader received no YES inventory");
    }

    const result: SolanaCanaryResult = {
      duelId,
      duelKeyHex,
      pm: {
        marketRef: marketState.toBase58(),
        upsertTx,
        makerOrderTx,
        takerOrderTx,
        cancelTx,
        syncTx,
        makerClaimTx,
        takerClaimTx,
      },
      perps: {
        marketId: perpsMarketId.toString(),
        marketPda: perpsMarketPda.toBase58(),
        updateOracleTx,
        depositInsuranceTx,
        openPositionTx,
        closePositionTx,
      },
      amm: {
        betId: betId.toString(),
        marketRef: betPda.toBase58(),
        createBetTx,
        initBetTx,
        ataSetupTx,
        buyTx,
        reserveYesBefore: reserveYesBefore.toString(),
        reserveYesAfter: reserveYesAfter.toString(),
        reserveNoBefore: reserveNoBefore.toString(),
        reserveNoAfter: reserveNoAfter.toString(),
      },
    };
    console.log(JSON.stringify(result));
  } finally {
    const keys = Object.keys(previousEnv) as Array<keyof typeof previousEnv>;
    for (const key of keys) {
      const previous = previousEnv[key];
      if (previous === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous;
      }
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

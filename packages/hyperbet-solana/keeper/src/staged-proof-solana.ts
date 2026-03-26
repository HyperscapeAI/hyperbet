import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import BN from "bn.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

import {
  createPrograms,
  duelKeyHexToBytes,
  findAmmBetPda,
  findAmmConfigPda,
  findAmmMintNoPda,
  findAmmMintYesPda,
  findClobVaultPda,
  findDuelStatePda,
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
  readKeypair,
  resolveFightOracleProgramId,
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

type SolanaPmCanaryResult = {
  marketRef: string;
  upsertTx: string;
  placeOrderTx: string;
  cancelTx: string;
  syncTx: string;
  claimTx: string;
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

function asBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  if (typeof value === "string") return BigInt(value);
  if (value && typeof value === "object" && "toString" in value) {
    return BigInt(String(value));
  }
  throw new Error(`Cannot convert value to bigint: ${String(value)}`);
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

async function publishControlledState(duelId: string, duelKeyHex: string): Promise<void> {
  const keeperUrl = requireEnv("HYPERBET_SOLANA_KEEPER_STAGING_URL").replace(/\/$/, "");
  const publishKey = requireEnv("HYPERBET_SOLANA_STAGING_STREAM_PUBLISH_KEY");
  await requestJson(`${keeperUrl}/api/streaming/state/publish`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-arena-write-key": publishKey,
    },
    body: JSON.stringify(buildControlledCycle(duelId, duelKeyHex)),
  });
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

async function main(): Promise<void> {
  const previousEnv = {
    SOLANA_RPC_URL: process.env.SOLANA_RPC_URL,
    SOLANA_CLUSTER: process.env.SOLANA_CLUSTER,
    FIGHT_ORACLE_PROGRAM_ID: process.env.FIGHT_ORACLE_PROGRAM_ID,
    GOLD_CLOB_MARKET_PROGRAM_ID: process.env.GOLD_CLOB_MARKET_PROGRAM_ID,
    GOLD_AMM_MARKET_PROGRAM_ID: process.env.GOLD_AMM_MARKET_PROGRAM_ID,
    GOLD_PERPS_MARKET_PROGRAM_ID: process.env.GOLD_PERPS_MARKET_PROGRAM_ID,
  };

  process.env.SOLANA_RPC_URL = requireEnv("HYPERBET_SOLANA_STAGING_RPC_URL");
  process.env.SOLANA_CLUSTER =
    maybeEnv("HYPERBET_SOLANA_STAGING_CLUSTER") ?? "devnet";
  const stagedFightOracleProgramId = maybeEnv(
    "HYPERBET_SOLANA_STAGING_FIGHT_ORACLE_PROGRAM_ID",
  );
  if (stagedFightOracleProgramId) {
    process.env.FIGHT_ORACLE_PROGRAM_ID = stagedFightOracleProgramId;
  }
  process.env.GOLD_CLOB_MARKET_PROGRAM_ID = requireEnv(
    "HYPERBET_SOLANA_STAGING_GOLD_CLOB_PROGRAM_ID",
  );
  process.env.GOLD_AMM_MARKET_PROGRAM_ID = requireEnv(
    "HYPERBET_SOLANA_STAGING_GOLD_AMM_PROGRAM_ID",
  );
  process.env.GOLD_PERPS_MARKET_PROGRAM_ID = requireEnv(
    "HYPERBET_SOLANA_STAGING_GOLD_PERPS_PROGRAM_ID",
  );

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
        ORDER_BEHAVIOR_GTC,
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

    await waitFor(
      "solana lifecycle cancelled",
      async () =>
        requestJson<PredictionMarketsResponse>(
          `${keeperUrl}/api/arena/prediction-markets/active`,
        ),
      (payload) => findCanonicalMarket(payload)?.lifecycleStatus === "CANCELLED",
    );

    const claimTx = await traderPrograms.goldClobMarket.methods
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
      await traderPrograms.goldClobMarket.account.userBalance.fetchNullable(userBalance);
    const aShares = BigInt(balanceAfter?.aShares?.toString?.() ?? "0");
    const bShares = BigInt(balanceAfter?.bShares?.toString?.() ?? "0");
    if (aShares !== 0n || bShares !== 0n) {
      throw new Error(`solana claim cleanup incomplete: ${aShares}:${bShares}`);
    }

    const perpsMarketId = derivePerpsMarketId(duelKeyHex);
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

    const updateOracleTx = await perpsAuthorityProgram.methods
      .updateMarketOracle(
        perpsMarketIdBn,
        new BN(
          (process.env.HYPERBET_SOLANA_STAGING_CANARY_PERPS_SPOT_INDEX ?? "1000000000").trim(),
        ),
        new BN(
          (process.env.HYPERBET_SOLANA_STAGING_CANARY_PERPS_MU ?? "1000000000").trim(),
        ),
        new BN(
          (process.env.HYPERBET_SOLANA_STAGING_CANARY_PERPS_SIGMA ?? "100000000").trim(),
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
        process.env.HYPERBET_SOLANA_STAGING_CANARY_PERPS_MIN_INSURANCE_LAMPORTS ??
        "12000000000"
      ).trim(),
    );
    const perpsMarketBefore = await perpsAuthorityProgram.account.marketState.fetch(
      perpsMarketPda,
    );
    let depositInsuranceTx: string | null = null;
    const currentInsurance = asBigInt(perpsMarketBefore.insuranceFund);
    if (currentInsurance < perpsMinInsuranceLamports) {
      const depositAmount = perpsMinInsuranceLamports - currentInsurance;
      depositInsuranceTx = await perpsAuthorityProgram.methods
        .depositInsurance(perpsMarketIdBn, new BN(depositAmount.toString()))
        .accountsPartial({
          market: perpsMarketPda,
          payer: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();
    }

    const existingPosition =
      await perpsTraderProgram.account.positionState.fetchNullable(perpsPositionPda);
    const existingSize = asBigInt(existingPosition?.size ?? 0);
    if (existingSize !== 0n) {
      await perpsTraderProgram.methods
        .modifyPosition(
          perpsMarketIdBn,
          new BN(0),
          new BN((-existingSize).toString()),
          new BN(0),
        )
        .accountsPartial({
          config: perpsConfigPda,
          market: perpsMarketPda,
          position: perpsPositionPda,
          trader: trader.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([trader])
        .rpc();
    }

    const perpsMarginDelta = BigInt(
      (
        process.env.HYPERBET_SOLANA_STAGING_CANARY_PERPS_MARGIN_LAMPORTS ??
        "250000000"
      ).trim(),
    );
    const perpsSizeDelta = BigInt(
      (
        process.env.HYPERBET_SOLANA_STAGING_CANARY_PERPS_SIZE_LAMPORTS ??
        "500000000"
      ).trim(),
    );
    const openPositionTx = await perpsTraderProgram.methods
      .modifyPosition(
        perpsMarketIdBn,
        new BN(perpsMarginDelta.toString()),
        new BN(perpsSizeDelta.toString()),
        new BN(0),
      )
      .accountsPartial({
        config: perpsConfigPda,
        market: perpsMarketPda,
        position: perpsPositionPda,
        trader: trader.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();

    const openedPosition = await perpsTraderProgram.account.positionState.fetch(
      perpsPositionPda,
    );
    if (asBigInt(openedPosition.size) !== perpsSizeDelta) {
      throw new Error("solana perps canary failed to open expected position size");
    }

    const closePositionTx = await perpsTraderProgram.methods
      .modifyPosition(
        perpsMarketIdBn,
        new BN(0),
        new BN((-perpsSizeDelta).toString()),
        new BN(0),
      )
      .accountsPartial({
        config: perpsConfigPda,
        market: perpsMarketPda,
        position: perpsPositionPda,
        trader: trader.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();

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
          process.env.HYPERBET_SOLANA_STAGING_CANARY_AMM_INITIAL_LIQUIDITY ??
          "1000000000"
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
      (process.env.HYPERBET_SOLANA_STAGING_CANARY_AMM_BUY_LAMPORTS ?? "1000000").trim(),
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
        marketRef: market.marketRef,
        upsertTx,
        placeOrderTx,
        cancelTx,
        syncTx,
        claimTx,
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
  await main();
}

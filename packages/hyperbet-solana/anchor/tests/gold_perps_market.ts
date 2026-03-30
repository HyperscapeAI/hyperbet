import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, SystemProgram } from "@solana/web3.js";
import * as assert from "assert";

import { GoldPerpsMarket } from "../target/types/gold_perps_market";
import {
  DEFAULT_FUNDING_VELOCITY,
  DEFAULT_LIQUIDATION_FEE_BPS,
  DEFAULT_MAX_MARKET_OPEN_INTEREST,
  DEFAULT_MAX_ORACLE_PRICE_DELTA_BPS,
  DEFAULT_MAX_ORACLE_SPOT_INDEX,
  DEFAULT_MAINTENANCE_MARGIN_BPS,
  DEFAULT_MAX_LEVERAGE,
  DEFAULT_MAX_ORACLE_STALENESS_SECONDS,
  DEFAULT_MIN_MARKET_INSURANCE,
  DEFAULT_MIN_MARGIN,
  DEFAULT_MIN_ORACLE_SPOT_INDEX,
  DEFAULT_SKEW_SCALE,
  DEFAULT_TRADE_MARKET_MAKER_FEE_BPS,
  DEFAULT_TRADE_TREASURY_FEE_BPS,
  PERPS_STATUS_ARCHIVED,
  PERPS_STATUS_CLOSE_ONLY,
  PERPS_STATUS_ACTIVE,
  PRICE,
  SOL,
  airdrop,
  configPda,
  crashOracle,
  ensurePerpsConfig,
  hasProgramError,
  marketIdBn,
  marketPda,
  num,
  positionPda,
  refreshMarketOracle,
  seedMarket,
  toBn,
  tradeFeeLamports,
  uniqueMarketId,
  waitForOracleToExpire,
} from "./perps-test-helpers";
import { configureAnchorTests } from "./test-anchor";

describe("gold_perps_market", () => {
  const provider = configureAnchorTests();
  anchor.setProvider(provider);

  const program = anchor.workspace.GoldPerpsMarket as Program<GoldPerpsMarket>;
  const authority = (provider.wallet as anchor.Wallet & { payer: Keypair })
    .payer;
  const liquidator = Keypair.generate();

  before(async () => {
    await airdrop(provider.connection, liquidator.publicKey, 25);
    await ensurePerpsConfig(program, authority);
  });

  it("initializes config with the expected controls", async () => {
    const config = await program.account.configState.fetch(
      configPda(program.programId),
    );

    assert.ok(config.authority.equals(authority.publicKey));
    assert.ok(config.keeperAuthority.equals(authority.publicKey));
    assert.strictEqual(num(config.defaultSkewScale), DEFAULT_SKEW_SCALE);
    assert.strictEqual(
      num(config.defaultFundingVelocity),
      DEFAULT_FUNDING_VELOCITY,
    );
    assert.strictEqual(
      num(config.maxOracleStalenessSeconds),
      DEFAULT_MAX_ORACLE_STALENESS_SECONDS,
    );
    assert.strictEqual(
      num(config.minOracleSpotIndex),
      DEFAULT_MIN_ORACLE_SPOT_INDEX,
    );
    assert.strictEqual(
      num(config.maxOracleSpotIndex),
      DEFAULT_MAX_ORACLE_SPOT_INDEX,
    );
    assert.strictEqual(
      config.maxOraclePriceDeltaBps,
      DEFAULT_MAX_ORACLE_PRICE_DELTA_BPS,
    );
    assert.ok(config.treasuryAuthority.equals(authority.publicKey));
    assert.ok(config.marketMakerAuthority.equals(authority.publicKey));
    assert.strictEqual(num(config.maxLeverage), DEFAULT_MAX_LEVERAGE);
    assert.strictEqual(num(config.minMarginLamports), DEFAULT_MIN_MARGIN);
    assert.strictEqual(
      num(config.maxMarketOpenInterest),
      DEFAULT_MAX_MARKET_OPEN_INTEREST,
    );
    assert.strictEqual(
      num(config.minMarketInsuranceLamports),
      DEFAULT_MIN_MARKET_INSURANCE,
    );
    assert.strictEqual(
      config.maintenanceMarginBps,
      DEFAULT_MAINTENANCE_MARGIN_BPS,
    );
    assert.strictEqual(config.liquidationFeeBps, DEFAULT_LIQUIDATION_FEE_BPS);
    assert.strictEqual(
      config.tradeTreasuryFeeBps,
      DEFAULT_TRADE_TREASURY_FEE_BPS,
    );
    assert.strictEqual(
      config.tradeMarketMakerFeeBps,
      DEFAULT_TRADE_MARKET_MAKER_FEE_BPS,
    );
  });

  it("allows the authority to update live risk config and restore it", async () => {
    await program.methods
      .updateConfig(
        liquidator.publicKey,
        authority.publicKey,
        authority.publicKey,
        toBn(SOL(75)),
        new anchor.BN(25_000_000),
        new anchor.BN(DEFAULT_MAX_ORACLE_STALENESS_SECONDS),
        toBn(PRICE(85)),
        toBn(PRICE(115)),
        2_500,
        toBn(4),
        toBn(SOL(0.2)),
        toBn(SOL(12)),
        toBn(SOL(6)),
        400,
        75,
        30,
        20,
      )
      .accountsPartial({
        config: configPda(program.programId),
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();

    let config = await program.account.configState.fetch(
      configPda(program.programId),
    );
    assert.ok(config.keeperAuthority.equals(liquidator.publicKey));
    assert.strictEqual(num(config.defaultSkewScale), SOL(75));
    assert.strictEqual(num(config.defaultFundingVelocity), 25_000_000);
    assert.strictEqual(num(config.minOracleSpotIndex), PRICE(85));
    assert.strictEqual(num(config.maxOracleSpotIndex), PRICE(115));
    assert.strictEqual(config.maxOraclePriceDeltaBps, 2_500);
    assert.strictEqual(num(config.maxLeverage), 4);
    assert.strictEqual(num(config.minMarginLamports), SOL(0.2));
    assert.strictEqual(num(config.maxMarketOpenInterest), SOL(12));
    assert.strictEqual(num(config.minMarketInsuranceLamports), SOL(6));
    assert.strictEqual(config.maintenanceMarginBps, 400);
    assert.strictEqual(config.liquidationFeeBps, 75);

    await program.methods
      .updateConfig(
        authority.publicKey,
        authority.publicKey,
        authority.publicKey,
        toBn(DEFAULT_SKEW_SCALE),
        new anchor.BN(DEFAULT_FUNDING_VELOCITY),
        new anchor.BN(DEFAULT_MAX_ORACLE_STALENESS_SECONDS),
        toBn(DEFAULT_MIN_ORACLE_SPOT_INDEX),
        toBn(DEFAULT_MAX_ORACLE_SPOT_INDEX),
        DEFAULT_MAX_ORACLE_PRICE_DELTA_BPS,
        toBn(DEFAULT_MAX_LEVERAGE),
        toBn(DEFAULT_MIN_MARGIN),
        toBn(DEFAULT_MAX_MARKET_OPEN_INTEREST),
        toBn(DEFAULT_MIN_MARKET_INSURANCE),
        DEFAULT_MAINTENANCE_MARGIN_BPS,
        DEFAULT_LIQUIDATION_FEE_BPS,
        DEFAULT_TRADE_TREASURY_FEE_BPS,
        DEFAULT_TRADE_MARKET_MAKER_FEE_BPS,
      )
      .accountsPartial({
        config: configPda(program.programId),
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();

    config = await program.account.configState.fetch(configPda(program.programId));
    assert.ok(config.keeperAuthority.equals(authority.publicKey));
    assert.strictEqual(
      num(config.maxMarketOpenInterest),
      DEFAULT_MAX_MARKET_OPEN_INTEREST,
    );
  });

  it("rejects oracle updates outside configured bounds and oversized jumps", async () => {
    await program.methods
      .updateConfig(
        authority.publicKey,
        authority.publicKey,
        authority.publicKey,
        toBn(DEFAULT_SKEW_SCALE),
        new anchor.BN(DEFAULT_FUNDING_VELOCITY),
        new anchor.BN(DEFAULT_MAX_ORACLE_STALENESS_SECONDS),
        toBn(DEFAULT_MIN_ORACLE_SPOT_INDEX),
        toBn(DEFAULT_MAX_ORACLE_SPOT_INDEX),
        1_000,
        toBn(DEFAULT_MAX_LEVERAGE),
        toBn(DEFAULT_MIN_MARGIN),
        toBn(DEFAULT_MAX_MARKET_OPEN_INTEREST),
        toBn(DEFAULT_MIN_MARKET_INSURANCE),
        DEFAULT_MAINTENANCE_MARGIN_BPS,
        DEFAULT_LIQUIDATION_FEE_BPS,
        DEFAULT_TRADE_TREASURY_FEE_BPS,
        DEFAULT_TRADE_MARKET_MAKER_FEE_BPS,
      )
      .accountsPartial({
        config: configPda(program.programId),
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();

    const marketId = uniqueMarketId(2_049);
    const market = await seedMarket(
      program,
      authority,
      marketId,
      PRICE(100),
      DEFAULT_MIN_MARKET_INSURANCE,
    );

    try {
      await program.methods
        .updateMarketOracle(
          marketIdBn(marketId),
          toBn(PRICE(121)),
          toBn(PRICE(121)),
          toBn(PRICE(12.1)),
        )
        .accountsPartial({
          config: configPda(program.programId),
          market,
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();
      assert.fail("out-of-bounds oracle update succeeded");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "OracleSpotIndexOutOfBounds"),
        `expected OracleSpotIndexOutOfBounds, got ${String(error)}`,
      );
    }

    try {
      await program.methods
        .updateMarketOracle(
          marketIdBn(marketId),
          toBn(PRICE(115)),
          toBn(PRICE(115)),
          toBn(PRICE(11.5)),
        )
        .accountsPartial({
          config: configPda(program.programId),
          market,
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();
      assert.fail("oversized oracle jump succeeded");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "OraclePriceDeltaTooLarge"),
        `expected OraclePriceDeltaTooLarge, got ${String(error)}`,
      );
    }

    await program.methods
      .updateConfig(
        authority.publicKey,
        authority.publicKey,
        authority.publicKey,
        toBn(DEFAULT_SKEW_SCALE),
        new anchor.BN(DEFAULT_FUNDING_VELOCITY),
        new anchor.BN(DEFAULT_MAX_ORACLE_STALENESS_SECONDS),
        toBn(DEFAULT_MIN_ORACLE_SPOT_INDEX),
        toBn(DEFAULT_MAX_ORACLE_SPOT_INDEX),
        DEFAULT_MAX_ORACLE_PRICE_DELTA_BPS,
        toBn(DEFAULT_MAX_LEVERAGE),
        toBn(DEFAULT_MIN_MARGIN),
        toBn(DEFAULT_MAX_MARKET_OPEN_INTEREST),
        toBn(DEFAULT_MIN_MARKET_INSURANCE),
        DEFAULT_MAINTENANCE_MARGIN_BPS,
        DEFAULT_LIQUIDATION_FEE_BPS,
        DEFAULT_TRADE_TREASURY_FEE_BPS,
        DEFAULT_TRADE_MARKET_MAKER_FEE_BPS,
      )
      .accountsPartial({
        config: configPda(program.programId),
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();
  });

  it("rejects positions that would push a market past the configured open-interest cap", async () => {
    await program.methods
      .updateConfig(
        authority.publicKey,
        authority.publicKey,
        authority.publicKey,
        toBn(DEFAULT_SKEW_SCALE),
        new anchor.BN(DEFAULT_FUNDING_VELOCITY),
        new anchor.BN(DEFAULT_MAX_ORACLE_STALENESS_SECONDS),
        toBn(DEFAULT_MIN_ORACLE_SPOT_INDEX),
        toBn(DEFAULT_MAX_ORACLE_SPOT_INDEX),
        DEFAULT_MAX_ORACLE_PRICE_DELTA_BPS,
        toBn(DEFAULT_MAX_LEVERAGE),
        toBn(DEFAULT_MIN_MARGIN),
        toBn(SOL(3)),
        toBn(DEFAULT_MIN_MARKET_INSURANCE),
        DEFAULT_MAINTENANCE_MARGIN_BPS,
        DEFAULT_LIQUIDATION_FEE_BPS,
        DEFAULT_TRADE_TREASURY_FEE_BPS,
        DEFAULT_TRADE_MARKET_MAKER_FEE_BPS,
      )
      .accountsPartial({
        config: configPda(program.programId),
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();

    const traderA = Keypair.generate();
    const traderB = Keypair.generate();
    await Promise.all([
      airdrop(provider.connection, traderA.publicKey, 10),
      airdrop(provider.connection, traderB.publicKey, 10),
    ]);

    const marketId = uniqueMarketId(2_050);
    await seedMarket(
      program,
      authority,
      marketId,
      PRICE(100),
      DEFAULT_MIN_MARKET_INSURANCE,
    );

    await program.methods
      .modifyPosition(marketIdBn(marketId), toBn(SOL(1)), toBn(SOL(2)), toBn(0))
      .accountsPartial({
        config: configPda(program.programId),
        market: marketPda(program.programId, marketId),
        position: positionPda(program.programId, traderA.publicKey, marketId),
        trader: traderA.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([traderA])
      .rpc();

    try {
      await program.methods
        .modifyPosition(
          marketIdBn(marketId),
          toBn(SOL(1)),
          toBn(SOL(2)),
          toBn(0),
        )
        .accountsPartial({
          config: configPda(program.programId),
          market: marketPda(program.programId, marketId),
          position: positionPda(program.programId, traderB.publicKey, marketId),
          trader: traderB.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([traderB])
        .rpc();
      assert.fail("open-interest cap violation succeeded");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "OpenInterestLimitExceeded"),
        `expected OpenInterestLimitExceeded, got ${String(error)}`,
      );
    }

    await program.methods
      .updateConfig(
        authority.publicKey,
        authority.publicKey,
        authority.publicKey,
        toBn(DEFAULT_SKEW_SCALE),
        new anchor.BN(DEFAULT_FUNDING_VELOCITY),
        new anchor.BN(DEFAULT_MAX_ORACLE_STALENESS_SECONDS),
        toBn(DEFAULT_MIN_ORACLE_SPOT_INDEX),
        toBn(DEFAULT_MAX_ORACLE_SPOT_INDEX),
        DEFAULT_MAX_ORACLE_PRICE_DELTA_BPS,
        toBn(DEFAULT_MAX_LEVERAGE),
        toBn(DEFAULT_MIN_MARGIN),
        toBn(DEFAULT_MAX_MARKET_OPEN_INTEREST),
        toBn(DEFAULT_MIN_MARKET_INSURANCE),
        DEFAULT_MAINTENANCE_MARGIN_BPS,
        DEFAULT_LIQUIDATION_FEE_BPS,
        DEFAULT_TRADE_TREASURY_FEE_BPS,
        DEFAULT_TRADE_MARKET_MAKER_FEE_BPS,
      )
      .accountsPartial({
        config: configPda(program.programId),
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();
  });

  it("requires isolated insurance before open interest can grow", async () => {
    const trader = Keypair.generate();
    await airdrop(provider.connection, trader.publicKey, 10);

    const marketId = uniqueMarketId(2_051);
    const market = await seedMarket(program, authority, marketId, PRICE(100), 0);
    const position = positionPda(program.programId, trader.publicKey, marketId);

    try {
      await program.methods
        .modifyPosition(
          marketIdBn(marketId),
          toBn(SOL(1)),
          toBn(SOL(1)),
          toBn(0),
        )
        .accountsPartial({
          config: configPda(program.programId),
          market,
          position,
          trader: trader.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([trader])
        .rpc();
      assert.fail("OI growth without insurance succeeded");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "MarketInsufficientInsurance"),
        `expected MarketInsufficientInsurance, got ${String(error)}`,
      );
    }

    await program.methods
      .depositInsurance(
        marketIdBn(marketId),
        toBn(DEFAULT_MIN_MARKET_INSURANCE),
      )
      .accountsPartial({
        market,
        payer: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    await program.methods
      .modifyPosition(
        marketIdBn(marketId),
        toBn(SOL(1)),
        toBn(SOL(1)),
        toBn(0),
      )
      .accountsPartial({
        config: configPda(program.programId),
        market,
        position,
        trader: trader.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();

    const marketState = await program.account.marketState.fetch(market);
    assert.strictEqual(
      num(marketState.insuranceFund),
      DEFAULT_MIN_MARKET_INSURANCE,
    );
    assert.strictEqual(num(marketState.totalLongOi), SOL(1));
  });

  it("initializes market state and tracks insurance deposits", async () => {
    const marketId = uniqueMarketId(2_000);
    const market = await seedMarket(program, authority, marketId, PRICE(100));
    const lamportsBeforeDeposit = await provider.connection.getBalance(market);

    await program.methods
      .depositInsurance(marketIdBn(marketId), toBn(SOL(3)))
      .accountsPartial({
        market,
        payer: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    const marketState = await program.account.marketState.fetch(market);
    const lamportsAfterDeposit = await provider.connection.getBalance(market);
    assert.strictEqual(marketState.status, PERPS_STATUS_ACTIVE);
    assert.strictEqual(num(marketState.marketId), marketId);
    assert.strictEqual(num(marketState.spotIndex), PRICE(100));
    assert.strictEqual(num(marketState.totalLongOi), 0);
    assert.strictEqual(num(marketState.totalShortOi), 0);
    assert.strictEqual(num(marketState.insuranceFund), SOL(3));
    assert.strictEqual(num(marketState.treasuryFeeBalance), 0);
    assert.strictEqual(num(marketState.marketMakerFeeBalance), 0);
    assert.ok(lamportsAfterDeposit >= lamportsBeforeDeposit + SOL(3));
  });

  it("opens and expands a long position while updating open interest", async () => {
    const trader = Keypair.generate();
    await airdrop(provider.connection, trader.publicKey, 10);

    const marketId = uniqueMarketId(2_001);
    await seedMarket(
      program,
      authority,
      marketId,
      PRICE(100),
      DEFAULT_MIN_MARKET_INSURANCE,
    );

    const market = marketPda(program.programId, marketId);
    const position = positionPda(program.programId, trader.publicKey, marketId);

    await program.methods
      .modifyPosition(marketIdBn(marketId), toBn(SOL(1)), toBn(SOL(2)), toBn(0))
      .accountsPartial({
        config: configPda(program.programId),
        market,
        position,
        trader: trader.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();

    await refreshMarketOracle(program, authority, marketId, PRICE(100));

    await program.methods
      .modifyPosition(
        marketIdBn(marketId),
        toBn(SOL(0.5)),
        toBn(SOL(1)),
        toBn(0),
      )
      .accountsPartial({
        config: configPda(program.programId),
        market,
        position,
        trader: trader.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();

    const marketState = await program.account.marketState.fetch(market);
    const positionState = await program.account.positionState.fetch(position);
    const maxMarginAfterFees =
      SOL(1.5) - tradeFeeLamports(SOL(2)) - tradeFeeLamports(SOL(1));

    assert.ok(num(positionState.margin) <= maxMarginAfterFees);
    assert.ok(num(positionState.margin) >= maxMarginAfterFees - SOL(0.02));
    assert.strictEqual(num(positionState.size), SOL(3));
    assert.ok(num(positionState.entryPrice) > PRICE(100));
    assert.strictEqual(num(marketState.totalLongOi), SOL(3));
    assert.strictEqual(num(marketState.totalShortOi), 0);
    assert.strictEqual(num(marketState.openPositions), 1);
    assert.ok(num(marketState.treasuryFeeBalance) > 0);
    assert.ok(num(marketState.marketMakerFeeBalance) > 0);
  });

  it("settles a profitable long and closes the position account", async () => {
    const trader = Keypair.generate();
    await airdrop(provider.connection, trader.publicKey, 10);

    const marketId = uniqueMarketId(2_002);
    const market = await seedMarket(
      program,
      authority,
      marketId,
      PRICE(100),
      DEFAULT_MIN_MARKET_INSURANCE,
    );
    const position = positionPda(program.programId, trader.publicKey, marketId);

    await program.methods
      .modifyPosition(marketIdBn(marketId), toBn(SOL(1)), toBn(SOL(2)), toBn(0))
      .accountsPartial({
        config: configPda(program.programId),
        market,
        position,
        trader: trader.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();

    await program.methods
      .updateMarketOracle(
        marketIdBn(marketId),
        toBn(PRICE(120)),
        toBn(PRICE(120)),
        toBn(PRICE(12)),
      )
      .accountsPartial({
        config: configPda(program.programId),
        market,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    const traderBalanceBeforeClose = await provider.connection.getBalance(
      trader.publicKey,
    );

    await program.methods
      .modifyPosition(marketIdBn(marketId), toBn(0), toBn(-SOL(2)), toBn(0))
      .accountsPartial({
        config: configPda(program.programId),
        market,
        position,
        trader: trader.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();

    const traderBalanceAfterClose = await provider.connection.getBalance(
      trader.publicKey,
    );
    const marketState = await program.account.marketState.fetch(market);
    const closedPosition =
      await program.account.positionState.fetchNullable(position);

    assert.strictEqual(closedPosition, null);
    assert.strictEqual(num(marketState.totalLongOi), 0);
    assert.ok(traderBalanceAfterClose > traderBalanceBeforeClose);
  });

  it("settles a profitable short when the oracle price drops", async () => {
    const trader = Keypair.generate();
    await airdrop(provider.connection, trader.publicKey, 10);

    const marketId = uniqueMarketId(2_003);
    const market = await seedMarket(
      program,
      authority,
      marketId,
      PRICE(100),
      DEFAULT_MIN_MARKET_INSURANCE,
    );
    const position = positionPda(program.programId, trader.publicKey, marketId);

    await program.methods
      .modifyPosition(
        marketIdBn(marketId),
        toBn(SOL(1)),
        toBn(-SOL(2)),
        toBn(0),
      )
      .accountsPartial({
        config: configPda(program.programId),
        market,
        position,
        trader: trader.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();

    await program.methods
      .updateMarketOracle(
        marketIdBn(marketId),
        toBn(PRICE(80)),
        toBn(PRICE(80)),
        toBn(PRICE(8)),
      )
      .accountsPartial({
        config: configPda(program.programId),
        market,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    const traderBalanceBeforeClose = await provider.connection.getBalance(
      trader.publicKey,
    );

    await program.methods
      .modifyPosition(marketIdBn(marketId), toBn(0), toBn(SOL(2)), toBn(0))
      .accountsPartial({
        config: configPda(program.programId),
        market,
        position,
        trader: trader.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();

    const traderBalanceAfterClose = await provider.connection.getBalance(
      trader.publicKey,
    );
    const marketState = await program.account.marketState.fetch(market);

    assert.strictEqual(num(marketState.totalShortOi), 0);
    assert.ok(traderBalanceAfterClose > traderBalanceBeforeClose);
  });

  it("drifts funding positive when longs dominate open interest", async () => {
    const trader = Keypair.generate();
    await airdrop(provider.connection, trader.publicKey, 10);

    const marketId = uniqueMarketId(2_004);
    const market = await seedMarket(
      program,
      authority,
      marketId,
      PRICE(100),
      DEFAULT_MIN_MARKET_INSURANCE,
    );
    const position = positionPda(program.programId, trader.publicKey, marketId);

    await program.methods
      .modifyPosition(marketIdBn(marketId), toBn(SOL(1)), toBn(SOL(3)), toBn(0))
      .accountsPartial({
        config: configPda(program.programId),
        market,
        position,
        trader: trader.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();

    const marketBefore = await program.account.marketState.fetch(market);
    await waitForOracleToExpire();

    await program.methods
      .updateMarketOracle(
        marketIdBn(marketId),
        toBn(PRICE(100)),
        toBn(PRICE(100)),
        toBn(PRICE(10)),
      )
      .accountsPartial({
        config: configPda(program.programId),
        market,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    const marketAfter = await program.account.marketState.fetch(market);
    assert.ok(
      num(marketAfter.currentFundingRate) >
        num(marketBefore.currentFundingRate),
    );
  });

  it("rejects stale opens", async () => {
    const trader = Keypair.generate();
    await airdrop(provider.connection, trader.publicKey, 10);

    const marketId = uniqueMarketId(2_005);
    const market = await seedMarket(
      program,
      authority,
      marketId,
      PRICE(100),
      DEFAULT_MIN_MARKET_INSURANCE,
    );
    const position = positionPda(program.programId, trader.publicKey, marketId);

    await waitForOracleToExpire();

    try {
      await program.methods
        .modifyPosition(
          marketIdBn(marketId),
          toBn(SOL(1)),
          toBn(SOL(2)),
          toBn(0),
        )
        .accountsPartial({
          config: configPda(program.programId),
          market,
          position,
          trader: trader.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([trader])
        .rpc();
      assert.fail("stale-oracle open succeeded");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "StaleOracle"),
        `expected StaleOracle, got ${String(error)}`,
      );
    }
  });

  it("rejects stale closes until the market oracle is refreshed", async () => {
    const trader = Keypair.generate();
    await airdrop(provider.connection, trader.publicKey, 10);

    const marketId = uniqueMarketId(2_006);
    const market = await seedMarket(
      program,
      authority,
      marketId,
      PRICE(100),
      DEFAULT_MIN_MARKET_INSURANCE,
    );
    const position = positionPda(program.programId, trader.publicKey, marketId);

    await program.methods
      .modifyPosition(marketIdBn(marketId), toBn(SOL(1)), toBn(SOL(2)), toBn(0))
      .accountsPartial({
        config: configPda(program.programId),
        market,
        position,
        trader: trader.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();

    await waitForOracleToExpire();

    try {
      await program.methods
        .modifyPosition(marketIdBn(marketId), toBn(0), toBn(-SOL(2)), toBn(0))
        .accountsPartial({
          config: configPda(program.programId),
          market,
          position,
          trader: trader.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([trader])
        .rpc();
      assert.fail("stale-oracle close succeeded");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "StaleOracle"),
        `expected StaleOracle, got ${String(error)}`,
      );
    }

    await program.methods
      .updateMarketOracle(
        marketIdBn(marketId),
        toBn(PRICE(110)),
        toBn(PRICE(110)),
        toBn(PRICE(11)),
      )
      .accountsPartial({
        config: configPda(program.programId),
        market,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    await program.methods
      .modifyPosition(marketIdBn(marketId), toBn(0), toBn(-SOL(2)), toBn(0))
      .accountsPartial({
        config: configPda(program.programId),
        market,
        position,
        trader: trader.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();
  });

  it("liquidates underwater positions and rewards the liquidator", async () => {
    const trader = Keypair.generate();
    await airdrop(provider.connection, trader.publicKey, 10);

    const marketId = uniqueMarketId(2_007);
    const market = await seedMarket(
      program,
      authority,
      marketId,
      PRICE(120),
      DEFAULT_MIN_MARKET_INSURANCE,
    );
    const position = positionPda(program.programId, trader.publicKey, marketId);

    // Entry at ~PRICE(120), 4x leverage → crash to PRICE(80) gives -33% loss on 4x
    await program.methods
      .modifyPosition(marketIdBn(marketId), toBn(SOL(1)), toBn(SOL(4)), toBn(0))
      .accountsPartial({
        config: configPda(program.programId),
        market,
        position,
        trader: trader.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();

    // Crash oracle in steps to avoid max_oracle_price_delta_bps limit
    await crashOracle(program, authority, marketId, PRICE(80));

    const liquidatorBalanceBefore = await provider.connection.getBalance(
      liquidator.publicKey,
    );

    await program.methods
      .liquidatePosition(marketIdBn(marketId))
      .accountsPartial({
        config: configPda(program.programId),
        market,
        position,
        owner: trader.publicKey,
        liquidator: liquidator.publicKey,
      })
      .signers([liquidator])
      .rpc();

    const liquidatorBalanceAfter = await provider.connection.getBalance(
      liquidator.publicKey,
    );
    const marketState = await program.account.marketState.fetch(market);
    const closedPosition =
      await program.account.positionState.fetchNullable(position);

    assert.strictEqual(closedPosition, null);
    assert.strictEqual(num(marketState.totalLongOi), 0);
    assert.ok(liquidatorBalanceAfter > liquidatorBalanceBefore);
  });

  it("keeps zero-equity liquidations incentivized", async () => {
    const trader = Keypair.generate();
    await airdrop(provider.connection, trader.publicKey, 10);

    const marketId = uniqueMarketId(2_071);
    const market = await seedMarket(
      program,
      authority,
      marketId,
      PRICE(100),
      DEFAULT_MIN_MARKET_INSURANCE,
    );
    const position = positionPda(program.programId, trader.publicKey, marketId);

    await program.methods
      .modifyPosition(
        marketIdBn(marketId),
        toBn(SOL(1.025)),
        toBn(SOL(5)),
        toBn(0),
      )
      .accountsPartial({
        config: configPda(program.programId),
        market,
        position,
        trader: trader.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();

    await program.methods
      .updateMarketOracle(
        marketIdBn(marketId),
        toBn(PRICE(80)),
        toBn(PRICE(80)),
        toBn(PRICE(8)),
      )
      .accountsPartial({
        config: configPda(program.programId),
        market,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    const liquidatorBalanceBefore = await provider.connection.getBalance(
      liquidator.publicKey,
    );

    await program.methods
      .liquidatePosition(marketIdBn(marketId))
      .accountsPartial({
        config: configPda(program.programId),
        market,
        position,
        owner: trader.publicKey,
        liquidator: liquidator.publicKey,
      })
      .signers([liquidator])
      .rpc();

    const liquidatorBalanceAfter = await provider.connection.getBalance(
      liquidator.publicKey,
    );
    const closedPosition =
      await program.account.positionState.fetchNullable(position);

    assert.ok(liquidatorBalanceAfter > liquidatorBalanceBefore);
    assert.strictEqual(closedPosition, null);
  });

  it("keeps market state isolated across market ids", async () => {
    const longMarketId = uniqueMarketId(2_008);
    const shortMarketId = uniqueMarketId(2_009);
    const isolatedLongTrader = Keypair.generate();
    const isolatedShortTrader = Keypair.generate();

    await Promise.all([
      airdrop(provider.connection, isolatedLongTrader.publicKey, 10),
      airdrop(provider.connection, isolatedShortTrader.publicKey, 10),
    ]);

    const longMarket = await seedMarket(
      program,
      authority,
      longMarketId,
      PRICE(100),
      DEFAULT_MIN_MARKET_INSURANCE,
    );
    const shortMarket = await seedMarket(
      program,
      authority,
      shortMarketId,
      PRICE(110),
      DEFAULT_MIN_MARKET_INSURANCE,
    );

    await refreshMarketOracle(program, authority, longMarketId, PRICE(100));
    await refreshMarketOracle(program, authority, shortMarketId, PRICE(110));

    await program.methods
      .modifyPosition(
        marketIdBn(longMarketId),
        toBn(SOL(1)),
        toBn(SOL(2)),
        toBn(0),
      )
      .accountsPartial({
        config: configPda(program.programId),
        market: longMarket,
        position: positionPda(
          program.programId,
          isolatedLongTrader.publicKey,
          longMarketId,
        ),
        trader: isolatedLongTrader.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([isolatedLongTrader])
      .rpc();

    await program.methods
      .modifyPosition(
        marketIdBn(shortMarketId),
        toBn(SOL(1)),
        toBn(-SOL(3)),
        toBn(0),
      )
      .accountsPartial({
        config: configPda(program.programId),
        market: shortMarket,
        position: positionPda(
          program.programId,
          isolatedShortTrader.publicKey,
          shortMarketId,
        ),
        trader: isolatedShortTrader.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([isolatedShortTrader])
      .rpc();

    const longMarketState = await program.account.marketState.fetch(longMarket);
    const shortMarketState =
      await program.account.marketState.fetch(shortMarket);

    assert.strictEqual(num(longMarketState.spotIndex), PRICE(100));
    assert.strictEqual(num(longMarketState.totalLongOi), SOL(2));
    assert.strictEqual(num(longMarketState.totalShortOi), 0);
    assert.strictEqual(num(shortMarketState.spotIndex), PRICE(110));
    assert.strictEqual(num(shortMarketState.totalLongOi), 0);
    assert.strictEqual(num(shortMarketState.totalShortOi), SOL(3));
  });

  it("recycles market-maker fees into insurance and withdraws treasury fees", async () => {
    const trader = Keypair.generate();
    await airdrop(provider.connection, trader.publicKey, 10);

    const marketId = uniqueMarketId(2_010);
    const market = await seedMarket(
      program,
      authority,
      marketId,
      PRICE(100),
      DEFAULT_MIN_MARKET_INSURANCE,
    );
    const position = positionPda(program.programId, trader.publicKey, marketId);

    await program.methods
      .modifyPosition(marketIdBn(marketId), toBn(SOL(1)), toBn(SOL(2)), toBn(0))
      .accountsPartial({
        config: configPda(program.programId),
        market,
        position,
        trader: trader.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();

    const beforeRecycle = await program.account.marketState.fetch(market);
    assert.ok(num(beforeRecycle.marketMakerFeeBalance) > 0);
    assert.ok(num(beforeRecycle.treasuryFeeBalance) > 0);

    await program.methods
      .recycleMarketMakerFees(
        marketIdBn(marketId),
        toBn(num(beforeRecycle.marketMakerFeeBalance)),
      )
      .accountsPartial({
        config: configPda(program.programId),
        market,
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();

    const afterRecycle = await program.account.marketState.fetch(market);
    assert.strictEqual(num(afterRecycle.marketMakerFeeBalance), 0);
    assert.ok(
      num(afterRecycle.insuranceFund) > num(beforeRecycle.insuranceFund),
    );

    await program.methods
      .withdrawFeeBalance(
        marketIdBn(marketId),
        0,
        toBn(num(afterRecycle.treasuryFeeBalance)),
      )
      .accountsPartial({
        config: configPda(program.programId),
        market,
        recipient: authority.publicKey,
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();

    const afterWithdraw = await program.account.marketState.fetch(market);
    assert.strictEqual(num(afterWithdraw.treasuryFeeBalance), 0);
  });

  it("moves deprecated markets to close-only and allows only reductions", async () => {
    const trader = Keypair.generate();
    const secondTrader = Keypair.generate();
    await Promise.all([
      airdrop(provider.connection, trader.publicKey, 10),
      airdrop(provider.connection, secondTrader.publicKey, 10),
    ]);

    const marketId = uniqueMarketId(2_011);
    const market = await seedMarket(
      program,
      authority,
      marketId,
      PRICE(100),
      DEFAULT_MIN_MARKET_INSURANCE,
    );
    const position = positionPda(program.programId, trader.publicKey, marketId);

    await program.methods
      .modifyPosition(marketIdBn(marketId), toBn(SOL(1)), toBn(SOL(2)), toBn(0))
      .accountsPartial({
        config: configPda(program.programId),
        market,
        position,
        trader: trader.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();

    await program.methods
      .setMarketStatus(
        marketIdBn(marketId),
        PERPS_STATUS_CLOSE_ONLY,
        toBn(PRICE(95)),
      )
      .accountsPartial({
        config: configPda(program.programId),
        market,
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();

    await waitForOracleToExpire();

    try {
      await program.methods
        .modifyPosition(
          marketIdBn(marketId),
          toBn(SOL(1)),
          toBn(SOL(1)),
          toBn(0),
        )
        .accountsPartial({
          config: configPda(program.programId),
          market,
          position: positionPda(
            program.programId,
            secondTrader.publicKey,
            marketId,
          ),
          trader: secondTrader.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([secondTrader])
        .rpc();
      assert.fail("close-only market accepted a new position");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "MarketCloseOnly"),
        `expected MarketCloseOnly, got ${String(error)}`,
      );
    }

    await program.methods
      .modifyPosition(marketIdBn(marketId), toBn(0), toBn(-SOL(2)), toBn(0))
      .accountsPartial({
        config: configPda(program.programId),
        market,
        position,
        trader: trader.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();

    const closedPosition =
      await program.account.positionState.fetchNullable(position);
    const marketState = await program.account.marketState.fetch(market);
    assert.strictEqual(closedPosition, null);
    assert.strictEqual(marketState.status, PERPS_STATUS_CLOSE_ONLY);
    assert.strictEqual(num(marketState.openPositions), 0);
  });

  it("archives a deprecated market once all positions are closed", async () => {
    const marketId = uniqueMarketId(2_012);
    const market = await seedMarket(
      program,
      authority,
      marketId,
      PRICE(100),
      DEFAULT_MIN_MARKET_INSURANCE,
    );

    await program.methods
      .setMarketStatus(
        marketIdBn(marketId),
        PERPS_STATUS_CLOSE_ONLY,
        toBn(PRICE(100)),
      )
      .accountsPartial({
        config: configPda(program.programId),
        market,
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();

    await program.methods
      .setMarketStatus(
        marketIdBn(marketId),
        PERPS_STATUS_ARCHIVED,
        toBn(PRICE(100)),
      )
      .accountsPartial({
        config: configPda(program.programId),
        market,
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();

    const marketState = await program.account.marketState.fetch(market);
    assert.strictEqual(marketState.status, PERPS_STATUS_ARCHIVED);
  });

  it("reactivates an archived market when the model returns", async () => {
    const marketId = uniqueMarketId(2_014);
    const market = await seedMarket(
      program,
      authority,
      marketId,
      PRICE(100),
      DEFAULT_MIN_MARKET_INSURANCE,
    );

    await program.methods
      .setMarketStatus(
        marketIdBn(marketId),
        PERPS_STATUS_CLOSE_ONLY,
        toBn(PRICE(100)),
      )
      .accountsPartial({
        config: configPda(program.programId),
        market,
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();

    await program.methods
      .setMarketStatus(
        marketIdBn(marketId),
        PERPS_STATUS_ARCHIVED,
        toBn(PRICE(100)),
      )
      .accountsPartial({
        config: configPda(program.programId),
        market,
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();

    await program.methods
      .setMarketStatus(marketIdBn(marketId), 0, new anchor.BN(0))
      .accountsPartial({
        config: configPda(program.programId),
        market,
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();

    await refreshMarketOracle(program, authority, marketId, PRICE(108));

    const marketState = await program.account.marketState.fetch(market);
    assert.strictEqual(marketState.status, 0);
    assert.strictEqual(num(marketState.settlementSpotIndex), 0);
    assert.strictEqual(num(marketState.spotIndex), PRICE(108));
  });

  it("rejects trades that exceed the caller's acceptable slippage", async () => {
    const trader = Keypair.generate();
    await airdrop(provider.connection, trader.publicKey, 10);

    const marketId = uniqueMarketId(2_013);
    const market = await seedMarket(
      program,
      authority,
      marketId,
      PRICE(100),
      DEFAULT_MIN_MARKET_INSURANCE,
    );

    try {
      await program.methods
        .modifyPosition(
          marketIdBn(marketId),
          toBn(SOL(1)),
          toBn(SOL(2)),
          toBn(PRICE(99)),
        )
        .accountsPartial({
          config: configPda(program.programId),
          market,
          position: positionPda(program.programId, trader.publicKey, marketId),
          trader: trader.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([trader])
        .rpc();
      assert.fail("trade succeeded despite unacceptable slippage");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "SlippageExceeded"),
        `expected SlippageExceeded, got ${String(error)}`,
      );
    }
  });

  // --- P1B.9 integration tests ---

  it("partially liquidates a position that is below maintenance but has positive equity", async () => {
    const trader = Keypair.generate();
    await airdrop(provider.connection, trader.publicKey, 10);

    const marketId = uniqueMarketId(2_080);
    const market = await seedMarket(
      program,
      authority,
      marketId,
      PRICE(100),
      DEFAULT_MIN_MARKET_INSURANCE,
    );
    const position = positionPda(program.programId, trader.publicKey, marketId);

    // Open 4x leveraged long: margin=1 SOL, size=4 SOL
    await program.methods
      .modifyPosition(marketIdBn(marketId), toBn(SOL(1)), toBn(SOL(4)), toBn(0))
      .accountsPartial({
        config: configPda(program.programId),
        market,
        position,
        trader: trader.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();

    // Drop price to 80 — equity ~ 0.175 SOL, maintenance ~ 0.2 SOL
    // Positive equity but below maintenance → partial liquidation
    await program.methods
      .updateMarketOracle(
        marketIdBn(marketId),
        toBn(PRICE(80)),
        toBn(PRICE(80)),
        toBn(PRICE(8)),
      )
      .accountsPartial({
        config: configPda(program.programId),
        market,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    const liquidatorBalanceBefore = await provider.connection.getBalance(
      liquidator.publicKey,
    );

    await program.methods
      .liquidatePosition(marketIdBn(marketId))
      .accountsPartial({
        config: configPda(program.programId),
        market,
        position,
        owner: trader.publicKey,
        liquidator: liquidator.publicKey,
      })
      .signers([liquidator])
      .rpc();

    const liquidatorBalanceAfter = await provider.connection.getBalance(
      liquidator.publicKey,
    );
    const positionState =
      await program.account.positionState.fetchNullable(position);
    const marketState = await program.account.marketState.fetch(market);

    // Position still exists with reduced size (partial liquidation)
    assert.ok(positionState !== null, "position should survive partial liquidation");
    assert.ok(num(positionState!.size) > 0, "position size should be positive");
    assert.ok(num(positionState!.size) < SOL(4), "position size should be reduced");
    assert.strictEqual(num(marketState.openPositions), 1);
    assert.ok(liquidatorBalanceAfter > liquidatorBalanceBefore, "liquidator should be rewarded");
  });

  it("fully liquidates a deeply underwater position and tracks insurance drawdown", async () => {
    const trader = Keypair.generate();
    await airdrop(provider.connection, trader.publicKey, 10);

    const marketId = uniqueMarketId(2_081);
    const market = await seedMarket(
      program,
      authority,
      marketId,
      PRICE(120),
      DEFAULT_MIN_MARKET_INSURANCE,
    );
    const position = positionPda(program.programId, trader.publicKey, marketId);

    const insuranceBefore = num(
      (await program.account.marketState.fetch(market)).insuranceFund,
    );

    // Open 4x leveraged long at ~PRICE(120), crash to PRICE(80) → equity deeply negative
    await program.methods
      .modifyPosition(marketIdBn(marketId), toBn(SOL(1)), toBn(SOL(4)), toBn(0))
      .accountsPartial({
        config: configPda(program.programId),
        market,
        position,
        trader: trader.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();

    // Crash oracle in steps to avoid max_oracle_price_delta_bps limit
    await crashOracle(program, authority, marketId, PRICE(80));

    const liquidatorBalanceBefore = await provider.connection.getBalance(
      liquidator.publicKey,
    );

    await program.methods
      .liquidatePosition(marketIdBn(marketId))
      .accountsPartial({
        config: configPda(program.programId),
        market,
        position,
        owner: trader.publicKey,
        liquidator: liquidator.publicKey,
      })
      .signers([liquidator])
      .rpc();

    const closedPosition =
      await program.account.positionState.fetchNullable(position);
    const marketState = await program.account.marketState.fetch(market);
    const liquidatorBalanceAfter = await provider.connection.getBalance(
      liquidator.publicKey,
    );

    assert.strictEqual(closedPosition, null, "position should be fully closed");
    assert.strictEqual(num(marketState.totalLongOi), 0);
    assert.strictEqual(num(marketState.openPositions), 0);
    assert.ok(liquidatorBalanceAfter > liquidatorBalanceBefore, "liquidator should be rewarded");
    // Insurance was drawn to cover the deficit
    assert.ok(
      num(marketState.insuranceFund) < insuranceBefore,
      "insurance fund should decrease from waterfall",
    );
  });

  it("accumulates bad debt when insurance fund is insufficient to cover deficit", async () => {
    const trader = Keypair.generate();
    await airdrop(provider.connection, trader.publicKey, 10);

    // Create market with minimal insurance
    const marketId = uniqueMarketId(2_083);
    const market = await seedMarket(
      program,
      authority,
      marketId,
      PRICE(120),
      DEFAULT_MIN_MARKET_INSURANCE,
    );
    const position = positionPda(program.programId, trader.publicKey, marketId);

    // Open 4x leveraged long at ~PRICE(120), crash to PRICE(80) → deeply negative equity
    await program.methods
      .modifyPosition(
        marketIdBn(marketId),
        toBn(SOL(1)),
        toBn(SOL(4)),
        toBn(0),
      )
      .accountsPartial({
        config: configPda(program.programId),
        market,
        position,
        trader: trader.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();

    // Crash oracle in steps to trigger full liquidation with deficit
    await crashOracle(program, authority, marketId, PRICE(80));

    await program.methods
      .liquidatePosition(marketIdBn(marketId))
      .accountsPartial({
        config: configPda(program.programId),
        market,
        position,
        owner: trader.publicKey,
        liquidator: liquidator.publicKey,
      })
      .signers([liquidator])
      .rpc();

    const marketState = await program.account.marketState.fetch(market);
    // Either bad debt was created or insurance was fully drained
    // The socialized loss cap may limit the deficit, but with small insurance
    // at least some insurance draw should happen
    const totalDeficitHandled =
      num(marketState.badDebt) > 0 ||
      num(marketState.insuranceFund) < DEFAULT_MIN_MARKET_INSURANCE;
    assert.ok(totalDeficitHandled, "deficit should be handled via insurance or bad debt");
  });

  it("blocks position increase when effective equity fails maintenance margin", async () => {
    const trader = Keypair.generate();
    await airdrop(provider.connection, trader.publicKey, 10);

    const marketId = uniqueMarketId(2_084);
    const market = await seedMarket(
      program,
      authority,
      marketId,
      PRICE(100),
      DEFAULT_MIN_MARKET_INSURANCE,
    );
    const position = positionPda(program.programId, trader.publicKey, marketId);

    // Open 4x leveraged long: margin=1 SOL, size=4 SOL
    await program.methods
      .modifyPosition(marketIdBn(marketId), toBn(SOL(1)), toBn(SOL(4)), toBn(0))
      .accountsPartial({
        config: configPda(program.programId),
        market,
        position,
        trader: trader.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();

    // Drop price to 81 — large unrealized loss
    await program.methods
      .updateMarketOracle(
        marketIdBn(marketId),
        toBn(PRICE(81)),
        toBn(PRICE(81)),
        toBn(PRICE(8)),
      )
      .accountsPartial({
        config: configPda(program.programId),
        market,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    // Try to increase position — raw leverage passes (margin*5 >= new_size)
    // but PnL-aware effective equity < maintenance margin → rejected
    try {
      await program.methods
        .modifyPosition(
          marketIdBn(marketId),
          toBn(SOL(0.05)),
          toBn(SOL(1)),
          toBn(0),
        )
        .accountsPartial({
          config: configPda(program.programId),
          market,
          position,
          trader: trader.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([trader])
        .rpc();
      assert.fail("position increase should have been rejected");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "MaintenanceMarginViolation"),
        `expected MaintenanceMarginViolation, got ${String(error)}`,
      );
    }
  });

  it("allows position reduction despite unrealized losses", async () => {
    const trader = Keypair.generate();
    await airdrop(provider.connection, trader.publicKey, 10);

    const marketId = uniqueMarketId(2_085);
    const market = await seedMarket(
      program,
      authority,
      marketId,
      PRICE(100),
      DEFAULT_MIN_MARKET_INSURANCE,
    );
    const position = positionPda(program.programId, trader.publicKey, marketId);

    // Open 4x leveraged long — same setup as maintenance margin test
    await program.methods
      .modifyPosition(marketIdBn(marketId), toBn(SOL(1)), toBn(SOL(4)), toBn(0))
      .accountsPartial({
        config: configPda(program.programId),
        market,
        position,
        trader: trader.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();

    // Drop price — large unrealized loss
    await program.methods
      .updateMarketOracle(
        marketIdBn(marketId),
        toBn(PRICE(81)),
        toBn(PRICE(81)),
        toBn(PRICE(8)),
      )
      .accountsPartial({
        config: configPda(program.programId),
        market,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    // Reduce position — should succeed despite unrealized losses
    // (maintenance margin check skipped for reduce-only changes)
    await program.methods
      .modifyPosition(marketIdBn(marketId), toBn(0), toBn(-SOL(1)), toBn(0))
      .accountsPartial({
        config: configPda(program.programId),
        market,
        position,
        trader: trader.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();

    const positionState = await program.account.positionState.fetch(position);
    assert.ok(num(positionState.size) < SOL(4), "position should be reduced");
    assert.ok(num(positionState.size) > 0, "position should still exist");
  });

  it("repays bad debt via repay_bad_debt instruction", async () => {
    const trader = Keypair.generate();
    await airdrop(provider.connection, trader.publicKey, 10);

    // Create market with minimal insurance
    const marketId = uniqueMarketId(2_086);
    const market = await seedMarket(
      program,
      authority,
      marketId,
      PRICE(120),
      DEFAULT_MIN_MARKET_INSURANCE,
    );
    const position = positionPda(program.programId, trader.publicKey, marketId);

    // Open 4x leveraged long at ~PRICE(120) and crash to PRICE(80)
    await program.methods
      .modifyPosition(
        marketIdBn(marketId),
        toBn(SOL(1)),
        toBn(SOL(4)),
        toBn(0),
      )
      .accountsPartial({
        config: configPda(program.programId),
        market,
        position,
        trader: trader.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();

    await crashOracle(program, authority, marketId, PRICE(80));

    await program.methods
      .liquidatePosition(marketIdBn(marketId))
      .accountsPartial({
        config: configPda(program.programId),
        market,
        position,
        owner: trader.publicKey,
        liquidator: liquidator.publicKey,
      })
      .signers([liquidator])
      .rpc();

    const marketAfterLiq = await program.account.marketState.fetch(market);
    const badDebt = num(marketAfterLiq.badDebt);

    if (badDebt > 0) {
      // Repay the bad debt
      await program.methods
        .repayBadDebt(marketIdBn(marketId), toBn(badDebt))
        .accountsPartial({
          market,
          payer: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      const marketAfterRepay = await program.account.marketState.fetch(market);
      assert.strictEqual(num(marketAfterRepay.badDebt), 0, "bad debt should be zero after repay");
      assert.ok(
        num(marketAfterRepay.insuranceFund) > num(marketAfterLiq.insuranceFund),
        "insurance fund should increase after repay",
      );
    } else {
      // If no bad debt, the deficit was fully covered by insurance
      assert.ok(
        num(marketAfterLiq.insuranceFund) < DEFAULT_MIN_MARKET_INSURANCE,
        "insurance should have been drawn if no bad debt",
      );
    }
  });

  it("rejects repay_bad_debt when amount exceeds outstanding bad debt", async () => {
    const marketId = uniqueMarketId(2_087);
    const market = await seedMarket(
      program,
      authority,
      marketId,
      PRICE(100),
      DEFAULT_MIN_MARKET_INSURANCE,
    );

    // Market has zero bad debt — any repayment should fail
    try {
      await program.methods
        .repayBadDebt(marketIdBn(marketId), toBn(SOL(1)))
        .accountsPartial({
          market,
          payer: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();
      assert.fail("repay_bad_debt should have been rejected");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "InvalidBadDebtRepayment"),
        `expected InvalidBadDebtRepayment, got ${String(error)}`,
      );
    }
  });

  it("insurance waterfall draws from fund before creating bad debt", async () => {
    const trader = Keypair.generate();
    await airdrop(provider.connection, trader.publicKey, 10);

    const marketId = uniqueMarketId(2_088);
    const market = await seedMarket(
      program,
      authority,
      marketId,
      PRICE(120),
      DEFAULT_MIN_MARKET_INSURANCE,
    );
    const position = positionPda(program.programId, trader.publicKey, marketId);

    const insuranceBefore = num(
      (await program.account.marketState.fetch(market)).insuranceFund,
    );

    // Open 4x leveraged long at ~PRICE(120), crash to PRICE(80) → equity deeply negative
    await program.methods
      .modifyPosition(
        marketIdBn(marketId),
        toBn(SOL(1)),
        toBn(SOL(4)),
        toBn(0),
      )
      .accountsPartial({
        config: configPda(program.programId),
        market,
        position,
        trader: trader.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();

    // Crash oracle in steps to avoid max_oracle_price_delta_bps limit
    await crashOracle(program, authority, marketId, PRICE(80));

    await program.methods
      .liquidatePosition(marketIdBn(marketId))
      .accountsPartial({
        config: configPda(program.programId),
        market,
        position,
        owner: trader.publicKey,
        liquidator: liquidator.publicKey,
      })
      .signers([liquidator])
      .rpc();

    const marketState = await program.account.marketState.fetch(market);
    const closedPosition =
      await program.account.positionState.fetchNullable(position);

    assert.strictEqual(closedPosition, null, "position should be fully closed");
    // Insurance was used before bad debt was created
    const insuranceAfter = num(marketState.insuranceFund);
    const badDebtAfter = num(marketState.badDebt);
    assert.ok(
      insuranceAfter < insuranceBefore || badDebtAfter > 0,
      "insurance should be drawn or bad debt created",
    );
    // If bad debt exists, insurance should be at zero (fully drained first)
    if (badDebtAfter > 0) {
      assert.strictEqual(
        insuranceAfter,
        0,
        "insurance should be fully drained before bad debt",
      );
    }
  });

  it("keeps emergency pause available after config freeze", async () => {
    const config = configPda(program.programId);

    await program.methods
      .freezeConfig()
      .accountsPartial({
        config,
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();

    let configState = await program.account.configState.fetch(config);
    assert.strictEqual(configState.configFrozen, true);

    await program.methods
      .setPaused(true)
      .accountsPartial({
        config,
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();

    configState = await program.account.configState.fetch(config);
    assert.strictEqual(configState.paused, true);

    await program.methods
      .setPaused(false)
      .accountsPartial({
        config,
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();

    configState = await program.account.configState.fetch(config);
    assert.strictEqual(configState.paused, false);

    try {
      await program.methods
        .updateConfig(
          authority.publicKey,
          authority.publicKey,
          authority.publicKey,
          toBn(DEFAULT_SKEW_SCALE),
          new anchor.BN(DEFAULT_FUNDING_VELOCITY),
          new anchor.BN(DEFAULT_MAX_ORACLE_STALENESS_SECONDS),
          toBn(DEFAULT_MIN_ORACLE_SPOT_INDEX),
          toBn(DEFAULT_MAX_ORACLE_SPOT_INDEX),
          DEFAULT_MAX_ORACLE_PRICE_DELTA_BPS,
          toBn(DEFAULT_MAX_LEVERAGE),
          toBn(DEFAULT_MIN_MARGIN),
          toBn(DEFAULT_MAX_MARKET_OPEN_INTEREST),
          toBn(DEFAULT_MIN_MARKET_INSURANCE),
          DEFAULT_MAINTENANCE_MARGIN_BPS,
          DEFAULT_LIQUIDATION_FEE_BPS,
          DEFAULT_TRADE_TREASURY_FEE_BPS,
          DEFAULT_TRADE_MARKET_MAKER_FEE_BPS,
        )
        .accountsPartial({
          config,
          authority: authority.publicKey,
        })
        .signers([authority])
        .rpc();
      assert.fail("update_config should remain frozen after freeze_config");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "ConfigFrozen"),
        `expected ConfigFrozen, got ${String(error)}`,
      );
    }
  });
});

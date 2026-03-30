import fs from "node:fs";
import path from "node:path";

import { ethers } from "ethers";

import {
  defaultRpcUrlForEvmNetwork,
  resolveBettingEvmDeployment,
  type BettingEvmNetwork,
} from "../../hyperbet-chain-registry/src/index";
import { loadDeploymentReceipt } from "./deployment-receipt";

const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
const REPORTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("REPORTER_ROLE"));
const FINALIZER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("FINALIZER_ROLE"));
const CHALLENGER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("CHALLENGER_ROLE"));
const PAUSER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("PAUSER_ROLE"));
const MARKET_OPERATOR_ROLE = ethers.keccak256(
  ethers.toUtf8Bytes("MARKET_OPERATOR_ROLE"),
);
const GOVERNANCE_SURFACE_FROZEN_SELECTOR = ethers
  .id("GovernanceSurfaceFrozen()")
  .slice(0, 10)
  .toLowerCase();
const CONFIG_FROZEN_SELECTOR = ethers
  .id("ConfigFrozen()")
  .slice(0, 10)
  .toLowerCase();

const ORACLE_ABI = [
  "function disputeWindowSeconds() view returns (uint64)",
  "function oracleActionsPaused() view returns (bool)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function grantRole(bytes32 role, address account)",
] as const;

const CLOB_ABI = [
  "function duelOracle() view returns (address)",
  "function treasury() view returns (address)",
  "function marketMaker() view returns (address)",
  "function tradeTreasuryFeeBps() view returns (uint256)",
  "function tradeMarketMakerFeeBps() view returns (uint256)",
  "function winningsMarketMakerFeeBps() view returns (uint256)",
  "function marketCreationPaused() view returns (bool)",
  "function orderPlacementPaused() view returns (bool)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function setFeeConfig(uint256 tradeTreasuryFeeBps, uint256 tradeMarketMakerFeeBps, uint256 winningsMarketMakerFeeBps)",
] as const;

const AMM_ABI = [
  "function mUSD() view returns (address)",
  "function duelOracle() view returns (address)",
  "function treasury() view returns (address)",
  "function feeBps() view returns (uint256)",
  "function configFrozen() view returns (bool)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function setFeeConfig(address treasury, uint256 feeBps)",
] as const;

const SKILL_ORACLE_ABI = [
  "function basePrice() view returns (uint256)",
  "function maxOracleDelay() view returns (uint256)",
  "function oraclePaused() view returns (bool)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function grantRole(bytes32 role, address account)",
] as const;

const PERP_ENGINE_ABI = [
  "function oracle() view returns (address)",
  "function marginToken() view returns (address)",
  "function defaultSkewScale() view returns (uint256)",
  "function fundingVelocity() view returns (uint256)",
  "function tradingPaused() view returns (bool)",
  "function marketCreationPaused() view returns (bool)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function setFundingVelocity(uint256)",
] as const;

interface DeploymentReceiptShape {
  duelOracleAddress?: string;
  goldClobAddress?: string;
  goldAmmRouterAddress?: string;
  mUsdTokenAddress?: string;
  goldTokenAddress?: string;
  skillOracleAddress?: string;
  perpEngineAddress?: string;
  perpMarginTokenAddress?: string;
}

function parseArg(name: string): string | undefined {
  const index = process.argv.findIndex((arg) => arg === name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function usage(): never {
  console.log(
    "usage: node --import tsx packages/evm-contracts/scripts/verify-deployment.ts --network bscTestnet|bsc|baseSepolia|base|avaxFuji|avax [--out <path>]",
  );
  process.exit(0);
}

function parseNetwork(value: string | undefined): BettingEvmNetwork {
  switch (value) {
    case "bscTestnet":
    case "bsc":
    case "baseSepolia":
    case "base":
    case "avaxFuji":
    case "avax":
      return value;
    default:
      throw new Error(`Unsupported --network value '${value ?? ""}'`);
  }
}

function appendCheck(ok: boolean, message: string, failures: Array<string>): void {
  const prefix = ok ? "[ok]" : "[fail]";
  console.log(`${prefix} ${message}`);
  if (!ok) failures.push(message);
}

function resolveReceipt(network: BettingEvmNetwork): DeploymentReceiptShape | null {
  return (loadDeploymentReceipt(network) as DeploymentReceiptShape | null) ?? null;
}

function pickAddress(
  override: string | undefined,
  receiptValue: string | undefined,
  manifestValue: string,
): string {
  return override?.trim() || receiptValue?.trim() || manifestValue.trim();
}

function pickOptionalAddress(
  override: string | undefined,
  receiptValue: string | undefined,
  manifestValue: string,
): string {
  return override?.trim() || receiptValue?.trim() || manifestValue.trim();
}

function extractRevertData(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as {
    data?: string;
    info?: { error?: { data?: string } };
    shortMessage?: string;
    message?: string;
  };
  return (
    candidate.data ||
    candidate.info?.error?.data ||
    (candidate.shortMessage?.includes("0x") ? candidate.shortMessage : undefined) ||
    (candidate.message?.includes("0x") ? candidate.message : undefined) ||
    null
  );
}

async function expectRevertSelector(
  provider: ethers.JsonRpcProvider,
  to: string,
  from: string,
  data: string,
  selectors: Array<string>,
): Promise<boolean> {
  try {
    await provider.call({ to, from, data });
    return false;
  } catch (error) {
    const revertData = extractRevertData(error)?.toLowerCase() || "";
    return selectors.some((selector) => revertData.includes(selector));
  }
}

function writeSummary(outPath: string | undefined, payload: unknown): void {
  if (!outPath) return;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCode(
  provider: ethers.JsonRpcProvider,
  address: string,
  attempts = 10,
  delayMs = 1000,
): Promise<string> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const code = await provider.getCode(address);
    if (code !== "0x") {
      return code;
    }
    if (attempt < attempts) {
      await sleep(delayMs);
    }
  }
  return "0x";
}

function parseUnitsEnv(
  rawValue: string | undefined,
  fallback: string,
  decimals = 18,
): bigint {
  return ethers.parseUnits((rawValue?.trim() || fallback).trim(), decimals);
}

async function main(): Promise<void> {
  if (process.argv.includes("--help")) usage();

  const network = parseNetwork(parseArg("--network"));
  const outPath = parseArg("--out");
  const manifest = resolveBettingEvmDeployment(network);
  const receipt = resolveReceipt(network);
  const rpcUrl =
    process.env[manifest.rpcEnvVar]?.trim() || defaultRpcUrlForEvmNetwork(network);

  const duelOracleAddress = pickAddress(
    parseArg("--duel-oracle-address"),
    receipt?.duelOracleAddress,
    manifest.duelOracleAddress,
  );
  const goldClobAddress = pickAddress(
    parseArg("--gold-clob-address"),
    receipt?.goldClobAddress,
    manifest.goldClobAddress,
  );
  const goldAmmRouterAddress = pickAddress(
    parseArg("--gold-amm-router-address"),
    receipt?.goldAmmRouterAddress,
    manifest.goldAmmRouterAddress,
  );
  const mUsdTokenAddress = pickAddress(
    parseArg("--musd-token-address"),
    receipt?.mUsdTokenAddress,
    manifest.mUsdTokenAddress,
  );
  const goldTokenAddress = pickAddress(
    parseArg("--gold-token-address"),
    receipt?.goldTokenAddress,
    manifest.goldTokenAddress,
  );
  const skillOracleAddress = pickAddress(
    parseArg("--skill-oracle-address"),
    receipt?.skillOracleAddress,
    manifest.skillOracleAddress,
  );
  const perpEngineAddress = pickAddress(
    parseArg("--perp-engine-address"),
    receipt?.perpEngineAddress,
    manifest.perpEngineAddress,
  );
  const perpMarginTokenAddress = pickOptionalAddress(
    parseArg("--perp-margin-token-address"),
    receipt?.perpMarginTokenAddress,
    goldTokenAddress,
  );

  const adminAddress =
    process.env.PERPS_ADMIN_ADDRESS?.trim() ||
    process.env.ADMIN_ADDRESS?.trim() ||
    manifest.adminAddress.trim();
  const marketOperatorAddress =
    process.env.PERPS_MARKET_OPERATOR_ADDRESS?.trim() ||
    process.env.MARKET_OPERATOR_ADDRESS?.trim() ||
    manifest.marketOperatorAddress.trim();
  const reporterAddress =
    process.env.PERPS_REPORTER_ADDRESS?.trim() ||
    process.env.REPORTER_ADDRESS?.trim() ||
    manifest.reporterAddress.trim();
  const finalizerAddress =
    process.env.FINALIZER_ADDRESS?.trim() || manifest.finalizerAddress.trim();
  const challengerAddress =
    process.env.CHALLENGER_ADDRESS?.trim() || manifest.challengerAddress.trim();
  const pauserAddress =
    process.env.PERPS_PAUSER_ADDRESS?.trim() ||
    process.env.PAUSER_ADDRESS?.trim() ||
    manifest.emergencyCouncilAddress.trim() ||
    adminAddress;
  const treasuryAddress =
    process.env.AMM_TREASURY_ADDRESS?.trim() ||
    process.env.TREASURY_ADDRESS?.trim() ||
    manifest.treasuryAddress.trim();
  const marketMakerAddress =
    process.env.MARKET_MAKER_ADDRESS?.trim() || manifest.marketMakerAddress.trim();
  const disputeWindowSeconds = Number.parseInt(
    process.env.DISPUTE_WINDOW_SECONDS?.trim() || "3600",
    10,
  );
  const expectedAmmFeeBps = Number.parseInt(
    process.env.AMM_FEE_BPS?.trim() || process.env.FEE_BPS?.trim() || "200",
    10,
  );
  const expectedOracleBasePrice = parseUnitsEnv(
    process.env.PERPS_INITIAL_BASE_PRICE,
    "100",
  );
  const expectedOracleMaxDelay = BigInt(
    process.env.PERPS_MAX_ORACLE_DELAY?.trim() || "120",
  );
  const expectedDefaultSkewScale = parseUnitsEnv(
    process.env.PERPS_DEFAULT_SKEW_SCALE,
    "1000000",
  );

  if (
    !duelOracleAddress ||
    !goldClobAddress ||
    !goldAmmRouterAddress ||
    !mUsdTokenAddress ||
    !goldTokenAddress ||
    !skillOracleAddress ||
    !perpEngineAddress
  ) {
    throw new Error(
      `Missing deployment addresses for ${network}. duelOracle='${duelOracleAddress}' goldClob='${goldClobAddress}' goldAmmRouter='${goldAmmRouterAddress}' mUsd='${mUsdTokenAddress}' goldToken='${goldTokenAddress}' skillOracle='${skillOracleAddress}' perpEngine='${perpEngineAddress}'`,
    );
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const oracle = new ethers.Contract(duelOracleAddress, ORACLE_ABI, provider);
  const clob = new ethers.Contract(goldClobAddress, CLOB_ABI, provider);
  const amm = new ethers.Contract(goldAmmRouterAddress, AMM_ABI, provider);
  const skillOracle = new ethers.Contract(
    skillOracleAddress,
    SKILL_ORACLE_ABI,
    provider,
  );
  const perpEngine = new ethers.Contract(
    perpEngineAddress,
    PERP_ENGINE_ABI,
    provider,
  );

  const failures: Array<string> = [];
  const [oracleCode, clobCode, ammCode, mUsdCode, goldTokenCode, skillOracleCode, perpEngineCode] =
    await Promise.all([
      waitForCode(provider, duelOracleAddress),
      waitForCode(provider, goldClobAddress),
      waitForCode(provider, goldAmmRouterAddress),
      waitForCode(provider, mUsdTokenAddress),
      waitForCode(provider, goldTokenAddress),
      waitForCode(provider, skillOracleAddress),
      waitForCode(provider, perpEngineAddress),
    ]);

  appendCheck(
    oracleCode !== "0x",
    `DuelOutcomeOracle deployed at ${duelOracleAddress}`,
    failures,
  );
  appendCheck(
    clobCode !== "0x",
    `GoldClob deployed at ${goldClobAddress}`,
    failures,
  );
  appendCheck(
    ammCode !== "0x",
    `AMM Router deployed at ${goldAmmRouterAddress}`,
    failures,
  );
  appendCheck(
    mUsdCode !== "0x",
    `mUSD token deployed at ${mUsdTokenAddress}`,
    failures,
  );
  appendCheck(
    goldTokenCode !== "0x",
    `gold token deployed at ${goldTokenAddress}`,
    failures,
  );
  appendCheck(
    skillOracleCode !== "0x",
    `SkillOracle deployed at ${skillOracleAddress}`,
    failures,
  );
  appendCheck(
    perpEngineCode !== "0x",
    `AgentPerpEngine deployed at ${perpEngineAddress}`,
    failures,
  );

  appendCheck(
    Number(await oracle.disputeWindowSeconds()) === disputeWindowSeconds,
    `oracle dispute window is ${disputeWindowSeconds}`,
    failures,
  );
  appendCheck(
    (await oracle.oracleActionsPaused()) === false,
    "oracle actions are not paused",
    failures,
  );
  appendCheck(
    (await oracle.hasRole(DEFAULT_ADMIN_ROLE, adminAddress)) === true,
    `oracle admin role granted to ${adminAddress}`,
    failures,
  );
  appendCheck(
    (await oracle.hasRole(REPORTER_ROLE, reporterAddress)) === true,
    `oracle reporter role granted to ${reporterAddress}`,
    failures,
  );
  appendCheck(
    (await oracle.hasRole(FINALIZER_ROLE, finalizerAddress)) === true,
    `oracle finalizer role granted to ${finalizerAddress}`,
    failures,
  );
  appendCheck(
    (await oracle.hasRole(CHALLENGER_ROLE, challengerAddress)) === true,
    `oracle challenger role granted to ${challengerAddress}`,
    failures,
  );
  appendCheck(
    (await oracle.hasRole(PAUSER_ROLE, pauserAddress)) === true,
    `oracle pauser role granted to ${pauserAddress}`,
    failures,
  );

  appendCheck(
    ethers.getAddress(await clob.duelOracle()) === ethers.getAddress(duelOracleAddress),
    "clob duelOracle immutable matches oracle deployment",
    failures,
  );
  appendCheck(
    ethers.getAddress(await clob.treasury()) === ethers.getAddress(treasuryAddress),
    `clob treasury immutable matches ${treasuryAddress}`,
    failures,
  );
  appendCheck(
    ethers.getAddress(await clob.marketMaker()) === ethers.getAddress(marketMakerAddress),
    `clob marketMaker immutable matches ${marketMakerAddress}`,
    failures,
  );
  appendCheck(
    (await clob.hasRole(DEFAULT_ADMIN_ROLE, adminAddress)) === true,
    `clob admin role granted to ${adminAddress}`,
    failures,
  );
  appendCheck(
    (await clob.hasRole(MARKET_OPERATOR_ROLE, marketOperatorAddress)) === true,
    `clob market operator role granted to ${marketOperatorAddress}`,
    failures,
  );
  appendCheck(
    (await clob.hasRole(PAUSER_ROLE, pauserAddress)) === true,
    `clob pauser role granted to ${pauserAddress}`,
    failures,
  );
  appendCheck(
    Number(await clob.tradeTreasuryFeeBps()) === 100,
    "clob trade treasury fee bps is 100",
    failures,
  );
  appendCheck(
    Number(await clob.tradeMarketMakerFeeBps()) === 100,
    "clob trade market-maker fee bps is 100",
    failures,
  );
  appendCheck(
    Number(await clob.winningsMarketMakerFeeBps()) === 200,
    "clob winnings market-maker fee bps is 200",
    failures,
  );
  appendCheck(
    (await clob.marketCreationPaused()) === false,
    "clob market creation is not paused",
    failures,
  );
  appendCheck(
    (await clob.orderPlacementPaused()) === false,
    "clob order placement is not paused",
    failures,
  );

  appendCheck(
    ethers.getAddress(await amm.mUSD()) === ethers.getAddress(mUsdTokenAddress),
    "amm mUSD immutable matches deployment",
    failures,
  );
  appendCheck(
    ethers.getAddress(await amm.duelOracle()) === ethers.getAddress(duelOracleAddress),
    "amm duelOracle immutable matches PM oracle",
    failures,
  );
  appendCheck(
    ethers.getAddress(await amm.treasury()) === ethers.getAddress(treasuryAddress),
    `amm treasury matches ${treasuryAddress}`,
    failures,
  );
  appendCheck(
    Number(await amm.feeBps()) === expectedAmmFeeBps,
    `amm fee bps is ${expectedAmmFeeBps}`,
    failures,
  );
  appendCheck(
    (await amm.configFrozen()) === true,
    "amm config is frozen",
    failures,
  );
  appendCheck(
    (await amm.hasRole(DEFAULT_ADMIN_ROLE, adminAddress)) === true,
    `amm admin role granted to ${adminAddress}`,
    failures,
  );
  appendCheck(
    (await amm.hasRole(MARKET_OPERATOR_ROLE, adminAddress)) === true,
    `amm market operator role granted to ${adminAddress}`,
    failures,
  );

  appendCheck(
    (await skillOracle.basePrice()) === expectedOracleBasePrice,
    `skill oracle base price is ${expectedOracleBasePrice.toString()}`,
    failures,
  );
  appendCheck(
    (await skillOracle.maxOracleDelay()) === expectedOracleMaxDelay,
    `skill oracle max oracle delay is ${expectedOracleMaxDelay.toString()}`,
    failures,
  );
  appendCheck(
    (await skillOracle.oraclePaused()) === false,
    "skill oracle is not paused",
    failures,
  );
  appendCheck(
    (await skillOracle.hasRole(DEFAULT_ADMIN_ROLE, adminAddress)) === true,
    `skill oracle admin role granted to ${adminAddress}`,
    failures,
  );
  appendCheck(
    (await skillOracle.hasRole(REPORTER_ROLE, reporterAddress)) === true,
    `skill oracle reporter role granted to ${reporterAddress}`,
    failures,
  );
  appendCheck(
    (await skillOracle.hasRole(PAUSER_ROLE, pauserAddress)) === true,
    `skill oracle pauser role granted to ${pauserAddress}`,
    failures,
  );

  appendCheck(
    ethers.getAddress(await perpEngine.oracle()) === ethers.getAddress(skillOracleAddress),
    "perp engine oracle matches skill oracle deployment",
    failures,
  );
  appendCheck(
    ethers.getAddress(await perpEngine.marginToken()) ===
      ethers.getAddress(perpMarginTokenAddress),
    "perp engine margin token matches deployment",
    failures,
  );
  appendCheck(
    BigInt(await perpEngine.defaultSkewScale()) === expectedDefaultSkewScale,
    `perp engine default skew scale is ${expectedDefaultSkewScale.toString()}`,
    failures,
  );
  appendCheck(
    BigInt(await perpEngine.fundingVelocity()) === 1_000_000_000_000n,
    "perp engine funding velocity is 1000000000000",
    failures,
  );
  appendCheck(
    (await perpEngine.tradingPaused()) === false,
    "perp engine trading is not paused",
    failures,
  );
  appendCheck(
    (await perpEngine.marketCreationPaused()) === false,
    "perp engine market creation is not paused",
    failures,
  );
  appendCheck(
    (await perpEngine.hasRole(DEFAULT_ADMIN_ROLE, adminAddress)) === true,
    `perp engine admin role granted to ${adminAddress}`,
    failures,
  );
  appendCheck(
    (await perpEngine.hasRole(MARKET_OPERATOR_ROLE, marketOperatorAddress)) === true,
    `perp engine market operator role granted to ${marketOperatorAddress}`,
    failures,
  );
  appendCheck(
    (await perpEngine.hasRole(PAUSER_ROLE, pauserAddress)) === true,
    `perp engine pauser role granted to ${pauserAddress}`,
    failures,
  );

  const oracleGovernanceFrozen = await expectRevertSelector(
    provider,
    duelOracleAddress,
    adminAddress,
    oracle.interface.encodeFunctionData("grantRole", [REPORTER_ROLE, adminAddress]),
    [GOVERNANCE_SURFACE_FROZEN_SELECTOR],
  );
  appendCheck(
    oracleGovernanceFrozen,
    "oracle grantRole(REPORTER_ROLE, ...) reverts with GovernanceSurfaceFrozen",
    failures,
  );

  const clobGovernanceFrozen = await expectRevertSelector(
    provider,
    goldClobAddress,
    adminAddress,
    clob.interface.encodeFunctionData("setFeeConfig", [101, 101, 201]),
    [GOVERNANCE_SURFACE_FROZEN_SELECTOR],
  );
  appendCheck(
    clobGovernanceFrozen,
    "clob setFeeConfig(...) reverts with GovernanceSurfaceFrozen",
    failures,
  );

  const ammGovernanceFrozen = await expectRevertSelector(
    provider,
    goldAmmRouterAddress,
    adminAddress,
    amm.interface.encodeFunctionData("setFeeConfig", [treasuryAddress, expectedAmmFeeBps + 1]),
    [CONFIG_FROZEN_SELECTOR, GOVERNANCE_SURFACE_FROZEN_SELECTOR],
  );
  appendCheck(
    ammGovernanceFrozen,
    "amm setFeeConfig(...) reverts with ConfigFrozen/GovernanceSurfaceFrozen",
    failures,
  );

  const skillOracleGovernanceFrozen = await expectRevertSelector(
    provider,
    skillOracleAddress,
    adminAddress,
    skillOracle.interface.encodeFunctionData("grantRole", [REPORTER_ROLE, adminAddress]),
    [GOVERNANCE_SURFACE_FROZEN_SELECTOR],
  );
  appendCheck(
    skillOracleGovernanceFrozen,
    "skill oracle grantRole(REPORTER_ROLE, ...) reverts with GovernanceSurfaceFrozen",
    failures,
  );

  const perpEngineGovernanceFrozen = await expectRevertSelector(
    provider,
    perpEngineAddress,
    adminAddress,
    perpEngine.interface.encodeFunctionData("setFundingVelocity", [1_000_000_000_001n]),
    [GOVERNANCE_SURFACE_FROZEN_SELECTOR],
  );
  appendCheck(
    perpEngineGovernanceFrozen,
    "perp engine setFundingVelocity(...) reverts with GovernanceSurfaceFrozen",
    failures,
  );

  const summary = {
    network,
    rpcUrl,
    duelOracleAddress,
    goldClobAddress,
    goldAmmRouterAddress,
    mUsdTokenAddress,
    goldTokenAddress,
    skillOracleAddress,
    perpEngineAddress,
    perpMarginTokenAddress,
    adminAddress,
    marketOperatorAddress,
    reporterAddress,
    finalizerAddress,
    challengerAddress,
    pauserAddress,
    treasuryAddress,
    marketMakerAddress,
    disputeWindowSeconds,
    expectedAmmFeeBps,
    expectedOracleBasePrice: expectedOracleBasePrice.toString(),
    expectedOracleMaxDelay: expectedOracleMaxDelay.toString(),
    expectedDefaultSkewScale: expectedDefaultSkewScale.toString(),
    failures,
  };
  writeSummary(outPath, summary);
  console.log(JSON.stringify(summary, null, 2));

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

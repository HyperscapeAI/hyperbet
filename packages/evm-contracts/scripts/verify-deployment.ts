import fs from "node:fs";
import path from "node:path";

import { ethers } from "ethers";

import {
  defaultRpcUrlForEvmNetwork,
  resolveBettingEvmDeployment,
  type BettingEvmNetwork,
} from "../../hyperbet-chain-registry/src/index";

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

const ORACLE_ABI = [
  "function disputeWindowSeconds() view returns (uint64)",
  "function oracleActionsPaused() view returns (bool)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function grantRole(bytes32 role, address account)",
];

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
];

function parseArg(name: string): string | undefined {
  const index = process.argv.findIndex((arg) => arg === name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function usage(): never {
  console.log(
    "usage: node --import tsx packages/evm-contracts/scripts/verify-deployment.ts --network bscTestnet|avaxFuji [--out <path>]",
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

function appendCheck(
  ok: boolean,
  message: string,
  failures: string[],
): void {
  const prefix = ok ? "[ok]" : "[fail]";
  console.log(`${prefix} ${message}`);
  if (!ok) failures.push(message);
}

function resolveReceipt(network: BettingEvmNetwork): {
  duelOracleAddress?: string;
  goldClobAddress?: string;
} | null {
  const receiptPath = path.resolve(__dirname, "..", "deployments", `${network}.json`);
  if (!fs.existsSync(receiptPath)) return null;
  return JSON.parse(fs.readFileSync(receiptPath, "utf8")) as {
    duelOracleAddress?: string;
    goldClobAddress?: string;
  };
}

function pickAddress(
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

async function expectGovernanceFrozen(
  provider: ethers.JsonRpcProvider,
  to: string,
  from: string,
  data: string,
): Promise<boolean> {
  try {
    await provider.call({ to, from, data });
    return false;
  } catch (error) {
    const revertData = extractRevertData(error)?.toLowerCase() || "";
    return revertData.includes(GOVERNANCE_SURFACE_FROZEN_SELECTOR);
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
  const adminAddress =
    process.env.ADMIN_ADDRESS?.trim() || manifest.adminAddress.trim();
  const marketOperatorAddress =
    process.env.MARKET_OPERATOR_ADDRESS?.trim() || manifest.marketOperatorAddress.trim();
  const reporterAddress =
    process.env.REPORTER_ADDRESS?.trim() || manifest.reporterAddress.trim();
  const finalizerAddress =
    process.env.FINALIZER_ADDRESS?.trim() || manifest.finalizerAddress.trim();
  const challengerAddress =
    process.env.CHALLENGER_ADDRESS?.trim() || manifest.challengerAddress.trim();
  const pauserAddress =
    process.env.PAUSER_ADDRESS?.trim() || manifest.emergencyCouncilAddress.trim() || adminAddress;
  const treasuryAddress =
    process.env.TREASURY_ADDRESS?.trim() || manifest.treasuryAddress.trim();
  const marketMakerAddress =
    process.env.MARKET_MAKER_ADDRESS?.trim() || manifest.marketMakerAddress.trim();
  const disputeWindowSeconds = Number.parseInt(
    process.env.DISPUTE_WINDOW_SECONDS?.trim() || "3600",
    10,
  );

  if (!duelOracleAddress || !goldClobAddress) {
    throw new Error(
      `Missing deployment addresses for ${network}. duelOracle='${duelOracleAddress}' goldClob='${goldClobAddress}'`,
    );
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const oracle = new ethers.Contract(duelOracleAddress, ORACLE_ABI, provider);
  const clob = new ethers.Contract(goldClobAddress, CLOB_ABI, provider);

  const failures: string[] = [];
  const [oracleCode, clobCode] = await Promise.all([
    waitForCode(provider, duelOracleAddress),
    waitForCode(provider, goldClobAddress),
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

  const oracleGovernanceFrozen = await expectGovernanceFrozen(
    provider,
    duelOracleAddress,
    adminAddress,
    oracle.interface.encodeFunctionData("grantRole", [REPORTER_ROLE, adminAddress]),
  );
  appendCheck(
    oracleGovernanceFrozen,
    "oracle grantRole(REPORTER_ROLE, ...) reverts with GovernanceSurfaceFrozen",
    failures,
  );

  const clobGovernanceFrozen = await expectGovernanceFrozen(
    provider,
    goldClobAddress,
    adminAddress,
    clob.interface.encodeFunctionData("setFeeConfig", [101, 101, 201]),
  );
  appendCheck(
    clobGovernanceFrozen,
    "clob setFeeConfig(...) reverts with GovernanceSurfaceFrozen",
    failures,
  );

  const summary = {
    network,
    rpcUrl,
    duelOracleAddress,
    goldClobAddress,
    adminAddress,
    marketOperatorAddress,
    reporterAddress,
    finalizerAddress,
    challengerAddress,
    pauserAddress,
    treasuryAddress,
    marketMakerAddress,
    disputeWindowSeconds,
    failures,
  };
  writeSummary(outPath, summary);
  console.log(JSON.stringify(summary, null, 2));

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

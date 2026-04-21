import fs from "node:fs";
import path from "node:path";

import { ethers, network } from "hardhat";
import { writeDeploymentReceipt } from "./deployment-receipt";

const PRODUCTION_CHAIN_IDS = new Set([56, 8453, 43114]);
const MANIFEST_NETWORK_KEYS = new Map<string, string>([
  ["bscTestnet", "bscTestnet"],
  ["bsc", "bsc"],
  ["baseSepolia", "baseSepolia"],
  ["base", "base"],
  ["avaxFuji", "avaxFuji"],
  ["avax", "avax"],
]);

function isValidAddress(value: string): boolean {
  return ethers.isAddress(value);
}

function resolveDisputeWindowSeconds(): number {
  const raw = process.env.DISPUTE_WINDOW_SECONDS?.trim() || "3600";
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 60) {
    throw new Error(`DISPUTE_WINDOW_SECONDS must be an integer >= 60, got: ${raw}`);
  }
  return parsed;
}

function resolveManifestPaths(): string[] {
  return [
    path.resolve(
      __dirname,
      "..",
      "..",
      "hyperbet-deployments",
      "contracts.json",
    ),
  ];
}

function updateBettingManifest(
  networkName: string,
  duelOracleAddress: string,
  goldClobAddress: string,
  adminAddress: string,
  marketOperatorAddress: string,
  treasuryAddress: string,
  marketMakerAddress: string,
  reporterAddress: string,
  finalizerAddress: string,
  challengerAddress: string,
  timelockAddress: string,
  multisigAddress: string,
  emergencyCouncilAddress: string,
  goldTokenAddress: string,
): void {
  const manifestKey = MANIFEST_NETWORK_KEYS.get(networkName);
  if (!manifestKey) return;
  if (process.env.SKIP_BETTING_MANIFEST_UPDATE === "true") {
    console.log("Skipping betting manifest update");
    return;
  }

  for (const manifestPath of resolveManifestPaths()) {
    if (!fs.existsSync(manifestPath)) {
      console.warn("Skipping missing betting manifest:", manifestPath);
      continue;
    }

    const rawManifest = fs.readFileSync(manifestPath, "utf8");
    const manifest = JSON.parse(rawManifest) as {
      evm?: Record<
        string,
        {
          duelOracleAddress?: string;
          goldClobAddress?: string;
          adminAddress?: string;
          marketOperatorAddress?: string;
          treasuryAddress?: string;
          marketMakerAddress?: string;
          reporterAddress?: string;
          finalizerAddress?: string;
          challengerAddress?: string;
          timelockAddress?: string;
          multisigAddress?: string;
          emergencyCouncilAddress?: string;
          deploymentVersion?: string;
          goldTokenAddress?: string;
        }
      >;
    };

    if (!manifest.evm || !manifest.evm[manifestKey]) {
      console.warn(
        `Skipping manifest without evm entry '${manifestKey}': ${manifestPath}`,
      );
      continue;
    }

    manifest.evm[manifestKey] = {
      ...manifest.evm[manifestKey],
      duelOracleAddress,
      goldClobAddress,
      adminAddress,
      marketOperatorAddress,
      treasuryAddress,
      marketMakerAddress,
      reporterAddress,
      finalizerAddress,
      challengerAddress,
      timelockAddress,
      multisigAddress,
      emergencyCouncilAddress,
      deploymentVersion: "v2",
      goldTokenAddress:
        goldTokenAddress.trim().length > 0
          ? goldTokenAddress
          : manifest.evm[manifestKey].goldTokenAddress || "",
    };

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    console.log("Updated betting manifest:", manifestPath);
  }
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);
  const isProduction =
    PRODUCTION_CHAIN_IDS.has(chainId) ||
    network.name === "bsc" ||
    network.name === "base";

  console.log("Deploying contracts with the account:", deployer.address);
  console.log("Network:", network.name, `(chainId=${chainId})`);

  const treasury = process.env.TREASURY_ADDRESS?.trim() || deployer.address;
  const marketMaker =
    process.env.MARKET_MAKER_ADDRESS?.trim() || deployer.address;
  const timelockAddress =
    process.env.TIMELOCK_ADDRESS?.trim() ||
    process.env.ADMIN_ADDRESS?.trim() ||
    deployer.address;
  const multisigAddress =
    process.env.MULTISIG_ADDRESS?.trim() ||
    process.env.ADMIN_ADDRESS?.trim() ||
    timelockAddress;
  const emergencyCouncilAddress =
    process.env.EMERGENCY_COUNCIL_ADDRESS?.trim() || timelockAddress;
  const adminAddress = timelockAddress;
  const marketOperator =
    process.env.MARKET_OPERATOR_ADDRESS?.trim() || deployer.address;
  const reporterAddress =
    process.env.REPORTER_ADDRESS?.trim() || deployer.address;
  const finalizerAddress =
    process.env.FINALIZER_ADDRESS?.trim() || multisigAddress;
  const challengerAddress =
    process.env.CHALLENGER_ADDRESS?.trim() || multisigAddress;
  const goldTokenAddress = process.env.GOLD_TOKEN_ADDRESS?.trim() || "";
  const disputeWindowSeconds = resolveDisputeWindowSeconds();

  if (!isValidAddress(adminAddress)) {
    throw new Error(`Invalid TIMELOCK_ADDRESS/ADMIN_ADDRESS: ${adminAddress}`);
  }
  if (!isValidAddress(multisigAddress)) {
    throw new Error(`Invalid MULTISIG_ADDRESS/ADMIN_ADDRESS: ${multisigAddress}`);
  }
  if (!isValidAddress(emergencyCouncilAddress)) {
    throw new Error(
      `Invalid EMERGENCY_COUNCIL_ADDRESS: ${emergencyCouncilAddress}`,
    );
  }
  if (!isValidAddress(marketOperator)) {
    throw new Error(`Invalid MARKET_OPERATOR_ADDRESS: ${marketOperator}`);
  }
  if (!isValidAddress(reporterAddress)) {
    throw new Error(`Invalid REPORTER_ADDRESS: ${reporterAddress}`);
  }
  if (!isValidAddress(finalizerAddress)) {
    throw new Error(`Invalid FINALIZER_ADDRESS: ${finalizerAddress}`);
  }
  if (!isValidAddress(challengerAddress)) {
    throw new Error(`Invalid CHALLENGER_ADDRESS: ${challengerAddress}`);
  }
  if (!isValidAddress(treasury)) {
    throw new Error(`Invalid TREASURY_ADDRESS: ${treasury}`);
  }
  if (!isValidAddress(marketMaker)) {
    throw new Error(`Invalid MARKET_MAKER_ADDRESS: ${marketMaker}`);
  }
  if (goldTokenAddress && !isValidAddress(goldTokenAddress)) {
    throw new Error(`Invalid GOLD_TOKEN_ADDRESS: ${goldTokenAddress}`);
  }

  if (isProduction) {
    if (
      (!process.env.MULTISIG_ADDRESS && !process.env.ADMIN_ADDRESS) ||
      !process.env.TIMELOCK_ADDRESS ||
      !process.env.EMERGENCY_COUNCIL_ADDRESS ||
      !process.env.MARKET_OPERATOR_ADDRESS ||
      !process.env.REPORTER_ADDRESS ||
      !process.env.FINALIZER_ADDRESS ||
      !process.env.CHALLENGER_ADDRESS ||
      !process.env.TREASURY_ADDRESS ||
      !process.env.MARKET_MAKER_ADDRESS
    ) {
      throw new Error(
        "Mainnet deployment requires effective wallet setup before deploy can succeed: TIMELOCK_ADDRESS, EMERGENCY_COUNCIL_ADDRESS, MULTISIG_ADDRESS or ADMIN_ADDRESS, MARKET_OPERATOR_ADDRESS, REPORTER_ADDRESS, FINALIZER_ADDRESS, CHALLENGER_ADDRESS, TREASURY_ADDRESS, and MARKET_MAKER_ADDRESS must all be explicitly set to the real AVAX governance/operator wallets",
      );
    }
  }

  console.log("Deploying DuelOutcomeOracle...");
  const DuelOutcomeOracle = await ethers.getContractFactory("DuelOutcomeOracle");
  const duelOracle = await DuelOutcomeOracle.deploy(
    adminAddress,
    reporterAddress,
    finalizerAddress,
    challengerAddress,
    emergencyCouncilAddress,
    disputeWindowSeconds,
  );
  await duelOracle.waitForDeployment();

  console.log("Deploying GoldClob...");
  const GoldClob = await ethers.getContractFactory("GoldClob");
  const clob = await GoldClob.deploy(
    adminAddress,
    marketOperator,
    await duelOracle.getAddress(),
    treasury,
    marketMaker,
    emergencyCouncilAddress,
  );
  await clob.waitForDeployment();

  console.log("DuelOutcomeOracle deployed to:", await duelOracle.getAddress());
  console.log("GoldClob deployed to:", await clob.getAddress());
  console.log("Configuration:");
  console.log("- Governance timelock:", timelockAddress);
  console.log("- Governance multisig:", multisigAddress);
  console.log("- Emergency council:", emergencyCouncilAddress);
  console.log("- Market Operator:", marketOperator);
  console.log("- Reporter:", reporterAddress);
  console.log("- Finalizer:", finalizerAddress);
  console.log("- Challenger:", challengerAddress);
  console.log("- Dispute window seconds:", disputeWindowSeconds);
  console.log("- Treasury:", treasury);
  console.log("- Market Maker:", marketMaker);
  if (goldTokenAddress) {
    console.log("- GOLD token:", goldTokenAddress);
  }

  const clobAddress = await clob.getAddress();
  const duelOracleAddress = await duelOracle.getAddress();
  const deploymentTxHash = clob.deploymentTransaction()?.hash ?? null;
  writeDeploymentReceipt(network.name, {
    network: network.name,
    chainId,
    deployer: deployer.address,
    duelOracleAddress,
    goldClobAddress: clobAddress,
    adminAddress,
    marketOperatorAddress: marketOperator,
    reporterAddress,
    finalizerAddress,
    challengerAddress,
    treasuryAddress: treasury,
    marketMakerAddress: marketMaker,
    timelockAddress,
    multisigAddress,
    emergencyCouncilAddress,
    goldTokenAddress,
    deploymentTxHash,
    deployedAt: new Date().toISOString(),
  });
  updateBettingManifest(
    network.name,
    duelOracleAddress,
    clobAddress,
    adminAddress,
    marketOperator,
    treasury,
    marketMaker,
    reporterAddress,
    finalizerAddress,
    challengerAddress,
    timelockAddress,
    multisigAddress,
    emergencyCouncilAddress,
    goldTokenAddress,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

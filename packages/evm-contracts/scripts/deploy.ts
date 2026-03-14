import fs from "node:fs";
import path from "node:path";

import { ethers, network } from "hardhat";

const PRODUCTION_CHAIN_IDS = new Set([56, 8453]);
const MANIFEST_NETWORK_KEYS = new Map<string, string>([
  ["bscTestnet", "bscTestnet"],
  ["bsc", "bsc"],
  ["baseSepolia", "baseSepolia"],
  ["base", "base"],
]);

function isValidAddress(value: string): boolean {
  return ethers.isAddress(value);
}

function resolveDeploymentOutputPath(networkName: string): string {
  return path.resolve(__dirname, "..", "deployments", `${networkName}.json`);
}

function ensureDir(filepath: string): void {
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
}

function writeDeploymentReceipt(
  networkName: string,
  payload: Record<string, string | number | null>,
): void {
  const outputPath = resolveDeploymentOutputPath(networkName);
  ensureDir(outputPath);
  fs.writeFileSync(`${outputPath}`, JSON.stringify(payload, null, 2));
  console.log("Deployment receipt written to:", outputPath);
}

function resolveManifestPaths(): string[] {
  return [
    path.resolve(
      __dirname,
      "..",
      "..",
      "hyperbet-solana",
      "deployments",
      "contracts.json",
    ),
    path.resolve(
      __dirname,
      "..",
      "..",
      "hyperbet-bsc",
      "deployments",
      "contracts.json",
    ),
  ];
}

function updateBettingManifest(
  networkName: string,
  duelOracleAddress: string,
  lvrRouterAddress: string,
  adminAddress: string,
  marketOperatorAddress: string,
  treasuryAddress: string,
  marketMakerAddress: string,
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
          lvrRouterAddress?: string;
          adminAddress?: string;
          marketOperatorAddress?: string;
          treasuryAddress?: string;
          marketMakerAddress?: string;
          deploymentVersion?: string;
          goldTokenAddress?: string;
        }
      >;
    };

    if (!manifest.evm || !manifest.evm[manifestKey]) {
      throw new Error(
        `Missing evm manifest entry '${manifestKey}' in ${manifestPath}`,
      );
    }

    manifest.evm[manifestKey] = {
      ...manifest.evm[manifestKey],
      duelOracleAddress,
      lvrRouterAddress,
      adminAddress,
      marketOperatorAddress,
      treasuryAddress,
      marketMakerAddress,
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
  const adminAddress = process.env.ADMIN_ADDRESS?.trim() || deployer.address;
  const marketOperator =
    process.env.MARKET_OPERATOR_ADDRESS?.trim() || deployer.address;
  const reporterAddress =
    process.env.REPORTER_ADDRESS?.trim() || deployer.address;
  const goldTokenAddress = process.env.GOLD_TOKEN_ADDRESS?.trim() || "";

  if (!isValidAddress(adminAddress)) {
    throw new Error(`Invalid ADMIN_ADDRESS: ${adminAddress}`);
  }
  if (!isValidAddress(marketOperator)) {
    throw new Error(`Invalid MARKET_OPERATOR_ADDRESS: ${marketOperator}`);
  }
  if (!isValidAddress(reporterAddress)) {
    throw new Error(`Invalid REPORTER_ADDRESS: ${reporterAddress}`);
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
      !process.env.ADMIN_ADDRESS ||
      !process.env.MARKET_OPERATOR_ADDRESS ||
      !process.env.REPORTER_ADDRESS ||
      !process.env.TREASURY_ADDRESS ||
      !process.env.MARKET_MAKER_ADDRESS
    ) {
      throw new Error(
        "Mainnet deployment requires ADMIN_ADDRESS, MARKET_OPERATOR_ADDRESS, REPORTER_ADDRESS, TREASURY_ADDRESS, and MARKET_MAKER_ADDRESS to be explicitly set",
      );
    }
  }

  console.log("Deploying DuelOutcomeOracle...");
  const DuelOutcomeOracle = await ethers.getContractFactory("DuelOutcomeOracle");
  const duelOracle = await DuelOutcomeOracle.deploy(adminAddress, reporterAddress);
  await duelOracle.waitForDeployment();

  console.log("Deploying LvrRouter...");
  const LvrRouter = await ethers.getContractFactory("LvrRouter");
  const clob = await LvrRouter.deploy(
    adminAddress,
    marketOperator,
    await duelOracle.getAddress(),
    treasury,
    marketMaker,
  );
  await clob.waitForDeployment();

  console.log("DuelOutcomeOracle deployed to:", await duelOracle.getAddress());
  console.log("LvrRouter deployed to:", await clob.getAddress());
  console.log("Configuration:");
  console.log("- Admin:", adminAddress);
  console.log("- Market Operator:", marketOperator);
  console.log("- Reporter:", reporterAddress);
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
    lvrRouterAddress: clobAddress,
    adminAddress,
    marketOperatorAddress: marketOperator,
    reporterAddress,
    treasuryAddress: treasury,
    marketMakerAddress: marketMaker,
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
    goldTokenAddress,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

interface DeploymentReceipt {
  pmAmmRouterAddress: string;
  mUsdAddress: string;
  oracleAddress: string;
  pmAmmTreasury: string;
  pmAmmFeeBps: number;
  [key: string]: unknown;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying PM-AMM with account:", deployer.address);

  const treasuryAddress = process.env.TREASURY_ADDRESS || deployer.address;
  const feeBps = process.env.FEE_BPS ? parseInt(process.env.FEE_BPS) : 200; // 2%

  let mUsdAddress = process.env.MOCK_USD_ADDRESS;

  if (!mUsdAddress && network.name === "localhost") {
    console.log("No MOCK_USD_ADDRESS found, deploying MockUSD...");
    const MockUSD = await ethers.getContractFactory("MockUSD");
    const musd = await MockUSD.deploy();
    await musd.waitForDeployment();
    mUsdAddress = await musd.getAddress();
    console.log("MockUSD deployed to:", mUsdAddress);
  }

  if (!mUsdAddress) {
    throw new Error("MOCK_USD_ADDRESS must be set for non-localhost networks");
  }

  const oracleAddress = process.env.ORACLE_ADDRESS;
  if (!oracleAddress) {
    throw new Error("ORACLE_ADDRESS must be set for Router deployment");
  }

  const adminAddress = process.env.ADMIN_ADDRESS;
  if (!adminAddress) {
    throw new Error("ADMIN_ADDRESS must be set explicitly (never fall back to deployer)");
  }

  console.log("Deploying AMM Router...");
  const Router = await ethers.getContractFactory("Router");
  const router = await Router.deploy(mUsdAddress, oracleAddress, treasuryAddress, feeBps, adminAddress);
  await router.waitForDeployment();

  const routerAddress = await router.getAddress();
  console.log("PM-AMM Router deployed to:", routerAddress);
  console.log("Config: Oracle =", oracleAddress, ", Treasury =", treasuryAddress, ", feeBps =", feeBps, ", admin =", adminAddress);

  // Update deployment receipt
  const receiptPath = path.join(__dirname, `../deployments/${network.name}.json`);
  let receipt: DeploymentReceipt = {} as DeploymentReceipt;
  if (fs.existsSync(receiptPath)) {
    try {
      receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8")) as DeploymentReceipt;
    } catch (err) {
      console.warn("Failed to parse existing deployment receipt, overwriting:", err);
    }
  }

  receipt.pmAmmRouterAddress = routerAddress;
  receipt.mUsdAddress = mUsdAddress;
  receipt.oracleAddress = oracleAddress;
  receipt.pmAmmTreasury = treasuryAddress;
  receipt.pmAmmFeeBps = feeBps;

  if (!fs.existsSync(path.dirname(receiptPath))) {
    fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  }
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  console.log("Deployment receipt updated at:", receiptPath);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

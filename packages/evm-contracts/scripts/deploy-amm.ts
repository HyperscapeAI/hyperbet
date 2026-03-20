import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

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

  const adminAddress = process.env.ADMIN_ADDRESS || deployer.address;

  console.log("Deploying AMM Router...");
  const Router = await ethers.getContractFactory("Router");
  const router = await Router.deploy(mUsdAddress, treasuryAddress, feeBps, adminAddress);
  await router.waitForDeployment();

  const routerAddress = await router.getAddress();
  console.log("PM-AMM Router deployed to:", routerAddress);
  console.log("Config: Treasury =", treasuryAddress, ", feeBps =", feeBps, ", admin =", adminAddress);

  // Update deployment receipt
  const receiptPath = path.join(__dirname, `../deployments/${network.name}.json`);
  let receipt: any = {};
  if (fs.existsSync(receiptPath)) {
    receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  }
  
  receipt.pmAmmRouterAddress = routerAddress;
  receipt.mUsdAddress = mUsdAddress;
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

import fs from "node:fs";
import path from "node:path";

import { ethers, network } from "hardhat";

type WalletManifest = {
  evm: Record<string, string>;
};

type TokenRecord = {
  network: string;
  chainId: number;
  deployer: string;
  deployedAt: string;
  mUsdTokenAddress: string;
  perpsMarginTokenAddress: string;
  goldTokenAddress: string;
  goldTokenIsMarginAlias: boolean;
  mintedTo: Record<string, { address: string; mUsd: string; perpsMargin: string }>;
};

type TokenAddressBook = Record<string, string>;

function getArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseUnitsAmount(raw: string, decimals = 18): bigint {
  return ethers.parseUnits(raw, decimals);
}

function resolveWalletDir(): string {
  return path.resolve(
    process.cwd(),
    getArg("--wallet-dir") ?? path.join("..", "..", "keys", "stage-a"),
  );
}

function resolveOutPath(walletDir: string): string {
  return path.resolve(
    process.cwd(),
    getArg("--out") ?? path.join(walletDir, "token-addresses.json"),
  );
}

function ensureDir(filepath: string): void {
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
}

function loadManifest(walletDir: string): WalletManifest {
  return JSON.parse(
    fs.readFileSync(path.join(walletDir, "public-addresses.json"), "utf8"),
  ) as WalletManifest;
}

function loadTokenAddressBook(outPath: string): TokenAddressBook {
  if (!fs.existsSync(outPath)) return {};
  return JSON.parse(fs.readFileSync(outPath, "utf8")) as TokenAddressBook;
}

function saveTokenAddressBook(outPath: string, value: TokenAddressBook): void {
  ensureDir(outPath);
  fs.writeFileSync(outPath, JSON.stringify(value, null, 2) + "\n");
}

async function main() {
  const walletDir = resolveWalletDir();
  const outPath = resolveOutPath(walletDir);
  const manifest = loadManifest(walletDir);
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);
  const networkKey = network.name;

  const mUsdMintAmount = parseUnitsAmount(process.env.STAGE_A_MUSD_MINT_AMOUNT ?? "100000");
  const marginMintAmount = parseUnitsAmount(
    process.env.STAGE_A_PERPS_MARGIN_MINT_AMOUNT ?? "100000",
  );
  const marginTokenName = process.env.STAGE_A_PERPS_MARGIN_NAME?.trim() || "Stage A Margin Token";
  const marginTokenSymbol =
    process.env.STAGE_A_PERPS_MARGIN_SYMBOL?.trim() || "sMARGIN";

  const MockUSD = await ethers.getContractFactory("MockUSD");
  const musd = await MockUSD.deploy();
  await musd.waitForDeployment();

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const marginToken = await MockERC20.deploy(marginTokenName, marginTokenSymbol);
  await marginToken.waitForDeployment();

  const recipients = {
    deployer: manifest.evm.deployer,
    admin: manifest.evm.admin,
    market_operator: manifest.evm.market_operator,
    market_maker: manifest.evm.market_maker,
    keeper: manifest.evm.keeper,
    canary: manifest.evm.canary,
    matcher: manifest.evm.matcher,
  };

  const mintedTo: TokenRecord["mintedTo"] = {};
  for (const [role, address] of Object.entries(recipients)) {
    await (await musd.mint(address, mUsdMintAmount)).wait();
    await (await marginToken.mint(address, marginMintAmount)).wait();
    mintedTo[role] = {
      address,
      mUsd: mUsdMintAmount.toString(),
      perpsMargin: marginMintAmount.toString(),
    };
  }

  const mUsdTokenAddress = await musd.getAddress();
  const perpsMarginTokenAddress = await marginToken.getAddress();
  const goldTokenAddress = perpsMarginTokenAddress;

  const record: TokenRecord = {
    network: networkKey,
    chainId,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    mUsdTokenAddress,
    perpsMarginTokenAddress,
    goldTokenAddress,
    goldTokenIsMarginAlias: true,
    mintedTo,
  };

  const addressBook = loadTokenAddressBook(outPath);
  if (networkKey === "bscTestnet") {
    addressBook.BSC_TESTNET_MUSD_TOKEN_ADDRESS = mUsdTokenAddress;
    addressBook.BSC_TESTNET_PERPS_MARGIN_TOKEN_ADDRESS = perpsMarginTokenAddress;
    addressBook.BSC_TESTNET_GOLD_TOKEN_ADDRESS = goldTokenAddress;
  } else if (networkKey === "avaxFuji") {
    addressBook.AVAX_FUJI_MUSD_TOKEN_ADDRESS = mUsdTokenAddress;
    addressBook.AVAX_FUJI_PERPS_MARGIN_TOKEN_ADDRESS = perpsMarginTokenAddress;
    addressBook.AVAX_FUJI_GOLD_TOKEN_ADDRESS = goldTokenAddress;
  }

  saveTokenAddressBook(outPath, addressBook);

  const recordOutPath = outPath.replace(/\.json$/, `.${networkKey}.json`);
  ensureDir(recordOutPath);
  fs.writeFileSync(recordOutPath, JSON.stringify(record, null, 2) + "\n");

  console.log(
    JSON.stringify(
      {
        walletDir,
        outPath,
        recordOutPath,
        record,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

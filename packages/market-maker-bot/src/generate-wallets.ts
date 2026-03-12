import { writeFile } from "node:fs/promises";
import path from "node:path";
import { ethers } from "ethers";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

type WalletEntry = {
  name: string;
  evmPrivateKey: string;
  solanaPrivateKey: string;
};

type WalletConfigFile = {
  defaults: Record<string, string>;
  wallets: WalletEntry[];
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const getValue = (flag: string, fallback: string) => {
    const index = args.indexOf(flag);
    if (index === -1) return fallback;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) return fallback;
    return value;
  };

  const countRaw = getValue("--count", "3");
  const count = Math.max(1, Number.parseInt(countRaw, 10) || 3);
  const prefix = getValue("--prefix", "mm-wallet");
  const outPath = getValue("--out", "wallets.generated.json");
  return { count, prefix, outPath };
};

async function main() {
  const { count, prefix, outPath } = parseArgs();
  const wallets: WalletEntry[] = [];

  for (let i = 0; i < count; i += 1) {
    const walletName = `${prefix}-${i + 1}`;
    const evmWallet = ethers.Wallet.createRandom();
    const solanaKeypair = Keypair.generate();
    wallets.push({
      name: walletName,
      evmPrivateKey: evmWallet.privateKey,
      solanaPrivateKey: bs58.encode(solanaKeypair.secretKey),
    });
  }

  const config: WalletConfigFile = {
    defaults: {
      MM_ENABLE_BSC: "true",
      MM_ENABLE_BASE: "true",
      MM_ENABLE_AVAX: "true",
      MM_ENABLE_SOLANA: "true",
    },
    wallets,
  };

  const resolvedOutPath = path.resolve(process.cwd(), outPath);
  await writeFile(resolvedOutPath, JSON.stringify(config, null, 2));

  console.log(
    `[wallet-gen] wrote ${wallets.length} wallets to ${resolvedOutPath}`,
  );
  console.log("[wallet-gen] keep this file private and out of version control");
}

main().catch((error) => {
  console.error("[wallet-gen] failed:", error);
  process.exit(1);
});

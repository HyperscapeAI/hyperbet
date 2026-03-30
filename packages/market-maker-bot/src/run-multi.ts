import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

type WalletInstance = {
  name: string;
  evmPrivateKey?: string;
  evmPrivateKeyBsc?: string;
  evmPrivateKeyBase?: string;
  evmPrivateKeyAvax?: string;
  solanaPrivateKey?: string;
  env?: Record<string, string>;
};

type MultiWalletConfig = {
  defaults?: Record<string, string>;
  wallets: WalletInstance[];
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

  return {
    configPath: getValue("--config", "wallets.generated.json"),
    staggerMs: Math.max(
      0,
      Number.parseInt(getValue("--stagger-ms", "1200"), 10) || 1200,
    ),
    dryRun: args.includes("--dry-run"),
  };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const maskSecret = (value: string | undefined) => {
  if (!value) return "(unset)";
  if (value.length <= 10) return "***";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
};

async function loadConfig(configPath: string): Promise<MultiWalletConfig> {
  const resolved = path.resolve(process.cwd(), configPath);
  const raw = await readFile(resolved, "utf8");
  const parsed = JSON.parse(raw) as MultiWalletConfig;
  if (
    !parsed ||
    !Array.isArray(parsed.wallets) ||
    parsed.wallets.length === 0
  ) {
    throw new Error("Config must include a non-empty wallets array");
  }
  return parsed;
}

function bindPrefixedOutput(
  proc: ChildProcessWithoutNullStreams,
  name: string,
  stream: "stdout" | "stderr",
) {
  proc[stream].on("data", (chunk) => {
    const text = chunk.toString();
    const lines = text.split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      const prefix = `[mm:${name}]`;
      if (stream === "stderr") {
        console.error(`${prefix} ${line}`);
      } else {
        console.log(`${prefix} ${line}`);
      }
    }
  });
}

async function main() {
  const { configPath, staggerMs, dryRun } = parseArgs();
  const config = await loadConfig(configPath);
  const defaults = config.defaults ?? {};
  const children = new Map<string, ChildProcessWithoutNullStreams>();
  let shuttingDown = false;

  const shutdownAll = (signal: NodeJS.Signals = "SIGTERM") => {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const [name, child] of children.entries()) {
      console.log(`[mm:runner] stopping ${name} (${signal})`);
      child.kill(signal);
    }
  };

  process.on("SIGINT", () => shutdownAll("SIGINT"));
  process.on("SIGTERM", () => shutdownAll("SIGTERM"));

  for (const wallet of config.wallets) {
    if (!wallet.name || !wallet.name.trim()) {
      throw new Error("Each wallet entry must have a non-empty name");
    }

    const env: NodeJS.ProcessEnv = {
      ...defaults,
      ...process.env,
      ...(wallet.env ?? {}),
      MM_INSTANCE_ID: wallet.name,
      EVM_PRIVATE_KEY: wallet.evmPrivateKey || process.env.EVM_PRIVATE_KEY,
      EVM_PRIVATE_KEY_BSC:
        wallet.evmPrivateKeyBsc ||
        wallet.evmPrivateKey ||
        process.env.EVM_PRIVATE_KEY_BSC,
      EVM_PRIVATE_KEY_BASE:
        wallet.evmPrivateKeyBase ||
        wallet.evmPrivateKey ||
        process.env.EVM_PRIVATE_KEY_BASE,
      EVM_PRIVATE_KEY_AVAX:
        wallet.evmPrivateKeyAvax ||
        wallet.evmPrivateKey ||
        process.env.EVM_PRIVATE_KEY_AVAX,
      SOLANA_PRIVATE_KEY:
        wallet.solanaPrivateKey || process.env.SOLANA_PRIVATE_KEY,
    };

    if (dryRun) {
      console.log(
        `[mm:runner] ${wallet.name} | evm=${maskSecret(env.EVM_PRIVATE_KEY)} | sol=${maskSecret(env.SOLANA_PRIVATE_KEY)}`,
      );
      continue;
    }

    const child = spawn("tsx", ["src/index.ts"], {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    children.set(wallet.name, child);
    bindPrefixedOutput(child, wallet.name, "stdout");
    bindPrefixedOutput(child, wallet.name, "stderr");

    child.on("exit", (code, signal) => {
      children.delete(wallet.name);
      if (shuttingDown) return;
      if (code === 0) {
        console.log(`[mm:runner] ${wallet.name} exited cleanly`);
        return;
      }
      console.error(
        `[mm:runner] ${wallet.name} exited unexpectedly (code=${code ?? "null"} signal=${signal ?? "none"})`,
      );
      shutdownAll();
      process.exit(code ?? 1);
    });

    console.log(`[mm:runner] started ${wallet.name}`);
    await sleep(staggerMs);
  }

  if (dryRun) {
    console.log("[mm:runner] dry run complete");
    return;
  }

  console.log(`[mm:runner] active instances: ${children.size}`);
  await new Promise<void>(() => {
    // Keep process alive while child market-makers run.
  });
}

main().catch((error) => {
  console.error("[mm:runner] failed:", error);
  process.exit(1);
});

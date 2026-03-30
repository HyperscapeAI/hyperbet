import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream } from "node:fs";

import { resolveBettingEvmDeploymentForChain } from "../packages/hyperbet-chain-registry/src/index";

import {
  copyIntoArtifacts,
  resolveArtifactRoot,
  rootDir,
  runCommand,
} from "./ci-lib";

const artifactRoot = resolveArtifactRoot("base-add-chain-smoke");
const anvilLog = path.join(artifactRoot, "anvil.log");
const bsc = resolveBettingEvmDeploymentForChain("bsc", "mainnet-beta");
const base = resolveBettingEvmDeploymentForChain("base", "mainnet-beta");

let stopAnvil: (() => void) | null = null;

async function startAnvil(): Promise<{ pid: number; stop: () => void }> {
  const logStream = createWriteStream(anvilLog, { flags: "w" });
  const child = spawn(
    "anvil",
    ["--silent", "--host", "127.0.0.1", "--port", "18545", "--chain-id", "8453"],
    {
      cwd: rootDir,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout?.pipe(logStream);
  child.stderr?.pipe(logStream);
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (!child.pid) {
    throw new Error("failed to start anvil");
  }
  try {
    process.kill(child.pid, 0);
  } catch {
    throw new Error(`anvil exited before readiness check; see ${anvilLog}`);
  }
  return {
    pid: child.pid,
    stop: () => {
      try {
        process.kill(child.pid!, "SIGTERM");
      } catch {
        // Process already exited.
      }
      logStream.end();
    },
  };
}

async function waitForAnvil(): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = spawnSync(
        "curl",
        [
          "-fsS",
          "-X",
          "POST",
          "http://127.0.0.1:18545",
          "-H",
          "content-type: application/json",
          "--data",
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_blockNumber",
            params: [],
          }),
        ],
        {
          cwd: rootDir,
          encoding: "utf8",
        },
      );
      if (response.status !== 0) {
        throw new Error((response.stderr || "").trim() || "curl probe failed");
      }
      const payload = JSON.parse(response.stdout || "null") as { result?: string };
      if (typeof payload.result === "string") {
        return;
      }
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("anvil did not become ready");
}

try {
  await runCommand(
    "bun",
    ["run", "--cwd", "packages/evm-contracts", "build:foundry:pm"],
    {
      stdoutFile: path.join(artifactRoot, "foundry-build.out.log"),
      stderrFile: path.join(artifactRoot, "foundry-build.err.log"),
    },
  );
  console.log("Base add-chain smoke: foundry artifacts built");

  const anvil = await startAnvil();
  stopAnvil = anvil.stop;
  console.log(`Base add-chain smoke: started anvil pid ${anvil.pid}`);

  await waitForAnvil();
  console.log("Base add-chain smoke: anvil ready");

  await runCommand(
    "bun",
    ["test", "packages/hyperbet-chain-registry/tests/chainRegistry.test.ts"],
    {
      stdoutFile: path.join(artifactRoot, "chain-registry.out.log"),
      stderrFile: path.join(artifactRoot, "chain-registry.err.log"),
    },
  );
  console.log("Base add-chain smoke: chain registry tests passed");

  await runCommand(
    "bun",
    [
      "run",
      "--cwd",
      "packages/market-maker-bot",
      "smoke:runtime",
      "--",
      "--chain",
      "base",
      "--rpc-url",
      "http://127.0.0.1:18545",
    ],
    {
      stdoutFile: path.join(artifactRoot, "runtime-smoke.out.log"),
      stderrFile: path.join(artifactRoot, "runtime-smoke.err.log"),
    },
  );
  console.log("Base add-chain smoke: base runtime smoke passed");

  await runCommand(
    "bash",
    ["scripts/ci-install-verified.sh", "root", "hyperbet-bsc", "hyperbet-bsc-app"],
    {
      stdoutFile: path.join(artifactRoot, "base-app-install.out.log"),
      stderrFile: path.join(artifactRoot, "base-app-install.err.log"),
    },
  );
  console.log("Base add-chain smoke: shared EVM app dependencies installed");

  await runCommand(
    "bun",
    ["run", "--cwd", "packages/hyperbet-bsc/app", "build", "--mode", "mainnet-beta"],
    {
      env: {
        CF_PAGES_COMMIT_SHA: process.env.GITHUB_SHA || "local-base-smoke",
        VITE_GAME_API_URL: "https://api.hyperbet.win",
        VITE_GAME_WS_URL: "wss://api.hyperbet.win/ws",
        VITE_SOLANA_CLUSTER: "mainnet-beta",
        VITE_USE_GAME_RPC_PROXY: "true",
        VITE_USE_GAME_EVM_RPC_PROXY: "true",
        VITE_BSC_CHAIN_ID: String(bsc.chainId),
        VITE_BSC_GOLD_CLOB_ADDRESS: bsc.goldClobAddress,
        VITE_BASE_CHAIN_ID: String(base.chainId),
        VITE_BASE_GOLD_CLOB_ADDRESS: base.goldClobAddress,
      },
      stdoutFile: path.join(artifactRoot, "base-app-build.out.log"),
      stderrFile: path.join(artifactRoot, "base-app-build.err.log"),
    },
  );
  console.log("Base add-chain smoke: shared EVM app build passed");

  copyIntoArtifacts(
    artifactRoot,
    path.join(rootDir, "packages/hyperbet-bsc/app/dist/build-info.json"),
    "build-info.json",
  );
} finally {
  stopAnvil?.();
  copyIntoArtifacts(artifactRoot, anvilLog, "anvil.log");
}

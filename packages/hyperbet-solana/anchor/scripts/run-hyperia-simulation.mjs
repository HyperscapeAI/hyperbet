import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Keypair } from "@solana/web3.js";

function commandExists(command) {
  const result = spawnSync(command, ["--version"], { stdio: "ignore" });
  return !(result.error && result.error.code === "ENOENT");
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to allocate port"));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

function runCommand(command, args, cwd, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function waitForRpcReady(rpcUrl, timeoutMs = 120_000) {
  const healthPayload = {
    jsonrpc: "2.0",
    id: 1,
    method: "getHealth",
    params: [],
  };
  const blockhashPayload = {
    jsonrpc: "2.0",
    id: 2,
    method: "getLatestBlockhash",
    params: [{ commitment: "confirmed" }],
  };

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const healthResponse = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(healthPayload),
      });
      const blockhashResponse = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(blockhashPayload),
      });
      if (!healthResponse.ok || !blockhashResponse.ok) {
        throw new Error("RPC not ready");
      }
      const blockhashJson = await blockhashResponse.json();
      if (blockhashJson?.result?.value?.blockhash) {
        return;
      }
    } catch {
      // Validator still warming up.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for local validator at ${rpcUrl}`);
}

function assertSuccess(step, result) {
  if (result.signal) {
    throw new Error(`${step} terminated with signal ${result.signal}`);
  }
  if ((result.code ?? 1) !== 0) {
    throw new Error(`${step} failed with exit code ${result.code ?? 1}`);
  }
}

function writeFailureMarker(workspaceDir, details) {
  const failurePath = join(
    workspaceDir,
    "simulations",
    "solana-localnet-runner-error.json",
  );
  try {
    writeFileSync(failurePath, JSON.stringify(details, null, 2));
  } catch {
    // Ignore secondary reporting failures.
  }
}

function clearFailureMarker(workspaceDir) {
  try {
    rmSync(
      join(workspaceDir, "simulations", "solana-localnet-runner-error.json"),
      { force: true },
    );
  } catch {
    // Ignore cleanup errors.
  }
}

function parseLocalnetPrograms(anchorTomlPath, deployDir) {
  const anchorToml = readFileSync(anchorTomlPath, "utf8");
  const localnetBlockMatch = anchorToml.match(
    /\[programs\.localnet\]([\s\S]*?)(?:\n\[|$)/,
  );
  if (!localnetBlockMatch) {
    throw new Error("Unable to find [programs.localnet] block in Anchor.toml");
  }

  const programs = [];
  for (const line of localnetBlockMatch[1].split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([a-zA-Z0-9_]+)\s*=\s*"([^"]+)"$/);
    if (!match) continue;
    const [, name, programId] = match;
    const soPath = join(deployDir, `${name}.so`);
    programs.push({ name, programId, soPath });
  }

  if (programs.length === 0) {
    throw new Error("No programs found in [programs.localnet] block");
  }

  return programs;
}

function expandHome(pathValue) {
  if (!pathValue || !pathValue.startsWith("~/")) {
    return pathValue;
  }
  return join(process.env.HOME ?? "", pathValue.slice(2));
}

function parseProviderWallet(anchorTomlPath) {
  const anchorToml = readFileSync(anchorTomlPath, "utf8");
  const providerBlockMatch = anchorToml.match(
    /\[provider\]([\s\S]*?)(?:\n\[|$)/,
  );
  if (!providerBlockMatch) {
    return null;
  }

  for (const line of providerBlockMatch[1].split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^wallet\s*=\s*"([^"]+)"$/);
    if (match) {
      return expandHome(match[1]);
    }
  }

  return null;
}

function readKeypairPublicKey(walletPath) {
  const secret = JSON.parse(readFileSync(walletPath, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret)).publicKey.toBase58();
}

async function main() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const workspaceDir = join(scriptDir, "..");
  const repoRoot = join(workspaceDir, "..", "..", "..");
  const anchorTomlPath = join(workspaceDir, "Anchor.toml");
  const targetDeployDir = join(workspaceDir, "target", "deploy");
  const targetIdlDir = join(workspaceDir, "target", "idl");
  const tsxCliPath =
    [
      join(workspaceDir, "node_modules", ".bin", "tsx"),
      join(workspaceDir, "..", "node_modules", ".bin", "tsx"),
      join(repoRoot, "node_modules", ".bin", "tsx"),
    ].find((candidate) => existsSync(candidate)) ?? null;

  const providerWalletPath = parseProviderWallet(anchorTomlPath);
  const resolvedWalletPath =
    process.env.ANCHOR_WALLET ??
    providerWalletPath ??
    `${process.env.HOME}/.config/solana/id.json`;
  const mintAuthority =
    process.env.SOLANA_SIM_MINT_AUTHORITY ??
    readKeypairPublicKey(resolvedWalletPath);
  const simulationConfig = {
    script: "./scripts/simulate-duel-market-localnet.ts",
    requiredIdl: "duel_market.json",
    requiredProgram: "duel_market",
  };
  const simulationScript = simulationConfig.script;
  if (!existsSync(join(workspaceDir, simulationScript))) {
    throw new Error(`Simulation script not found: ${simulationScript}`);
  }
  const requiredIdlPath = join(targetIdlDir, simulationConfig.requiredIdl);
  if (!existsSync(requiredIdlPath)) {
    throw new Error(
      `Simulation mode '${simulationMode}' requires IDL '${simulationConfig.requiredIdl}' at ${requiredIdlPath}`,
    );
  }
  console.log(
    `[simulate] mode=${simulationMode} script=${simulationScript} rpc=dynamic`,
  );

  if (!tsxCliPath) {
    throw new Error(
      `Missing local tsx binary under ${workspaceDir}/node_modules/.bin/tsx, ${join(workspaceDir, "..", "node_modules", ".bin", "tsx")}, or ${repoRoot}/node_modules/.bin/tsx`,
    );
  }

  const required = ["anchor", "solana-test-validator", "node"].filter(
    (cmd) => !commandExists(cmd),
  );
  if (required.length > 0) {
    throw new Error(`Missing required command(s): ${required.join(", ")}`);
  }

  const rpcPort = await getFreePort();
  let faucetPort = await getFreePort();
  while (faucetPort === rpcPort || faucetPort === rpcPort + 1) {
    faucetPort = await getFreePort();
  }

  const rpcUrl = `http://127.0.0.1:${rpcPort}`;
  const wsUrl = `ws://127.0.0.1:${rpcPort + 1}`;
  const ledgerDir = mkdtempSync(join(tmpdir(), "hyperia-sim-validator-"));
  let validator = null;

  const stopValidator = async () => {
    if (!validator || validator.killed || validator.exitCode !== null) return;
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        try {
          validator.kill("SIGKILL");
        } catch {
          // Ignore cleanup errors.
        }
      }, 5_000);
      validator.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
      validator.kill("SIGTERM");
    });
  };

  let exitCode = 0;
  try {
    clearFailureMarker(workspaceDir);

    const localnetPrograms = parseLocalnetPrograms(
      anchorTomlPath,
      targetDeployDir,
    );
    if (
      !localnetPrograms.some(
        (program) => program.name === simulationConfig.requiredProgram,
      )
    ) {
      throw new Error(
        `Simulation mode '${simulationMode}' requires [programs.localnet].${simulationConfig.requiredProgram} in ${anchorTomlPath}`,
      );
    }
    const missingSos = localnetPrograms.filter(
      (program) => !existsSync(program.soPath),
    );
    if (missingSos.length > 0) {
      const build = await runCommand("anchor", ["build"], workspaceDir);
      assertSuccess("anchor build", build);
    }

    const validatorArgs = [
      "--reset",
      "--bind-address",
      "0.0.0.0",
      "--rpc-port",
      String(rpcPort),
      "--faucet-port",
      String(faucetPort),
      "--mint",
      mintAuthority,
      "--ledger",
      ledgerDir,
    ];
    for (const program of localnetPrograms) {
      validatorArgs.push(
        "--upgradeable-program",
        program.programId,
        program.soPath,
        resolvedWalletPath,
      );
    }

    validator = spawn("solana-test-validator", validatorArgs, {
      cwd: workspaceDir,
      stdio: "inherit",
      env: process.env,
    });

    await waitForRpcReady(rpcUrl);

    const simulate = await runCommand(
      "node",
      [tsxCliPath, simulationScript],
      workspaceDir,
      {
        ...process.env,
        ANCHOR_PROVIDER_URL: rpcUrl,
        ANCHOR_WS_URL: wsUrl,
        SOLANA_URL: rpcUrl,
        ANCHOR_WALLET: resolvedWalletPath,
        HYPERBET_SIMULATION_OUTPUT_DIR: join(workspaceDir, "simulations"),
      },
    );
    assertSuccess("solana simulation", simulate);
  } catch (error) {
    exitCode = 1;
    console.error("[simulate] Failed:", error);
    writeFailureMarker(workspaceDir, {
      generatedAt: new Date().toISOString(),
      rpcUrl,
      wsUrl,
      ledgerDir,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await stopValidator();
    if (exitCode === 0) {
      clearFailureMarker(workspaceDir);
      rmSync(ledgerDir, { recursive: true, force: true });
    } else {
      console.error(`[simulate] Preserving validator ledger at ${ledgerDir}`);
    }
  }

  process.exit(exitCode);
}

main().catch((error) => {
  console.error("[simulate] Fatal error:", error);
  process.exit(1);
});

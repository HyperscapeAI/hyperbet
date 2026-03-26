import path from "node:path";
import { mkdirSync, readFileSync } from "node:fs";
import { cpSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  copyIntoArtifacts,
  resolveArtifactRoot,
  rootDir,
  runCommand,
  writeJsonArtifact,
} from "./ci-lib";

type Step = {
  name: string;
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

type CliOptions = {
  skipDeterministic: boolean;
  skipDeploys: boolean;
};

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function parseArgs(): CliOptions {
  return {
    skipDeterministic: hasFlag("--skip-deterministic"),
    skipDeploys: hasFlag("--skip-deploys"),
  };
}

function timestampLabel(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sanitizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

async function runStep(artifactRoot: string, step: Step): Promise<void> {
  const label = sanitizeName(step.name);
  writeJsonArtifact(artifactRoot, `commands/${label}.json`, {
    name: step.name,
    command: step.command,
    args: step.args,
    cwd: step.cwd ?? rootDir,
    envKeys: Object.keys(step.env ?? {}).sort(),
  });
  await runCommand(step.command, step.args, {
    cwd: step.cwd ?? rootDir,
    env: step.env,
    stdoutFile: path.join(artifactRoot, "logs", `${label}.stdout.log`),
    stderrFile: path.join(artifactRoot, "logs", `${label}.stderr.log`),
  });
}

function loadEnvFile(filepath: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const raw = readFileSync(filepath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator);
    const value = trimmed.slice(separator + 1);
    env[key] = value;
  }
  return env;
}

function requireEnvValue(
  env: NodeJS.ProcessEnv,
  name: string,
  message = name,
): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required Stage A env: ${message}`);
  }
  return value;
}

function readJsonFile<T>(filepath: string): T {
  return JSON.parse(readFileSync(filepath, "utf8")) as T;
}

function buildEvmDeployEnv(
  stageEnv: NodeJS.ProcessEnv,
  chainPrefix: "BSC_TESTNET" | "AVAX_FUJI",
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...stageEnv };
  env.MUSD_TOKEN_ADDRESS = requireEnvValue(stageEnv, `${chainPrefix}_MUSD_TOKEN_ADDRESS`);
  env.GOLD_TOKEN_ADDRESS = requireEnvValue(stageEnv, `${chainPrefix}_GOLD_TOKEN_ADDRESS`);
  env.PERPS_MARGIN_TOKEN_ADDRESS =
    stageEnv[`${chainPrefix}_PERPS_MARGIN_TOKEN_ADDRESS`] ??
    requireEnvValue(stageEnv, `${chainPrefix}_GOLD_TOKEN_ADDRESS`);
  env.AMM_ADMIN_ADDRESS = requireEnvValue(stageEnv, "ADMIN_ADDRESS");
  env.AMM_TREASURY_ADDRESS = requireEnvValue(stageEnv, "TREASURY_ADDRESS");
  env.PERPS_ADMIN_ADDRESS = requireEnvValue(stageEnv, "ADMIN_ADDRESS");
  env.PERPS_REPORTER_ADDRESS = requireEnvValue(stageEnv, "REPORTER_ADDRESS");
  env.PERPS_MARKET_OPERATOR_ADDRESS = requireEnvValue(
    stageEnv,
    "MARKET_OPERATOR_ADDRESS",
  );
  env.PERPS_PAUSER_ADDRESS = requireEnvValue(stageEnv, "PAUSER_ADDRESS");
  return env;
}

async function main(): Promise<void> {
  const options = parseArgs();
  const runRoot = path.join(resolveArtifactRoot("local-stage-a"), timestampLabel());
  mkdirSync(runRoot, { recursive: true });

  const summary: Record<string, unknown> = {
    startedAt: new Date().toISOString(),
    options,
    artifactRoot: runRoot,
  };

  try {
    if (!options.skipDeterministic) {
      const deterministicSteps: Step[] = [
        {
          name: "registry-unit-tests",
          command: "bun",
          args: ["test", "packages/hyperbet-chain-registry/tests/chainRegistry.test.ts"],
        },
        { name: "amm-gate-evm", command: "bun", args: ["run", "ci:gate:amm:evm"] },
        {
          name: "amm-gate-solana",
          command: "bun",
          args: ["run", "ci:gate:amm:solana"],
        },
        {
          name: "perps-gate-evm",
          command: "bun",
          args: ["run", "ci:gate:perps:evm"],
        },
        {
          name: "perps-gate-solana",
          command: "bun",
          args: ["run", "ci:gate:perps:solana"],
        },
        {
          name: "soak-contract-gate",
          command: "bun",
          args: ["run", "ci:gate:soak:contract"],
        },
        {
          name: "market-maker-adversarial",
          command: "bun",
          args: ["run", "market-maker:simulate:adversarial:ci"],
        },
        {
          name: "hyperscapes-local-bootstrap",
          command: "bash",
          args: ["scripts/run-hyperscapes-pm-local.sh"],
        },
        {
          name: "pm-soak-local",
          command: "bun",
          args: ["run", "pm:soak", "--", "--mode=local", "--follow", "--duration-min=25"],
        },
        {
          name: "pm-soak-harness-local",
          command: "bun",
          args: ["run", "pm:soak:harness", "--", "--duration-min=25"],
        },
      ];

      for (const step of deterministicSteps) {
        await runStep(runRoot, step);
      }

      copyIntoArtifacts(runRoot, path.join(rootDir, ".ci-artifacts", "pm-soak"), "pm-soak");
      copyIntoArtifacts(runRoot, path.join(rootDir, "output", "playwright", "pm-soak"), "playwright/pm-soak");
      summary.deterministic = { ok: true };
    }

    if (!options.skipDeploys) {
      const stageEnvPath = path.join(runRoot, "stage-a.env");
      await runStep(runRoot, {
        name: "export-stage-a-env",
        command: "bash",
        args: ["scripts/export-stage-a-env.sh"],
        env: {
          GITHUB_ENV: stageEnvPath,
        },
      });

      const stageEnv = loadEnvFile(stageEnvPath);
      const solanaEnv: NodeJS.ProcessEnv = { ...stageEnv };

      const solanaVerifyOut = path.join(runRoot, "solana", "verify-devnet.json");
      const solanaInitOut = path.join(runRoot, "solana", "launch-init-devnet.json");
      await runStep(runRoot, {
        name: "solana-preflight-devnet",
        command: "bun",
        args: ["run", "--cwd", "packages/hyperbet-solana", "deploy:preflight:devnet"],
        env: solanaEnv,
      });
      await runStep(runRoot, {
        name: "solana-deploy-devnet",
        command: "bun",
        args: ["run", "--cwd", "packages/hyperbet-solana", "anchor:deploy:devnet"],
        env: solanaEnv,
      });
      await runStep(runRoot, {
        name: "solana-init-devnet",
        command: "node",
        args: [
          "--import",
          "tsx",
          "packages/hyperbet-solana/scripts/init-pm-config.ts",
          "--cluster",
          "devnet",
          "--freeze",
          "--out",
          solanaInitOut,
        ],
        env: solanaEnv,
      });
      await runStep(runRoot, {
        name: "solana-verify-devnet",
        command: "node",
        args: [
          "--import",
          "tsx",
          "packages/hyperbet-solana/scripts/verify-deployment.ts",
          "--cluster",
          "devnet",
          "--out",
          solanaVerifyOut,
        ],
        env: solanaEnv,
      });

      const bscEnv = buildEvmDeployEnv(stageEnv, "BSC_TESTNET");
      await runStep(runRoot, {
        name: "bsc-create2-testnet",
        command: "bun",
        args: ["run", "--cwd", "packages/evm-contracts", "deploy:create2:bsc-testnet"],
        env: bscEnv,
      });
      const bscReceiptPath = path.join(
        rootDir,
        "packages",
        "evm-contracts",
        "deployments",
        "bscTestnet.json",
      );
      const bscReceipt = readJsonFile<{ duelOracleAddress?: string }>(bscReceiptPath);
      bscEnv.DUEL_ORACLE_ADDRESS = requireEnvValue(
        { DUEL_ORACLE_ADDRESS: bscReceipt.duelOracleAddress },
        "DUEL_ORACLE_ADDRESS",
        "bscTestnet duelOracleAddress receipt field",
      );
      await runStep(runRoot, {
        name: "bsc-amm-testnet",
        command: "bun",
        args: ["run", "--cwd", "packages/evm-contracts", "deploy:amm:bsc-testnet"],
        env: bscEnv,
      });
      await runStep(runRoot, {
        name: "bsc-perps-testnet",
        command: "bun",
        args: ["run", "--cwd", "packages/evm-contracts", "deploy:perps:bsc-testnet"],
        env: bscEnv,
      });
      await runStep(runRoot, {
        name: "bsc-verify-testnet",
        command: "node",
        args: [
          "--import",
          "tsx",
          "packages/evm-contracts/scripts/verify-deployment.ts",
          "--network",
          "bscTestnet",
          "--out",
          path.join(runRoot, "bsc", "verify-bscTestnet.json"),
        ],
        env: bscEnv,
      });
      copyIntoArtifacts(runRoot, bscReceiptPath, "bsc/deployment-receipt.json");

      const avaxEnv = buildEvmDeployEnv(stageEnv, "AVAX_FUJI");
      await runStep(runRoot, {
        name: "avax-create2-fuji",
        command: "bun",
        args: ["run", "--cwd", "packages/evm-contracts", "deploy:create2:avax-fuji"],
        env: avaxEnv,
      });
      const avaxReceiptPath = path.join(
        rootDir,
        "packages",
        "evm-contracts",
        "deployments",
        "avaxFuji.json",
      );
      const avaxReceipt = readJsonFile<{ duelOracleAddress?: string }>(avaxReceiptPath);
      avaxEnv.DUEL_ORACLE_ADDRESS = requireEnvValue(
        { DUEL_ORACLE_ADDRESS: avaxReceipt.duelOracleAddress },
        "DUEL_ORACLE_ADDRESS",
        "avaxFuji duelOracleAddress receipt field",
      );
      await runStep(runRoot, {
        name: "avax-amm-fuji",
        command: "bun",
        args: ["run", "--cwd", "packages/evm-contracts", "deploy:amm:avax-fuji"],
        env: avaxEnv,
      });
      await runStep(runRoot, {
        name: "avax-perps-fuji",
        command: "bun",
        args: ["run", "--cwd", "packages/evm-contracts", "deploy:perps:avax-fuji"],
        env: avaxEnv,
      });
      await runStep(runRoot, {
        name: "avax-verify-fuji",
        command: "node",
        args: [
          "--import",
          "tsx",
          "packages/evm-contracts/scripts/verify-deployment.ts",
          "--network",
          "avaxFuji",
          "--out",
          path.join(runRoot, "avax", "verify-avaxFuji.json"),
        ],
        env: avaxEnv,
      });
      copyIntoArtifacts(runRoot, avaxReceiptPath, "avax/deployment-receipt.json");

      summary.deploys = {
        ok: true,
        stageEnvPath,
      };
    }

    summary.completedAt = new Date().toISOString();
    writeJsonArtifact(runRoot, "summary.json", summary);
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    summary.completedAt = new Date().toISOString();
    summary.ok = false;
    summary.error = error instanceof Error ? error.message : String(error);
    writeJsonArtifact(runRoot, "summary.json", summary);
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}

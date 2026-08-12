import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const failures: string[] = [];
const prohibitedLegacyBrandPattern = new RegExp(
  ["hyper", "scape"].join(""),
  "i",
);

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf8");
}

function fail(message: string): void {
  failures.push(message);
}

function requireAbsent(
  relativePath: string,
  patterns: readonly RegExp[],
): void {
  const contents = read(relativePath);
  for (const pattern of patterns) {
    if (pattern.test(contents)) {
      fail(`${relativePath} still matches forbidden v1 pattern ${pattern}`);
    }
  }
}

const rootPackage = JSON.parse(read("package.json")) as {
  scripts?: Record<string, string>;
  packageManager?: string;
};
const scripts = rootPackage.scripts ?? {};
const bunVersion = rootPackage.packageManager?.match(/^bun@(.+)$/)?.[1];
if (!bunVersion) {
  fail("root packageManager must pin an exact Bun version");
} else {
  for (const [runtimePath, expectedPin] of [
    [".github/actions/setup-hyperbet/action.yml", `default: \"${bunVersion}\"`],
    [
      "packages/hyperbet-solana/keeper/Dockerfile",
      `FROM oven/bun:${bunVersion}`,
    ],
  ] as const) {
    if (!read(runtimePath).includes(expectedPin)) {
      fail(`${runtimePath} is not pinned to Bun ${bunVersion}`);
    }
  }
}
const forbiddenRootScript = /(^|:)(?:bsc|avax|base|evm)(?::|$)/i;
const forbiddenRootTarget =
  /packages\/hyperbet-(?:bsc|avax|evm)|--(?:chain|target)=(?:bsc|avax|base|evm)|ci-gate-(?:amm|base|perps)/i;

for (const [name, command] of Object.entries(scripts)) {
  if (forbiddenRootScript.test(name) || forbiddenRootTarget.test(command)) {
    fail(`root script ${name} is outside the SOL-only v1 command surface`);
  }
}

if (
  scripts["ci:env"] !== "node --import tsx scripts/ci-env-audit-solana-v1.ts"
) {
  fail("root environment audit is not pinned to the SOL-only v1 entrypoint");
}
if (scripts.typecheck !== "bun run typecheck:solana") {
  fail("root typecheck must delegate to the SOL-only workspace graph");
}
if (scripts.test !== "bun run test:launch:solana") {
  fail("root test must delegate to the SOL-only launch workspace graph");
}
if (
  scripts["test:launch:solana"] !==
  "turbo run test --filter=hyperbet-solana-app --filter=hyperbet-solana-keeper --filter=@hyperbet/sdk --filter=@hyperbet/ui && bun run --cwd packages/hyperbet-solana/anchor test"
) {
  fail("SOL-only test graph is not pinned to launch workspaces");
}
if (scripts.lint !== "bun run lint:solana") {
  fail("root lint must delegate to the SOL-only workspace graph");
}
if (
  scripts["lint:solana"] !==
  "turbo run lint --filter=hyperbet-solana-app... --filter=hyperbet-solana-keeper --filter=@hyperbet/sdk"
) {
  fail("SOL-only lint graph is not pinned to launch workspaces");
}
if (
  scripts["typecheck:solana"] !==
  "turbo run typecheck --filter=hyperbet-solana-app... --filter=hyperbet-solana-keeper --filter=@hyperbet/sdk"
) {
  fail("SOL-only typecheck graph is not pinned to launch workspaces");
}
for (const retiredOperatorScript of [
  "pm:soak",
  "pm:soak:harness",
  "ci:gate:soak:contract",
]) {
  if (scripts[retiredOperatorScript]) {
    fail(
      `root still exposes retired operator command ${retiredOperatorScript}`,
    );
  }
}
for (const rootDeveloperEntrypoint of [
  "scripts/run-local-demo.ts",
  "scripts/dev-bootstrap.ts",
  "scripts/dev-doctor.ts",
  "scripts/ci-install-verified.sh",
  ".github/actions/setup-hyperbet/action.yml",
]) {
  requireAbsent(rootDeveloperEntrypoint, [
    /packages\/hyperbet-(?:bsc|avax|evm)/i,
    /\b(?:AVAX|Avalanche|BSC|Base Sepolia|EVM|anvil|forge|foundry)\b/i,
  ]);
}
if (!read("scripts/run-local-demo.ts").includes('target !== "solana"')) {
  fail("local demo dispatcher does not fail closed to Solana");
}

if (
  scripts["ci:gate:registry:launch"] !==
  "node --import tsx scripts/ci-gate-solana-v1-registry.ts && bun test packages/hyperbet-solana/tests/deployments.test.ts packages/hyperbet-solana/tests/duel-market-artifacts.test.ts packages/hyperbet-solana/tests/build-workspace-policy.test.ts"
) {
  fail("launch registry/artifact gate is not the dedicated Solana v1 gate");
}

const keeperPackage = JSON.parse(
  read("packages/hyperbet-solana/keeper/package.json"),
) as {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
};
if (keeperPackage.scripts?.["duel-bot"] !== "bun --bun src/duelBot.ts") {
  fail("keeper duel-bot command is not pinned to the launch-only entrypoint");
}
if (
  keeperPackage.scripts?.typecheck !==
  "bunx tsc --noEmit -p tsconfig.launch.json"
) {
  fail("keeper typecheck is not pinned to the launch-only TypeScript graph");
}
if (
  keeperPackage.scripts?.lint !== "bunx tsc --noEmit -p tsconfig.launch.json"
) {
  fail("keeper lint is not pinned to the launch-only TypeScript graph");
}
if (keeperPackage.scripts?.test !== "bun run test:launch") {
  fail("keeper default test is not pinned to the launch suite");
}
if (
  Object.values(keeperPackage.scripts ?? {}).some((command) =>
    /src\/bot\.ts/.test(command),
  )
) {
  fail("keeper package still exposes the retired mixed bot");
}
if (
  keeperPackage.scripts?.["terminal-ops"] !== "bun --bun src/terminalOps.ts"
) {
  fail("keeper terminal recovery command is not pinned to the audited CLI");
}
if (keeperPackage.dependencies?.["@hyperbet/mm-core"]) {
  fail("SOL keeper runtime still depends on the shared multi-chain MM core");
}
const launchTestCommand = keeperPackage.scripts?.["test:launch"] ?? "";
for (const requiredLaunchTest of [
  "src/launchHealth.test.ts",
  "src/solanaMarketMakerPolicy.test.ts",
  "src/solanaRpcProxyPolicy.test.ts",
]) {
  if (!launchTestCommand.includes(requiredLaunchTest)) {
    fail(`keeper launch suite is missing ${requiredLaunchTest}`);
  }
}

const solanaPackage = JSON.parse(
  read("packages/hyperbet-solana/package.json"),
) as {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
};
if (
  solanaPackage.scripts?.["keeper:duel"] !== "bun run --cwd keeper duel-bot"
) {
  fail("Solana package does not expose the dedicated duel keeper");
}
for (const [scriptName, expectedCommand] of Object.entries({
  "deploy:preflight:devnet":
    "bun run scripts/preflight-contract-deploy.ts --cluster devnet",
  "deploy:preflight:testnet":
    "bun run scripts/preflight-contract-deploy.ts --target testnet",
  "deploy:preflight:mainnet":
    "bun run scripts/preflight-contract-deploy.ts --target mainnet",
  "deploy:init:devnet":
    "node --import tsx scripts/init-pm-config.ts --cluster devnet",
  "deploy:init:testnet":
    "node --import tsx scripts/init-pm-config.ts --cluster testnet",
  "deploy:init:mainnet":
    "node --import tsx scripts/init-pm-config.ts --cluster mainnet-beta --freeze",
  "verify:deployment:devnet":
    "node --import tsx scripts/verify-deployment.ts --cluster devnet",
  "verify:deployment:testnet":
    "node --import tsx scripts/verify-deployment.ts --cluster testnet",
  "verify:deployment:mainnet":
    "node --import tsx scripts/verify-deployment.ts --cluster mainnet-beta",
})) {
  if (solanaPackage.scripts?.[scriptName] !== expectedCommand) {
    fail(`${scriptName} is not pinned to the SOL-only deployment command`);
  }
}
if (solanaPackage.dependencies?.["@hyperbet/chain-registry"]) {
  fail(
    "Solana launch package still depends on the shared multi-chain registry",
  );
}
if (solanaPackage.dependencies?.["@hyperbet/mm-core"]) {
  fail("Solana launch package still depends on the shared multi-chain MM core");
}

const sharedUiPackage = JSON.parse(
  read("packages/hyperbet-ui/package.json"),
) as {
  dependencies?: Record<string, string>;
  exports?: Record<string, string>;
};
for (const retiredDependency of [
  "@hyperbet/chain-registry",
  "@rainbow-me/rainbowkit",
  "@jup-ag/api",
  "@solana/spl-token",
  "@solana/wallet-adapter-base",
  "@solana/wallet-adapter-phantom",
  "@solana/wallet-adapter-react",
  "@solana/wallet-adapter-react-ui",
  "@solana/wallet-adapter-wallets",
  "@tanstack/react-query",
  "lightweight-charts",
  "sonner",
  "viem",
  "wagmi",
]) {
  if (sharedUiPackage.dependencies?.[retiredDependency]) {
    fail(`shared SOL UI still depends on ${retiredDependency}`);
  }
}
for (const exportPath of Object.keys(sharedUiPackage.exports ?? {})) {
  if (
    /(?:evm|chain(?:context|config|selector)|gold|perps|walletlink|wagmi|jupiter|birdeye|theme)/i.test(
      exportPath,
    ) ||
    /components\/(?:ModelsMarketView|PointsDisplay|ReferralPanel)$/i.test(
      exportPath,
    )
  ) {
    fail(`shared SOL UI still exposes retired entrypoint ${exportPath}`);
  }
}

const sharedUiSourcePaths = (
  readdirSync(join(root, "packages/hyperbet-ui/src"), {
    recursive: true,
  }) as string[]
)
  .filter((entry) => /\.(?:ts|tsx|json)$/.test(entry))
  .map((entry) => join("packages/hyperbet-ui/src", entry));
for (const relativePath of sharedUiSourcePaths) {
  requireAbsent(relativePath, [
    /@hyperbet\/chain-registry/,
    /@rainbow-me\/rainbowkit/,
    /@solana\/wallet-adapter/,
    /\b(?:AVAX|Avalanche|BSC|EVM|perps|amm)\b/i,
    /gold[_-]?(?:token|mint|clob|perps|amm|amount|balance)/i,
    /wallet[_ -]?link/i,
    /staking[_ -]?daily/i,
  ]);
}

const typescriptSdkPackage = JSON.parse(
  read("packages/hyperbet-sdk/package.json"),
) as { dependencies?: Record<string, string>; description?: string };
for (const retiredDependency of [
  "ethers",
  "viem",
  "wagmi",
  "@hyperbet/chain-registry",
]) {
  if (typescriptSdkPackage.dependencies?.[retiredDependency]) {
    fail(`TypeScript SOL SDK still depends on ${retiredDependency}`);
  }
}
const pythonSdkManifest = read("packages/hyperbet-sdk-py/pyproject.toml");
for (const retiredDependencyPattern of [
  /^web3\s*=/im,
  /^eth-account\s*=/im,
  /^eth-typing\s*=/im,
]) {
  if (retiredDependencyPattern.test(pythonSdkManifest)) {
    fail(
      `Python SOL SDK still declares retired dependency ${retiredDependencyPattern}`,
    );
  }
}

const sdkSourcePaths = [
  "packages/hyperbet-sdk/README.md",
  "packages/hyperbet-sdk/package.json",
  "packages/hyperbet-sdk/tsup.config.ts",
  "packages/hyperbet-sdk-py/README.md",
  "packages/hyperbet-sdk-py/pyproject.toml",
  ...(
    readdirSync(join(root, "packages/hyperbet-sdk/src"), {
      recursive: true,
    }) as string[]
  )
    .filter((entry) => /\.(?:ts|tsx|json)$/.test(entry))
    .map((entry) => join("packages/hyperbet-sdk/src", entry)),
  ...(
    readdirSync(join(root, "packages/hyperbet-sdk/tests"), {
      recursive: true,
    }) as string[]
  )
    .filter((entry) => /\.(?:ts|tsx|json)$/.test(entry))
    .map((entry) => join("packages/hyperbet-sdk/tests", entry)),
  ...(
    readdirSync(join(root, "packages/hyperbet-sdk-py/hyperbet_sdk"), {
      recursive: true,
    }) as string[]
  )
    .filter((entry) => /\.(?:py|json)$/.test(entry))
    .map((entry) => join("packages/hyperbet-sdk-py/hyperbet_sdk", entry)),
  ...(
    readdirSync(join(root, "packages/hyperbet-sdk-py/tests"), {
      recursive: true,
    }) as string[]
  )
    .filter((entry) => /\.(?:py|json)$/.test(entry))
    .map((entry) => join("packages/hyperbet-sdk-py/tests", entry)),
];
for (const relativePath of sdkSourcePaths) {
  requireAbsent(relativePath, [
    /\b(?:AVAX|Avalanche|BSC|Base Sepolia|EVM)\b/i,
    /(?:from|import)\s+["']?web3\b/i,
    /\bethers\b/i,
    /DuelOutcomeOracle|GoldClob|gold[_-]?(?:token|mint|clob|perps|amm)/i,
    /@hyperbet\/chain-registry/,
  ]);
}
for (const [sdkTypePath, requiredConstant] of [
  ["packages/hyperbet-sdk/src/types.ts", "MARKET_KIND_DUEL_WINNER = 1"],
  [
    "packages/hyperbet-sdk-py/hyperbet_sdk/types.py",
    "MARKET_KIND_DUEL_WINNER = 1",
  ],
] as const) {
  if (!read(sdkTypePath).includes(requiredConstant)) {
    fail(`${sdkTypePath} does not use the canonical duel-winner market kind`);
  }
}

const solanaReadmePath = "packages/hyperbet-solana/README.md";
const solanaReadme = read(solanaReadmePath);
for (const requiredLaunchBoundary of [
  "deployments/solana-v1.json",
  "native-SOL",
  "outside the launch closure",
]) {
  if (!solanaReadme.includes(requiredLaunchBoundary)) {
    fail(
      `${solanaReadmePath} does not document launch boundary ${requiredLaunchBoundary}`,
    );
  }
}
requireAbsent(solanaReadmePath, [
  /@hyperbet\/chain-registry/,
  /packages\/hyperbet-chain-registry/,
  /user-facing[^\n]*(?:perps|models)/i,
  /internal[^\n]*AMM[^\n]*(?:engine|surface)/i,
  /full-product/i,
]);

const launchDocumentationPaths = [
  "README.md",
  solanaReadmePath,
  ...(readdirSync(join(root, "docs"), { recursive: true }) as string[])
    .filter((entry) => entry.endsWith(".md"))
    .map((entry) => join("docs", entry)),
];
for (const documentationPath of launchDocumentationPaths) {
  requireAbsent(documentationPath, [
    /\bGOLD\b/i,
    /gold[_-]?(?:mint|clob|perps|amm)/i,
    /\b(?:AVAX|Avalanche|BSC|Base Sepolia|EVM)\b/i,
    /\b(?:perps|amm)\b/i,
  ]);
}

const expectedPrograms = new Set(["fight_oracle", "duel_market"]);
const requiredNeutralMarketPaths = [
  "packages/hyperbet-solana/anchor/programs/duel_market/src/lib.rs",
  "packages/hyperbet-solana/anchor/target/idl/duel_market.json",
  "packages/hyperbet-solana/anchor/target/types/duel_market.ts",
  "packages/hyperbet-solana/app/src/generated/duel-market/programs/duelMarket.ts",
  "packages/hyperbet-solana/app/src/idl/duel_market.json",
  "packages/hyperbet-solana/keeper/src/idl/duel_market.json",
  "packages/hyperbet-ui/src/idl/duel_market.json",
  "packages/hyperbet-sdk/src/solana/idl/duel_market.json",
  "packages/hyperbet-sdk-py/hyperbet_sdk/solana/idl/duel_market.json",
] as const;
for (const relativePath of requiredNeutralMarketPaths) {
  if (!existsSync(join(root, relativePath))) {
    fail(`missing neutral duel-market artifact ${relativePath}`);
  }
}

for (const retiredPath of [
  "packages/hyperbet-solana/anchor/programs/gold_clob_market",
  "packages/hyperbet-solana/anchor/programs/gold_perps_market",
  "packages/hyperbet-solana/anchor/programs/lvr_amm",
  "packages/hyperbet-solana/anchor/target/idl/gold_clob_market.json",
  "packages/hyperbet-solana/anchor/target/idl/gold_perps_market.json",
  "packages/hyperbet-solana/anchor/target/idl/lvr_amm.json",
  "packages/hyperbet-solana/anchor/target/types/gold_clob_market.ts",
  "packages/hyperbet-solana/anchor/target/types/gold_perps_market.ts",
  "packages/hyperbet-solana/anchor/target/types/lvr_amm.ts",
  "packages/hyperbet-solana/app/src/generated/gold-clob-market",
  "packages/hyperbet-solana/app/src/generated/gold-perps-market",
  "packages/hyperbet-solana/generated/ts",
  "packages/hyperbet-solana/anchor/scripts/simulate-hyperia-localnet.ts",
  "packages/hyperbet-solana/.env.example",
  "packages/hyperbet-solana/app/src/idl/gold_clob_market.json",
  "packages/hyperbet-solana/app/src/idl/gold_perps_market.json",
  "packages/hyperbet-solana/app/src/idl/lvr_amm.json",
  "packages/hyperbet-solana/keeper/src/idl/gold_clob_market.json",
  "packages/hyperbet-solana/keeper/src/idl/gold_perps_market.json",
  "packages/hyperbet-solana/keeper/src/idl/lvr_amm.json",
  "packages/hyperbet-solana/keeper/src/bot.ts",
  "packages/hyperbet-solana/keeper/src/common.ts",
  "packages/hyperbet-solana/keeper/src/staged-proof-solana.ts",
  "packages/hyperbet-solana/keeper/src/legacyAnalyticsDb.ts",
  "packages/hyperbet-solana/keeper/src/modelMarkets.ts",
  "packages/hyperbet-solana/keeper/src/perpsMath.ts",
  "packages/hyperbet-ui/src/idl/gold_clob_market.json",
  "packages/hyperbet-ui/src/idl/gold_perps_market.json",
  "packages/hyperbet-ui/src/idl/lvr_amm.json",
  "packages/hyperbet-ui/src/createAppRoot.tsx",
  "packages/hyperbet-ui/src/createEvmAppRoot.tsx",
  "packages/hyperbet-ui/src/components/EvmBettingPanel.tsx",
  "packages/hyperbet-ui/src/components/EvmModelsMarketView.tsx",
  "packages/hyperbet-ui/src/components/ModelsMarketView.tsx",
  "packages/hyperbet-ui/src/components/PointsDisplay.tsx",
  "packages/hyperbet-ui/src/components/ReferralPanel.tsx",
  "packages/hyperbet-ui/src/components/WalletLinkCard.tsx",
  "packages/hyperbet-ui/src/lib/ChainContext.tsx",
  "packages/hyperbet-ui/src/lib/chainConfig.ts",
  "packages/hyperbet-ui/src/lib/config.ts",
  "packages/hyperbet-ui/src/lib/evmClient.ts",
  "packages/hyperbet-ui/src/lib/goldClobAbi.ts",
  "packages/hyperbet-ui/src/lib/jupiter.ts",
  "packages/hyperbet-ui/src/lib/modelMarkets.ts",
  "packages/hyperbet-ui/src/lib/predictionMarkets.ts",
  "packages/hyperbet-ui/src/lib/wagmiConfig.ts",
  "packages/hyperbet-sdk/src/solana/idl/gold_clob_market.json",
  "packages/hyperbet-sdk-py/hyperbet_sdk/solana/idl/gold_clob_market.json",
  "packages/hyperbet-sdk/src/evm",
  "packages/hyperbet-sdk/tests/evm.test.ts",
  "packages/hyperbet-sdk-py/hyperbet_sdk/evm",
  "packages/hyperbet-sdk-py/tests/test_evm.py",
]) {
  if (existsSync(join(root, retiredPath))) {
    fail(`retired Solana market path still exists: ${retiredPath}`);
  }
}

const retiredSolanaMarketNamePatterns = [
  /gold_clob/i,
  /gold-clob/i,
  /GOLD_CLOB/,
  /GoldClob|goldClob/,
] as const;
for (const relativePath of [
  "packages/hyperbet-solana/README.md",
  "packages/hyperbet-solana/package.json",
  "packages/hyperbet-solana/anchor/Cargo.toml",
  "packages/hyperbet-solana/anchor/Anchor.toml",
  "packages/hyperbet-solana/anchor/package.json",
  "packages/hyperbet-solana/anchor/programs/duel_market/src/lib.rs",
  "packages/hyperbet-solana/anchor/scripts/build-workspace.sh",
  "packages/hyperbet-solana/anchor/scripts/deploy-programs.sh",
  "packages/hyperbet-solana/anchor/scripts/run-localnet-tests.sh",
  "packages/hyperbet-solana/anchor/scripts/run-hyperia-simulation.mjs",
  "packages/hyperbet-solana/scripts/preflight-contract-deploy.ts",
  "packages/hyperbet-solana/scripts/init-pm-config.ts",
  "packages/hyperbet-solana/scripts/verify-deployment.ts",
  "packages/hyperbet-solana/scripts/stage-a-identity.ts",
  "packages/hyperbet-solana/scripts/sync-anchor-artifacts.mjs",
  "packages/hyperbet-solana/keeper/src/launchCommon.ts",
  "packages/hyperbet-ui/src/lib/programs.ts",
  "packages/hyperbet-ui/src/components/SolanaClobPanel.tsx",
  ".github/workflows/deploy-testnet-v3.yml",
  "scripts/ci-gate-solana-build.ts",
]) {
  requireAbsent(relativePath, retiredSolanaMarketNamePatterns);
}

const duelMarketIdl = JSON.parse(
  read("packages/hyperbet-solana/anchor/target/idl/duel_market.json"),
) as { metadata?: { name?: unknown } };
if (duelMarketIdl.metadata?.name !== "duel_market") {
  fail("duel_market IDL does not expose the neutral program name");
}
const cargoWorkspace = read("packages/hyperbet-solana/anchor/Cargo.toml");
const cargoMembers = Array.from(
  cargoWorkspace.matchAll(/"programs\/([a-z0-9_]+)"/g),
  (match) => match[1],
);
if (
  cargoMembers.length !== expectedPrograms.size ||
  cargoMembers.some((program) => !expectedPrograms.has(program))
) {
  fail(`Anchor Cargo workspace is not duel-only: ${cargoMembers.join(", ")}`);
}

const anchorConfig = read("packages/hyperbet-solana/anchor/Anchor.toml");
const workspaceLine =
  anchorConfig.match(/members\s*=\s*\[([^\]]+)\]/)?.[1] ?? "";
const anchorMembers = Array.from(
  workspaceLine.matchAll(/"programs\/([a-z0-9_]+)"/g),
  (match) => match[1],
);
if (
  anchorMembers.length !== expectedPrograms.size ||
  anchorMembers.some((program) => !expectedPrograms.has(program))
) {
  fail(`Anchor.toml workspace is not duel-only: ${anchorMembers.join(", ")}`);
}
requireAbsent("packages/hyperbet-solana/anchor/Anchor.toml", [
  /gold[_-]?(?:clob|perps|amm)/i,
  /lvr_amm/i,
]);

const excludedProgramPatterns = [
  /gold_perps_market/i,
  /lvr_amm/i,
  /PROGRAM_PERPS/,
  /PROGRAM_LVR/,
  /tests\/gold_perps/i,
] as const;

for (const relativePath of [
  "packages/hyperbet-solana/package.json",
  "packages/hyperbet-solana/anchor/package.json",
  "packages/hyperbet-solana/anchor/scripts/build-workspace.sh",
  "packages/hyperbet-solana/anchor/scripts/deploy-programs.sh",
  "packages/hyperbet-solana/anchor/scripts/run-localnet-tests.sh",
  "packages/hyperbet-solana/scripts/preflight-contract-deploy.ts",
  "packages/hyperbet-solana/scripts/init-pm-config.ts",
  "packages/hyperbet-solana/scripts/verify-deployment.ts",
  "packages/hyperbet-solana/scripts/solana-deployment-identity.ts",
  "packages/hyperbet-solana/scripts/stage-a-identity.ts",
  "packages/hyperbet-solana/scripts/sync-anchor-artifacts.mjs",
  "scripts/ci-gate-solana-build.ts",
]) {
  requireAbsent(relativePath, excludedProgramPatterns);
}
requireAbsent(
  "packages/hyperbet-solana/anchor/scripts/run-hyperia-simulation.mjs",
  [
    /BETTING_SOLANA_SIM_MODE/,
    /simulate-hyperia-localnet/,
    /(?:^|\W)spl(?:\W|$)/i,
  ],
);

const deployScriptPath =
  "packages/hyperbet-solana/anchor/scripts/deploy-programs.sh";
const deployScript = read(deployScriptPath);
for (const requiredDeploymentGate of [
  "preflight-contract-deploy.ts",
  "--require-deployed",
  "running read-only program identity preflight",
  "mandatory post-deploy program identity verification",
]) {
  if (!deployScript.includes(requiredDeploymentGate)) {
    fail(
      `${deployScriptPath} is missing deployment identity gate ${requiredDeploymentGate}`,
    );
  }
}

const deploymentPreflightPath =
  "packages/hyperbet-solana/scripts/preflight-contract-deploy.ts";
const deploymentPreflight = read(deploymentPreflightPath);
for (const requiredIdentityControl of [
  "resolveSolanaV1Deployment",
  "fetchSolanaProgramDeploymentIdentity",
  "SOLANA_EXPECTED_UPGRADE_AUTHORITY",
  'required: cluster === "mainnet-beta"',
]) {
  if (!deploymentPreflight.includes(requiredIdentityControl)) {
    fail(
      `${deploymentPreflightPath} is missing identity control ${requiredIdentityControl}`,
    );
  }
}

for (const [configurationPath, requiredConfigurationControls] of [
  [
    "packages/hyperbet-solana/scripts/init-pm-config.ts",
    [
      "resolveSolanaV1Deployment",
      "resolveSolanaDuelLaunchConfig",
      "SOLANA_LAUNCH_CONFIG_FREEZE_APPROVED",
      "fetchSolanaProgramDeploymentIdentity",
    ],
  ],
  [
    "packages/hyperbet-solana/scripts/verify-deployment.ts",
    [
      "resolveSolanaV1Deployment",
      "resolveSolanaDuelLaunchConfig",
      "fetchSolanaProgramDeploymentIdentity",
      "configFrozen === true",
    ],
  ],
  [
    "packages/hyperbet-solana/keeper/src/duelBot.ts",
    ["resolveApprovedLaunchFeePolicy", "SOLANA_LAUNCH_FEE_POLICY_APPROVED"],
  ],
] as const) {
  const configurationSource = read(configurationPath);
  for (const requiredControl of requiredConfigurationControls) {
    if (!configurationSource.includes(requiredControl)) {
      fail(
        `${configurationPath} is missing launch configuration control ${requiredControl}`,
      );
    }
  }
}

const deploymentWorkflowPath = ".github/workflows/deploy-testnet-v3.yml";
requireAbsent(deploymentWorkflowPath, [
  /packages\/(?:evm-contracts|hyperbet-(?:evm|bsc|avax))/i,
  /\b(?:AVAX|Avalanche|BSC|Base Sepolia)\b/i,
  /\b(?:perps|amm)\b/i,
  /(?:GOLD_TOKEN|MUSD_TOKEN|MARGIN_TOKEN)/i,
]);
const deploymentWorkflow = read(deploymentWorkflowPath);
for (const requiredWorkflowControl of [
  "DEPLOY_SOLANA_DUEL_V1_DEVNET",
  "environment: solana-devnet",
  "ci:gate:registry:launch",
  "ci:scope:solana",
  "--require-deployed",
]) {
  if (!deploymentWorkflow.includes(requiredWorkflowControl)) {
    fail(
      `${deploymentWorkflowPath} is missing SOL-only workflow control ${requiredWorkflowControl}`,
    );
  }
}

const workflowDirectory = join(root, ".github/workflows");
const expectedLaunchWorkflows = new Set([
  "ci.yml",
  "deploy-solana-keeper.yml",
  "deploy-solana-pages.yml",
  "deploy-testnet-v3.yml",
  "fund-stage-a-wallets.yml",
]);
const actualLaunchWorkflows = readdirSync(workflowDirectory).filter(
  (entry) => entry.endsWith(".yml") || entry.endsWith(".yaml"),
);
for (const workflowName of actualLaunchWorkflows) {
  if (!expectedLaunchWorkflows.has(workflowName)) {
    fail(
      `unexpected workflow remains callable in SOL-only v1: ${workflowName}`,
    );
  }
}
for (const workflowName of expectedLaunchWorkflows) {
  if (!actualLaunchWorkflows.includes(workflowName)) {
    fail(`missing required SOL-only workflow: ${workflowName}`);
  }
}

for (const workflowPath of [
  ".github/workflows/ci.yml",
  ".github/workflows/deploy-solana-pages.yml",
  ".github/workflows/fund-stage-a-wallets.yml",
]) {
  requireAbsent(workflowPath, [
    /packages\/(?:evm-contracts|hyperbet-(?:evm|bsc|avax))/i,
    /(?:^|[_:/-])(?:AVAX|Avalanche|BSC|Base Sepolia|EVM)(?:[_:/-]|$)/im,
    /(?:GOLD_TOKEN|GOLD_CLOB|GOLD_AMM|GOLD_PERPS|MUSD_TOKEN|PERPS_MARGIN)/i,
    /(?:ci:gate|deploy|keeper|pages):(?:amm|perps|evm|bsc|avax)/i,
  ]);
}

const pagesWorkflowPath = ".github/workflows/deploy-solana-pages.yml";
const pagesWorkflow = read(pagesWorkflowPath);
for (const requiredPagesControl of [
  "ci-env-audit-solana-v1.ts --target=pages:solana",
  "VITE_USE_GAME_RPC_PROXY",
  "bun run ci:scope:solana",
]) {
  if (!pagesWorkflow.includes(requiredPagesControl)) {
    fail(`${pagesWorkflowPath} is missing ${requiredPagesControl}`);
  }
}

const keeperWorkflowPath = ".github/workflows/deploy-solana-keeper.yml";
requireAbsent(keeperWorkflowPath, [
  /packages\/(?:market-maker-bot|hyperbet-mm-core|hyperbet-chain-registry)/i,
  /(?:ENABLE_MARKET_MAKER|ENABLE_KEEPER_BOT)/i,
  /(?:GOLD_TOKEN|GOLD_CLOB|GOLD_AMM|GOLD_PERPS|MUSD_TOKEN|PERPS_MARGIN)/i,
]);
const keeperWorkflow = read(keeperWorkflowPath);
for (const requiredKeeperControl of [
  "ci-env-audit-solana-v1.ts --target=keeper:solana",
  "test:launch",
  "bun run ci:scope:solana",
  '"${HYPERBET_KEEPER_URL}/ready"',
  "/api/perps/markets /api/models/markets /api/proxy/evm/rpc",
  'test "$status_code" = "404"',
]) {
  if (!keeperWorkflow.includes(requiredKeeperControl)) {
    fail(`${keeperWorkflowPath} is missing ${requiredKeeperControl}`);
  }
}

const solanaEnvironmentAuditPath = "scripts/ci-env-audit-solana-v1.ts";
requireAbsent(solanaEnvironmentAuditPath, [
  /@hyperbet\/chain-registry/,
  /packages\/(?:evm-contracts|hyperbet-(?:evm|bsc|avax))/i,
]);
const solanaEnvironmentAudit = read(solanaEnvironmentAuditPath);
for (const requiredEnvironmentControl of [
  "unsupported SOL-only audit target",
  "FORBIDDEN_NON_SOLANA_ENV",
  "VITE_USE_GAME_RPC_PROXY",
  "SOLANA_RPC_URL",
]) {
  if (!solanaEnvironmentAudit.includes(requiredEnvironmentControl)) {
    fail(
      `${solanaEnvironmentAuditPath} is missing ${requiredEnvironmentControl}`,
    );
  }
}

const stagedWorkspacePath = "scripts/stage-deploy-workspace.ts";
requireAbsent(stagedWorkspacePath, [
  /packages\/(?:market-maker-bot|hyperbet-mm-core|hyperbet-chain-registry|hyperbet-(?:evm|bsc|avax))/i,
  /keeper:(?:evm|bsc|avax)/i,
]);
if (
  !read(stagedWorkspacePath).includes("unsupported SOL-only deployment target")
) {
  fail("deployment workspace staging does not reject non-Solana targets");
}

const keeperStartPath = "packages/hyperbet-solana/keeper/start.sh";
requireAbsent(keeperStartPath, [
  /market-maker/i,
  /ENABLE_MARKET_MAKER/i,
  /src\/bot\.ts/,
]);
const keeperDockerIgnorePath = "packages/hyperbet-solana/keeper/.dockerignore";
if (!read(keeperDockerIgnorePath).includes("src/*.test.ts")) {
  fail(`${keeperDockerIgnorePath} does not exclude test sources`);
}
for (const railwayConfigPath of [
  "packages/hyperbet-solana/railway.json",
  "packages/hyperbet-solana/keeper/railway.json",
]) {
  const railwayConfig = JSON.parse(read(railwayConfigPath)) as {
    deploy?: { healthcheckPath?: unknown };
  };
  if (railwayConfig.deploy?.healthcheckPath !== "/ready") {
    fail(`${railwayConfigPath} does not use fail-closed /ready health checks`);
  }
}

const appPath = "packages/hyperbet-solana/app/src/App.tsx";
requireAbsent(appPath, [
  /ModelsMarketView/,
  /surface-mode-models/,
  /MODELS MARKET/,
  prohibitedLegacyBrandPattern,
  />\s*GOLD\s*</,
  /@hyperbet\/ui\/components\/PointsDisplay/,
  /@hyperbet\/ui\/components\/ReferralPanel/,
]);

const solanaRuntimeFiles = [
  "packages/hyperbet-solana/app/index.html",
  "packages/hyperbet-solana/app/src/lib/config.ts",
  "packages/hyperbet-solana/app/src/lib/programIds.ts",
  "packages/hyperbet-solana/app/src/lib/runtimeUrls.ts",
  "packages/hyperbet-solana/deployments/solana-v1.json",
  "packages/hyperbet-solana/deployments/v1.ts",
  "packages/hyperbet-ui/src/lib/solanaConfig.ts",
  "packages/hyperbet-ui/src/lib/solanaLifecycle.ts",
  "packages/hyperbet-ui/src/lib/solanaPredictionMarkets.ts",
  "packages/hyperbet-ui/src/lib/solanaPredictionMarketTracking.ts",
  "packages/hyperbet-ui/src/lib/solanaSettlementAction.ts",
  "packages/hyperbet-ui/src/lib/solanaSettlementHistory.ts",
  "packages/hyperbet-ui/src/components/SolanaPointsDisplay.tsx",
  "packages/hyperbet-ui/src/components/SolanaReferralPanel.tsx",
  "packages/hyperbet-ui/src/components/SolanaSettlementHistory.tsx",
] as const;
const forbiddenSolanaRuntimePatterns = [
  /\bGOLD\b/i,
  /goldMint/i,
  /goldAmount/i,
  /gold-betting-keeper/i,
  /\b(?:BSC|AVAX|Avalanche|Base Sepolia)\b/i,
  /\b(?:perps|amm|models market)\b/i,
  /@hyperbet\/chain-registry/,
] as const;
for (const relativePath of solanaRuntimeFiles) {
  requireAbsent(relativePath, forbiddenSolanaRuntimePatterns);
}

const keeperLaunchSources = [
  "packages/hyperbet-solana/keeper/src/service.ts",
  "packages/hyperbet-solana/keeper/src/db.ts",
  "packages/hyperbet-solana/keeper/src/launchCommon.ts",
  "packages/hyperbet-solana/keeper/src/launchHealth.ts",
  "packages/hyperbet-solana/keeper/src/marketRecovery.ts",
  "packages/hyperbet-solana/keeper/src/duelBot.ts",
  "packages/hyperbet-solana/keeper/src/duelTerminalPolicy.ts",
  "packages/hyperbet-solana/keeper/src/feedConfig.ts",
  "packages/hyperbet-solana/keeper/src/feePolicy.ts",
  "packages/hyperbet-solana/keeper/src/game-client.ts",
  "packages/hyperbet-solana/keeper/src/keeperRoles.ts",
  "packages/hyperbet-solana/keeper/src/nativeAmount.ts",
  "packages/hyperbet-solana/keeper/src/readiness.ts",
  "packages/hyperbet-solana/keeper/src/resolve.ts",
  "packages/hyperbet-solana/keeper/src/solanaBetAccounting.ts",
  "packages/hyperbet-solana/keeper/src/solanaBetReconciliation.ts",
  "packages/hyperbet-solana/keeper/src/solanaTerminalSettlement.ts",
  "packages/hyperbet-solana/keeper/src/solanaLifecycleIndexer.ts",
  "packages/hyperbet-solana/keeper/src/solanaProgramIdentity.ts",
  "packages/hyperbet-solana/keeper/src/solanaLifecycle.ts",
  "packages/hyperbet-solana/keeper/src/solanaMarketMakerPolicy.ts",
  "packages/hyperbet-solana/keeper/src/solanaRpcProxyPolicy.ts",
  "packages/hyperbet-solana/keeper/src/solanaWallet.ts",
  "packages/hyperbet-solana/keeper/src/terminalLedger.ts",
  "packages/hyperbet-solana/keeper/src/terminalOps.ts",
] as const;
const forbiddenKeeperLaunchPatterns = [
  /@hyperbet\/(?:chain-registry|mm-core)/,
  /\/api\/perps/,
  /points\/multiplier/,
  /arena\/wallet-link/,
  /proxy\/birdeye/,
  /\bgoldAmount\b/i,
  /\bsourceAmount\b/,
  /wallet_gold_state/i,
  /referral_fees/i,
  /staking_points/i,
  /wallet_canonical/i,
  /identity_members/i,
  /\bpointsScope\b/,
  /\bidentityWalletCount\b/,
  /url\.searchParams\.get\(["']scope["']\)/,
  /\b(?:BSC|AVAX|Avalanche|Base Sepolia)\b/i,
] as const;
for (const relativePath of keeperLaunchSources) {
  requireAbsent(relativePath, forbiddenKeeperLaunchPatterns);
}

requireAbsent("packages/hyperbet-solana/keeper/src/duelBot.ts", [
  /from\s+["']\.\/common["']/,
  /\b(?:perps|model.?market|trueskill|agent.?rating)\b/i,
  /\b(?:GOLD|AVAX|Avalanche|BSC|Base Sepolia)\b/i,
  /seed-gold|market-mint|legacyAnalyticsDb/i,
  prohibitedLegacyBrandPattern,
  /\b(?:BOT_KEYPAIR|ORACLE_AUTHORITY_KEYPAIR)\b/,
]);
requireAbsent("packages/hyperbet-solana/keeper/src/resolve.ts", [
  /from\s+["']\.\/common["']/,
  /\b(?:BOT_KEYPAIR|ORACLE_AUTHORITY_KEYPAIR)\b/,
]);
requireAbsent("packages/hyperbet-solana/keeper/src/game-client.ts", [
  /\/api\/streaming\/state/,
  /STREAMING_STATE_UPDATE/,
]);
const gameClientSource = read(
  "packages/hyperbet-solana/keeper/src/game-client.ts",
);
if (!gameClientSource.includes("payload.schemaVersion !== 3")) {
  fail("duel keeper game client does not require betting-feed schema v3");
}
if (!gameClientSource.includes("/api/internal/bet-sync/state")) {
  fail(
    "duel keeper game client is not pinned to the authenticated betting feed",
  );
}
for (const requiredContinuityToken of [
  "payload.sourceEpoch",
  "payload.seq",
  "/api/internal/bet-sync/events",
  "BettingFeedContinuityError",
  "saveBettingFeedCheckpoint",
]) {
  if (!gameClientSource.includes(requiredContinuityToken)) {
    fail(
      `duel keeper game client is missing feed-continuity control ${requiredContinuityToken}`,
    );
  }
}
const marketRecoverySource = read(
  "packages/hyperbet-solana/keeper/src/marketRecovery.ts",
);
for (const requiredRecoveryToken of [
  "findDuelStatePda",
  "findMarketPda",
  "findOrderPda",
  "allowedMarketAuthorities",
  "expectedFees",
  "planManagedOrderClosure",
  "missing canonical duelId metadata",
  "invalid-managed-order",
]) {
  if (!marketRecoverySource.includes(requiredRecoveryToken)) {
    fail(
      `duel keeper market recovery is missing validation ${requiredRecoveryToken}`,
    );
  }
}
requireAbsent("packages/hyperbet-solana/keeper/.env.example", [
  /\b(?:GOLD|AVAX|Avalanche|BSC|Base Sepolia)\b/i,
  /PERPS_|BIRDEYE_|MARKET_MINT|ENABLE_KEEPER_BOT/i,
  /\b(?:BOT_KEYPAIR|ORACLE_AUTHORITY_KEYPAIR)\b/,
]);
requireAbsent("packages/hyperbet-solana/app/.env.example", [
  /\b(?:GOLD|AVAX|Avalanche|BSC|Base Sepolia)\b/i,
  /PERPS_|GOLD_MINT|USDC_MINT/i,
]);

const solanaAppPackage = JSON.parse(
  read("packages/hyperbet-solana/app/package.json"),
) as { scripts?: Record<string, string> };
if (solanaAppPackage.scripts?.test !== "bun test tests/unit") {
  fail("Solana app default test is not pinned to its unit suite");
}
if (solanaAppPackage.scripts?.["test:e2e:mainnet"]) {
  fail("Solana app still exposes a public mainnet browser-write harness");
}
for (const requiredReadOnlyCommand of ["test:e2e:devnet", "test:e2e:testnet"]) {
  if (
    !solanaAppPackage.scripts?.[requiredReadOnlyCommand]?.includes(
      "scripts/run-e2e-public.sh",
    )
  ) {
    fail(`Solana app is missing ${requiredReadOnlyCommand}`);
  }
}

const launchHarnessPaths = [
  "packages/hyperbet-solana/app/scripts/run-local-demo.sh",
  "packages/hyperbet-solana/app/scripts/run-e2e-local.sh",
  "packages/hyperbet-solana/app/scripts/run-e2e-public.sh",
  "packages/hyperbet-solana/app/tests/e2e/setup-localnet.ts",
  "packages/hyperbet-solana/app/tests/e2e/setup-public.ts",
  "packages/hyperbet-solana/app/tests/e2e/seed-api-local.ts",
  "packages/hyperbet-solana/app/tests/e2e/market-flows.e2e.ts",
] as const;
for (const relativePath of launchHarnessPaths) {
  requireAbsent(relativePath, [
    /\bGOLD\b/i,
    /gold[_-]?(?:mint|clob|perps|amm)/i,
    /E2E_SOLANA_V1_ONLY/,
    /ORACLE_AUTHORITY_KEYPAIR/,
    /ENABLE_KEEPER_BOT/,
    /packages\/hyperbet-(?:bsc|avax|evm)/i,
    /\b(?:AVAX|Avalanche|BSC|Base Sepolia)\b/i,
  ]);
}
if (
  existsSync(
    join(root, "packages/hyperbet-solana/app/tests/e2e/setup-api-local.ts"),
  )
) {
  fail("retired token analytics E2E seed remains callable");
}

const localHarness = read(
  "packages/hyperbet-solana/app/scripts/run-e2e-local.sh",
);
for (const requiredLocalProgram of ["fight_oracle.so", "duel_market.so"]) {
  if (!localHarness.includes(requiredLocalProgram)) {
    fail(`local E2E harness does not deploy ${requiredLocalProgram}`);
  }
}
const publicHarness = read(
  "packages/hyperbet-solana/app/scripts/run-e2e-public.sh",
);
for (const requiredReadOnlyControl of [
  "validating live Solana state without chain writes",
  "app-tabs-and-apis.e2e.ts",
  "devnet|testnet",
]) {
  if (!publicHarness.includes(requiredReadOnlyControl)) {
    fail(`public E2E harness is missing ${requiredReadOnlyControl}`);
  }
}
requireAbsent("packages/hyperbet-solana/app/scripts/run-e2e-public.sh", [
  /setup-api-local/,
  /seed-api-local/,
  /start-hyperia-duel-service/,
  /keeper:service/,
  /mainnet-beta/,
]);

const appFacingAcceptance = read(
  "packages/hyperbet-solana/app/tests/e2e/app-tabs-and-apis.e2e.ts",
);
for (const retiredRoute of [
  "/api/perps/markets",
  "/api/models/markets",
  "/api/proxy/evm/rpc",
]) {
  if (!appFacingAcceptance.includes(retiredRoute)) {
    fail(`app acceptance does not prove ${retiredRoute} is inaccessible`);
  }
}
if (!appFacingAcceptance.includes("must stay inaccessible")) {
  fail("app acceptance does not assert disabled-route 404 behavior");
}

requireAbsent("packages/hyperbet-solana/keeper/src/service.ts", [
  /src\/bot\.ts/,
  /Bun\.spawn/,
  /loadPerps/i,
  /modelMarketId/i,
  /saveReferralFees/i,
  /saveWalletGoldState/i,
  /legacyAnalyticsDb/i,
  /from\s+["']\.\/keeperBot["']/i,
  prohibitedLegacyBrandPattern,
  /\b(?:BOT_KEYPAIR|ORACLE_AUTHORITY_KEYPAIR)\b/,
  /readKeypair/,
]);

const duelBotSource = read("packages/hyperbet-solana/keeper/src/duelBot.ts");
for (const requiredRecoveryControl of [
  "discoverDuelMarketRecovery",
  "fightProgram.account.duelState.all()",
  "marketProgram.account.marketState.all()",
  "ORDER_MAKER_MEMCMP_OFFSET",
  "ORDER_ACTIVE_MEMCMP_OFFSET",
  "reclaimRestingOrder",
  "recoveredManagedOrders",
  "on-chain-market-recovery",
  "programIdentityCheckIntervalMs",
  "withdrawResolvedTradeFees",
  "accruedTradeTreasuryFeeLamports",
  "accruedTradeMarketMakerFeeLamports",
]) {
  if (!duelBotSource.includes(requiredRecoveryControl)) {
    fail(
      `duel keeper is missing on-chain recovery control ${requiredRecoveryControl}`,
    );
  }
}
const keeperServiceSource = read(
  "packages/hyperbet-solana/keeper/src/service.ts",
);
for (const requiredAccountingControl of [
  "verifyPlaceOrderAccounting",
  "classifySignatureFinality",
  "isCanonicalSolanaTransactionSignature",
  "marketAccount.tradeTreasuryFeeBpsSnapshot",
  "marketAccount.tradeMarketMakerFeeBpsSnapshot",
  "tradeFeeEscrowEvents",
  "claimSettled",
  "resolvedTradeFeesWithdrawn",
  "transaction.meta.innerInstructions",
  "rewardEligibleLamports",
  "REQUIRE_ONCHAIN_BET_VERIFICATION",
  "getSignatureStatuses",
  'commitment: "finalized"',
  'status: "pending-finality"',
  "syncFinalizedMarketLifecycleIndex",
  "getMinimumLedgerSlot",
  "commitSolanaIndexedTransaction",
  "parseFinalizedMarketLifecycleTransaction",
  "TAKER_EXECUTION",
  "reconcileSolanaBetLifecycleAccounting",
  "/api/arena/settlements/",
  "loadSolanaWalletBetHistory",
  "settlementLedgerStatus",
]) {
  if (!keeperServiceSource.includes(requiredAccountingControl)) {
    fail(
      `keeper service is missing authoritative bet accounting control ${requiredAccountingControl}`,
    );
  }
}
const solanaTrackingSource = read(
  "packages/hyperbet-ui/src/lib/solanaPredictionMarketTracking.ts",
);
for (const requiredFinalityRetryControl of [
  "MAX_FINALIZATION_ATTEMPTS",
  "response.status === 425",
  "response.status === 503",
]) {
  if (!solanaTrackingSource.includes(requiredFinalityRetryControl)) {
    fail(
      `Solana tracking client is missing finality retry control ${requiredFinalityRetryControl}`,
    );
  }
}
const solanaAppConfigSource = read(
  "packages/hyperbet-solana/app/src/lib/config.ts",
);
for (const requiredRuntimeUrlControl of [
  "buildSolanaRpcProxyUrl",
  "window.location.origin",
]) {
  if (!solanaAppConfigSource.includes(requiredRuntimeUrlControl)) {
    fail(`Solana app config is missing ${requiredRuntimeUrlControl}`);
  }
}
const sharedStreamingStateSourcePath =
  "packages/hyperbet-ui/src/spectator/useStreamingState.ts";
const sharedStreamingStateSource = read(sharedStreamingStateSourcePath);
if (
  !sharedStreamingStateSource.includes("new URL(sseUrl, sseBaseUrl)") ||
  !sharedStreamingStateSource.includes("window.location.origin")
) {
  fail(`${sharedStreamingStateSourcePath} does not support same-origin SSE`);
}
const appStreamingStateSourcePath =
  "packages/hyperbet-solana/app/src/spectator/useStreamingState.ts";
const appStreamingStateSource = read(appStreamingStateSourcePath);
if (
  !appStreamingStateSource.includes("useSharedStreamingState") ||
  !appStreamingStateSource.includes("apiUrl: CONFIG.gameApiUrl")
) {
  fail(
    `${appStreamingStateSourcePath} does not delegate its runtime API base to the same-origin-capable shared SSE client`,
  );
}
const solanaClobPanelSource = read(
  "packages/hyperbet-ui/src/components/SolanaClobPanel.tsx",
);
requireAbsent("packages/hyperbet-ui/src/components/SolanaClobPanel.tsx", [
  prohibitedLegacyBrandPattern,
  /feeBps:\s*0\b/,
]);
for (const requiredLoserCleanupControl of [
  "resolveSolanaSettlementInstruction",
  ".closeLosingBalance()",
  "clearingPositionContext",
]) {
  if (!solanaClobPanelSource.includes(requiredLoserCleanupControl)) {
    fail(
      `Solana CLOB panel is missing loser cleanup control ${requiredLoserCleanupControl}`,
    );
  }
}
if (solanaClobPanelSource.includes('claimKind !== "LOSER_CLEANUP"')) {
  fail("Solana CLOB panel still suppresses the supported loser cleanup action");
}
for (const requiredOrderQuoteControl of [
  "buildSolanaOrderQuote",
  "parseSolAmountToLamports",
  "tradeTreasuryFeeBpsSnapshot",
  "tradeMarketMakerFeeBpsSnapshot",
  "winningsMarketMakerFeeBpsSnapshot",
  "accountRentReserveLamports",
  "estimatedNetworkFeeLamports",
  "getFeeForMessage",
  "verifyVaultRentExempt",
  "tradeTreasuryFeeLamports",
  "tradeMarketMakerFeeLamports",
  "activeMarket.treasury",
  "activeMarket.marketMaker",
  "orderSubmissionReady",
  "MAX_MATCHES_PER_TX = 50",
]) {
  if (!solanaClobPanelSource.includes(requiredOrderQuoteControl)) {
    fail(
      `Solana CLOB panel is missing pre-signature quote control ${requiredOrderQuoteControl}`,
    );
  }
}
const solanaOrderQuoteSource = read(
  "packages/hyperbet-ui/src/lib/solanaOrderQuote.ts",
);
for (const requiredOrderQuoteInvariant of [
  "SOL amount must use at most 6 decimal places",
  "Combined trade fee exceeds the program cap",
  "fullFillWinningsFeeLamports",
  "refundableExecutionFeeLamports",
  "selfTradePrevented",
  "continuationRequired",
  "outcomePriceToMarketPrice",
]) {
  if (!solanaOrderQuoteSource.includes(requiredOrderQuoteInvariant)) {
    fail(
      `Solana order quote is missing invariant ${requiredOrderQuoteInvariant}`,
    );
  }
}
requireAbsent("packages/hyperbet-ui/src/lib/solanaOrderQuote.ts", [
  /nonRefundableExecutionFeeLamports/,
]);
const marketProgramSource = read(
  "packages/hyperbet-solana/anchor/programs/duel_market/src/lib.rs",
);
for (const requiredOnChainCleanupControl of [
  "pub fn close_losing_balance",
  "validate_losing_balance_cleanup",
  "WinningBalanceCannotBeClosed",
  "LosingBalanceClosed",
  ".user_balance",
  ".close(ctx.accounts.user.to_account_info())",
]) {
  if (!marketProgramSource.includes(requiredOnChainCleanupControl)) {
    fail(
      `Solana market program is missing loser cleanup control ${requiredOnChainCleanupControl}`,
    );
  }
}
for (const requiredFeeEscrowControl of [
  "escrow_trade_fees",
  "trade_treasury_fee_lamports",
  "trade_market_maker_fee_lamports",
  "accrued_trade_treasury_fee_lamports",
  "accrued_trade_market_maker_fee_lamports",
  "pub fn withdraw_resolved_trade_fees",
  "ResolvedTradeFeesWithdrawn",
  "TradeFeesEscrowed",
  "ClaimSettled",
  "FeeEscrowInvariantViolation",
]) {
  if (!marketProgramSource.includes(requiredFeeEscrowControl)) {
    fail(
      `Solana market program is missing cancellation-safe fee escrow control ${requiredFeeEscrowControl}`,
    );
  }
}
const solanaBuildSource = read(
  "packages/hyperbet-solana/anchor/scripts/build-workspace.sh",
);
for (const requiredBuildIntegrityControl of [
  "refusing to reuse stale deploy binaries",
  "HYPERBET_SOLANA_ALLOW_IDL_ONLY",
  'ANCHOR_CLI_VERSION="0.32.1"',
  "host-only fallback is disabled",
  "explicit canonical IDL-only mode enabled",
  'anchor build --no-idl -- --tools-version "${TOOLS_VERSION}" -- --locked',
  "cargo_build_sbf=warn",
  "audit-sbf-build-log.ts",
]) {
  if (!solanaBuildSource.includes(requiredBuildIntegrityControl)) {
    fail(
      `Solana program build is missing integrity control ${requiredBuildIntegrityControl}`,
    );
  }
}
if (
  existsSync(
    join(
      root,
      "packages/hyperbet-solana/anchor/scripts/generate-anchor-types.mjs",
    ),
  )
) {
  fail("Solana build still exposes a non-Anchor TypeScript IDL generator");
}
for (const forbiddenBuildFallback of [
  /generate_idl\s*\(/,
  /__anchor_private_print_idl_/,
]) {
  if (forbiddenBuildFallback.test(solanaBuildSource)) {
    fail(
      `Solana program build still contains unsafe host IDL fallback ${forbiddenBuildFallback}`,
    );
  }
}
if (
  !existsSync(
    join(root, "packages/hyperbet-solana/tests/build-workspace-policy.test.ts"),
  )
) {
  fail("Solana build fail-closed policy test is missing");
}
if (
  !existsSync(
    join(
      root,
      "packages/hyperbet-solana/anchor/scripts/audit-sbf-build-log.ts",
    ),
  )
) {
  fail("Solana SBF warning classifier is missing");
}
const solanaLocalnetTestSource = read(
  "packages/hyperbet-solana/anchor/scripts/run-localnet-tests.sh",
);
for (const requiredLocalnetHarnessControl of [
  "SOLANA_ACTIVE_RELEASE_BIN",
  "TS_MOCHA_COMMAND",
  'bunx "ts-mocha@10.0.0"',
  'bash "$ROOT_DIR/scripts/build-workspace.sh"',
]) {
  if (!solanaLocalnetTestSource.includes(requiredLocalnetHarnessControl)) {
    fail(
      `Solana localnet test harness is missing tool resolution ${requiredLocalnetHarnessControl}`,
    );
  }
}
if (/^\s*anchor build/m.test(solanaLocalnetTestSource)) {
  fail("Solana localnet harness bypasses the canonical pinned build script");
}
const scenarioGateSource = read("scripts/ci-gate-scenarios.ts");
for (const requiredScenarioIntegrityControl of [
  "unsupported SOL-only scenario argument",
  "Always rebuild before a Solana scenario run",
  "stale .so",
  'SIM_RUNTIME_TARGET: "solana"',
  '"duel_market.so"',
]) {
  if (!scenarioGateSource.includes(requiredScenarioIntegrityControl)) {
    fail(
      `Solana scenario gate is missing integrity control ${requiredScenarioIntegrityControl}`,
    );
  }
}
for (const solanaGatePath of [
  "scripts/ci-gate-scenarios.ts",
  "scripts/ci-gate-e2e.ts",
]) {
  requireAbsent(solanaGatePath, [
    /packages\/(?:evm-contracts|hyperbet-(?:bsc|avax|evm))/i,
    /\b(?:AVAX|Avalanche|BSC|Base Sepolia|EVM|anvil|foundry)\b/i,
    /gold[_-]?(?:mint|clob|perps|amm)/i,
    /E2E_SOLANA_V1_ONLY/,
  ]);
}
const solanaProofScenarioSource = read(
  "packages/simulation-dashboard/src/backends/solana/proof-scenarios.ts",
);
for (const requiredCleanupProof of [
  "WinningBalanceCannotBeClosed",
  "winnerCleanupRejected",
  "repeatCleanupRejected",
  "innerSystemTransfers === 0",
  "vaultAfter === losingCleanupRecord.vaultBefore",
  "Loser cleanup transaction unexpectedly included the vault",
]) {
  if (!solanaProofScenarioSource.includes(requiredCleanupProof)) {
    fail(
      `Solana validator proof is missing loser cleanup assertion ${requiredCleanupProof}`,
    );
  }
}
const simulationServerSource = read(
  "packages/simulation-dashboard/src/server.ts",
);
for (const requiredSolanaOnlyBootstrapControl of [
  "EVM_BOOTSTRAP_ENABLED",
  "skipping Anvil and EVM deployment",
  "simulationRuntimeUsesEvm",
]) {
  if (!simulationServerSource.includes(requiredSolanaOnlyBootstrapControl)) {
    fail(
      `Simulation server is missing Solana-only bootstrap control ${requiredSolanaOnlyBootstrapControl}`,
    );
  }
}
const betAccountingSource = read(
  "packages/hyperbet-solana/keeper/src/solanaBetAccounting.ts",
);
for (const requiredAccountingInvariant of [
  "exactly one order-placed event",
  "unexplained native transfer",
  "trade-fee escrow event does not match executed fill value",
  "GTC order released units without self-trade evidence",
  "rewardEligibleLamports",
]) {
  if (!betAccountingSource.includes(requiredAccountingInvariant)) {
    fail(
      `keeper bet accounting is missing invariant ${requiredAccountingInvariant}`,
    );
  }
}
const betReconciliationSource = read(
  "packages/hyperbet-solana/keeper/src/solanaBetReconciliation.ts",
);
for (const requiredReconciliationControl of [
  "reconcileBetExecutionFromIndexedFacts",
  "indexed order units violate conservation",
  "indexed initial execution contradicts immutable place-order accounting",
  "rewardEligible",
  "pointsForLamports",
]) {
  if (!betReconciliationSource.includes(requiredReconciliationControl)) {
    fail(
      `Solana bet reconciliation is missing ${requiredReconciliationControl}`,
    );
  }
}
const terminalSettlementSource = read(
  "packages/hyperbet-solana/keeper/src/solanaTerminalSettlement.ts",
);
for (const requiredTerminalSettlementControl of [
  "reconcileWalletMarketTerminalSettlements",
  "allocateFeeByLargestRemainder",
  "wallet-market terminal settlement does not conserve",
  "terminal settlement match is missing taker execution",
  "grossEntitlementLamports",
  "order.lockedLamports + order.tradeFeeLamports",
  "cancellation refund trade-fee attribution does not conserve",
]) {
  if (!terminalSettlementSource.includes(requiredTerminalSettlementControl)) {
    fail(
      `Solana terminal settlement is missing ${requiredTerminalSettlementControl}`,
    );
  }
}
const settlementHistorySource = read(
  "packages/hyperbet-ui/src/lib/solanaSettlementHistory.ts",
);
for (const requiredSettlementHistoryControl of [
  "parseSolanaSettlementHistoryResponse",
  "matched + resting + released !== orderAmount",
  "executed + tradeFee !== rewardEligible",
  "terminalPayout + terminalFee !== terminalGross",
  'response.asset !== "SOL"',
  "ledger.current",
]) {
  if (!settlementHistorySource.includes(requiredSettlementHistoryControl)) {
    fail(
      `Solana settlement history client is missing ${requiredSettlementHistoryControl}`,
    );
  }
}
const dbSource = read("packages/hyperbet-solana/keeper/src/db.ts");
for (const requiredSettlementLedgerControl of [
  "loadSolanaWalletBetHistory",
  "orderStateForHistory",
  "settlementStateForHistory",
  "persisted Solana bet history accounting is invalid",
  "persisted Solana terminal history does not conserve",
]) {
  if (!dbSource.includes(requiredSettlementLedgerControl)) {
    fail(
      `Solana settlement ledger is missing ${requiredSettlementLedgerControl}`,
    );
  }
}
const lifecycleIndexerSource = read(
  "packages/hyperbet-solana/keeper/src/solanaLifecycleIndexer.ts",
);
for (const requiredLifecycleIndexerControl of [
  "collectFinalizedSignatureBackfill",
  "minimumAvailableSlot",
  "checkpointSignature",
  "newestFirst.reverse()",
  "resolveLifecycleIndexStartSlot",
  "unitsReleasedByVaultRefund",
  "verifyClaimLifecycleAccounting",
  "verifyLosingBalanceCleanupAccounting",
  "LOSING_BALANCE_CLOSED",
  "RESOLVED_TRADE_FEES_WITHDRAWN",
]) {
  if (!lifecycleIndexerSource.includes(requiredLifecycleIndexerControl)) {
    fail(
      `Solana lifecycle index is missing ${requiredLifecycleIndexerControl}`,
    );
  }
}
const programIdentitySource = read(
  "packages/hyperbet-solana/keeper/src/solanaProgramIdentity.ts",
);
for (const requiredProgramIdentityControl of [
  "BPF_LOADER_UPGRADEABLE_PROGRAM_ID",
  "programAccount.executable",
  "canonicalProgramDataAddress",
  "programDataAccount.owner.equals",
  "expectedUpgradeAuthority",
  '"finalized"',
]) {
  if (!programIdentitySource.includes(requiredProgramIdentityControl)) {
    fail(
      `Solana launch program identity gate is missing ${requiredProgramIdentityControl}`,
    );
  }
}
for (const launchRuntimeSource of [duelBotSource, keeperServiceSource]) {
  if (!launchRuntimeSource.includes("fetchUpgradeableProgramIdentity")) {
    fail("a Solana launch runtime is missing the program identity gate");
  }
}
for (const requiredRole of [
  "keeperFeePayerKeypair",
  "oracleReporterKeypair",
  "oracleFinalizerKeypair",
  "oracleChallengerWallet",
  "clobMarketOperatorKeypair",
  "marketMakerKeypair",
]) {
  if (!duelBotSource.includes(requiredRole)) {
    fail(`dedicated duel keeper is missing explicit ${requiredRole} wiring`);
  }
}
for (const requiredSignerBinding of [
  ".signers([oracleReporterKeypair])",
  ".signers([oracleFinalizerKeypair])",
  ".signers([clobMarketOperatorKeypair])",
  ".signers([marketMakerKeypair])",
]) {
  if (!duelBotSource.includes(requiredSignerBinding)) {
    fail(
      `dedicated duel keeper is missing transaction signer binding ${requiredSignerBinding}`,
    );
  }
}

const serviceSource = read("packages/hyperbet-solana/keeper/src/service.ts");
for (const requiredReadinessControl of [
  "createReadOnlyLaunchPrograms",
  "evaluateKeeperReadiness",
  "resolveStreamStateSourceConfig",
  "canAcceptStreamStatePublish",
  "STREAM_STATE_PUBLISH_ENABLED",
  'url.pathname === "/health"',
  'url.pathname === "/ready"',
  "checkDatabaseHealth",
]) {
  if (!serviceSource.includes(requiredReadinessControl)) {
    fail(
      `Solana service is missing launch readiness control ${requiredReadinessControl}`,
    );
  }
}
requireAbsent("packages/hyperbet-solana/keeper/src/db.ts", [
  /\bperps\b/i,
  /model market/i,
  /agent_ratings/i,
]);

if (
  existsSync(
    join(
      root,
      "packages/hyperbet-solana/app/src/components/ModelsMarketView.tsx",
    ),
  )
) {
  fail("Solana app still contains its Models/perps route component");
}

const distAssets = join(root, "packages/hyperbet-solana/app/dist/assets");
if (existsSync(distAssets)) {
  const assetNames = readdirSync(distAssets);
  const excludedChunk = assetNames.find((name) =>
    /modelsmarket|perps/i.test(name),
  );
  if (excludedChunk) {
    fail(`Solana production bundle contains excluded chunk ${excludedChunk}`);
  }

  const forbiddenBundlePatterns = [
    /RainbowKit/i,
    /\bwagmi\b/i,
    /Avalanche/i,
    /\bAVAX\b/,
    /Binance Smart Chain/i,
    /Base Sepolia/i,
    /Models Market/i,
    /Gold Perps/i,
    /\bGOLD\b/,
    /gold-betting-keeper/i,
  ] as const;
  for (const name of assetNames.filter((entry) => entry.endsWith(".js"))) {
    const contents = readFileSync(join(distAssets, name), "utf8");
    if (forbiddenBundlePatterns.some((pattern) => pattern.test(contents))) {
      fail(
        `Solana production bundle ${name} contains excluded chain/token content`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error("SOL-only v1 scope gate failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  "SOL-only v1 scope gate passed: root commands, two-program graph, runtime sources, and production bundle are duel-only.",
);

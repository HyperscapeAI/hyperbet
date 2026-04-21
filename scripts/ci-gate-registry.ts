import {
  BETTING_EVM_CHAIN_ORDER,
  BETTING_LAUNCH_EVM_CHAIN_ORDER,
  BETTING_LAUNCH_SOLANA_CLUSTER,
  BETTING_SOLANA_CLUSTERS,
  type BettingAppEnvironment,
  type BettingEvmChain,
  type BettingSolanaFullProductField,
  type BettingSolanaCluster,
  getMissingBettingEvmCanonicalFields,
  getMissingBettingEvmFullProductFields,
  getMissingBettingEvmReleaseFields,
  getMissingBettingSolanaCanonicalFields,
  getMissingBettingSolanaFullProductFields,
  getMissingBettingSolanaReleaseFields,
  resolveBettingEvmDeploymentForChain,
  resolveBettingSolanaDeployment,
} from "../packages/hyperbet-chain-registry/src/index.js";
import { resolveArtifactRoot, writeJsonArtifact } from "./ci-lib.js";

type RegistrySurface = "pm-core" | "full-product" | "release";
type RegistryScope = "all-evm-mainnet" | "launch";

type RegistryGateResult = {
  kind: "solana" | "evm";
  chain: string;
  networkKey: string;
  label: string;
  missingFields: string[];
};

function parseSurface(): RegistrySurface {
  const value =
    process.argv
      .slice(2)
      .find((arg) => arg.startsWith("--surface="))
      ?.slice("--surface=".length) ?? "full-product";
  if (value !== "pm-core" && value !== "full-product" && value !== "release") {
    throw new Error(`unsupported registry surface: ${value}`);
  }
  return value;
}

function parseScope(): RegistryScope {
  const value =
    process.argv
      .slice(2)
      .find((arg) => arg.startsWith("--scope="))
      ?.slice("--scope=".length) ?? "all-evm-mainnet";
  if (value !== "all-evm-mainnet" && value !== "launch") {
    throw new Error(`unsupported registry scope: ${value}`);
  }
  return value;
}

function parseSolanaCluster(): BettingSolanaCluster {
  const value =
    process.argv
      .slice(2)
      .find((arg) => arg.startsWith("--solana-cluster="))
      ?.slice("--solana-cluster=".length) ?? BETTING_LAUNCH_SOLANA_CLUSTER;
  if (!BETTING_SOLANA_CLUSTERS.includes(value as BettingSolanaCluster)) {
    throw new Error(`unsupported solana cluster: ${value}`);
  }
  return value as BettingSolanaCluster;
}

function parseEvmEnvironment(): BettingAppEnvironment {
  const value =
    process.argv
      .slice(2)
      .find((arg) => arg.startsWith("--evm-environment="))
      ?.slice("--evm-environment=".length) ?? "mainnet-beta";
  if (
    value !== "mainnet-beta" &&
    value !== "testnet" &&
    value !== "devnet" &&
    value !== "localnet" &&
    value !== "e2e" &&
    value !== "stream-ui"
  ) {
    throw new Error(`unsupported evm environment: ${value}`);
  }
  return value;
}

function parseIncludedEvmChains(
  scope: RegistryScope,
): readonly BettingEvmChain[] {
  const value =
    process.argv
      .slice(2)
      .find((arg) => arg.startsWith("--include-evm="))
      ?.slice("--include-evm=".length) ?? "";
  if (value.trim().length === 0) {
    return scope === "launch" ? BETTING_LAUNCH_EVM_CHAIN_ORDER : BETTING_EVM_CHAIN_ORDER;
  }
  const chains = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (chains.length === 0) {
    throw new Error("include-evm must include at least one chain");
  }
  for (const chain of chains) {
    if (chain !== "bsc" && chain !== "base" && chain !== "avax") {
      throw new Error(`unsupported evm chain in include-evm: ${chain}`);
    }
  }
  return chains as BettingEvmChain[];
}

function parseIgnoredSolanaFields(): ReadonlySet<BettingSolanaFullProductField> {
  const value =
    process.argv
      .slice(2)
      .find((arg) => arg.startsWith("--ignore-solana-fields="))
      ?.slice("--ignore-solana-fields=".length) ?? "";
  if (value.trim().length === 0) {
    return new Set();
  }
  const allowed = new Set<BettingSolanaFullProductField>([
    "fightOracleProgramId",
    "goldClobMarketProgramId",
    "goldAmmMarketProgramId",
    "usdcMint",
    "goldPerpsMarketProgramId",
    "goldMint",
  ]);
  const fields = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  for (const field of fields) {
    if (!allowed.has(field as BettingSolanaFullProductField)) {
      throw new Error(`unsupported solana field in ignore-solana-fields: ${field}`);
    }
  }
  return new Set(fields as BettingSolanaFullProductField[]);
}

function missingEvmFieldsForSurface(
  surface: RegistrySurface,
  chain: (typeof BETTING_EVM_CHAIN_ORDER)[number],
  environment: BettingAppEnvironment,
) {
  const deployment = resolveBettingEvmDeploymentForChain(chain, environment);
  if (surface === "pm-core") {
    return {
      deployment,
      missingFields: getMissingBettingEvmCanonicalFields(deployment),
    };
  }
  if (surface === "release") {
    return {
      deployment,
      missingFields: getMissingBettingEvmReleaseFields(deployment),
    };
  }
  return {
    deployment,
    missingFields: getMissingBettingEvmFullProductFields(deployment),
  };
}

function missingSolanaFieldsForSurface(
  surface: RegistrySurface,
  cluster: BettingSolanaCluster,
  ignoredFields: ReadonlySet<BettingSolanaFullProductField>,
) {
  const deployment = resolveBettingSolanaDeployment(cluster);
  if (surface === "pm-core") {
    return {
      deployment,
      missingFields: getMissingBettingSolanaCanonicalFields(deployment),
    };
  }
  if (surface === "release") {
    return {
      deployment,
      missingFields: getMissingBettingSolanaReleaseFields(deployment),
    };
  }
  return {
    deployment,
    missingFields: getMissingBettingSolanaFullProductFields(deployment).filter(
      (field) => !ignoredFields.has(field),
    ),
  };
}

function artifactNameFor(scope: RegistryScope, surface: RegistrySurface): string {
  if (scope === "launch" && surface === "full-product") {
    return "registry-launch-gate";
  }
  if (scope === "all-evm-mainnet") {
    return `registry-${surface}-gate`;
  }
  return `registry-${scope}-${surface}-gate`;
}

const surface = parseSurface();
const scope = parseScope();
const solanaCluster = parseSolanaCluster();
const evmEnvironment = parseEvmEnvironment();
const includedEvmChains = parseIncludedEvmChains(scope);
const ignoredSolanaFields = parseIgnoredSolanaFields();
const artifactRoot = resolveArtifactRoot(artifactNameFor(scope, surface));
const results: RegistryGateResult[] =
  scope === "launch"
    ? [
        (() => {
          const { deployment, missingFields } = missingSolanaFieldsForSurface(
            surface,
            solanaCluster,
            ignoredSolanaFields,
          );
          return {
            kind: "solana" as const,
            chain: "solana",
            networkKey: deployment.cluster,
            label: `Solana ${deployment.cluster}`,
            missingFields,
          };
        })(),
        ...includedEvmChains.map((chain) => {
          const { deployment, missingFields } = missingEvmFieldsForSurface(
            surface,
            chain,
            evmEnvironment,
          );
          return {
            kind: "evm" as const,
            chain,
            networkKey: deployment.networkKey,
            label: deployment.label,
            missingFields,
          };
        }),
      ]
    : BETTING_EVM_CHAIN_ORDER.map((chain) => {
        const { deployment, missingFields } = missingEvmFieldsForSurface(
          surface,
          chain,
          evmEnvironment,
        );
        return {
          kind: "evm" as const,
          chain,
          networkKey: deployment.networkKey,
          label: deployment.label,
          missingFields,
        };
      });

writeJsonArtifact(artifactRoot, "summary.json", {
  scope,
  surface,
  solanaCluster,
  evmEnvironment,
  includedEvmChains,
  ignoredSolanaFields: [...ignoredSolanaFields],
  results,
});

const failures = results.filter((result) => result.missingFields.length > 0);
if (failures.length > 0) {
  throw new Error(
    [
      `${scope} ${surface} registry gate failed`,
      ...failures.map(
        (result) =>
          `${result.chain} is missing ${result.missingFields.join(", ")}`,
      ),
    ].join("\n"),
  );
}

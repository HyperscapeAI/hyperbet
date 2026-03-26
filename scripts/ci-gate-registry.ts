import {
  BETTING_EVM_CHAIN_ORDER,
  BETTING_LAUNCH_EVM_CHAIN_ORDER,
  BETTING_LAUNCH_SOLANA_CLUSTER,
  getMissingBettingEvmCanonicalFields,
  getMissingBettingEvmFullProductFields,
  getMissingBettingEvmReleaseFields,
  getMissingBettingSolanaCanonicalFields,
  getMissingBettingSolanaFullProductFields,
  getMissingBettingSolanaReleaseFields,
  resolveBettingEvmDeploymentForChain,
  resolveBettingSolanaDeployment,
} from "../packages/hyperbet-chain-registry/src/index";
import { resolveArtifactRoot, writeJsonArtifact } from "./ci-lib";

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

function missingEvmFieldsForSurface(
  surface: RegistrySurface,
  chain: (typeof BETTING_EVM_CHAIN_ORDER)[number],
) {
  const deployment = resolveBettingEvmDeploymentForChain(chain, "mainnet-beta");
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

function missingSolanaFieldsForSurface(surface: RegistrySurface) {
  const deployment = resolveBettingSolanaDeployment(BETTING_LAUNCH_SOLANA_CLUSTER);
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
    missingFields: getMissingBettingSolanaFullProductFields(deployment),
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
const artifactRoot = resolveArtifactRoot(artifactNameFor(scope, surface));
const results: RegistryGateResult[] =
  scope === "launch"
    ? [
        (() => {
          const { deployment, missingFields } = missingSolanaFieldsForSurface(
            surface,
          );
          return {
            kind: "solana" as const,
            chain: "solana",
            networkKey: deployment.cluster,
            label: `Solana ${deployment.cluster}`,
            missingFields,
          };
        })(),
        ...BETTING_LAUNCH_EVM_CHAIN_ORDER.map((chain) => {
          const { deployment, missingFields } = missingEvmFieldsForSurface(
            surface,
            chain,
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

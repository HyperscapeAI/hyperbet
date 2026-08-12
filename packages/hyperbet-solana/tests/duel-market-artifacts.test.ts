import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repositoryRoot = path.resolve(packageRoot, "..", "..");
const canonicalIdlPath = path.join(
  packageRoot,
  "anchor",
  "target",
  "idl",
  "duel_market.json",
);
const canonicalFightOracleIdlPath = path.join(
  packageRoot,
  "anchor",
  "target",
  "idl",
  "fight_oracle.json",
);

const downstreamIdlPaths = [
  path.join(packageRoot, "app", "src", "idl", "duel_market.json"),
  path.join(packageRoot, "keeper", "src", "idl", "duel_market.json"),
  path.join(
    repositoryRoot,
    "packages",
    "hyperbet-ui",
    "src",
    "idl",
    "duel_market.json",
  ),
  path.join(
    repositoryRoot,
    "packages",
    "market-maker-bot",
    "src",
    "idl",
    "duel_market.json",
  ),
  path.join(
    repositoryRoot,
    "packages",
    "hyperbet-sdk",
    "src",
    "solana",
    "idl",
    "duel_market.json",
  ),
  path.join(
    repositoryRoot,
    "packages",
    "hyperbet-sdk-py",
    "hyperbet_sdk",
    "solana",
    "idl",
    "duel_market.json",
  ),
] as const;

const downstreamFightOracleIdlPaths = [
  path.join(packageRoot, "app", "src", "idl", "fight_oracle.json"),
  path.join(packageRoot, "keeper", "src", "idl", "fight_oracle.json"),
  path.join(
    repositoryRoot,
    "packages",
    "hyperbet-ui",
    "src",
    "idl",
    "fight_oracle.json",
  ),
  path.join(
    repositoryRoot,
    "packages",
    "hyperbet-sdk",
    "src",
    "solana",
    "idl",
    "fight_oracle.json",
  ),
  path.join(
    repositoryRoot,
    "packages",
    "hyperbet-sdk-py",
    "hyperbet_sdk",
    "solana",
    "idl",
    "fight_oracle.json",
  ),
] as const;

describe("neutral Solana duel-market artifacts", () => {
  test("keeps every downstream IDL byte-identical to the Anchor artifact", () => {
    const canonical = readFileSync(canonicalIdlPath);
    for (const downstreamPath of downstreamIdlPaths) {
      expect(readFileSync(downstreamPath).equals(canonical)).toBe(true);
    }
  });

  test("keeps every downstream fight-oracle IDL byte-identical", () => {
    const canonical = readFileSync(canonicalFightOracleIdlPath);
    for (const downstreamPath of downstreamFightOracleIdlPaths) {
      expect(readFileSync(downstreamPath).equals(canonical)).toBe(true);
    }
  });

  test("publishes permanent proposal history in the oracle ABI", () => {
    const idl = JSON.parse(
      readFileSync(canonicalFightOracleIdlPath, "utf8"),
    ) as {
      metadata?: { name?: unknown };
      instructions?: Array<{
        name?: unknown;
        accounts?: Array<{ name?: unknown }>;
      }>;
      accounts?: Array<{ name?: unknown }>;
      types?: unknown[];
      errors?: unknown[];
    };
    expect(idl.metadata?.name).toBe("fight_oracle");
    expect(idl.instructions?.length).toBe(10);
    expect(idl.accounts?.map((account) => account.name)).toContain(
      "ProposalRecord",
    );
    expect(idl.accounts?.length).toBe(3);
    expect(idl.types?.length).toBe(10);
    expect(idl.errors?.length).toBe(30);

    const accountsFor = (instructionName: string) =>
      idl.instructions
        ?.find((instruction) => instruction.name === instructionName)
        ?.accounts?.map((account) => account.name);
    expect(accountsFor("propose_result")).toEqual([
      "reporter",
      "oracle_config",
      "duel_state",
      "proposal_record",
      "system_program",
    ]);
    expect(accountsFor("repropose_result")).toEqual([
      "reporter",
      "oracle_config",
      "duel_state",
      "proposal_record",
      "system_program",
    ]);
    expect(accountsFor("challenge_result")).toEqual([
      "challenger",
      "oracle_config",
      "duel_state",
      "proposal_record",
    ]);
  });

  test("publishes only the neutral program identity", () => {
    const idl = JSON.parse(readFileSync(canonicalIdlPath, "utf8")) as {
      address?: unknown;
      metadata?: { name?: unknown };
      instructions?: unknown[];
      accounts?: unknown[];
      types?: unknown[];
      errors?: unknown[];
    };
    expect(idl.metadata?.name).toBe("duel_market");
    expect(typeof idl.address).toBe("string");
    expect(idl.instructions?.length).toBe(15);
    expect(idl.accounts?.length).toBe(6);
    expect(idl.types?.length).toBe(22);
    expect(idl.errors?.length).toBe(53);
    expect(readFileSync(canonicalIdlPath, "utf8")).not.toMatch(
      /gold[_-]?clob/i,
    );
  });
});

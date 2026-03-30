import { describe, expect, it } from "vitest";

import {
  parseForkAttackSeeds,
  resolveForkTargets,
  runForkAttackSuite,
} from "./fork-harness.js";

describe("fork harness target resolution", () => {
  it("returns undefined targets when no env vars are set", () => {
    const targets = resolveForkTargets({});

    expect(targets).toEqual({
      bscForkRpc: undefined,
      avaxForkRpc: undefined,
      solanaForkRpc: undefined,
    });
  });

  it("reads and trims configured fork rpc targets", () => {
    const targets = resolveForkTargets({
      BSC_FORK_RPC_URL: " http://127.0.0.1:8545 ",
      AVAX_FORK_RPC_URL: "http://127.0.0.1:9650/ext/bc/C/rpc",
      SOLANA_FORK_RPC_URL: " http://127.0.0.1:8899 ",
    });

    expect(targets).toEqual({
      bscForkRpc: "http://127.0.0.1:8545",
      avaxForkRpc: "http://127.0.0.1:9650/ext/bc/C/rpc",
      solanaForkRpc: "http://127.0.0.1:8899",
    });
  });
});

describe("fork harness attack seed parsing", () => {
  it("uses default seed when env is unset", () => {
    expect(parseForkAttackSeeds(undefined)).toEqual([20260311]);
  });

  it("parses and deduplicates seed corpus", () => {
    expect(parseForkAttackSeeds("20260311, 20260328,20260311")).toEqual([
      20260311,
      20260328,
    ]);
  });

  it("throws on invalid seed corpus", () => {
    expect(() => parseForkAttackSeeds("abc, 0, -2")).toThrow(
      /MM_FORK_ATTACK_SEEDS/,
    );
  });
});

describe("fork harness deterministic attack suite", () => {
  it("passes hardened fork attack scenarios for each chain", () => {
    const chains = ["solana", "bsc", "avax"] as const;

    for (const chain of chains) {
      const result = runForkAttackSuite(chain, [20260311]);
      expect(result.breaches).toEqual([]);
      expect(result.scenariosChecked).toBe(7);
    }
  });
});

import { describe, expect, test } from "bun:test";

import { SolanaTransactionExpiredError } from "../src/lib/solanaRpc";
import {
  buildSolanaExplorerTransactionUrl,
  classifySolanaTransactionError,
  SolanaTransactionFlowError,
} from "../src/lib/solanaTransactionFeedback";

function flowError(
  stage: "preparing" | "signing" | "sending" | "confirming",
  cause: Error,
  signature: string | null = null,
): SolanaTransactionFlowError {
  return new SolanaTransactionFlowError({
    message: `${stage} failed`,
    stage,
    signature,
    cause,
  });
}

describe("Solana transaction feedback", () => {
  test("classifies a pre-signature order-book change as a safe quote refresh", () => {
    const result = classifySolanaTransactionError(
      flowError(
        "preparing",
        new Error("Order book changed; review the refreshed quote"),
      ),
    );
    expect(result.kind).toBe("QUOTE_STALE");
    expect(result.stage).toBe("preparing");
    expect(result.signature).toBeNull();
    expect(result.retryMode).toBe("REVIEW_AND_RETRY");
  });

  test("classifies user rejection as safe to review and retry", () => {
    const result = classifySolanaTransactionError(
      flowError("signing", new Error("User rejected the request")),
    );
    expect(result.kind).toBe("USER_REJECTED");
    expect(result.stage).toBe("signing");
    expect(result.signature).toBeNull();
    expect(result.retryMode).toBe("REVIEW_AND_RETRY");
  });

  test("requires status inspection when an RPC error follows submission", () => {
    const result = classifySolanaTransactionError(
      flowError(
        "confirming",
        new Error("RPC service unavailable"),
        "sig-known",
      ),
    );
    expect(result.kind).toBe("RPC_UNAVAILABLE");
    expect(result.signature).toBe("sig-known");
    expect(result.retryMode).toBe("CHECK_STATUS_FIRST");
  });

  test("never presents an expired submitted transaction as a blind retry", () => {
    const result = classifySolanaTransactionError(
      flowError(
        "confirming",
        new SolanaTransactionExpiredError("block height exceeded"),
        "sig-expired",
      ),
    );
    expect(result.kind).toBe("EXPIRED");
    expect(result.retryMode).toBe("CHECK_STATUS_FIRST");
    expect(result.detail).toBe("block height exceeded");
  });

  test("distinguishes funding, simulation, and finalized program failures", () => {
    expect(
      classifySolanaTransactionError(
        flowError("sending", new Error("insufficient funds for fee")),
      ),
    ).toMatchObject({
      kind: "INSUFFICIENT_FUNDS",
      retryMode: "REVIEW_AND_RETRY",
    });
    expect(
      classifySolanaTransactionError(
        flowError("sending", new Error("Transaction simulation failed")),
      ),
    ).toMatchObject({
      kind: "SIMULATION_FAILED",
      retryMode: "REVIEW_AND_RETRY",
    });
    expect(
      classifySolanaTransactionError(
        flowError(
          "confirming",
          new Error("Transaction failed: InstructionError"),
        ),
      ),
    ).toMatchObject({ kind: "ONCHAIN_FAILED", retryMode: "BLOCKED" });
  });

  test("builds cluster-correct explorer links and omits localnet", () => {
    expect(buildSolanaExplorerTransactionUrl("sig/one", "mainnet-beta")).toBe(
      "https://explorer.solana.com/tx/sig%2Fone",
    );
    expect(buildSolanaExplorerTransactionUrl("sig", "devnet")).toBe(
      "https://explorer.solana.com/tx/sig?cluster=devnet",
    );
    expect(buildSolanaExplorerTransactionUrl("sig", "localnet")).toBeNull();
    expect(buildSolanaExplorerTransactionUrl(" ", "mainnet-beta")).toBeNull();
  });
});

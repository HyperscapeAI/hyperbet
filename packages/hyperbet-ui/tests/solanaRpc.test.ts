import { afterEach, describe, expect, mock, test } from "bun:test";

import {
  confirmSignatureViaRpc,
  inspectSignatureViaRpc,
  isSolanaTransactionExpiredError,
  sendRawTransactionViaRpc,
  SolanaTransactionExpiredError,
} from "../src/lib/solanaRpc";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("solanaRpc", () => {
  test("routes keeper-backed submit traffic to the sender endpoint", async () => {
    const fetchMock = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe(
          "https://keeper.example.com/api/proxy/solana/sender",
        );
        expect(init?.method).toBe("POST");

        const payload = JSON.parse(String(init?.body)) as {
          transaction: string;
        };
        expect(payload.transaction).toBe("AQID");

        return new Response(JSON.stringify({ signature: "sig-123" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const signature = await sendRawTransactionViaRpc(
      {
        rpcEndpoint:
          "https://keeper.example.com/api/proxy/solana/rpc?cluster=mainnet-beta",
      } as any,
      {
        serialize: () => Uint8Array.from([1, 2, 3]),
      } as any,
    );

    expect(signature).toBe("sig-123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("fails explicitly when a submitted signature outlives its blockhash", async () => {
    const connection = {
      rpcEndpoint: "https://rpc.example.com",
      getSignatureStatuses: mock(async () => ({ value: [null] })),
      getBlockHeight: mock(async () => 151),
    } as any;

    const confirmation = confirmSignatureViaRpc(connection, "sig-expired", {
      timeoutMs: 1_000,
      lastValidBlockHeight: 150,
    });

    await expect(confirmation).rejects.toBeInstanceOf(
      SolanaTransactionExpiredError,
    );
    await expect(confirmation).rejects.toThrow("not automatically resubmitted");
    expect(connection.getSignatureStatuses).toHaveBeenCalledTimes(1);
    expect(connection.getBlockHeight).toHaveBeenCalledTimes(1);
  });

  test("does not report expiration after the signature is confirmed", async () => {
    const connection = {
      rpcEndpoint: "https://rpc.example.com",
      getSignatureStatuses: mock(async () => ({
        value: [{ err: null, confirmationStatus: "confirmed" }],
      })),
      getBlockHeight: mock(async () => 999),
    } as any;

    await confirmSignatureViaRpc(connection, "sig-confirmed", {
      timeoutMs: 1_000,
      lastValidBlockHeight: 150,
    });

    expect(connection.getBlockHeight).not.toHaveBeenCalled();
  });

  test("inspects known signatures without resubmitting ambiguous transactions", async () => {
    const statuses = [
      null,
      { err: null, confirmationStatus: "processed" },
      { err: null, confirmationStatus: "finalized" },
      {
        err: { InstructionError: [0, "Custom"] },
        confirmationStatus: "finalized",
      },
    ];
    const connection = {
      rpcEndpoint: "https://rpc.example.com",
      getSignatureStatuses: mock(async () => ({
        value: [statuses.shift() ?? null],
      })),
      sendRawTransaction: mock(async () => "must-not-send"),
    } as any;

    await expect(
      inspectSignatureViaRpc(connection, "sig-known"),
    ).resolves.toEqual({
      state: "not_found",
      confirmationStatus: null,
      error: null,
    });
    await expect(
      inspectSignatureViaRpc(connection, "sig-known"),
    ).resolves.toEqual({
      state: "pending",
      confirmationStatus: "processed",
      error: null,
    });
    await expect(
      inspectSignatureViaRpc(connection, "sig-known"),
    ).resolves.toEqual({
      state: "confirmed",
      confirmationStatus: "finalized",
      error: null,
    });
    await expect(
      inspectSignatureViaRpc(connection, "sig-known"),
    ).resolves.toEqual({
      state: "failed",
      confirmationStatus: "finalized",
      error: { InstructionError: [0, "Custom"] },
    });
    expect(connection.getSignatureStatuses).toHaveBeenCalledTimes(4);
    expect(connection.sendRawTransaction).not.toHaveBeenCalled();
  });

  test("rejects an empty status-inspection signature", async () => {
    await expect(inspectSignatureViaRpc({} as any, "  ")).rejects.toThrow(
      "signature is required",
    );
  });

  test("recognizes wallet and RPC blockhash-expiration errors", () => {
    expect(
      isSolanaTransactionExpiredError(new Error("Blockhash not found")),
    ).toBeTrue();
    expect(
      isSolanaTransactionExpiredError(
        new Error("send failed", {
          cause: new SolanaTransactionExpiredError("transaction expired"),
        }),
      ),
    ).toBeTrue();
    expect(
      isSolanaTransactionExpiredError(new Error("user rejected")),
    ).toBeFalse();
  });
});

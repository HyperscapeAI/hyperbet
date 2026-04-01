import { afterEach, describe, expect, mock, test } from "bun:test";

import { sendRawTransactionViaRpc } from "../src/lib/solanaRpc";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("solanaRpc", () => {
  test("routes keeper-backed submit traffic to the sender endpoint", async () => {
    const fetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
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
    });
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
});

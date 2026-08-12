import { describe, expect, test } from "bun:test";

import { describeRpcEndpoint } from "./solana-deployment-evidence";

describe("Solana deployment evidence redaction", () => {
  test("retains only protocol and host from configured RPC URLs", () => {
    expect(
      describeRpcEndpoint(
        "https://user:secret@rpc.example.test/private/api-key?token=secret#fragment",
      ),
    ).toBe("https://rpc.example.test");
    expect(describeRpcEndpoint("http://127.0.0.1:8899/path")).toBe(
      "http://127.0.0.1:8899",
    );
  });

  test("does not echo malformed RPC configuration", () => {
    expect(describeRpcEndpoint("not a URL with secret-token")).toBe(
      "invalid-rpc-url",
    );
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import { HyperbetSolanaClient, duelKeyHexToBytes } from "../src/solana/client";
import { ORDER_BEHAVIOR_GTC, SIDE_ASK, SIDE_BID } from "../src/types";

const mocks = vi.hoisted(() => ({
  placeOrder: vi.fn(),
  cancelOrder: vi.fn(),
  reclaimRestingOrder: vi.fn(),
  closeFilledOrder: vi.fn(),
  claim: vi.fn(),
  closeLosingBalance: vi.fn(),
  rpc: vi.fn().mockResolvedValue("mock-signature"),
  idlAddresses: [] as string[],
}));

vi.mock("bs58", () => ({
  default: { decode: vi.fn(() => new Uint8Array(64)) },
}));

vi.mock("@coral-xyz/anchor", () => {
  const instruction = (spy: ReturnType<typeof vi.fn>) =>
    spy.mockImplementation((...args: unknown[]) => {
      const builder = {
        args,
        accounts: null as Record<string, unknown> | null,
        remaining: [] as unknown[],
        accountsPartial(accounts: Record<string, unknown>) {
          builder.accounts = accounts;
          return builder;
        },
        remainingAccounts(accounts: unknown[]) {
          builder.remaining = accounts;
          return builder;
        },
        rpc: mocks.rpc,
      };
      return builder;
    });
  instruction(mocks.placeOrder);
  instruction(mocks.cancelOrder);
  instruction(mocks.reclaimRestingOrder);
  instruction(mocks.closeFilledOrder);
  instruction(mocks.claim);
  instruction(mocks.closeLosingBalance);

  class Program {
    public readonly account: Record<string, any>;
    public readonly methods: Record<string, any>;

    constructor(idl: any) {
      mocks.idlAddresses.push(idl.address);
      const marketAccount = {
        duelState: new (globalThis as any).__MockPublicKey("mock-pda"),
        marketKind: 1,
        status: { open: {} },
        nextOrderId: 42n,
        treasury: new (globalThis as any).__MockPublicKey("mock-treasury"),
        marketMaker: new (globalThis as any).__MockPublicKey("mock-maker"),
      };
      const orderAccount = {
        id: 7n,
        marketState: new (globalThis as any).__MockPublicKey("mock-pda"),
        maker: new (globalThis as any).__MockPublicKey("mock-wallet"),
        side: 1,
        price: 500,
        amount: 10_000n,
        filled: 2_000n,
        prevOrderId: 0n,
        nextOrderId: 0n,
        active: true,
        continuationPending: false,
      };
      this.account = {
        duelState: { fetch: vi.fn().mockResolvedValue({ status: {} }) },
        marketState: { fetch: vi.fn().mockResolvedValue(marketAccount) },
        priceLevel: {
          all: vi.fn().mockResolvedValue([]),
          fetch: vi.fn().mockResolvedValue({
            marketState: new (globalThis as any).__MockPublicKey("mock-pda"),
            side: 1,
            price: 500,
            headOrderId: 7n,
            tailOrderId: 7n,
            totalOpen: 8_000n,
          }),
          fetchNullable: vi.fn().mockResolvedValue(null),
        },
        order: { fetch: vi.fn().mockResolvedValue(orderAccount) },
      };
      this.methods = {
        placeOrder: mocks.placeOrder,
        cancelOrder: mocks.cancelOrder,
        reclaimRestingOrder: mocks.reclaimRestingOrder,
        closeFilledOrder: mocks.closeFilledOrder,
        claim: mocks.claim,
        closeLosingBalance: mocks.closeLosingBalance,
      };
    }
  }

  return {
    AnchorProvider: class {},
    Wallet: class {},
    Program,
  };
});

vi.mock("@solana/web3.js", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  class MockPublicKey {
    constructor(public readonly value: string) {}
    toBase58() {
      return this.value;
    }
    toBuffer() {
      return Buffer.from(this.value.padEnd(32, "0").slice(0, 32));
    }
    equals(other: MockPublicKey) {
      return this.value === other.value;
    }
    static findProgramAddressSync() {
      return [new MockPublicKey("mock-pda"), 255];
    }
  }
  (globalThis as any).__MockPublicKey = MockPublicKey;
  return {
    ...original,
    Connection: class {
      constructor(
        public readonly rpcEndpoint: string,
        public readonly commitment: string,
      ) {}
    },
    Keypair: {
      fromSecretKey: vi.fn(() => ({
        publicKey: new MockPublicKey("mock-wallet"),
      })),
    },
    PublicKey: MockPublicKey,
    SystemProgram: {
      programId: new MockPublicKey("11111111111111111111111111111111"),
    },
  };
});

describe("HyperbetSolanaClient", () => {
  let client: HyperbetSolanaClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.idlAddresses.length = 0;
    client = new HyperbetSolanaClient(
      "http://localhost:8899",
      "mock-base58-key",
      "duel-market-program",
      "fight-oracle-program",
    );
  });

  it("binds both Anchor programs to the explicitly configured identities", () => {
    expect(mocks.idlAddresses).toEqual([
      "duel-market-program",
      "fight-oracle-program",
    ]);
  });

  it("rejects malformed duel keys and unsafe order precision", async () => {
    expect(() => duelKeyHexToBytes("abc")).toThrow(/32-byte hex/);
    await expect(
      client.placeOrder({
        duelKeyHex: "0".repeat(64),
        side: "YES",
        outcomePriceMillis: 500,
        amountLamports: 1_001n,
      }),
    ).rejects.toThrow(/divisible by 1000/);
  });

  it("builds the complete current place-order instruction", async () => {
    const signature = await client.placeOrder({
      duelKeyHex: "0".repeat(64),
      side: "NO",
      outcomePriceMillis: 400,
      amountLamports: 10_000n,
    });
    expect(signature).toBe("mock-signature");
    const args = mocks.placeOrder.mock.calls[0];
    expect(args[0].toString()).toBe("42");
    expect(args.slice(1, 3)).toEqual([SIDE_ASK, 600]);
    expect(args[3].toString()).toBe("10000");
    expect(args[4]).toBe(ORDER_BEHAVIOR_GTC);
    const builder = mocks.placeOrder.mock.results[0].value;
    expect(Object.keys(builder.accounts).sort()).toEqual(
      [
        "config",
        "duelState",
        "marketMaker",
        "marketState",
        "newOrder",
        "restingLevel",
        "systemProgram",
        "treasury",
        "user",
        "userBalance",
        "vault",
      ].sort(),
    );
  });

  it("revalidates and builds cancel and terminal-reclaim instructions", async () => {
    await expect(
      client.cancelOrder({ duelKeyHex: "0".repeat(64), orderId: 7n }),
    ).resolves.toBe("mock-signature");
    await expect(
      client.reclaimOrder({ duelKeyHex: "0".repeat(64), orderId: 7n }),
    ).resolves.toBe("mock-signature");
    expect(mocks.cancelOrder.mock.calls[0][0].toString()).toBe("7");
    expect(mocks.cancelOrder.mock.calls[0].slice(1)).toEqual([SIDE_BID, 500]);
    expect(mocks.reclaimRestingOrder.mock.calls[0][0].toString()).toBe("7");
  });

  it("routes claims and loser cleanup through distinct current instructions", async () => {
    await expect(client.claim({ duelKeyHex: "0".repeat(64) })).resolves.toBe(
      "mock-signature",
    );
    await expect(
      client.closeLosingBalance({ duelKeyHex: "0".repeat(64) }),
    ).resolves.toBe("mock-signature");
    expect(mocks.claim).toHaveBeenCalledOnce();
    expect(mocks.closeLosingBalance).toHaveBeenCalledOnce();
    expect(
      mocks.claim.mock.results[0].value.accounts.userBalance,
    ).toBeDefined();
    expect(
      mocks.closeLosingBalance.mock.results[0].value.accounts.userBalance,
    ).toBeDefined();
  });
});

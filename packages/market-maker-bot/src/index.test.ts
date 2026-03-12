import { beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DUEL_KEY =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TEST_SOLANA_PUBLIC_KEY =
  "TestSolanaPublicKey1111111111111111111111111";
const TEST_SOLANA_PROGRAM_ID =
  "MockProgram111111111111111111111111111111111";
const TEST_FIGHT_ORACLE_ID =
  "FightOracle11111111111111111111111111111111";

const contractInstances: Array<Record<string, any>> = [];

type SolanaOrderRecord = {
  id: bigint;
  side: number;
  price: number;
  amount: bigint;
  filled: bigint;
  active: boolean;
};

const solanaState = {
  marketExists: true,
  marketStatus: "open",
  bestBid: 480,
  bestAsk: 520,
  nextOrderId: 1n,
  orders: new Map<number, SolanaOrderRecord>(),
  userBalance: {
    aShares: 0n,
    bShares: 0n,
  },
  calls: {
    sync: 0,
    place: [] as Array<{ orderId: bigint; side: number; price: number; amount: bigint }>,
    cancel: [] as Array<{ orderId: bigint; side: number; price: number }>,
    claim: 0,
  },
};

let duelPhase = "FIGHTING";
let agent1Hp = 90;
let agent2Hp = 30;
let solanaLifecycleStatus = "OPEN";
let activePredictionChains = ["bsc", "base", "avax", "solana"];

function resetSolanaState() {
  solanaState.marketExists = true;
  solanaState.marketStatus = "open";
  solanaState.bestBid = 480;
  solanaState.bestAsk = 520;
  solanaState.nextOrderId = 1n;
  solanaState.orders.clear();
  solanaState.userBalance.aShares = 0n;
  solanaState.userBalance.bShares = 0n;
  solanaState.calls.sync = 0;
  solanaState.calls.place = [];
  solanaState.calls.cancel = [];
  solanaState.calls.claim = 0;
}

function mockEnum(name: string) {
  return { [name]: {} };
}

function parseOrderIdFromPda(value: string): number {
  const seedHex = value.split(":").at(-1) || "";
  const bytes = Buffer.from(seedHex, "hex");
  return Number(bytes.readBigUInt64LE(0));
}

vi.mock("ethers", () => {
  class MockJsonRpcProvider {
    constructor(readonly url: string) {}

    async getNetwork() {
      return { chainId: 31337n };
    }

    async getCode() {
      return "0x6000";
    }

    async getBalance() {
      return 10n ** 18n;
    }

    async getTransactionCount() {
      return 0;
    }
  }

  class MockWallet {
    address = "0x1234567890123456789012345678901234567890";

    constructor(readonly privateKey: string, readonly provider?: unknown) {
      void privateKey;
      void provider;
    }
  }

  class MockContract {
    target: string;
    nextOrderId = 1n;
    feeBps = vi.fn().mockResolvedValue(200n);
    tradeTreasuryFeeBps = vi.fn().mockResolvedValue(100n);
    tradeMarketMakerFeeBps = vi.fn().mockResolvedValue(100n);
    marketKey = vi.fn().mockResolvedValue("0xmarket");
    getMarket = vi.fn().mockResolvedValue({
      exists: true,
      status: 1n,
      winner: 0n,
      nextOrderId: 1n,
      bestBid: 480n,
      bestAsk: 520n,
      totalAShares: 0n,
      totalBShares: 0n,
    });
    positions = vi.fn().mockResolvedValue({
      aShares: 0n,
      bShares: 0n,
      aStake: 0n,
      bStake: 0n,
    });
    cancelOrder = vi.fn().mockResolvedValue({
      wait: vi.fn().mockResolvedValue({}),
    });
    placeOrder = vi.fn().mockImplementation(() => {
      const orderId = this.nextOrderId;
      this.nextOrderId += 1n;
      return {
        hash: `0xtx-${orderId.toString()}`,
        wait: vi.fn().mockResolvedValue({
          hash: `0xtx-${orderId.toString()}`,
          logs: [{ kind: "orderPlaced", orderId }],
        }),
      };
    });

    constructor(target: string) {
      this.target = target;
      contractInstances.push(this as unknown as Record<string, any>);
    }
  }

  class MockInterface {
    parseLog(log: Record<string, any>) {
      if (log.kind === "orderPlaced") {
        return {
          name: "OrderPlaced",
          args: {
            marketKey: "0xmarket",
            orderId: log.orderId ?? 1n,
          },
        };
      }
      return null;
    }
  }

  return {
    ethers: {
      JsonRpcProvider: MockJsonRpcProvider,
      Wallet: MockWallet,
      Contract: MockContract,
      Interface: MockInterface,
      ZeroAddress: "0x0000000000000000000000000000000000000000",
      getAddress: (value: string) => {
        const trimmed = value.trim();
        if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
          throw new Error("invalid address");
        }
        return trimmed;
      },
    },
  };
});

vi.mock("@solana/web3.js", () => {
  class MockPublicKey {
    constructor(private readonly value = TEST_SOLANA_PROGRAM_ID) {}

    toBase58() {
      return this.value;
    }

    toBuffer() {
      return Buffer.from(this.value.padEnd(32, "0").slice(0, 32));
    }

    static findProgramAddressSync(
      seeds: Array<Uint8Array | Buffer>,
      programId: MockPublicKey,
    ) {
      const seedHex = seeds
        .map((seed) => Buffer.from(seed).toString("hex"))
        .join(":");
      return [new MockPublicKey(`pda:${programId.toBase58()}:${seedHex}`), 255];
    }
  }

  const buildKeypair = () => ({
    publicKey: new MockPublicKey(TEST_SOLANA_PUBLIC_KEY),
    secretKey: new Uint8Array(64),
  });

  class MockConnection {
    rpcEndpoint = "http://localhost:8899";

    async getVersion() {
      return { "solana-core": "1.18.0-test" };
    }

    async getAccountInfo() {
      return { executable: true };
    }

    async getLatestBlockhash() {
      return { blockhash: "test-blockhash", lastValidBlockHeight: 1 };
    }

    async getBalance() {
      return 10n ** 9n;
    }

    async getSignatureStatuses() {
      return {
        value: [{ confirmationStatus: "confirmed", err: null }],
      };
    }
  }

  class MockTransaction {
    partialSign() {}
  }

  class MockVersionedTransaction {
    sign() {}
  }

  return {
    Connection: MockConnection,
    Keypair: {
      generate: buildKeypair,
      fromSeed: buildKeypair,
      fromSecretKey: buildKeypair,
    },
    PublicKey: MockPublicKey,
    SystemProgram: {
      programId: new MockPublicKey("11111111111111111111111111111111"),
    },
    Transaction: MockTransaction,
    VersionedTransaction: MockVersionedTransaction,
  };
});

vi.mock("@coral-xyz/anchor", async () => {
  const web3 = await import("@solana/web3.js");

  class MockAnchorProvider {
    connection: unknown;
    wallet: any;
    opts: Record<string, unknown>;

    constructor(connection: unknown, wallet: any, opts: Record<string, unknown>) {
      this.connection = connection;
      this.wallet = wallet;
      this.opts = opts;
    }
  }

  class MockProgram {
    programId: InstanceType<typeof web3.PublicKey>;
    provider: MockAnchorProvider;

    account = {
      marketConfig: {
        fetchNullable: vi.fn(async () => ({
          treasury: new web3.PublicKey("Treasury111111111111111111111111111111111"),
          marketMaker: new web3.PublicKey("MarketMaker11111111111111111111111111111"),
          tradeTreasuryFeeBps: 100,
          tradeMarketMakerFeeBps: 100,
          winningsMarketMakerFeeBps: 200,
        })),
      },
      marketState: {
        fetchNullable: vi.fn(async () => {
          if (!solanaState.marketExists) return null;
          return {
            bestBid: solanaState.bestBid,
            bestAsk: solanaState.bestAsk,
            nextOrderId: solanaState.nextOrderId,
            status: mockEnum(solanaState.marketStatus),
          };
        }),
      },
      userBalance: {
        fetchNullable: vi.fn(async () => ({
          aShares: solanaState.userBalance.aShares,
          bShares: solanaState.userBalance.bShares,
        })),
      },
      order: {
        fetchNullable: vi.fn(async (address: { toBase58: () => string }) => {
          const orderId = parseOrderIdFromPda(address.toBase58());
          const order = solanaState.orders.get(orderId);
          if (!order || !order.active) {
            return null;
          }
          return {
            id: order.id,
            side: order.side,
            price: order.price,
            amount: order.amount,
            filled: order.filled,
            active: order.active,
          };
        }),
      },
    };

    methods = {
      syncMarketFromDuel: () => ({
        accountsPartial: () => ({
          rpc: async () => {
            solanaState.calls.sync += 1;
            return `sol-sync-${solanaState.calls.sync}`;
          },
        }),
      }),
      placeOrder: (
        orderId: { toString: () => string },
        side: number,
        price: number,
        amount: { toString: () => string },
      ) => ({
        accountsPartial: () => ({
          rpc: async () => {
            const id = BigInt(orderId.toString());
            const rawAmount = BigInt(amount.toString());
            solanaState.orders.set(Number(id), {
              id,
              side,
              price,
              amount: rawAmount,
              filled: 0n,
              active: true,
            });
            solanaState.nextOrderId = id + 1n;
            solanaState.calls.place.push({
              orderId: id,
              side,
              price,
              amount: rawAmount,
            });
            return `sol-place-${id.toString()}`;
          },
        }),
      }),
      cancelOrder: (
        orderId: { toString: () => string },
        side: number,
        price: number,
      ) => ({
        accountsPartial: () => ({
          rpc: async () => {
            const id = BigInt(orderId.toString());
            const order = solanaState.orders.get(Number(id));
            if (order) {
              order.active = false;
            }
            solanaState.calls.cancel.push({
              orderId: id,
              side,
              price,
            });
            return `sol-cancel-${id.toString()}`;
          },
        }),
      }),
      claim: () => ({
        accountsPartial: () => ({
          rpc: async () => {
            solanaState.userBalance.aShares = 0n;
            solanaState.userBalance.bShares = 0n;
            solanaState.calls.claim += 1;
            return `sol-claim-${solanaState.calls.claim}`;
          },
        }),
      }),
    };

    constructor(idl: { address?: string }, provider: MockAnchorProvider) {
      this.programId = new web3.PublicKey(idl.address || TEST_SOLANA_PROGRAM_ID);
      this.provider = provider;
    }
  }

  return {
    AnchorProvider: MockAnchorProvider,
    Program: MockProgram,
  };
});

async function loadMarketMaker() {
  vi.resetModules();
  const { CrossChainMarketMaker } = await import("./index.ts");
  return new CrossChainMarketMaker();
}

function invalidateBotCaches(mm: any) {
  mm.lastPredictionMarkets = null;
  mm.lastPredictionMarketsAt = 0;
  mm.lastDuelSignal = null;
  mm.lastDuelSignalAt = 0;
}

describe("CrossChainMarketMaker", () => {
  beforeEach(() => {
    vi.useRealTimers();
    contractInstances.length = 0;
    resetSolanaState();
    duelPhase = "FIGHTING";
    agent1Hp = 90;
    agent2Hp = 30;
    solanaLifecycleStatus = "OPEN";
    activePredictionChains = ["bsc", "base", "avax", "solana"];

    process.env.MM_ENV = "testnet";
    process.env.EVM_PRIVATE_KEY =
      "0x1111111111111111111111111111111111111111111111111111111111111111";
    process.env.EVM_PRIVATE_KEY_AVAX =
      "0x2222222222222222222222222222222222222222222222222222222222222222";
    process.env.CLOB_CONTRACT_ADDRESS_BSC =
      "0x1234567890123456789012345678901234567890";
    process.env.CLOB_CONTRACT_ADDRESS_BASE =
      "0x1234567890123456789012345678901234567891";
    process.env.CLOB_CONTRACT_ADDRESS_AVAX =
      "0x1234567890123456789012345678901234567892";
    process.env.MM_ENABLE_BSC = "true";
    process.env.MM_ENABLE_BASE = "true";
    process.env.MM_ENABLE_AVAX = "true";
    process.env.MM_ENABLE_SOLANA = "true";
    process.env.MM_MARKETS_CACHE_MS = "0";
    process.env.MM_DUEL_SIGNAL_CACHE_MS = "0";
    process.env.MM_DUEL_SIGNAL_FETCH_TIMEOUT_MS = "50";
    process.env.MM_PREDICTION_MARKETS_API_URL =
      "http://localhost:8080/api/arena/prediction-markets/active";
    process.env.MM_DUEL_STATE_API_URL = "http://localhost:8080/api/streaming/state";
    process.env.SOLANA_PRIVATE_KEY = JSON.stringify(
      Array.from({ length: 64 }, (_, index) => (index + 1) % 255),
    );
    process.env.SOLANA_RPC_URL = "http://localhost:8899";
    process.env.FIGHT_ORACLE_PROGRAM_ID = TEST_FIGHT_ORACLE_ID;
    process.env.GOLD_CLOB_MARKET_PROGRAM_ID = TEST_SOLANA_PROGRAM_ID;
    process.env.CANCEL_STALE_AGE_MS = "12000";

    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const resolved = String(url);
      if (resolved.includes("/api/arena/prediction-markets/active")) {
        const markets = [];
        if (activePredictionChains.includes("bsc")) {
          markets.push({
            chainKey: "bsc",
            duelKey: TEST_DUEL_KEY,
            marketRef: "0xmarket",
            lifecycleStatus: "OPEN",
          });
        }
        if (activePredictionChains.includes("base")) {
          markets.push({
            chainKey: "base",
            duelKey: TEST_DUEL_KEY,
            marketRef: "0xmarket",
            lifecycleStatus: "OPEN",
          });
        }
        if (activePredictionChains.includes("avax")) {
          markets.push({
            chainKey: "avax",
            duelKey: TEST_DUEL_KEY,
            marketRef: "0xmarket",
            lifecycleStatus: "OPEN",
          });
        }
        if (activePredictionChains.includes("solana")) {
          markets.push({
            chainKey: "solana",
            duelKey: TEST_DUEL_KEY,
            marketRef: null,
            lifecycleStatus: solanaLifecycleStatus,
            programId: TEST_SOLANA_PROGRAM_ID,
          });
        }

        return {
          ok: true,
          json: async () => ({
            duel: {
              duelKey: TEST_DUEL_KEY,
              duelId: "duel-1",
              phase: "ANNOUNCEMENT",
              betCloseTime: Date.now() + 60_000,
            },
            markets,
            updatedAt: Date.now(),
          }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({
          cycle: {
            phase: duelPhase,
            agent1: { hp: agent1Hp, maxHp: 100 },
            agent2: { hp: agent2Hp, maxHp: 100 },
          },
        }),
      } as Response;
    }) as unknown as typeof fetch;
  });

  it("quotes on all enabled EVM chains using lifecycle discovery", async () => {
    const mm = await loadMarketMaker();

    await mm.marketMakeCycle();

    expect(mm.getActiveOrders().filter((order) => order.chainKey !== "solana")).toHaveLength(6);
    expect(mm.getActiveOrders().some((order) => order.chainKey === "avax")).toBe(true);
    expect(contractInstances.every((instance) => instance.placeOrder.mock.calls.length > 0)).toBe(true);
  });

  it("keeps active EVM quotes inside the refresh window when fair value moves", async () => {
    process.env.MM_ENABLE_SOLANA = "false";
    activePredictionChains = ["bsc", "base", "avax"];
    const mm = await loadMarketMaker();

    await mm.marketMakeCycle();
    const initialOrderCount = mm.getActiveOrders().length;

    agent1Hp = 10;
    agent2Hp = 95;

    await mm.marketMakeCycle();

    expect(mm.getActiveOrders()).toHaveLength(initialOrderCount);
    expect(contractInstances.every((instance) => instance.cancelOrder.mock.calls.length === 0)).toBe(true);
    expect(contractInstances.every((instance) => instance.placeOrder.mock.calls.length === 2)).toBe(true);
  });

  it("places bid and ask orders on an open Solana market", async () => {
    process.env.MM_ENABLE_BSC = "false";
    process.env.MM_ENABLE_BASE = "false";
    process.env.MM_ENABLE_AVAX = "false";
    activePredictionChains = ["solana"];
    const mm = await loadMarketMaker();

    await mm.marketMakeCycle();

    expect(mm.getActiveOrders().filter((order) => order.chainKey === "solana")).toHaveLength(2);
    expect(solanaState.calls.sync).toBeGreaterThan(0);
    expect(solanaState.calls.place).toHaveLength(2);
    expect(mm.getConfig().solanaWalletPublicKey).toBe(TEST_SOLANA_PUBLIC_KEY);
  });

  it("keeps active Solana quotes inside the refresh window when fair value moves", async () => {
    process.env.MM_ENABLE_BSC = "false";
    process.env.MM_ENABLE_BASE = "false";
    process.env.MM_ENABLE_AVAX = "false";
    activePredictionChains = ["solana"];
    const mm = await loadMarketMaker();

    await mm.marketMakeCycle();
    const initialOrderCount = mm.getActiveOrders().length;
    const initialPlaceCount = solanaState.calls.place.length;

    agent1Hp = 10;
    agent2Hp = 95;

    await mm.marketMakeCycle();

    expect(mm.getActiveOrders().filter((order) => order.chainKey === "solana")).toHaveLength(initialOrderCount);
    expect(solanaState.calls.cancel).toHaveLength(0);
    expect(solanaState.calls.place).toHaveLength(initialPlaceCount);
  });

  it("cancels and replaces stale Solana orders", async () => {
    process.env.MM_ENABLE_BSC = "false";
    process.env.MM_ENABLE_BASE = "false";
    process.env.MM_ENABLE_AVAX = "false";
    process.env.CANCEL_STALE_AGE_MS = "1000";
    activePredictionChains = ["solana"];
    const mm = await loadMarketMaker();

    await mm.marketMakeCycle();
    expect(solanaState.calls.place).toHaveLength(2);

    for (const order of (mm as any).activeOrders as Array<{ placedAt: number }>) {
      order.placedAt = 0;
    }
    invalidateBotCaches(mm);
    await mm.marketMakeCycle();

    expect(solanaState.calls.cancel.length).toBeGreaterThan(0);
    expect(solanaState.calls.place.length).toBeGreaterThan(2);
    expect(mm.getActiveOrders().filter((order) => order.chainKey === "solana")).toHaveLength(2);
  });

  it("cancels Solana quotes when the market locks", async () => {
    process.env.MM_ENABLE_BSC = "false";
    process.env.MM_ENABLE_BASE = "false";
    process.env.MM_ENABLE_AVAX = "false";
    activePredictionChains = ["solana"];
    const mm = await loadMarketMaker();

    await mm.marketMakeCycle();
    expect(mm.getActiveOrders().filter((order) => order.chainKey === "solana")).toHaveLength(2);

    solanaLifecycleStatus = "LOCKED";
    solanaState.marketStatus = "locked";
    invalidateBotCaches(mm);

    await mm.marketMakeCycle();

    expect(solanaState.calls.cancel.length).toBeGreaterThan(0);
    expect(mm.getActiveOrders().every((order) => order.chainKey !== "solana")).toBe(true);
  });

  it("claims resolved Solana inventory with non-zero shares", async () => {
    process.env.MM_ENABLE_BSC = "false";
    process.env.MM_ENABLE_BASE = "false";
    process.env.MM_ENABLE_AVAX = "false";
    activePredictionChains = ["solana"];
    const mm = await loadMarketMaker();

    await mm.marketMakeCycle();

    solanaLifecycleStatus = "RESOLVED";
    solanaState.marketStatus = "resolved";
    solanaState.userBalance.aShares = 4_000n;
    invalidateBotCaches(mm);

    await mm.marketMakeCycle();

    expect(solanaState.calls.cancel.length).toBeGreaterThan(0);
    expect(solanaState.calls.claim).toBe(1);
    expect(solanaState.userBalance.aShares).toBe(0n);
    expect(mm.getActiveOrders().every((order) => order.chainKey !== "solana")).toBe(true);
  });
});

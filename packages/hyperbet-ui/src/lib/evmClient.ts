import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  http,
  parseAbiItem,
  toHex,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";

import type { EvmChainConfig } from "./chainConfig";
import { GOLD_CLOB_ABI } from "./goldClobAbi";

type BrowserEthereumWindow = Window &
  typeof globalThis & {
    ethereum?: Parameters<typeof custom>[0];
  };

export type MarketStatus =
  | "NULL"
  | "OPEN"
  | "LOCKED"
  | "RESOLVED"
  | "CANCELLED";
export type Side = "NONE" | "A" | "B";

export type MarketMeta = {
  exists: boolean;
  duelKey: Hex;
  marketKind: number;
  status: MarketStatus;
  winner: Side;
  nextOrderId: bigint;
  bestBid: number;
  bestAsk: number;
  totalAShares: bigint;
  totalBShares: bigint;
  marketKey: Hex;
};

export type Position = {
  aShares: bigint;
  bShares: bigint;
  aStake: bigint;
  bStake: bigint;
};

export type TimeInForce = "gtc" | "ioc";

export type OrderInfo = {
  id: bigint;
  side: number;
  price: number;
  maker: Address;
  amount: bigint;
  filled: bigint;
  prevOrderId: bigint;
  nextOrderId: bigint;
  active: boolean;
};

export type ContractWriteClient = {
  chain: WalletClient["chain"];
  writeContract: WalletClient["writeContract"];
};

export const SIDE_ENUM = {
  NONE: 0,
  A: 1,
  B: 2,
  BUY: 1,
  SELL: 2,
} as const;

export const ORDER_FLAG_GTC = 0x01;
export const ORDER_FLAG_IOC = 0x02;
export const ORDER_FLAG_POST_ONLY = 0x04;

export function encodeOrderFlags(
  timeInForce: TimeInForce,
  postOnly: boolean,
): number {
  if (timeInForce === "ioc") {
    if (postOnly) {
      throw new Error("postOnly orders must use timeInForce='gtc'");
    }
    return ORDER_FLAG_IOC;
  }
  return postOnly ? ORDER_FLAG_GTC | ORDER_FLAG_POST_ONLY : ORDER_FLAG_GTC;
}

const MARKET_STATUS_MAP: Record<number, MarketStatus> = {
  0: "NULL",
  1: "OPEN",
  2: "LOCKED",
  3: "RESOLVED",
  4: "CANCELLED",
};

const SIDE_MAP: Record<number, Side> = {
  0: "NONE",
  1: "A",
  2: "B",
};

export function toDuelKeyHex(duelKeyHex: string): Hex {
  const normalized = duelKeyHex.trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("duelKeyHex must be a 32-byte hex string");
  }
  return `0x${normalized}`;
}

export function createEvmPublicClient(
  chainConfig: EvmChainConfig,
): PublicClient {
  return createPublicClient({
    chain: chainConfig.wagmiChain,
    transport: http(chainConfig.rpcUrl),
  });
}

export function createEvmWalletClient(
  chainConfig: EvmChainConfig,
): WalletClient | null {
  if (typeof window === "undefined") {
    return null;
  }

  const browserWindow = window as BrowserEthereumWindow;
  if (!browserWindow.ethereum) {
    return null;
  }

  return createWalletClient({
    chain: chainConfig.wagmiChain,
    transport: custom(browserWindow.ethereum),
  });
}

export function createUnlockedRpcWalletClient(
  chainConfig: EvmChainConfig,
  account: Address,
): ContractWriteClient {
  return {
    chain: chainConfig.wagmiChain,
    async writeContract(parameters) {
      const { address, abi, functionName, args, value } = parameters;
      const data = (encodeFunctionData as (parameters: unknown) => Hex)({
        abi,
        functionName,
        args: args ?? [],
      });
      const response = await fetch(chainConfig.rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: Date.now(),
          method: "eth_sendTransaction",
          params: [
            {
              from: account,
              to: address,
              data,
              ...(value !== undefined ? { value: toHex(value) } : {}),
            },
          ],
        }),
      });
      const payload = (await response.json()) as {
        result?: Hash;
        error?: { message?: string };
      };
      if (!response.ok || !payload.result) {
        throw new Error(payload.error?.message || "eth_sendTransaction failed");
      }
      return payload.result;
    },
  };
}

export async function marketKeyForDuel(
  client: PublicClient,
  contractAddress: Address,
  duelKey: Hex,
  marketKind: number,
): Promise<Hex> {
  return client.readContract({
    address: contractAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "marketKey",
    args: [duelKey, marketKind],
  }) as Promise<Hex>;
}

export async function getMarketMeta(
  client: PublicClient,
  contractAddress: Address,
  duelKey: Hex,
  marketKind: number,
): Promise<MarketMeta> {
  const [resolvedMarketKey, rawResult] = await Promise.all([
    marketKeyForDuel(client, contractAddress, duelKey, marketKind),
    client.readContract({
      address: contractAddress,
      abi: GOLD_CLOB_ABI,
      functionName: "getMarket",
      args: [duelKey, marketKind],
    }),
  ]);

  const result = rawResult as {
    exists: boolean;
    duelKey: Hex;
    status: number;
    winner: number;
    nextOrderId: bigint;
    bestBid: number;
    bestAsk: number;
    totalAShares: bigint;
    totalBShares: bigint;
  };

  return {
    exists: result.exists,
    duelKey: result.duelKey,
    marketKind,
    status: MARKET_STATUS_MAP[Number(result.status)] ?? "NULL",
    winner: SIDE_MAP[Number(result.winner)] ?? "NONE",
    nextOrderId: result.nextOrderId,
    bestBid: Number(result.bestBid),
    bestAsk: Number(result.bestAsk),
    totalAShares: result.totalAShares,
    totalBShares: result.totalBShares,
    marketKey: resolvedMarketKey,
  };
}

export async function getPosition(
  client: PublicClient,
  contractAddress: Address,
  marketKey: Hex,
  userAddress: Address,
): Promise<Position> {
  const result = (await client.readContract({
    address: contractAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "positions",
    args: [marketKey, userAddress],
  })) as [bigint, bigint, bigint, bigint];

  return {
    aShares: result[0],
    bShares: result[1],
    aStake: result[2],
    bStake: result[3],
  };
}

export async function getOrder(
  client: PublicClient,
  contractAddress: Address,
  marketKey: Hex,
  orderId: bigint,
): Promise<OrderInfo> {
  const result = (await client.readContract({
    address: contractAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "orders",
    args: [marketKey, orderId],
  })) as [
    bigint,
    number,
    number,
    Address,
    bigint,
    bigint,
    bigint,
    bigint,
    boolean,
  ];

  return {
    id: result[0],
    side: Number(result[1]),
    price: Number(result[2]),
    maker: result[3],
    amount: result[4],
    filled: result[5],
    prevOrderId: result[6],
    nextOrderId: result[7],
    active: result[8],
  };
}

export async function getOrderBook(
  client: PublicClient,
  contractAddress: Address,
  duelKey: Hex,
  marketKind: number,
  market: MarketMeta,
) {
  const bids: Array<{ price: number; amount: bigint; total: bigint }> = [];
  const asks: Array<{ price: number; amount: bigint; total: bigint }> = [];

  let runningBid = 0n;
  for (let price = market.bestBid; price > 0 && bids.length < 10; price -= 1) {
    const level = (await client.readContract({
      address: contractAddress,
      abi: GOLD_CLOB_ABI,
      functionName: "getPriceLevel",
      args: [duelKey, marketKind, SIDE_ENUM.BUY, price],
    })) as [bigint, bigint, bigint];
    if (level[2] <= 0n) continue;
    runningBid += level[2];
    bids.push({ price: price / 1000, amount: level[2], total: runningBid });
  }

  let runningAsk = 0n;
  for (
    let price = market.bestAsk;
    price < 1000 && asks.length < 10;
    price += 1
  ) {
    const level = (await client.readContract({
      address: contractAddress,
      abi: GOLD_CLOB_ABI,
      functionName: "getPriceLevel",
      args: [duelKey, marketKind, SIDE_ENUM.SELL, price],
    })) as [bigint, bigint, bigint];
    if (level[2] <= 0n) continue;
    runningAsk += level[2];
    asks.push({ price: price / 1000, amount: level[2], total: runningAsk });
  }

  return { bids, asks };
}

export async function getFeeBps(
  client: PublicClient,
  contractAddress: Address,
): Promise<number> {
  const [treasuryFee, marketMakerFee] = (await Promise.all([
    client.readContract({
      address: contractAddress,
      abi: GOLD_CLOB_ABI,
      functionName: "tradeTreasuryFeeBps",
    }),
    client.readContract({
      address: contractAddress,
      abi: GOLD_CLOB_ABI,
      functionName: "tradeMarketMakerFeeBps",
    }),
  ])) as [bigint, bigint];

  return Number(treasuryFee + marketMakerFee);
}

export async function getNativeBalance(
  client: PublicClient,
  userAddress: Address,
): Promise<bigint> {
  return client.getBalance({ address: userAddress });
}

export async function getRecentTrades(
  client: PublicClient,
  contractAddress: Address,
  marketKey: Hex,
  blocksToSearch = 100n,
): Promise<
  {
    time: number;
    price: number;
    amount: bigint;
    side: "YES" | "NO";
    id: string;
  }[]
> {
  const currentBlock = await client.getBlockNumber();
  const fromBlock =
    currentBlock > blocksToSearch ? currentBlock - blocksToSearch : 0n;

  const logs = await client.getLogs({
    address: contractAddress,
    event: parseAbiItem(
      "event OrderMatched(bytes32 indexed marketKey, uint64 makerOrderId, uint64 takerOrderId, uint256 matchedAmount, uint16 price)",
    ),
    args: { marketKey },
    fromBlock,
    toBlock: "latest",
  });

  const blockCache = new Map<bigint, number>();
  const trades = await Promise.all(
    logs.map(async (log) => {
      let time = Date.now();
      if (log.blockNumber) {
        if (!blockCache.has(log.blockNumber)) {
          const block = await client.getBlock({ blockNumber: log.blockNumber });
          blockCache.set(log.blockNumber, Number(block.timestamp) * 1000);
        }
        time = blockCache.get(log.blockNumber)!;
      }

      return {
        id: `${log.transactionHash}-${log.logIndex}`,
        time,
        price: Number(log.args.price!) / 1000,
        amount: log.args.matchedAmount!,
        side: (Number(log.args.price!) >= 500 ? "YES" : "NO") as "YES" | "NO",
      };
    }),
  );

  return trades.reverse();
}

export async function getRecentOrders(
  client: PublicClient,
  contractAddress: Address,
  marketKey: Hex,
  blocksToSearch = 100n,
) {
  const currentBlock = await client.getBlockNumber();
  const fromBlock =
    currentBlock > blocksToSearch ? currentBlock - blocksToSearch : 0n;

  const logs = await client.getLogs({
    address: contractAddress,
    event: parseAbiItem(
      "event OrderPlaced(bytes32 indexed marketKey, uint64 indexed orderId, address indexed maker, uint8 side, uint16 price, uint256 amount)",
    ),
    args: { marketKey },
    fromBlock,
    toBlock: "latest",
  });

  return logs
    .map((log) => ({
      orderId: log.args.orderId!,
      maker: log.args.maker!,
      price: Number(log.args.price!) / 1000,
      amount: log.args.amount!,
      side: Number(log.args.side!),
    }))
    .reverse();
}

export async function placeOrder(
  walletClient: ContractWriteClient,
  contractAddress: Address,
  duelKey: Hex,
  marketKind: number,
  side: number,
  price: number,
  amount: bigint,
  orderFlags: number,
  account: Address,
  value: bigint,
): Promise<Hash> {
  return walletClient.writeContract({
    address: contractAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "placeOrder",
    args: [duelKey, marketKind, side, price, amount, orderFlags],
    account,
    chain: walletClient.chain,
    value,
  });
}

export async function cancelOrder(
  walletClient: ContractWriteClient,
  contractAddress: Address,
  duelKey: Hex,
  marketKind: number,
  orderId: bigint,
  account: Address,
): Promise<Hash> {
  return walletClient.writeContract({
    address: contractAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "cancelOrder",
    args: [duelKey, marketKind, orderId],
    account,
    chain: walletClient.chain,
  });
}

export async function claimWinnings(
  walletClient: ContractWriteClient,
  contractAddress: Address,
  duelKey: Hex,
  marketKind: number,
  account: Address,
): Promise<Hash> {
  return walletClient.writeContract({
    address: contractAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "claim",
    args: [duelKey, marketKind],
    account,
    chain: walletClient.chain,
  });
}

export async function syncMarketFromOracle(
  walletClient: ContractWriteClient,
  contractAddress: Address,
  duelKey: Hex,
  marketKind: number,
  account: Address,
): Promise<Hash> {
  return walletClient.writeContract({
    address: contractAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "syncMarketFromOracle",
    args: [duelKey, marketKind],
    account,
    chain: walletClient.chain,
  });
}

import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  http,
  toHex,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";

import type { EvmChainConfig } from "./chainConfig";
import { LVR_ROUTER_ABI } from "./goldClobAbi";

type BrowserEthereumWindow = Window &
  typeof globalThis & {
    ethereum?: Parameters<typeof custom>[0];
  };

export type MarketStatus =
  | "NULL"
  | "OPEN"
  | "PENDING"
  | "DISPUTED"
  | "RESOLVED"
  | "CANCELLED" | "LOCKED";
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
  marketAddress: Address;
};

export type Position = {
  aShares: bigint;
  bShares: bigint;
  aStake: bigint;
  bStake: bigint;
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
  YES: 1,
  NO: 0,
} as const;

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
  const normalized = duelKeyHex.trim().toLowerCase();
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

export async function getMarketMeta(
  client: PublicClient,
  routerAddress: Address,
  duelKey: Hex,
  marketKind: number,
): Promise<MarketMeta> {
  try {
    const marketKey = await client.readContract({
      address: routerAddress,
      abi: LVR_ROUTER_ABI,
      functionName: "marketKey",
      args: [duelKey, marketKind],
    }) as Hex;
    const market = await client.readContract({
      address: routerAddress,
      abi: LVR_ROUTER_ABI,
      functionName: "getMarket",
      args: [duelKey, marketKind],
    }) as {
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

    if (!market.exists) {
      throw new Error("Market not found");
    }

    return {
      exists: market.exists,
      duelKey: market.duelKey,
      marketKind,
      status: MARKET_STATUS_MAP[Number(market.status)] ?? "NULL",
      winner: SIDE_MAP[Number(market.winner)] ?? "NONE",
      nextOrderId: market.nextOrderId,
      bestBid: Number(market.bestBid),
      bestAsk: Number(market.bestAsk),
      totalAShares: market.totalAShares,
      totalBShares: market.totalBShares,
      marketKey,
      marketAddress: routerAddress,
    };
  } catch (e) {
    return {
      exists: false,
      duelKey,
      marketKind,
      status: "NULL",
      winner: "NONE",
      nextOrderId: 0n,
      bestBid: 500,
      bestAsk: 500,
      totalAShares: 0n,
      totalBShares: 0n,
      marketKey: duelKey,
      marketAddress: "0x0000000000000000000000000000000000000000",
    };
  }
}

export async function getPosition(
  client: PublicClient,
  contractAddress: Address,
  marketKey: Hex,
  userAddress: Address,
): Promise<Position> {
  if (contractAddress === "0x0000000000000000000000000000000000000000") {
    return { aShares: 0n, bShares: 0n, aStake: 0n, bStake: 0n };
  }

  try {
    const [aShares, bShares, aStake, bStake] = await client.readContract({
      address: contractAddress,
      abi: LVR_ROUTER_ABI,
      functionName: "positions",
      args: [marketKey, userAddress],
    }) as readonly [bigint, bigint, bigint, bigint];

    return {
      aShares,
      bShares,
      aStake,
      bStake,
    };
  } catch (err) {
    return { aShares: 0n, bShares: 0n, aStake: 0n, bStake: 0n };
  }
}

export async function getOrderBook(...args: any[]): Promise<{ bids: {price: number, amount: bigint, total: bigint}[], asks: {price: number, amount: bigint, total: bigint}[] }> {
  return { bids: [], asks: [] };
}

export async function getFeeBps(
  client: PublicClient,
  contractAddress: Address,
): Promise<number> {
  const [treasuryFee, marketMakerFee] = await Promise.all([
    client.readContract({
      address: contractAddress,
      abi: LVR_ROUTER_ABI,
      functionName: "tradeTreasuryFeeBps",
    }) as Promise<bigint>,
    client.readContract({
      address: contractAddress,
      abi: LVR_ROUTER_ABI,
      functionName: "tradeMarketMakerFeeBps",
    }) as Promise<bigint>,
  ]);
  return Number(treasuryFee + marketMakerFee);
}

export async function getNativeBalance(
  client: PublicClient,
  userAddress: Address,
): Promise<bigint> {
  return client.getBalance({ address: userAddress });
}

export async function getRecentTrades(...args: any[]): Promise<{id: string, side: "YES"|"NO", amount: bigint, price: number, time: number}[]> {
  return [];
}

export async function placeOrder(
  walletClient: ContractWriteClient,
  routerAddress: Address,
  marketAddress: Address,
  duelKey: Hex,
  marketKind: number,
  side: number,
  price: number,
  amount: bigint,
  account: Address,
  value: bigint,
): Promise<Hash> {
  return walletClient.writeContract({
    address: routerAddress,
    abi: LVR_ROUTER_ABI,
    functionName: "placeOrder",
    args: [duelKey, marketKind, side, price, amount],
    account,
    chain: walletClient.chain,
    value,
  });
}

export async function cancelOrder(): Promise<Hash> {
  throw new Error("Cannot cancel orders on an AMM");
}

export async function claimWinnings(
  walletClient: ContractWriteClient,
  routerAddress: Address,
  marketAddress: Address,
  duelKey: Hex,
  marketKind: number,
  account: Address,
  amountYes: bigint,
  amountNo: bigint,
): Promise<Hash> {
  return walletClient.writeContract({
    address: routerAddress,
    abi: LVR_ROUTER_ABI,
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
    abi: LVR_ROUTER_ABI,
    functionName: "syncMarketFromOracle",
    args: [duelKey, marketKind],
    account,
    chain: walletClient.chain,
  });
}

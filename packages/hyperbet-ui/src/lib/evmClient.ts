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
import { LVR_ROUTER_ABI } from "./lvrRouterAbi";
import { LVR_MARKET_ABI } from "./lvrMarketAbi";

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
  0: "OPEN",
  1: "PENDING",
  2: "DISPUTED",
  3: "RESOLVED",
};

const SIDE_MAP: Record<number, Side> = {
  0: "A",
  1: "B",
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
  const marketKey = duelKey; // For this simplified migration
  try {
    const rawResult = await client.readContract({
      address: routerAddress,
      abi: LVR_ROUTER_ABI,
      functionName: "getMarketMetadata",
      args: [marketKey],
    }) as [Address, bigint, string, string, string];

    const marketAddress = rawResult[0];
    
    // Fallback if not found
    if (!marketAddress || marketAddress === "0x0000000000000000000000000000000000000000") {
      throw new Error("Market not found");
    }

    const details = await client.readContract({
      address: marketAddress,
      abi: LVR_MARKET_ABI,
      functionName: "getMarketDetails",
    }) as [number, bigint, bigint, bigint, bigint, bigint, bigint, bigint];

    const statusObj = MARKET_STATUS_MAP[details[0]] ?? "NULL";
    const winnerObj = SIDE_MAP[Number(details[2])] ?? "NONE";
    const totalAShares = details[4];
    const totalBShares = details[5];
    const priceYes = Number(details[6]) / 1e18;
    const priceNo = Number(details[7]) / 1e18;

    return {
      exists: true,
      duelKey,
      marketKind,
      status: statusObj,
      winner: winnerObj,
      nextOrderId: 0n,
      bestBid: Math.floor(priceYes * 1000),
      bestAsk: Math.ceil((1 - priceNo) * 1000), // AMM implied
      totalAShares,
      totalBShares,
      marketKey,
      marketAddress,
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
      marketKey,
      marketAddress: "0x0000000000000000000000000000000000000000",
    };
  }
}

export async function getPosition(
  client: PublicClient,
  marketAddress: Address,
  userAddress: Address,
): Promise<Position> {
  if (marketAddress === "0x0000000000000000000000000000000000000000") {
    return { aShares: 0n, bShares: 0n, aStake: 0n, bStake: 0n };
  }
  
  try {
    const yesToken = await client.readContract({
      address: marketAddress,
      abi: LVR_MARKET_ABI,
      functionName: "getToken",
      args: [true],
    }) as Address;
    
    const noToken = await client.readContract({
      address: marketAddress,
      abi: LVR_MARKET_ABI,
      functionName: "getToken",
      args: [false],
    }) as Address;

    // Use ERC20 ABI to get balance
    const aShares = await client.readContract({
      address: yesToken,
      abi: [{"inputs":[{"internalType":"address","name":"account","type":"address"}],"name":"balanceOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"}],
      functionName: "balanceOf",
      args: [userAddress],
    }) as bigint;

    const bShares = await client.readContract({
      address: noToken,
      abi: [{"inputs":[{"internalType":"address","name":"account","type":"address"}],"name":"balanceOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"}],
      functionName: "balanceOf",
      args: [userAddress],
    }) as bigint;

    return {
      aShares,
      bShares,
      aStake: aShares,
      bStake: bShares,
    };
  } catch (err) {
    return { aShares: 0n, bShares: 0n, aStake: 0n, bStake: 0n };
  }
}

export async function getOrderBook(...args: any[]): Promise<{ bids: {price: number, amount: bigint, total: bigint}[], asks: {price: number, amount: bigint, total: bigint}[] }> {
  // LvrAmm does not use orderbooks
  return { bids: [], asks: [] };
}

export async function getFeeBps(...args: any[]): Promise<number> {
  return 0; // Handled directly in AMM math now
}

export async function getNativeBalance(
  client: PublicClient,
  userAddress: Address,
): Promise<bigint> {
  return client.getBalance({ address: userAddress });
}

export async function getRecentTrades(...args: any[]): Promise<{id: string, side: "YES"|"NO", amount: bigint, price: number, time: number}[]> {
  // AMM does not have CLOB trades array locally mapped like this unless indexed
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
  value: bigint, // Value is passed if needed, else transfer token
): Promise<Hash> {
  const isBuyYes = side === SIDE_ENUM.BUY || side === SIDE_ENUM.A;
  
  if (value > 0n) {
    throw new Error("LvrAMM does not support native value transfers right now, requires collateral ERC20 approval");
  }

  // Use the specific buy methods on the Router
  return walletClient.writeContract({
    address: routerAddress,
    abi: LVR_ROUTER_ABI,
    functionName: isBuyYes ? "buyYes" : "buyNo",
    args: [marketAddress, amount],
    account,
    chain: walletClient.chain,
    // The caller must approve the ERC20 token first!
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
    functionName: "redeem",
    args: [marketAddress, amountYes, amountNo],
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
    functionName: "settleMarket",
    args: [duelKey],
    account,
    chain: walletClient.chain,
  });
}

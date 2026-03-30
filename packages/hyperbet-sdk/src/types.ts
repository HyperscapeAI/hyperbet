export type OrderSide = "buy" | "sell";
export type TimeInForce = "gtc" | "ioc";

export interface CreateOrderParams {
  duelId: string;
  side: OrderSide;
  price: number;
  amount: bigint;
  timeInForce?: TimeInForce;
  postOnly?: boolean;
}

export interface CancelOrderParams {
  duelId: string;
  orderId: number;
}

export interface ClaimParams {
  duelId: string;
}

export interface SdkConfig {
  evmPrivateKey?: string;
  bscRpcUrl?: string; // Fallback to public node if missing
  avaxRpcUrl?: string; // Fallback to public node if missing
  solanaPrivateKey?: string; // Base58 encoded secret key
  solanaRpcUrl?: string; // Fallback to mainnet-beta if missing
  streamUrl?: string;
}

export const SIDE_BID = 1;
export const SIDE_ASK = 2;
export const MARKET_KIND_DUEL_WINNER = 0;
export const ORDER_FLAG_GTC = 0x01;
export const ORDER_FLAG_IOC = 0x02;
export const ORDER_FLAG_POST_ONLY = 0x04;

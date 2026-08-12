export type SolanaOutcomeSide = "YES" | "NO";
export type SolanaOrderBehavior = "GTC" | "IOC" | "POST_ONLY";

export interface CreateOrderParams {
  duelKeyHex: string;
  side: SolanaOutcomeSide;
  outcomePriceMillis: number;
  amountLamports: bigint;
  behavior?: SolanaOrderBehavior;
}

export interface OrderActionParams {
  duelKeyHex: string;
  orderId: bigint;
}

export type CancelOrderParams = OrderActionParams;
export type ReclaimOrderParams = OrderActionParams;
export type CloseFilledOrderParams = OrderActionParams;

export interface ClaimParams {
  duelKeyHex: string;
}

export type CloseLosingBalanceParams = ClaimParams;

export interface SdkConfig {
  solanaPrivateKey: string;
  solanaRpcUrl: string;
  duelMarketProgramId: string;
  fightOracleProgramId: string;
  streamUrl?: string;
}

export const SIDE_BID = 1;
export const SIDE_ASK = 2;
export const MARKET_KIND_DUEL_WINNER = 1;
export const ORDER_BEHAVIOR_GTC = 0;
export const ORDER_BEHAVIOR_IOC = 1;
export const ORDER_BEHAVIOR_POST_ONLY = 2;
export const MAX_MATCHES_PER_TRANSACTION = 50;

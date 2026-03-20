import { PublicKey } from "@solana/web3.js";

export const DUEL_WINNER_MARKET_KIND = 1;
export const SIDE_BID = 1;
export const SIDE_ASK = 2;
export const ORDER_BEHAVIOR_GTC = 0;
export const ORDER_BEHAVIOR_IOC = 1;
export const ORDER_BEHAVIOR_POST_ONLY = 2;

export function duelKeyHexToBytes(duelKeyHex: string): Uint8Array {
  const normalized = duelKeyHex.trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("duelKeyHex must be a 32-byte hex string");
  }
  return Uint8Array.from(Buffer.from(normalized, "hex"));
}

export function findDuelStatePda(
  fightOracleProgramId: PublicKey,
  duelKey: Uint8Array,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("duel"), Buffer.from(duelKey)],
    fightOracleProgramId,
  )[0];
}

export function findMarketPda(
  marketProgramId: PublicKey,
  duelStatePda: PublicKey,
  marketKind = DUEL_WINNER_MARKET_KIND,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), duelStatePda.toBuffer(), Uint8Array.of(marketKind)],
    marketProgramId,
  )[0];
}

export function findMarketConfigPda(marketProgramId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    marketProgramId,
  )[0];
}

export function findOrderPda(
  marketProgramId: PublicKey,
  marketPda: PublicKey,
  orderId: bigint,
): PublicKey {
  const orderIdBytes = Buffer.alloc(8);
  orderIdBytes.writeBigUInt64LE(orderId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("order"), marketPda.toBuffer(), orderIdBytes],
    marketProgramId,
  )[0];
}

export function findClobVaultPda(
  marketProgramId: PublicKey,
  marketPda: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), marketPda.toBuffer()],
    marketProgramId,
  )[0];
}

export function findUserBalancePda(
  marketProgramId: PublicKey,
  marketPda: PublicKey,
  owner: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("balance"), marketPda.toBuffer(), owner.toBuffer()],
    marketProgramId,
  )[0];
}

export function findPriceLevelPda(
  marketProgramId: PublicKey,
  marketPda: PublicKey,
  side: number,
  price: number,
): PublicKey {
  const priceBytes = Buffer.alloc(2);
  priceBytes.writeUInt16LE(price);
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("level"),
      marketPda.toBuffer(),
      Uint8Array.of(side),
      priceBytes,
    ],
    marketProgramId,
  )[0];
}

// --- AMM (lvr_amm) PDA helpers ---

function betIdToBytes(betId: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(betId);
  return buf;
}

export function findAmmConfigPda(ammProgramId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("amm_config")],
    ammProgramId,
  )[0];
}

export function findAmmAdminStatePda(ammProgramId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("admin_state")],
    ammProgramId,
  )[0];
}

export function findAmmBetPda(
  ammProgramId: PublicKey,
  betId: bigint,
  creator: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bet"), betIdToBytes(betId), creator.toBuffer()],
    ammProgramId,
  )[0];
}

export function findAmmMintYesPda(
  ammProgramId: PublicKey,
  betId: bigint,
  creator: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("mint_yes"), betIdToBytes(betId), creator.toBuffer()],
    ammProgramId,
  )[0];
}

export function findAmmMintNoPda(
  ammProgramId: PublicKey,
  betId: bigint,
  creator: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("mint_no"), betIdToBytes(betId), creator.toBuffer()],
    ammProgramId,
  )[0];
}

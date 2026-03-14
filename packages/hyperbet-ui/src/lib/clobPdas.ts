import { PublicKey } from "@solana/web3.js";
import { findProgramAddressSync } from "./programAddress";

export function findClobConfigPda(programId: PublicKey): PublicKey {
  return findProgramAddressSync([Buffer.from("admin_state")], programId)[0];
}

export function findClobVaultPda(
  programId: PublicKey,
  marketState: PublicKey,
): PublicKey {
  return findProgramAddressSync([Buffer.from("vault"), marketState.toBuffer()], programId)[0];
}

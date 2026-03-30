import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";

import { confirmSignatureViaRpc, sendRawTransactionViaRpc } from "./solanaRpc";

function isMintLookupError(error: unknown): boolean {
  const message = (error as Error)?.message?.toLowerCase?.() ?? "";
  return message.includes("could not find mint");
}

export async function findTokenAccountForMint(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey,
  tokenProgram: PublicKey = TOKEN_2022_PROGRAM_ID,
): Promise<PublicKey | null> {
  let response:
    | Awaited<ReturnType<Connection["getTokenAccountsByOwner"]>>
    | undefined;

  try {
    response = await connection.getTokenAccountsByOwner(owner, {
      mint,
      programId: tokenProgram,
    });
  } catch (error) {
    if (isMintLookupError(error)) return null;
    throw error;
  }

  if (response && response.value.length > 0) {
    return response.value[0]?.pubkey ?? null;
  }

  return null;
}

export async function findAnyGoldAccount(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey,
): Promise<PublicKey | null> {
  const t22 = await findTokenAccountForMint(
    connection,
    owner,
    mint,
    TOKEN_2022_PROGRAM_ID,
  );
  if (t22) return t22;

  const legacy = await findTokenAccountForMint(
    connection,
    owner,
    mint,
    TOKEN_PROGRAM_ID,
  );
  if (legacy) return legacy;

  const t22Ata = getAssociatedTokenAddressSync(
    mint,
    owner,
    false,
    TOKEN_2022_PROGRAM_ID,
  );
  const t22AtaInfo = await connection.getAccountInfo(t22Ata, "confirmed");
  if (t22AtaInfo) return t22Ata;

  const legacyAta = getAssociatedTokenAddressSync(
    mint,
    owner,
    false,
    TOKEN_PROGRAM_ID,
  );
  const legacyAtaInfo = await connection.getAccountInfo(legacyAta, "confirmed");
  if (legacyAtaInfo) return legacyAta;

  return null;
}

export function getToken2022Ata(owner: PublicKey, mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(
    mint,
    owner,
    false,
    TOKEN_2022_PROGRAM_ID,
  );
}

export async function confirmTx(
  connection: Connection,
  signature: string,
): Promise<void> {
  await confirmSignatureViaRpc(connection, signature);
}

export async function sendTx(
  connection: Connection,
  signedTx: Transaction,
): Promise<string> {
  const signature = await sendRawTransactionViaRpc(connection, signedTx);
  await confirmTx(connection, signature);
  return signature;
}

import { Connection, PublicKey } from "@solana/web3.js";
import fs from "fs";
import * as anchor from "@coral-xyz/anchor";

async function main() {
  const connection = new Connection("http://127.0.0.1:18899", "confirmed");
  
  const marketStateStr = "Gy6c5zyzi4x5aN69AcqwzYbebYNYuEZ6rXG2XxcYTcZg";
  console.log("Found Market State string:", marketStateStr);
  
  const marketState = new PublicKey(marketStateStr);
  console.log("Market State Pubkey:", marketState.toBase58());
  
  const programIdStr = "AMMLL4618eBhyk1gQJvPqG8yZ1vM23L4q63f5QEQ1z7M"; // LVR AMM PROGRAM ID
  const programId = new PublicKey(programIdStr);

  const accountInfo = await connection.getAccountInfo(marketState);
  if (!accountInfo) {
    console.log("Market State account NOT FOUND on localnet!");
    return;
  }
  
  // The first 8 bytes are discriminator
  // pub creator: Pubkey, (32 bytes) at offset 8
  // pub bet_id: u64, (8 bytes) at offset 40
  const creatorBytes = accountInfo.data.slice(8, 40);
  const betIdBytes = accountInfo.data.slice(40, 48);
  
  const creator = new PublicKey(creatorBytes);
  console.log("Parsed Creator:", creator.toBase58());
  
  const mintYes = PublicKey.findProgramAddressSync(
    [Buffer.from("mint_yes"), betIdBytes, creator.toBuffer()],
    programId
  )[0];
  const mintNo = PublicKey.findProgramAddressSync(
    [Buffer.from("mint_no"), betIdBytes, creator.toBuffer()],
    programId
  )[0];
  
  console.log("Derived mintYes:", mintYes.toBase58());
  console.log("Derived mintNo:", mintNo.toBase58());
  
  const mintYesInfo = await connection.getAccountInfo(mintYes);
  console.log("mintYes exists?", !!mintYesInfo);
  if (mintYesInfo) {
     console.log("mintYes owner:", mintYesInfo.owner.toBase58());
     console.log("mintYes lamports:", mintYesInfo.lamports);
  }

  const tokenProgramBase58 = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  const associatedTokenProgramBase58 = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
}

main().catch(console.error);

import { Connection, PublicKey } from "@solana/web3.js";
import { BN } from "bn.js";
import crypto from "crypto";

const LVR_PROGRAM = new PublicKey("Af4LMYfaBtcFFM6dBjwLYH6QJLMqEwneQ8VHfn2z7NY5");

function u64Le(value: bigint | number): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value), 0);
  return buffer;
}

function deriveLvrAmmBetId(duelKeyHex: string): bigint {
  const duelKey = Buffer.from(duelKeyHex, "hex");
  return BigInt(`0x${duelKey.slice(0, 8).reverse().toString('hex')}`);
}

async function run() {
    // In Test 2, we know the exact variables that must have produced CrWyw
    // Let's compute them properly:
    console.log("Starting script mapping checks.");
    
    const duelKeyHex = "04937e5b2b9dddf524fff841be1a17160c6d2f66b15c45e2441110a6da6de893";
    const betIdNum = deriveLvrAmmBetId(duelKeyHex);
    const betIdNumBytes = Buffer.alloc(8);
    betIdNumBytes.writeBigUInt64LE(BigInt(betIdNum));

    // setup-localnet.ts creates it using operator.publicKey!
    // Who is the operator? authority!
    // What is authority in localnet? The bootstrap wallet!
    // The bootstrap wallet is generated at .e2e-bootstrap.json
    // I can get the public key from the terminal if needed.
    // Let's just grep the public key!
    // But wait, the authority is actually state.solanaAuthorityPublicKey!
    // I don't have it right here. Let me read state.json!
    // Actually, let me just assume the signer from the e2e-debug-7.txt output!
    // It says "primaryWallet: HJgeD...". No, that's keeper.
    const stateJson = require("./tests/e2e/state.json");
    const mockSigner = new PublicKey("DfEnrzh4cgnHxfuZRxLGX69fnLd9DP41XxGuE4gtyJpn");

    const mintYes = PublicKey.findProgramAddressSync(
      [Buffer.from("mint_yes"), betIdNumBytes, mockSigner.toBuffer()],
      LVR_PROGRAM
    )[0];

    const mintNo = PublicKey.findProgramAddressSync(
      [Buffer.from("mint_no"), betIdNumBytes, mockSigner.toBuffer()],
      LVR_PROGRAM
    )[0];

    console.log("Derived mintYes:", mintYes.toBase58());
    console.log("Derived mintNo:", mintNo.toBase58());
}

run().catch(console.error);

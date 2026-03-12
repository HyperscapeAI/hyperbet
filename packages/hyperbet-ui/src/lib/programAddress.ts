import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { PublicKey } from "@solana/web3.js";

const MAX_SEED_LENGTH = 32;
const PROGRAM_DERIVED_ADDRESS_MARKER = new TextEncoder().encode(
  "ProgramDerivedAddress",
);

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function isOnCurve(bytes: Uint8Array): boolean {
  try {
    ed25519.Point.fromHex(bytesToHex(bytes));
    return true;
  } catch {
    return false;
  }
}

export function findProgramAddressSync(
  seeds: readonly Uint8Array[],
  programId: PublicKey,
): [PublicKey, number] {
  for (let nonce = 255; nonce > 0; nonce -= 1) {
    const validatedSeeds = seeds.map((seed) => {
      if (seed.length > MAX_SEED_LENGTH) {
        throw new TypeError("Max seed length exceeded");
      }
      return seed;
    });
    const derivedBytes = sha256(
      concatBytes([
        ...validatedSeeds,
        Uint8Array.of(nonce),
        programId.toBytes(),
        PROGRAM_DERIVED_ADDRESS_MARKER,
      ]),
    );
    if (isOnCurve(derivedBytes)) {
      continue;
    }
    return [new PublicKey(derivedBytes), nonce];
  }
  throw new Error("Unable to find a viable program address nonce");
}

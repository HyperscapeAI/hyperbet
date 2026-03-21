export function duelKeyHexToBytes(duelKeyHex: string): Uint8Array {
  const normalized = duelKeyHex.trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("duelKeyHex must be a 32-byte hex string");
  }

  return Uint8Array.from(Buffer.from(normalized, "hex"));
}

export function shortDuelKey(duelKeyHex: string | null | undefined): string {
  if (!duelKeyHex) return "unavailable";
  return `${duelKeyHex.slice(0, 8)}...${duelKeyHex.slice(-6)}`;
}

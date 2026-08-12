export function resolveAbsoluteHttpBase(
  configuredBase: string,
  browserOrigin?: string | null,
): string {
  const candidate = configuredBase.trim() || browserOrigin?.trim() || "";
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("An absolute HTTP(S) service URL is required");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error("An absolute HTTP(S) service URL is required");
  }
  return candidate.replace(/\/$/, "");
}

export function buildSolanaRpcProxyUrl(input: {
  configuredBase: string;
  browserOrigin?: string | null;
  cluster: string;
}): string {
  const base = resolveAbsoluteHttpBase(
    input.configuredBase,
    input.browserOrigin,
  );
  return `${base}/api/proxy/solana/rpc?cluster=${encodeURIComponent(input.cluster)}`;
}

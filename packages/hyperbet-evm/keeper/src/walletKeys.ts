const LEGACY_POINTS_WALLET_PREFIXES = ["rank/", "multiplier/"] as const;

export function isLegacyDerivedPointsWalletKey(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return LEGACY_POINTS_WALLET_PREFIXES.some((prefix) =>
    normalized.startsWith(prefix),
  );
}

export function normalizePointsWalletInput(value: string): string {
  let normalized = value.trim();

  while (normalized.length > 0) {
    const lowered = normalized.toLowerCase();
    const matchedPrefix = LEGACY_POINTS_WALLET_PREFIXES.find((prefix) =>
      lowered.startsWith(prefix),
    );
    if (!matchedPrefix) break;
    normalized = normalized.slice(matchedPrefix.length).trim();
  }

  return normalized;
}

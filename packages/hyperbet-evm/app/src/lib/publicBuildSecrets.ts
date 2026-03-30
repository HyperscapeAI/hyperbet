const PUBLIC_SECRET_PATTERNS = [
  /[?&](api[-_]?key|token)=/i,
  /helius-rpc\.com\/\?api-key=/i,
  /alchemy\.com\/v2\//i,
  /infura\.io\/v3\//i,
  /quicknode\.(com|pro)\//i,
  /drpc\.org\//i,
] as const;

const FORBIDDEN_PUBLIC_VARS = [
  "VITE_HEADLESS_WALLET_SECRET_KEY",
  "VITE_HEADLESS_WALLETS",
  "VITE_EVM_PRIVATE_KEY",
  "VITE_HEADLESS_EVM_PRIVATE_KEY",
  "VITE_E2E_EVM_PRIVATE_KEY",
] as const;

export function looksLikePublicSecretUrl(value: string | undefined): boolean {
  if (!value) return false;
  return PUBLIC_SECRET_PATTERNS.some((pattern) => pattern.test(value));
}

export function assertPublicBuildSecrets(
  mode: string,
  env: Record<string, string>,
): void {
  const isPublicBuild =
    mode === "production" || mode === "mainnet" || mode === "mainnet-beta";
  if (!isPublicBuild) return;

  const publicRpcVars = ["VITE_AVAX_RPC_URL"] as const;
  for (const name of publicRpcVars) {
    if (looksLikePublicSecretUrl(env[name]?.trim())) {
      throw new Error(
        `[build] ${name} contains a provider-keyed RPC URL. Keep provider keys on the keeper service and proxy public traffic through the backend.`,
      );
    }
  }

  for (const name of FORBIDDEN_PUBLIC_VARS) {
    if (env[name]?.trim()) {
      throw new Error(
        `[build] ${name} must not be set for public builds. Move secrets to server-side environment variables instead.`,
      );
    }
  }
}

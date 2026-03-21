export function normalizeEvmPrivateKey(
  value: string | undefined | null,
): `0x${string}` | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  const withPrefix = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(withPrefix)) return null;
  return withPrefix as `0x${string}`;
}

export function selectConfiguredEvmPrivateKey(
  env: Record<string, string | boolean | undefined>,
): `0x${string}` | null {
  // C-6: Only read private keys in e2e mode. Vite bakes VITE_* env vars
  // into the JS bundle at build time — a misconfigured CI could ship a
  // private key in a production bundle.
  const mode = (env.MODE as string | undefined) ?? "";
  if (mode !== "e2e" && mode !== "development" && mode !== "test") {
    return null;
  }
  return normalizeEvmPrivateKey(
    (env.VITE_EVM_PRIVATE_KEY as string | undefined) ??
      (env.VITE_HEADLESS_EVM_PRIVATE_KEY as string | undefined) ??
      (env.VITE_E2E_EVM_PRIVATE_KEY as string | undefined) ??
      "",
  );
}

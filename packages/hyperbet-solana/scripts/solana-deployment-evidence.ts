export function describeRpcEndpoint(rpcUrl: string): string {
  try {
    const parsed = new URL(rpcUrl);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "invalid-rpc-url";
  }
}

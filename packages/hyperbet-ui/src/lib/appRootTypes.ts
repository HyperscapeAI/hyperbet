export type HeadlessWalletDescriptor = {
  // Using `unknown` here avoids importing @solana/wallet-adapter-base in this
  // file. SolanaProviders.tsx imports the real Adapter type directly.
  adapter: unknown;
  autoConnect: boolean;
};

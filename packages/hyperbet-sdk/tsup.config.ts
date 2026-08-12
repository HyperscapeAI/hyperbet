import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  bundle: true,
  minify: false,
  external: ["@solana/web3.js", "@coral-xyz/anchor", "bn.js", "bs58"],
});

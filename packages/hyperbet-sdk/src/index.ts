import { HyperbetSolanaClient } from "./solana/client";
import { HyperbetStreamClient } from "./stream/client";
import type { SdkConfig } from "./types";

export * from "./types";
export * from "./solana/client";
export { HyperbetStreamClient } from "./stream/client";

export class HyperbetClient {
  public readonly solana: HyperbetSolanaClient;
  public readonly stream: HyperbetStreamClient | null;

  constructor(config: SdkConfig) {
    this.solana = new HyperbetSolanaClient(
      config.solanaRpcUrl,
      config.solanaPrivateKey,
      config.duelMarketProgramId,
      config.fightOracleProgramId,
    );
    this.stream = config.streamUrl
      ? new HyperbetStreamClient(config.streamUrl)
      : null;
  }
}

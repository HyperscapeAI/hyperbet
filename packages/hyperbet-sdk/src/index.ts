import { HyperbetEVMClient } from "./evm/client";
import { HyperbetSolanaClient } from "./solana/client";
import { HyperbetStreamClient } from "./stream/client";
import { SdkConfig, CreateOrderParams, CancelOrderParams, ClaimParams, OrderSide } from "./types";

export * from "./types";
export { HyperbetEVMClient, HyperbetSolanaClient, HyperbetStreamClient };

export class HyperbetClient {
  public evmBsc?: HyperbetEVMClient;
  public evmAvax?: HyperbetEVMClient;
  public solana?: HyperbetSolanaClient;
  public stream?: HyperbetStreamClient;

  // Constants
  public static readonly DEFAULT_BSC_RPC = "https://bsc-dataseed.binance.org/";
  public static readonly DEFAULT_AVAX_RPC = "https://api.avax.network/ext/bc/C/rpc";
  public static readonly DEFAULT_SOLANA_RPC = "https://api.mainnet-beta.solana.com";
  public static readonly DEFAULT_STREAM_URL = "wss://api.hyperbet.win/ws";

  public static readonly BSC_CLOB_ADDRESS = "0x443C09B1E7bb7bA3392b02500772B185654A6F33";
  public static readonly BSC_ORACLE_ADDRESS = "0x8F582bc1D34Ca6dA12ac46B7c7Fdec02f2465961";
  public static readonly AVAX_CLOB_ADDRESS = "0x123...";
  public static readonly AVAX_ORACLE_ADDRESS = "0x456...";
  public static readonly SOLANA_CLOB_PROGRAM_ID = "DYtd7AoyTX2tbmZ8vpC3mxZgqTpyaDei4TFXZukWBJEf";
  public static readonly SOLANA_ORACLE_PROGRAM_ID = "B5mRCRDJk9BrnH7regMWW5mpTQ8QG1CcCGSnDxMt8hmo";

  constructor(config: SdkConfig) {
    if (config.evmPrivateKey) {
      this.evmBsc = new HyperbetEVMClient(
        config.bscRpcUrl || HyperbetClient.DEFAULT_BSC_RPC,
        config.evmPrivateKey,
        HyperbetClient.BSC_CLOB_ADDRESS,
        HyperbetClient.BSC_ORACLE_ADDRESS
      );
      this.evmAvax = new HyperbetEVMClient(
        config.avaxRpcUrl || HyperbetClient.DEFAULT_AVAX_RPC,
        config.evmPrivateKey,
        HyperbetClient.AVAX_CLOB_ADDRESS,
        HyperbetClient.AVAX_ORACLE_ADDRESS
      );
    }

    if (config.solanaPrivateKey) {
      this.solana = new HyperbetSolanaClient(
        config.solanaRpcUrl || HyperbetClient.DEFAULT_SOLANA_RPC,
        config.solanaPrivateKey,
        HyperbetClient.SOLANA_CLOB_PROGRAM_ID,
        HyperbetClient.SOLANA_ORACLE_PROGRAM_ID
      );
    }

    if (config.streamUrl || HyperbetClient.DEFAULT_STREAM_URL) {
      this.stream = new HyperbetStreamClient(config.streamUrl || HyperbetClient.DEFAULT_STREAM_URL);
    }
  }

  // Helper methods to place cross-chain orders simultaneously if desired
  public async placeOrderAll(params: CreateOrderParams) {
    const promises: Promise<any>[] = [];
    if (this.evmBsc) promises.push(this.evmBsc.placeOrder(params));
    if (this.evmAvax) promises.push(this.evmAvax.placeOrder(params));
    if (this.solana) promises.push(this.solana.placeOrder(params));
    return Promise.allSettled(promises);
  }
}

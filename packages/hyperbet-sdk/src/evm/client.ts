import { ethers, Contract, JsonRpcProvider, Wallet } from "ethers";
import { CreateOrderParams, CancelOrderParams, ClaimParams, OrderSide, SIDE_BID, SIDE_ASK, MARKET_KIND_DUEL_WINNER } from "../types";

import lvrRouterAbi from "./abi/LvrRouter.json";
import oracleAbi from "./abi/DuelOutcomeOracle.json";

export class HyperbetEVMClient {
  public provider: JsonRpcProvider;
  public wallet: Wallet;
  public clob: Contract;
  public oracle: Contract;
  
  constructor(
    rpcUrl: string,
    privateKey: string,
    clobAddress: string,
    oracleAddress: string
  ) {
    this.provider = new JsonRpcProvider(rpcUrl);
    this.wallet = new Wallet(privateKey, this.provider);
    this.clob = new Contract(clobAddress, lvrRouterAbi.abi, this.wallet);
    this.oracle = new Contract(oracleAddress, oracleAbi.abi, this.wallet);
  }

  // Helper to convert frontend "buy"/"sell" and number prices into EVM parameters
  public async placeOrder({ duelId, side, price, amount }: CreateOrderParams) {
    const duelKey = ethers.keccak256(ethers.toUtf8Bytes(duelId));
    const sideInt = side === "buy" ? SIDE_BID : SIDE_ASK;

    // To place an order on EVM, one must send the native token covering:
    // Value = (amount * priceComponent) / 1000 + treasuryFee + mmFee
    // Since amount is large (e.g., in wei), keeping the JS side simple, we can fetch fee BPS from the contract.
    const treasuryFeeBps = await this.clob.tradeTreasuryFeeBps();
    const mmFeeBps = await this.clob.tradeMarketMakerFeeBps();
    
    const priceComponent = BigInt(side === "buy" ? price : 1000 - price);
    const nominalCost = (amount * priceComponent) / 1000n;
    
    const treasuryFee = (nominalCost * treasuryFeeBps) / 10000n;
    const mmFee = (nominalCost * mmFeeBps) / 10000n;
    const totalValue = nominalCost + treasuryFee + mmFee;

    const tx = await this.clob.placeOrder(
      duelKey,
      MARKET_KIND_DUEL_WINNER,
      sideInt,
      price,
      amount,
      { value: totalValue + 1000n } // Add slight buffer for any rounding
    );
    return tx.wait();
  }

  public async cancelOrder({ duelId, orderId }: CancelOrderParams) {
    const duelKey = ethers.keccak256(ethers.toUtf8Bytes(duelId));
    const tx = await this.clob.cancelOrder(duelKey, MARKET_KIND_DUEL_WINNER, orderId);
    return tx.wait();
  }

  public async claim({ duelId }: ClaimParams) {
    const duelKey = ethers.keccak256(ethers.toUtf8Bytes(duelId));
    const tx = await this.clob.claim(duelKey, MARKET_KIND_DUEL_WINNER);
    return tx.wait();
  }
}

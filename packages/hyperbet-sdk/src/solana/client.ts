import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import bs58 from "bs58";
import { CreateOrderParams, CancelOrderParams, ClaimParams, OrderSide, SIDE_BID, SIDE_ASK, MARKET_KIND_DUEL_WINNER } from "../types";
import BN from "bn.js";

import lvrMarketIdl from "./idl/lvr_amm.json" assert { type: "json" };
import fightOracleIdl from "./idl/fight_oracle.json" assert { type: "json" };

export function duelKeyHexToBytes(duelKeyHex: string): Uint8Array {
  const normalized = duelKeyHex.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("duelKeyHex must be a 32-byte hex string");
  }
  return Uint8Array.from(Buffer.from(normalized, "hex"));
}

export class HyperbetSolanaClient {
  public connection: Connection;
  public wallet: Keypair;
  public provider: AnchorProvider;
  public clob: Program;
  public oracle: Program;
  
  public clobProgramId: PublicKey;
  public fightOracleId: PublicKey;

  constructor(
    rpcUrl: string,
    privateKeyBase58: string,
    clobProgramIdStr: string,
    oracleProgramIdStr: string
  ) {
    this.connection = new Connection(rpcUrl, "confirmed");
    this.wallet = Keypair.fromSecretKey(bs58.decode(privateKeyBase58));
    this.clobProgramId = new PublicKey(clobProgramIdStr);
    this.fightOracleId = new PublicKey(oracleProgramIdStr);
    const anchorWallet = new Wallet(this.wallet);

    this.provider = new AnchorProvider(this.connection, anchorWallet, {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    });

    this.clob = new Program(lvrMarketIdl as any, this.provider);
    this.oracle = new Program(fightOracleIdl as any, this.provider);
  }

  // PDAs
  public getDuelStatePda(duelKey: Uint8Array): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("duel"), Buffer.from(duelKey)],
      this.fightOracleId
    )[0];
  }

  public getMarketPda(duelStatePda: PublicKey, marketKind = MARKET_KIND_DUEL_WINNER): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("market"), duelStatePda.toBuffer(), Uint8Array.of(marketKind)],
      this.clobProgramId
    )[0];
  }

  public getMarketConfigPda(): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      this.clobProgramId
    )[0];
  }

  public getClobVaultPda(marketPda: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), marketPda.toBuffer()],
      this.clobProgramId
    )[0];
  }

  public getUserBalancePda(marketPda: PublicKey, owner: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("balance"), marketPda.toBuffer(), owner.toBuffer()],
      this.clobProgramId
    )[0];
  }

  // Operations
  public async placeOrder({ duelId, side, price, amount }: CreateOrderParams) {
    const duelKey = duelKeyHexToBytes(duelId);
    const duelStatePda = this.getDuelStatePda(duelKey);
    const marketStatePda = this.getMarketPda(duelStatePda);
    const vaultPda = this.getClobVaultPda(marketStatePda);
    const configPda = this.getMarketConfigPda();

    const config = await (this.clob as any).account.marketConfig.fetch(configPda);

    const tx = await (this.clob as any).methods.placeOrder(
      side === "buy" ? SIDE_BID : SIDE_ASK,
      price,
      new BN(amount.toString())
    ).accountsPartial({
      marketState: marketStatePda,
      duelState: duelStatePda,
      config: configPda,
      treasury: config.treasury,
      marketMaker: config.marketMaker,
      vault: vaultPda,
      user: this.wallet.publicKey,
      systemProgram: SystemProgram.programId,
    }).remainingAccounts([]).rpc();

    return tx;
  }

  public async cancelOrder({ duelId, orderId }: CancelOrderParams) {
    const duelKey = duelKeyHexToBytes(duelId);
    const duelStatePda = this.getDuelStatePda(duelKey);
    const marketStatePda = this.getMarketPda(duelStatePda);

    const tx = await (this.clob as any).methods.cancelOrder(
      new BN(orderId)
    ).accountsPartial({
      marketState: marketStatePda,
      duelState: duelStatePda,
      user: this.wallet.publicKey,
    }).remainingAccounts([]).rpc();

    return tx;
  }

  public async claim({ duelId }: ClaimParams) {
    const duelKey = duelKeyHexToBytes(duelId);
    const duelStatePda = this.getDuelStatePda(duelKey);
    const marketStatePda = this.getMarketPda(duelStatePda);
    const vaultPda = this.getClobVaultPda(marketStatePda);
    const configPda = this.getMarketConfigPda();

    const config = await (this.clob as any).account.marketConfig.fetch(configPda);

    const tx = await (this.clob as any).methods.claimWinnings().accountsPartial({
      marketState: marketStatePda,
      duelState: duelStatePda,
      config: configPda,
      marketMaker: config.marketMaker,
      vault: vaultPda,
      user: this.wallet.publicKey,
      systemProgram: SystemProgram.programId,
    }).remainingAccounts([]).rpc();

    return tx;
  }
}

import crypto from "node:crypto";
import { readFileSync } from "node:fs";

import * as anchor from "@coral-xyz/anchor";
import type { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import {
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    SystemProgram,
} from "@solana/web3.js";

import type { SolanaValidatorHandle } from "./validator.js";

const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey(
    "BPFLoaderUpgradeab1e11111111111111111111111",
);
const DUEL_WINNER_MARKET_KIND = 1;
export const SIDE_BID = 1;
export const SIDE_ASK = 2;
export const ORDER_BEHAVIOR_GTC = 0;
export const ORDER_BEHAVIOR_IOC = 1;
export const ORDER_BEHAVIOR_POST_ONLY = 2;

export type SolanaRuntimeActor = {
    keypair: Keypair;
    name: string;
    role: string;
    description: string;
    color: string;
    tradeCount: number;
    activeOrders: number;
};

export type SolanaOpenMarket = {
    config: PublicKey;
    duelKey: number[];
    duelState: PublicKey;
    marketState: PublicKey;
    vault: PublicKey;
    treasury: PublicKey;
    marketMaker: PublicKey;
};

function toBn(value: bigint | number): BN {
    return new BN(BigInt(value).toString());
}

function hashLabel(label: string): number[] {
    return Array.from(crypto.createHash("sha256").update(label).digest());
}

function duelStatusBettingOpen(): { bettingOpen: Record<string, never> } {
    return { bettingOpen: {} };
}

function duelStatusLocked(): { locked: Record<string, never> } {
    return { locked: {} };
}

function marketSideA(): { a: Record<string, never> } {
    return { a: {} };
}

function marketSideB(): { b: Record<string, never> } {
    return { b: {} };
}

export function buildSeededDuelKey(label: string, seed: string): number[] {
    return hashLabel(`${label}:${seed}`);
}

export function hasProgramError(error: unknown, fragment: string): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes(fragment);
}

async function confirmSignatureByPolling(
    connection: anchor.web3.Connection,
    signature: string,
    timeoutMs = 120_000,
): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        const statuses = await connection.getSignatureStatuses([signature], {
            searchTransactionHistory: true,
        });
        const status = statuses.value[0];
        if (status?.err) {
            throw new Error(
                `Transaction ${signature} failed: ${JSON.stringify(status.err)}`,
            );
        }
        if (
            status &&
            (status.confirmationStatus === "confirmed" ||
                status.confirmationStatus === "finalized")
        ) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 400));
    }

    throw new Error(`Timed out waiting for transaction ${signature}`);
}

async function airdrop(
    connection: anchor.web3.Connection,
    recipient: PublicKey,
    sol = 5,
): Promise<void> {
    const signature = await connection.requestAirdrop(
        recipient,
        sol * LAMPORTS_PER_SOL,
    );
    await confirmSignatureByPolling(connection, signature);
}

function deriveProgramDataAddress(programId: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
        [programId.toBuffer()],
        BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    )[0];
}

function deriveOracleConfigPda(programId: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
        [Buffer.from("oracle_config")],
        programId,
    )[0];
}

function deriveDuelStatePda(
    programId: PublicKey,
    duelKey: readonly number[],
): PublicKey {
    return PublicKey.findProgramAddressSync(
        [Buffer.from("duel"), Buffer.from(duelKey)],
        programId,
    )[0];
}

function deriveMarketConfigPda(programId: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
        [Buffer.from("config")],
        programId,
    )[0];
}

function deriveMarketStatePda(
    programId: PublicKey,
    duelState: PublicKey,
    marketKind = DUEL_WINNER_MARKET_KIND,
): PublicKey {
    return PublicKey.findProgramAddressSync(
        [Buffer.from("market"), duelState.toBuffer(), Buffer.from([marketKind])],
        programId,
    )[0];
}

function deriveClobVaultPda(
    programId: PublicKey,
    marketState: PublicKey,
): PublicKey {
    return PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), marketState.toBuffer()],
        programId,
    )[0];
}

export function deriveUserBalancePda(
    programId: PublicKey,
    marketState: PublicKey,
    user: PublicKey,
): PublicKey {
    return PublicKey.findProgramAddressSync(
        [Buffer.from("balance"), marketState.toBuffer(), user.toBuffer()],
        programId,
    )[0];
}

function deriveOrderPda(
    programId: PublicKey,
    marketState: PublicKey,
    orderId: bigint | number,
): PublicKey {
    const buffer = Buffer.alloc(8);
    buffer.writeBigUInt64LE(BigInt(orderId), 0);
    return PublicKey.findProgramAddressSync(
        [Buffer.from("order"), marketState.toBuffer(), buffer],
        programId,
    )[0];
}

function derivePriceLevelPda(
    programId: PublicKey,
    marketState: PublicKey,
    side: number,
    price: number,
): PublicKey {
    const priceBuffer = Buffer.alloc(2);
    priceBuffer.writeUInt16LE(price, 0);
    return PublicKey.findProgramAddressSync(
        [
            Buffer.from("level"),
            marketState.toBuffer(),
            Buffer.from([side]),
            priceBuffer,
        ],
        programId,
    )[0];
}

export function marketStatusCode(status: Record<string, unknown>): number {
    if ("open" in status) return 1;
    if ("locked" in status) return 2;
    if ("resolved" in status) return 3;
    if ("cancelled" in status) return 4;
    return 0;
}

export function marketStatusLabel(status: Record<string, unknown>) {
    switch (marketStatusCode(status)) {
        case 1:
            return "OPEN" as const;
        case 2:
            return "LOCKED" as const;
        case 3:
            return "RESOLVED" as const;
        case 4:
            return "CANCELLED" as const;
        default:
            return "NULL" as const;
    }
}

export function marketWinnerCode(winner: Record<string, unknown>): number {
    if ("a" in winner) return 1;
    if ("b" in winner) return 2;
    return 0;
}

export class SolanaProgramRuntime {
    readonly connection: anchor.web3.Connection;
    readonly provider: anchor.AnchorProvider;
    readonly authority: Keypair;
    readonly fightProgram: Program<any>;
    readonly clobProgram: Program<any>;
    readonly rpcUrl: string;
    readonly wsUrl: string;

    private constructor(
        validator: SolanaValidatorHandle,
        provider: anchor.AnchorProvider,
        authority: Keypair,
        fightProgram: Program<any>,
        clobProgram: Program<any>,
    ) {
        this.connection = provider.connection;
        this.provider = provider;
        this.authority = authority;
        this.fightProgram = fightProgram;
        this.clobProgram = clobProgram;
        this.rpcUrl = validator.rpcUrl;
        this.wsUrl = validator.wsUrl;
    }

    static async create(
        validator: SolanaValidatorHandle,
    ): Promise<SolanaProgramRuntime> {
        const authoritySecret = JSON.parse(
            readFileSync(validator.assets.walletPath, "utf8"),
        ) as number[];
        const authority = Keypair.fromSecretKey(Uint8Array.from(authoritySecret));
        const connection = new anchor.web3.Connection(validator.rpcUrl, {
            commitment: "confirmed",
            wsEndpoint: validator.wsUrl,
        });
        const wallet = new anchor.Wallet(authority);
        const provider = new anchor.AnchorProvider(connection, wallet, {
            commitment: "confirmed",
        });
        anchor.setProvider(provider);

        const fightIdl = JSON.parse(
            readFileSync(validator.assets.fightOracle.idlPath, "utf8"),
        ) as anchor.Idl;
        const clobIdl = JSON.parse(
            readFileSync(validator.assets.goldClobMarket.idlPath, "utf8"),
        ) as anchor.Idl;

        const fightProgram = new anchor.Program(
            fightIdl,
            provider,
        ) as Program<any>;
        const clobProgram = new anchor.Program(
            clobIdl,
            provider,
        ) as Program<any>;

        return new SolanaProgramRuntime(
            validator,
            provider,
            authority,
            fightProgram,
            clobProgram,
        );
    }

    createActors(): Record<"marketMaker" | "taker" | "attacker", SolanaRuntimeActor> {
        return {
            marketMaker: {
                keypair: Keypair.generate(),
                name: "Solana Market Maker",
                role: "market_maker",
                description: "Seeds and carries the real CLOB quote flow",
                color: "#66bb6a",
                tradeCount: 0,
                activeOrders: 0,
            },
            taker: {
                keypair: Keypair.generate(),
                name: "Solana Taker",
                role: "taker",
                description: "Takes the resting quote in the validator-backed market",
                color: "#4fc3f7",
                tradeCount: 0,
                activeOrders: 0,
            },
            attacker: {
                keypair: Keypair.generate(),
                name: "Unauthorized Reporter",
                role: "attacker",
                description: "Attempts an unauthorized oracle write before settlement",
                color: "#ef5350",
                tradeCount: 0,
                activeOrders: 0,
            },
        };
    }

    async fundActors(
        actors: Iterable<SolanaRuntimeActor>,
        sol = 8,
    ): Promise<void> {
        await Promise.all(
            Array.from(actors, (actor) =>
                airdrop(this.connection, actor.keypair.publicKey, sol),
            ),
        );
    }

    async getBalanceLamports(wallet: PublicKey): Promise<bigint> {
        return BigInt(await this.connection.getBalance(wallet, "confirmed"));
    }

    async ensureOracleReady(reporter = this.authority.publicKey): Promise<PublicKey> {
        const oracleConfig = deriveOracleConfigPda(this.fightProgram.programId);
        const existingConfig = await (this.fightProgram.account as any).oracleConfig.fetchNullable(
            oracleConfig,
        );
        const finalizer = this.authority.publicKey;
        const challenger = this.authority.publicKey;

        if (!existingConfig) {
            await this.fightProgram.methods
                .initializeOracle(reporter, reporter, reporter, new BN(60))
                .accountsPartial({
                    authority: this.authority.publicKey,
                    oracleConfig,
                    program: this.fightProgram.programId,
                    programData: deriveProgramDataAddress(this.fightProgram.programId),
                    systemProgram: SystemProgram.programId,
                })
                .signers([this.authority])
                .rpc();
        }

        await this.fightProgram.methods
            .updateOracleConfig(
                this.authority.publicKey,
                reporter,
                finalizer,
                challenger,
                toBn(60),
            )
            .accountsPartial({
                authority: this.authority.publicKey,
                oracleConfig,
            })
            .signers([this.authority])
            .rpc();

        return oracleConfig;
    }

    async ensureClobConfig(options: {
        treasury: PublicKey;
        marketMaker: PublicKey;
    }): Promise<PublicKey> {
        const config = deriveMarketConfigPda(this.clobProgram.programId);
        const existingConfig = await (this.clobProgram.account as any).marketConfig.fetchNullable(
            config,
        );

        if (!existingConfig) {
            await this.clobProgram.methods
                .initializeConfig(
                    this.authority.publicKey,
                    options.treasury,
                    options.marketMaker,
                    100,
                    100,
                    200,
                )
                .accountsPartial({
                    authority: this.authority.publicKey,
                    config,
                    program: this.clobProgram.programId,
                    programData: deriveProgramDataAddress(this.clobProgram.programId),
                    systemProgram: SystemProgram.programId,
                })
                .signers([this.authority])
                .rpc();
            return config;
        }

        await this.clobProgram.methods
            .updateConfig(
                this.authority.publicKey,
                this.authority.publicKey,
                options.treasury,
                options.marketMaker,
                100,
                100,
                200,
            )
            .accountsPartial({
                authority: this.authority.publicKey,
                config,
            })
            .signers([this.authority])
            .rpc();

        return config;
    }

    async upsertDuelOpen(
        duelKey: readonly number[],
        metadataUri: string,
    ): Promise<PublicKey> {
        const now = Math.floor(Date.now() / 1000);
        const oracleConfig = deriveOracleConfigPda(this.fightProgram.programId);
        const duelState = deriveDuelStatePda(this.fightProgram.programId, duelKey);

        await this.fightProgram.methods
            .upsertDuel(
                [...duelKey],
                [...hashLabel(`${Buffer.from(duelKey).toString("hex")}:a`)],
                [...hashLabel(`${Buffer.from(duelKey).toString("hex")}:b`)],
                toBn(now - 30),
                toBn(now + 10),
                toBn(now + 70),
                metadataUri,
                duelStatusBettingOpen(),
            )
            .accountsPartial({
                reporter: this.authority.publicKey,
                oracleConfig,
                duelState,
                systemProgram: SystemProgram.programId,
            })
            .signers([this.authority])
            .rpc();

        return duelState;
    }

    async setDuelStatus(
        duelKey: readonly number[],
        status: "bettingOpen" | "locked",
        metadataUri: string,
    ): Promise<PublicKey> {
        const oracleConfig = deriveOracleConfigPda(this.fightProgram.programId);
        const duelState = deriveDuelStatePda(this.fightProgram.programId, duelKey);
        const existingDuel = await this.fetchDuelState(duelState);

        await this.fightProgram.methods
            .upsertDuel(
                [...duelKey],
                [...existingDuel.participantAHash],
                [...existingDuel.participantBHash],
                existingDuel.betOpenTs,
                existingDuel.betCloseTs,
                existingDuel.duelStartTs,
                metadataUri,
                status === "locked" ? duelStatusLocked() : duelStatusBettingOpen(),
            )
            .accountsPartial({
                reporter: this.authority.publicKey,
                oracleConfig,
                duelState,
                systemProgram: SystemProgram.programId,
            })
            .signers([this.authority])
            .rpc();

        return duelState;
    }

    async waitForBettingWindowClose(duelState: PublicKey): Promise<void> {
        const duel = await this.fetchDuelState(duelState);
        const betCloseTs = Number(duel.betCloseTs);
        const nowSec = Math.floor(Date.now() / 1000);
        if (nowSec >= betCloseTs) {
            return;
        }

        const waitMs = (betCloseTs - nowSec + 2) * 1000;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    async lockDuel(
        market: SolanaOpenMarket,
        metadataUri = "https://hyperbet.local/lock",
    ): Promise<string> {
        await this.waitForBettingWindowClose(market.duelState);
        await this.setDuelStatus(market.duelKey, "locked", metadataUri);
        return this.syncMarketFromDuel(market);
    }

    async cancelDuel(
        market: SolanaOpenMarket,
        metadataUri = "https://hyperbet.local/cancel",
    ): Promise<string> {
        const oracleConfig = deriveOracleConfigPda(this.fightProgram.programId);
        return this.fightProgram.methods
            .cancelDuel([...market.duelKey], metadataUri)
            .accountsPartial({
                authority: this.authority.publicKey,
                oracleConfig,
                duelState: market.duelState,
            })
            .signers([this.authority])
            .rpc();
    }

    async initializeCanonicalMarket(
        duelKey: readonly number[],
        duelState: PublicKey,
        config: PublicKey,
    ): Promise<{ marketState: PublicKey; vault: PublicKey }> {
        const marketState = deriveMarketStatePda(
            this.clobProgram.programId,
            duelState,
        );
        const vault = deriveClobVaultPda(this.clobProgram.programId, marketState);

        await this.clobProgram.methods
            .initializeMarket([...duelKey], DUEL_WINNER_MARKET_KIND)
            .accountsPartial({
                operator: this.authority.publicKey,
                config,
                duelState,
                marketState,
                vault,
                systemProgram: SystemProgram.programId,
            })
            .signers([this.authority])
            .rpc();

        return { marketState, vault };
    }

    async ensureVaultRentExempt(vault: PublicKey): Promise<void> {
        const minimumBalance =
            await this.connection.getMinimumBalanceForRentExemption(0);
        const currentBalance = await this.connection.getBalance(vault);
        if (currentBalance >= minimumBalance) {
            return;
        }

        await this.provider.sendAndConfirm(
            new anchor.web3.Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: this.authority.publicKey,
                    toPubkey: vault,
                    lamports: minimumBalance - currentBalance,
                }),
            ),
            [this.authority],
        );
    }

    async createOpenMarket(
        duelKey: readonly number[],
        marketMaker: PublicKey,
        metadataUri: string,
    ): Promise<SolanaOpenMarket> {
        await this.ensureOracleReady(this.authority.publicKey);
        const config = await this.ensureClobConfig({
            treasury: this.authority.publicKey,
            marketMaker,
        });
        const duelState = await this.upsertDuelOpen(duelKey, metadataUri);
        const { marketState, vault } = await this.initializeCanonicalMarket(
            duelKey,
            duelState,
            config,
        );
        await this.ensureVaultRentExempt(vault);

        return {
            config,
            duelKey: [...duelKey],
            duelState,
            marketState,
            vault,
            treasury: this.authority.publicKey,
            marketMaker,
        };
    }

    async placeOrder(args: {
        market: SolanaOpenMarket;
        user: SolanaRuntimeActor;
        orderId: bigint | number;
        side: number;
        price: number;
        amount: bigint | number;
        orderBehavior?: number;
        remainingAccounts?: anchor.web3.AccountMeta[];
    }): Promise<{
        signature: string;
        userBalance: PublicKey;
        order: PublicKey;
        restingLevel: PublicKey;
    }> {
        const userBalance = deriveUserBalancePda(
            this.clobProgram.programId,
            args.market.marketState,
            args.user.keypair.publicKey,
        );
        const order = deriveOrderPda(
            this.clobProgram.programId,
            args.market.marketState,
            args.orderId,
        );
        const restingLevel = derivePriceLevelPda(
            this.clobProgram.programId,
            args.market.marketState,
            args.side,
            args.price,
        );

        let builder = this.clobProgram.methods
            .placeOrder(
                toBn(args.orderId),
                args.side,
                args.price,
                toBn(args.amount),
                args.orderBehavior ?? ORDER_BEHAVIOR_GTC,
            )
            .accountsPartial({
                marketState: args.market.marketState,
                duelState: args.market.duelState,
                userBalance,
                newOrder: order,
                restingLevel,
                config: args.market.config,
                treasury: args.market.treasury,
                marketMaker: args.market.marketMaker,
                vault: args.market.vault,
                user: args.user.keypair.publicKey,
                systemProgram: SystemProgram.programId,
            });

        if (args.remainingAccounts?.length) {
            builder = builder.remainingAccounts(args.remainingAccounts);
        }

        const signature = await builder.signers([args.user.keypair]).rpc();
        args.user.tradeCount += 1;
        args.user.activeOrders += 1;
        return { signature, userBalance, order, restingLevel };
    }

    async cancelOrder(args: {
        market: SolanaOpenMarket;
        user: SolanaRuntimeActor;
        orderId: bigint | number;
        side: number;
        price: number;
        remainingAccounts?: anchor.web3.AccountMeta[];
    }): Promise<string> {
        const order = deriveOrderPda(
            this.clobProgram.programId,
            args.market.marketState,
            args.orderId,
        );
        const priceLevel = derivePriceLevelPda(
            this.clobProgram.programId,
            args.market.marketState,
            args.side,
            args.price,
        );

        let builder = this.clobProgram.methods
            .cancelOrder(toBn(args.orderId), args.side, args.price)
            .accountsPartial({
                marketState: args.market.marketState,
                duelState: args.market.duelState,
                order,
                priceLevel,
                vault: args.market.vault,
                user: args.user.keypair.publicKey,
                systemProgram: SystemProgram.programId,
            });

        if (args.remainingAccounts?.length) {
            builder = builder.remainingAccounts(args.remainingAccounts);
        }

        const signature = await builder.signers([args.user.keypair]).rpc();
        args.user.tradeCount += 1;
        args.user.activeOrders = Math.max(0, args.user.activeOrders - 1);
        return signature;
    }

    async reportResult(args: {
        reporter: Keypair;
        duelKey: readonly number[];
        winner: "A" | "B";
        seed: string;
        metadataUri: string;
        duelEndTs?: number;
    }): Promise<string> {
        const oracleConfig = deriveOracleConfigPda(this.fightProgram.programId);
        const duelState = deriveDuelStatePda(this.fightProgram.programId, args.duelKey);

        // The oracle lifecycle now rejects pre-close lock/propose transitions.
        await this.waitForBettingWindowClose(duelState);

        const now = Math.floor(Date.now() / 1000);

        const proposalSignature = await this.fightProgram.methods
            .proposeResult(
                [...args.duelKey],
                args.winner === "B" ? marketSideB() : marketSideA(),
                toBn(BigInt(`0x${Buffer.from(hashLabel(args.seed)).toString("hex")}`) % 10_000n),
                [...hashLabel(`${args.seed}:replay`)],
                [...hashLabel(`${args.seed}:result`)],
                toBn(args.duelEndTs ?? (now + 7_200)),
                args.metadataUri,
            )
            .accountsPartial({
                reporter: args.reporter.publicKey,
                oracleConfig,
                duelState,
            })
            .signers([args.reporter])
            .rpc();

        await confirmSignatureByPolling(this.connection, proposalSignature);

        // Wait for dispute window to elapse before finalizing
        const config = await (this.fightProgram.account as any).oracleConfig.fetch(oracleConfig);
        const disputeWindowSecs = Number(config.disputeWindowSecs);
        const waitFinalize = (disputeWindowSecs + 2) * 1000;
        await new Promise((resolve) => setTimeout(resolve, waitFinalize));

        const finalizeSignature = await this.fightProgram.methods
            .finalizeResult([...args.duelKey], args.metadataUri)
            .accountsPartial({
                finalizer: args.reporter.publicKey,
                oracleConfig,
                duelState,
            })
            .signers([args.reporter])
            .rpc();

        await confirmSignatureByPolling(this.connection, finalizeSignature);
        return finalizeSignature;
    }

    async syncMarketFromDuel(market: SolanaOpenMarket): Promise<string> {
        return this.clobProgram.methods
            .syncMarketFromDuel()
            .accountsPartial({
                marketState: market.marketState,
                duelState: market.duelState,
            })
            .rpc();
    }

    async claim(
        market: SolanaOpenMarket,
        user: SolanaRuntimeActor,
    ): Promise<{ signature: string; userBalance: PublicKey }> {
        const userBalance = deriveUserBalancePda(
            this.clobProgram.programId,
            market.marketState,
            user.keypair.publicKey,
        );

        const signature = await this.clobProgram.methods
            .claim()
            .accountsPartial({
                marketState: market.marketState,
                duelState: market.duelState,
                userBalance,
                config: market.config,
                marketMaker: market.marketMaker,
                vault: market.vault,
                user: user.keypair.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([user.keypair])
            .rpc();

        user.tradeCount += 1;
        return { signature, userBalance };
    }

    async fetchMarketState(marketState: PublicKey): Promise<any> {
        return (this.clobProgram.account as any).marketState.fetch(marketState);
    }

    async fetchDuelState(duelState: PublicKey): Promise<any> {
        return (this.fightProgram.account as any).duelState.fetch(duelState);
    }

    async fetchConfig(config: PublicKey): Promise<any> {
        return (this.clobProgram.account as any).marketConfig.fetch(config);
    }

    async fetchUserBalance(userBalance: PublicKey): Promise<any> {
        return (this.clobProgram.account as any).userBalance.fetch(userBalance);
    }

    async fetchUserBalanceNullable(userBalance: PublicKey): Promise<any | null> {
        return (this.clobProgram.account as any).userBalance.fetchNullable(
            userBalance,
        );
    }

    async fetchUserBalanceFor(
        marketState: PublicKey,
        user: PublicKey,
    ): Promise<any> {
        return this.fetchUserBalance(
            deriveUserBalancePda(this.clobProgram.programId, marketState, user),
        );
    }

    async fetchPriceLevelNullable(priceLevel: PublicKey): Promise<any | null> {
        return (this.clobProgram.account as any).priceLevel.fetchNullable(
            priceLevel,
        );
    }
}

export function writableAccount(pubkey: PublicKey): anchor.web3.AccountMeta {
    return {
        pubkey,
        isSigner: false,
        isWritable: true,
    };
}

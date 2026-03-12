import type { Contract, JsonRpcSigner, JsonRpcProvider } from "ethers";
import {
    DEFAULT_MARKET_MAKER_CONFIG,
    buildQuotePlan,
    type MarketSnapshot,
    type QuotePlan,
} from "@hyperbet/mm-core";
import type { ScenarioRuntimeProfile } from "./scenario-catalog.js";
import {
    BUY_SIDE,
    SELL_SIDE,
    MARKET_KIND_DUEL_WINNER,
    quoteCost,
    quoteWithFees,
    random,
    randomInt,
    clamp,
    MAX_PRICE,
    SIDE_A,
    sleep,
    withTimeout,
} from "./helpers.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type AgentAction = {
    type: "placeOrder" | "cancelOrder" | "claim" | "noop";
    side?: number;
    price?: number;
    amount?: bigint;
    orderId?: number;
    label?: string;
};

export type SimContext = {
    duelKey: string;
    marketKey: string;
    bestBid: number;
    bestAsk: number;
    mid: number;
    totalAShares: bigint;
    totalBShares: bigint;
    tick: number;
    nowMs: number;
    treasuryFeeBps: bigint;
    mmFeeBps: bigint;
    agentActiveOrderIds: number[];
    scenarioProfile: ScenarioRuntimeProfile | null;
    agentPosition: { aShares: bigint; bShares: bigint; aStake: bigint; bStake: bigint };
};

export type AgentConfig = {
    name: string;
    strategy: string;
    description: string;
    enabled: boolean;
    color: string;
};

// ─── Base Agent ──────────────────────────────────────────────────────────────

export abstract class BaseAgent {
    config: AgentConfig;
    signer: JsonRpcSigner;
    clob: Contract;
    activeOrderIds: number[] = [];
    tradeCount = 0;

    constructor(config: AgentConfig, signer: JsonRpcSigner, clob: Contract) {
        this.config = config;
        this.signer = signer;
        this.clob = clob;
    }

    abstract decide(ctx: SimContext): AgentAction[];

    async executeActions(
        actions: AgentAction[],
        ctx: SimContext,
    ): Promise<string[]> {
        const logs: string[] = [];
        for (const action of actions) {
            try {
                if (action.type === "placeOrder" && action.side && action.price && action.amount) {
                    const valueNeeded = quoteWithFees(
                        action.side,
                        action.price,
                        action.amount,
                        ctx.treasuryFeeBps,
                        ctx.mmFeeBps,
                    ) + 50n; // small buffer

                    const tx: any = await withTimeout(
                        (this.clob.connect(this.signer) as any).placeOrder(
                            ctx.duelKey,
                            MARKET_KIND_DUEL_WINNER,
                            action.side,
                            action.price,
                            action.amount,
                            { value: valueNeeded },
                        ),
                        10_000,
                        `${this.config.name} placeOrder`,
                    );
                    const receipt: any = await withTimeout(
                        tx.wait(),
                        10_000,
                        `${this.config.name} placeOrder receipt`,
                    );
                    this.tradeCount++;

                    // Extract order ID from events
                    const iface = this.clob.interface;
                    let orderId = 0;
                    for (const log of receipt.logs) {
                        try {
                            const parsed = iface.parseLog({ topics: log.topics, data: log.data });
                            if (parsed?.name === "OrderPlaced") {
                                orderId = Number(parsed.args.orderId ?? parsed.args[1]);
                                break;
                            }
                        } catch { /* skip */ }
                    }
                    if (orderId > 0) this.activeOrderIds.push(orderId);

                    const sideLabel = action.side === BUY_SIDE ? "BUY" : "SELL";
                    logs.push(
                        `[${this.config.name}] ${sideLabel} @${action.price} x${action.amount} (order #${orderId})`,
                    );
                    await sleep(25);
                } else if (action.type === "cancelOrder" && action.orderId) {
                    try {
                        const tx: any = await withTimeout(
                            (this.clob.connect(this.signer) as any).cancelOrder(
                                ctx.duelKey,
                                MARKET_KIND_DUEL_WINNER,
                                action.orderId,
                            ),
                            10_000,
                            `${this.config.name} cancelOrder`,
                        );
                        await withTimeout(
                            tx.wait(),
                            10_000,
                            `${this.config.name} cancelOrder receipt`,
                        );
                        logs.push(`[${this.config.name}] CANCEL order #${action.orderId}`);
                        await sleep(25);
                    } catch {
                        // Order was already filled or cancelled — silently clean up
                    }
                    this.activeOrderIds = this.activeOrderIds.filter(
                        (id) => id !== action.orderId,
                    );
                }
            } catch (err: any) {
                const msg = err.message || "";
                // Suppress noisy but harmless errors
                if (!msg.includes("not maker") && !msg.includes("order inactive") && !msg.includes("market not open") && !msg.includes("betting closed")) {
                    logs.push(`[${this.config.name}] ERROR: ${msg.slice(0, 120)}`);
                }
            }
        }
        return logs;
    }
}

// ─── Retail Agent ────────────────────────────────────────────────────────────
export class RetailAgent extends BaseAgent {
    constructor(signer: JsonRpcSigner, clob: Contract) {
        super(
            {
                name: "Retail Trader",
                strategy: "retail",
                description: "Random buy/sell at mid ± noise, realistic retail flow",
                enabled: true,
                color: "#4fc3f7",
            },
            signer,
            clob,
        );
    }

    decide(ctx: SimContext): AgentAction[] {
        if (random() < 0.4) return []; // 40% chance of sitting out

        const isBuy = random() > 0.5;
        const noise = randomInt(-50, 50);
        const price = clamp(ctx.mid + noise, 10, 990);
        const amount = BigInt(randomInt(1, 5)) * 100000000000000n;

        return [
            {
                type: "placeOrder",
                side: isBuy ? BUY_SIDE : SELL_SIDE,
                price,
                amount,
                label: isBuy ? "retail buy" : "retail sell",
            },
        ];
    }
}

// ─── Market Maker Agent ──────────────────────────────────────────────────────
export class MarketMakerAgent extends BaseAgent {
    lastPlan: QuotePlan | null = null;
    lastSnapshot: MarketSnapshot | null = null;

    constructor(signer: JsonRpcSigner, clob: Contract) {
        super(
            {
                name: "Market Maker",
                strategy: "market_maker",
                description: "Two-sided quoting around mid with inventory awareness",
                enabled: true,
                color: "#66bb6a",
            },
            signer,
            clob,
        );
    }

    decide(ctx: SimContext): AgentAction[] {
        const actions: AgentAction[] = [];
        const shouldReduceOnly = this.activeOrderIds.length >= 6;
        const runtimeProfile = ctx.scenarioProfile;
        const nowMs = ctx.nowMs;
        const staleStreamLagMs = (runtimeProfile?.staleStreamLagTicks ?? 0) * 500;
        const staleOracleLagMs = (runtimeProfile?.staleOracleLagTicks ?? 0) * 500;
        const staleRpcLagMs = (runtimeProfile?.staleRpcLagTicks ?? 0) * 500;
        const betCloseTimeMs =
            runtimeProfile?.betCloseTick != null
                ? runtimeProfile.betCloseTick * 500
                : null;

        // Cancel stale orders first
        if (this.activeOrderIds.length > 4) {
            const toCancel = this.activeOrderIds.slice(0, 1);
            for (const id of toCancel) {
                actions.push({ type: "cancelOrder", orderId: id });
            }
            if (shouldReduceOnly) {
                return actions;
            }
        }

        const snapshot: MarketSnapshot = {
            chainKey: "bsc",
            lifecycleStatus: "OPEN",
            duelKey: ctx.duelKey,
            marketRef: ctx.marketKey,
            bestBid: ctx.bestBid > 0 ? ctx.bestBid : null,
            bestAsk: ctx.bestAsk > 0 ? ctx.bestAsk : null,
            betCloseTimeMs,
            exposure: {
                yes: Number(ctx.agentPosition.aShares / 1000n),
                no: Number(ctx.agentPosition.bShares / 1000n),
                openYes: 0,
                openNo: 0,
            },
            lastStreamAtMs: nowMs - staleStreamLagMs,
            lastOracleAtMs: nowMs - staleOracleLagMs,
            lastRpcAtMs: nowMs - staleRpcLagMs,
            quoteAgeMs: this.activeOrderIds.length > 0 ? 2_000 : null,
        };
        this.lastSnapshot = snapshot;

        const plan = buildQuotePlan(
            snapshot,
            {
                signalPrice: ctx.mid,
                signalWeight: runtimeProfile?.signalWeight ?? 0.35,
            },
            {
                ...DEFAULT_MARKET_MAKER_CONFIG,
                minQuoteUnits: 2,
                maxQuoteUnits: 8,
                maxInventoryPerSide: 40,
                maxNetExposure: 25,
                maxQuoteAgeMs: 2_500,
                minRefreshIntervalMs: 1_000,
                betCloseGuardMs:
                    runtimeProfile?.marketMakerBetCloseGuardMs ??
                    DEFAULT_MARKET_MAKER_CONFIG.betCloseGuardMs,
            },
            nowMs,
        );
        this.lastPlan = plan;

        if (plan.risk.circuitBreaker.active) {
            return actions;
        }

        if (plan.bidPrice != null && plan.bidUnits > 0) {
            actions.push({
                type: "placeOrder",
                side: BUY_SIDE,
                price: plan.bidPrice,
                amount: BigInt(plan.bidUnits) * 1000n,
                label: "MM bid",
            });
        }
        if (plan.askPrice != null && plan.askUnits > 0) {
            actions.push({
                type: "placeOrder",
                side: SELL_SIDE,
                price: plan.askPrice,
                amount: BigInt(plan.askUnits) * 1000n,
                label: "MM ask",
            });
        }

        return actions;
    }
}

// ─── Whale Agent ─────────────────────────────────────────────────────────────
export class WhaleAgent extends BaseAgent {
    constructor(signer: JsonRpcSigner, clob: Contract) {
        super(
            {
                name: "Whale",
                strategy: "whale",
                description: "Large single-side orders that move the book",
                enabled: true,
                color: "#ab47bc",
            },
            signer,
            clob,
        );
    }

    decide(ctx: SimContext): AgentAction[] {
        if (random() < 0.7) return []; // Only trades 30% of ticks

        const isBuy = random() > 0.5;
        const price = isBuy
            ? clamp(ctx.mid + randomInt(10, 40), 10, 990)
            : clamp(ctx.mid - randomInt(10, 40), 10, 990);
        const amount = BigInt(randomInt(5, 20)) * 100000000000000n;

        return [
            {
                type: "placeOrder",
                side: isBuy ? BUY_SIDE : SELL_SIDE,
                price,
                amount,
                label: isBuy ? "whale buy" : "whale sell",
            },
        ];
    }
}

// ─── MEV Frontrunner Agent ───────────────────────────────────────────────────
export class MevFrontrunnerAgent extends BaseAgent {
    private provider: JsonRpcProvider;

    constructor(signer: JsonRpcSigner, clob: Contract, provider: JsonRpcProvider) {
        super(
            {
                name: "MEV Frontrunner",
                strategy: "mev_frontrunner",
                description: "Front-runs retail orders in the same block",
                enabled: false,
                color: "#ef5350",
            },
            signer,
            clob,
        );
        this.provider = provider;
    }

    decide(ctx: SimContext): AgentAction[] {
        if (random() < 0.6) return [];

        // Simulate front-running by placing aggressive orders at better prices
        const isBuy = random() > 0.5;
        const price = isBuy
            ? clamp(ctx.bestAsk > 0 && ctx.bestAsk < MAX_PRICE ? ctx.bestAsk : ctx.mid + 20, 10, 990)
            : clamp(ctx.bestBid > 0 ? ctx.bestBid : ctx.mid - 20, 10, 990);
        const amount = BigInt(randomInt(1, 5)) * 100000000000000n;

        return [
            {
                type: "placeOrder",
                side: isBuy ? BUY_SIDE : SELL_SIDE,
                price,
                amount,
                label: "MEV frontrun",
            },
        ];
    }
}

// ─── Sandwich Agent ──────────────────────────────────────────────────────────
export class SandwichAgent extends BaseAgent {
    constructor(signer: JsonRpcSigner, clob: Contract) {
        super(
            {
                name: "Sandwich Bot",
                strategy: "sandwich",
                description: "Front-run + back-run around retail orders",
                enabled: false,
                color: "#ff7043",
            },
            signer,
            clob,
        );
    }

    decide(ctx: SimContext): AgentAction[] {
        if (random() < 0.7) return [];

        const amount = BigInt(randomInt(1, 5)) * 100000000000000n;
        // Buy before and sell after — in sim, these are sequential
        return [
            {
                type: "placeOrder",
                side: BUY_SIDE,
                price: clamp(ctx.mid + 15, 10, 990),
                amount,
                label: "sandwich front",
            },
            {
                type: "placeOrder",
                side: SELL_SIDE,
                price: clamp(ctx.mid + 30, 10, 990),
                amount,
                label: "sandwich back",
            },
        ];
    }
}

// ─── Wash Trader Agent ───────────────────────────────────────────────────────
export class WashTraderAgent extends BaseAgent {
    constructor(signer: JsonRpcSigner, clob: Contract) {
        super(
            {
                name: "Wash Trader",
                strategy: "wash_trader",
                description: "Self-trades to inflate volume",
                enabled: false,
                color: "#ffa726",
            },
            signer,
            clob,
        );
    }

    decide(ctx: SimContext): AgentAction[] {
        if (random() < 0.5) return [];

        const price = clamp(ctx.mid, 10, 990);
        const amount = BigInt(randomInt(1, 3)) * 100000000000000n;

        // Place both sides at the same price to self-trade
        return [
            { type: "placeOrder", side: SELL_SIDE, price, amount, label: "wash sell" },
            { type: "placeOrder", side: BUY_SIDE, price, amount, label: "wash buy" },
        ];
    }
}

// ─── Oracle Attack Agent ─────────────────────────────────────────────────────
export class OracleAttackAgent extends BaseAgent {
    private oracle: Contract;

    constructor(signer: JsonRpcSigner, clob: Contract, oracle: Contract) {
        super(
            {
                name: "Oracle Attacker",
                strategy: "oracle_attack",
                description: "Attempts unauthorized oracle manipulation",
                enabled: false,
                color: "#e53935",
            },
            signer,
            clob,
        );
        this.oracle = oracle;
    }

    decide(_ctx: SimContext): AgentAction[] {
        // This agent doesn't use the standard action system — it's handled specially
        return [{ type: "noop", label: "oracle attack attempt" }];
    }

    async executeOracleAttack(duelKey: string): Promise<string> {
        try {
            const { ethers } = await import("ethers");
            const tx = await (this.oracle.connect(this.signer) as any).reportResult(
                duelKey,
                SIDE_A,
                13,
                ethers.keccak256(ethers.toUtf8Bytes("attack-replay")),
                ethers.keccak256(ethers.toUtf8Bytes("attack-result")),
                BigInt(Math.floor(Date.now() / 1000)) + 90n,
                "attack",
            );
            await tx.wait();
            return `[${this.config.name}] ⚠️ ATTACK SUCCEEDED (unexpected!)`;
        } catch {
            return `[${this.config.name}] 🛡️ Attack rejected by access control (expected)`;
        }
    }
}

// ─── Cabal Agent ─────────────────────────────────────────────────────────────
export class CabalAgent extends BaseAgent {
    private biasAgainstHouse: boolean;

    constructor(signer: JsonRpcSigner, clob: Contract, biasAgainstHouse = true) {
        super(
            {
                name: biasAgainstHouse ? "Cabal (Anti-House)" : "Cabal (Pro-House)",
                strategy: "cabal",
                description: "Coordinated group betting against/with the house bias",
                enabled: false,
                color: "#7e57c2",
            },
            signer,
            clob,
        );
        this.biasAgainstHouse = biasAgainstHouse;
    }

    decide(ctx: SimContext): AgentAction[] {
        if (random() < 0.3) return [];

        // Cabal always bets one direction aggressively
        const side = this.biasAgainstHouse ? BUY_SIDE : SELL_SIDE;
        const price = side === BUY_SIDE
            ? clamp(ctx.mid + randomInt(20, 60), 10, 990)
            : clamp(ctx.mid - randomInt(20, 60), 10, 990);
        const amount = BigInt(randomInt(1, 5)) * 100000000000000n;

        return [
            { type: "placeOrder", side, price, amount, label: "cabal push" },
        ];
    }
}

// ─── Arbitrageur Agent ───────────────────────────────────────────────────────
export class ArbitrageurAgent extends BaseAgent {
    constructor(signer: JsonRpcSigner, clob: Contract) {
        super(
            {
                name: "Arbitrageur",
                strategy: "arbitrageur",
                description: "Exploits crossed book by buying low and selling high",
                enabled: false,
                color: "#26a69a",
            },
            signer,
            clob,
        );
    }

    decide(ctx: SimContext): AgentAction[] {
        // Only act when spread is crossed or very tight (arb opportunity)
        if (ctx.bestBid <= 0 || ctx.bestAsk >= MAX_PRICE) return [];
        if (ctx.bestBid < ctx.bestAsk - 20) return []; // needs tight/crossed spread

        const amount = BigInt(randomInt(1, 3)) * 100000000000000n;

        return [
            {
                type: "placeOrder",
                side: SELL_SIDE,
                price: ctx.bestBid,
                amount,
                label: "arb sell at bid",
            },
            {
                type: "placeOrder",
                side: BUY_SIDE,
                price: ctx.bestAsk,
                amount,
                label: "arb buy at ask",
            },
        ];
    }
}

// ─── Stress Test Agent ───────────────────────────────────────────────────────
export class StressTestAgent extends BaseAgent {
    constructor(signer: JsonRpcSigner, clob: Contract) {
        super(
            {
                name: "Stress Tester",
                strategy: "stress_test",
                description: "Floods orders to test throughput limits",
                enabled: false,
                color: "#78909c",
            },
            signer,
            clob,
        );
    }

    decide(ctx: SimContext): AgentAction[] {
        const actions: AgentAction[] = [];
        const count = randomInt(2, 4);

        for (let i = 0; i < count; i++) {
            const isBuy = random() > 0.5;
            const price = clamp(ctx.mid + randomInt(-100, 100), 10, 990);
            const amount = BigInt(randomInt(1, 3)) * 100000000000000n;
            actions.push({
                type: "placeOrder",
                side: isBuy ? BUY_SIDE : SELL_SIDE,
                price,
                amount,
                label: `stress #${i}`,
            });
        }

        return actions;
    }
}

export class CancelReplaceAgent extends BaseAgent {
    constructor(signer: JsonRpcSigner, clob: Contract) {
        super(
            {
                name: "Cancel/Replace Griefer",
                strategy: "cancel_replace",
                description: "Rapidly churns its own quotes to stress cancel-replace paths",
                enabled: false,
                color: "#8d6e63",
            },
            signer,
            clob,
        );
    }

    decide(ctx: SimContext): AgentAction[] {
        const actions: AgentAction[] = [];
        for (const orderId of this.activeOrderIds.slice(0, 2)) {
            actions.push({ type: "cancelOrder", orderId, label: "cancel/replace" });
        }
        const orderCount = randomInt(1, 2);
        for (let i = 0; i < orderCount; i += 1) {
            const isBuy = random() > 0.5;
            actions.push({
                type: "placeOrder",
                side: isBuy ? BUY_SIDE : SELL_SIDE,
                price: clamp(ctx.mid + randomInt(-15, 15), 10, 990),
                amount: BigInt(randomInt(1, 2)) * 1000n,
                label: `cancel-replace #${i + 1}`,
            });
        }
        return actions;
    }
}

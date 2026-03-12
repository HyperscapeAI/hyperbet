export type ScenarioGateTier = "gate" | "diagnostic";
export type ScenarioSettlementMode = "resolve" | "cancel";
export type ScenarioSettlementStatus =
    | "NULL"
    | "OPEN"
    | "LOCKED"
    | "RESOLVED"
    | "CANCELLED";

export type ScenarioRuntimeProfile = {
    settlementMode?: ScenarioSettlementMode;
    staleStreamLagTicks?: number;
    staleOracleLagTicks?: number;
    staleRpcLagTicks?: number;
    betCloseTick?: number;
    marketMakerBetCloseGuardMs?: number;
    signalWeight?: number;
};

export type ScenarioGatePolicy = {
    requireDegradationFree?: boolean;
    requireMmSolvent?: boolean;
    requireBookIntegrity?: boolean;
    requireStaleStreamGuard?: boolean;
    requireStaleOracleGuard?: boolean;
    requireCloseGuard?: boolean;
    requireSettlementConsistency?: boolean;
    requireClaimsProcessed?: boolean;
    expectedSettlementStatus?: ScenarioSettlementStatus;
    maxAttackerPnl?: number;
    maxDrawdownBps?: number;
    minQuoteUptimeRatio?: number;
    maxQuoteUptimeRatio?: number;
    maxOrderChurn?: number;
};

export type ScenarioPreset = {
    id: string;
    name: string;
    family: string;
    description: string;
    enabledStrategies: string[];
    defaultTicks: number;
    defaultWinner: "A" | "B";
    canonicalSeed: string;
    matrixSeeds: string[];
    tier: ScenarioGateTier;
    runtimeProfile?: ScenarioRuntimeProfile;
    gatePolicy?: ScenarioGatePolicy;
};

export const SCENARIO_PRESETS: ScenarioPreset[] = [
    {
        id: "normal-market",
        name: "Normal Market",
        family: "baseline",
        description: "Retail traders + market maker in a balanced market",
        enabledStrategies: ["retail", "market_maker"],
        defaultTicks: 20,
        defaultWinner: "A",
        canonicalSeed: "normal-market-seed-1",
        matrixSeeds: [],
        tier: "diagnostic",
    },
    {
        id: "retail-rush",
        name: "Retail Rush",
        family: "toxic-flow",
        description: "All retail traders active, overwhelming thin MM liquidity",
        enabledStrategies: ["retail", "market_maker"],
        defaultTicks: 24,
        defaultWinner: "A",
        canonicalSeed: "retail-rush-seed-1",
        matrixSeeds: [],
        tier: "diagnostic",
    },
    {
        id: "stale-signal-sniping",
        name: "Stale Signal Sniping",
        family: "stale-signal-sniping",
        description: "Signal freshness drops while attackers keep trading against stale quotes",
        enabledStrategies: ["retail", "market_maker", "mev_frontrunner"],
        defaultTicks: 8,
        defaultWinner: "A",
        canonicalSeed: "stale-signal-seed-1",
        matrixSeeds: ["stale-signal-seed-2", "stale-signal-seed-3"],
        tier: "gate",
        runtimeProfile: {
            staleStreamLagTicks: 12,
            signalWeight: 0.45,
        },
        gatePolicy: {
            requireDegradationFree: true,
            requireMmSolvent: true,
            requireBookIntegrity: true,
            requireStaleStreamGuard: true,
            maxAttackerPnl: 0,
            maxQuoteUptimeRatio: 0.25,
        },
    },
    {
        id: "stale-oracle-sniping",
        name: "Stale Oracle Sniping",
        family: "stale-oracle-sniping",
        description: "Oracle freshness drops while attackers probe for stale oracle quotes",
        enabledStrategies: ["retail", "market_maker", "mev_frontrunner"],
        defaultTicks: 6,
        defaultWinner: "B",
        canonicalSeed: "stale-oracle-seed-1",
        matrixSeeds: ["stale-oracle-seed-2", "stale-oracle-seed-3"],
        tier: "gate",
        runtimeProfile: {
            staleOracleLagTicks: 14,
            signalWeight: 0.45,
        },
        gatePolicy: {
            requireDegradationFree: true,
            requireMmSolvent: true,
            requireBookIntegrity: true,
            requireStaleOracleGuard: true,
            maxAttackerPnl: 0,
            maxQuoteUptimeRatio: 0.25,
        },
    },
    {
        id: "close-window-race",
        name: "Close Window Race",
        family: "close-window-race",
        description: "Attackers try to race the book into the close window",
        enabledStrategies: ["retail", "market_maker", "mev_frontrunner"],
        defaultTicks: 6,
        defaultWinner: "B",
        canonicalSeed: "close-window-seed-1",
        matrixSeeds: ["close-window-seed-2"],
        tier: "gate",
        runtimeProfile: {
            betCloseTick: 4,
            marketMakerBetCloseGuardMs: 750,
            signalWeight: 0.35,
        },
        gatePolicy: {
            requireDegradationFree: true,
            requireMmSolvent: true,
            requireBookIntegrity: true,
            requireCloseGuard: true,
            maxAttackerPnl: 0,
        },
    },
    {
        id: "whale-impact",
        name: "Whale Impact",
        family: "inventory-poisoning",
        description: "Normal market with a whale dumping large orders",
        enabledStrategies: ["retail", "market_maker", "whale"],
        defaultTicks: 10,
        defaultWinner: "B",
        canonicalSeed: "inventory-poisoning-seed-1",
        matrixSeeds: ["inventory-poisoning-seed-2", "inventory-poisoning-seed-3"],
        tier: "gate",
        gatePolicy: {
            requireDegradationFree: true,
            requireMmSolvent: true,
            requireBookIntegrity: true,
            maxAttackerPnl: 0,
            maxDrawdownBps: 2_000,
        },
    },
    {
        id: "mev-extraction",
        name: "MEV Extraction",
        family: "frontrun-backrun",
        description: "Multiple MEV bots frontrunning retail order flow",
        enabledStrategies: ["retail", "market_maker", "mev_frontrunner"],
        defaultTicks: 10,
        defaultWinner: "A",
        canonicalSeed: "mev-extraction-seed-1",
        matrixSeeds: [],
        tier: "gate",
        gatePolicy: {
            requireDegradationFree: true,
            requireMmSolvent: true,
            requireBookIntegrity: true,
            maxAttackerPnl: 0,
        },
    },
    {
        id: "sandwich-attack",
        name: "Sandwich Attack",
        family: "sandwich",
        description: "Multiple sandwich bots wrapping retail orders",
        enabledStrategies: ["retail", "market_maker", "sandwich"],
        defaultTicks: 8,
        defaultWinner: "B",
        canonicalSeed: "sandwich-seed-1",
        matrixSeeds: ["sandwich-seed-2", "sandwich-seed-3"],
        tier: "gate",
        gatePolicy: {
            requireDegradationFree: true,
            requireMmSolvent: true,
            requireBookIntegrity: true,
            maxAttackerPnl: 0,
        },
    },
    {
        id: "double-sandwich-mev",
        name: "Double Sandwich + MEV",
        family: "sandwich",
        description: "Both sandwich bots and MEV bots extracting from retail",
        enabledStrategies: ["retail", "market_maker", "sandwich", "mev_frontrunner"],
        defaultTicks: 20,
        defaultWinner: "B",
        canonicalSeed: "double-sandwich-mev-seed-1",
        matrixSeeds: [],
        tier: "diagnostic",
    },
    {
        id: "wash-trading",
        name: "Wash Trading",
        family: "wash-self-trade",
        description: "Wash trader inflating volume alongside normal flow",
        enabledStrategies: ["retail", "market_maker", "wash_trader"],
        defaultTicks: 10,
        defaultWinner: "A",
        canonicalSeed: "wash-trading-seed-1",
        matrixSeeds: [],
        tier: "gate",
        gatePolicy: {
            requireDegradationFree: true,
            requireMmSolvent: true,
            requireBookIntegrity: true,
            maxAttackerPnl: 0,
        },
    },
    {
        id: "oracle-attack",
        name: "Oracle Attack",
        family: "oracle-abuse",
        description: "Attacker trying to manipulate the duel oracle",
        enabledStrategies: ["retail", "market_maker", "oracle_attack"],
        defaultTicks: 18,
        defaultWinner: "A",
        canonicalSeed: "oracle-attack-seed-1",
        matrixSeeds: [],
        tier: "diagnostic",
    },
    {
        id: "cabal-coordination",
        name: "Cabal Coordination",
        family: "coordinated-flow",
        description: "Two coordinated cabal groups betting against each other",
        enabledStrategies: ["retail", "market_maker", "cabal"],
        defaultTicks: 18,
        defaultWinner: "B",
        canonicalSeed: "cabal-coordination-seed-1",
        matrixSeeds: [],
        tier: "diagnostic",
    },
    {
        id: "arbitrage-hunt",
        name: "Arbitrage Hunt",
        family: "crossed-book-arbitrage",
        description: "Arbitrageur exploiting tight or crossed spreads",
        enabledStrategies: ["retail", "market_maker", "arbitrageur"],
        defaultTicks: 8,
        defaultWinner: "A",
        canonicalSeed: "crossed-book-seed-1",
        matrixSeeds: [],
        tier: "gate",
        gatePolicy: {
            requireDegradationFree: true,
            requireMmSolvent: true,
            requireBookIntegrity: true,
            maxAttackerPnl: 0,
        },
    },
    {
        id: "cancel-replace-griefing",
        name: "Cancel Replace Griefing",
        family: "cancel-replace-griefing",
        description: "Attacker churns orders to stress quote refresh and order cleanup",
        enabledStrategies: ["retail", "market_maker", "cancel_replace"],
        defaultTicks: 8,
        defaultWinner: "B",
        canonicalSeed: "cancel-replace-seed-1",
        matrixSeeds: [],
        tier: "gate",
        gatePolicy: {
            requireDegradationFree: true,
            requireMmSolvent: true,
            requireBookIntegrity: true,
            maxAttackerPnl: 0,
            maxOrderChurn: 120,
        },
    },
    {
        id: "stress-test",
        name: "Stress Test",
        family: "order-flood-dos",
        description: "High-frequency flood of orders overwhelming the book",
        enabledStrategies: ["retail", "market_maker", "stress_test"],
        defaultTicks: 6,
        defaultWinner: "B",
        canonicalSeed: "order-flood-seed-1",
        matrixSeeds: ["order-flood-seed-2", "order-flood-seed-3"],
        tier: "gate",
        gatePolicy: {
            requireDegradationFree: true,
            requireMmSolvent: true,
            requireBookIntegrity: true,
            maxAttackerPnl: 0,
            maxDrawdownBps: 2_000,
            maxOrderChurn: 160,
        },
    },
    {
        id: "whale-vs-mev",
        name: "Whale vs MEV",
        family: "toxic-flow",
        description: "Whale moving markets while MEV bots try to extract",
        enabledStrategies: ["market_maker", "whale", "mev_frontrunner"],
        defaultTicks: 20,
        defaultWinner: "B",
        canonicalSeed: "whale-vs-mev-seed-1",
        matrixSeeds: [],
        tier: "diagnostic",
    },
    {
        id: "claim-refund-abuse",
        name: "Claim Refund Abuse",
        family: "claim-refund-abuse",
        description: "Cancelled market exercises refund cleanup and repeated claim safety",
        enabledStrategies: ["market_maker", "whale"],
        defaultTicks: 4,
        defaultWinner: "B",
        canonicalSeed: "claim-refund-seed-1",
        matrixSeeds: [],
        tier: "gate",
        runtimeProfile: {
            settlementMode: "cancel",
        },
        gatePolicy: {
            requireDegradationFree: true,
            requireMmSolvent: true,
            requireBookIntegrity: true,
            requireSettlementConsistency: true,
            requireClaimsProcessed: true,
            expectedSettlementStatus: "CANCELLED",
            maxAttackerPnl: 0,
        },
    },
    {
        id: "attack-gauntlet",
        name: "Attack Gauntlet",
        family: "multi-vector",
        description: "All attack agents vs thin MM — maximum adversarial pressure",
        enabledStrategies: [
            "market_maker",
            "mev_frontrunner",
            "sandwich",
            "wash_trader",
            "cabal",
            "arbitrageur",
        ],
        defaultTicks: 10,
        defaultWinner: "B",
        canonicalSeed: "gauntlet-seed-1",
        matrixSeeds: [],
        tier: "diagnostic",
    },
    {
        id: "liquidity-crisis",
        name: "Liquidity Crisis",
        family: "insolvency",
        description: "Only the underfunded MM and whale — tests insolvency edge cases",
        enabledStrategies: ["market_maker", "whale"],
        defaultTicks: 18,
        defaultWinner: "B",
        canonicalSeed: "liquidity-crisis-seed-1",
        matrixSeeds: [],
        tier: "diagnostic",
    },
    {
        id: "full-chaos",
        name: "Full Chaos",
        family: "multi-vector",
        description: "All agents active simultaneously — maximum entropy",
        enabledStrategies: [
            "retail",
            "market_maker",
            "whale",
            "mev_frontrunner",
            "sandwich",
            "wash_trader",
            "oracle_attack",
            "cabal",
            "arbitrageur",
            "stress_test",
            "cancel_replace",
        ],
        defaultTicks: 8,
        defaultWinner: "B",
        canonicalSeed: "chaos-seed-1",
        matrixSeeds: [],
        tier: "diagnostic",
    },
];

export const GATE_SCENARIOS = SCENARIO_PRESETS.filter(
    (scenario) => scenario.tier === "gate",
);

export function getScenarioPresetByIdOrName(
    nameOrId: string,
): ScenarioPreset | null {
    return (
        SCENARIO_PRESETS.find(
            (entry) => entry.id === nameOrId || entry.name === nameOrId,
        ) ?? null
    );
}

import { describe, expect, it } from "bun:test";

import {
    GATE_SCENARIOS,
    getScenarioPresetByIdOrName,
} from "./scenario-catalog.js";
import { evaluateScenarioPolicyGates } from "./scenario-evaluator.js";

describe("scenario catalog", () => {
    it("exposes all required gate families", () => {
        const families = new Set(GATE_SCENARIOS.map((scenario) => scenario.family));
        expect(families.has("stale-signal-sniping")).toBeTrue();
        expect(families.has("stale-oracle-sniping")).toBeTrue();
        expect(families.has("close-window-race")).toBeTrue();
        expect(families.has("crossed-book-arbitrage")).toBeTrue();
        expect(families.has("sandwich")).toBeTrue();
        expect(families.has("frontrun-backrun")).toBeTrue();
        expect(families.has("wash-self-trade")).toBeTrue();
        expect(families.has("cancel-replace-griefing")).toBeTrue();
        expect(families.has("order-flood-dos")).toBeTrue();
        expect(families.has("inventory-poisoning")).toBeTrue();
        expect(families.has("claim-refund-abuse")).toBeTrue();
    });
});

describe("evaluateScenarioPolicyGates", () => {
    it("enforces stale signal guard policy", () => {
        const preset = getScenarioPresetByIdOrName("stale-signal-sniping");
        expect(preset).not.toBeNull();
        const gates = evaluateScenarioPolicyGates(preset!, {
            attackerPnl: 0,
            maxDrawdownBps: 0,
            quoteUptimeRatio: 0,
            orderChurn: 0,
            degraded: false,
            mmSolvent: true,
            bookNotCrossed: true,
            settlementConsistent: true,
            claimsProcessed: true,
            settlementStatus: "OPEN",
            staleStreamGuardTrips: 1,
            staleOracleGuardTrips: 0,
            closeGuardTrips: 0,
        });
        expect(gates.every((gate) => gate.passed)).toBeTrue();
    });

    it("flags missing refund cleanup on cancel scenarios", () => {
        const preset = getScenarioPresetByIdOrName("claim-refund-abuse");
        expect(preset).not.toBeNull();
        const gates = evaluateScenarioPolicyGates(preset!, {
            attackerPnl: 0,
            maxDrawdownBps: 0,
            quoteUptimeRatio: 0.5,
            orderChurn: 20,
            degraded: false,
            mmSolvent: true,
            bookNotCrossed: true,
            settlementConsistent: true,
            claimsProcessed: false,
            settlementStatus: "CANCELLED",
            staleStreamGuardTrips: 0,
            staleOracleGuardTrips: 0,
            closeGuardTrips: 0,
        });
        expect(gates.some((gate) => gate.name === "scenarioClaimsProcessed" && !gate.passed)).toBeTrue();
    });
});

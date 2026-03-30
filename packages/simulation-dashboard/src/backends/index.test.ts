import { describe, expect, test } from "bun:test";

import { getSimulationBackendKind } from "./index.js";
import { getScenarioPresetByIdOrName } from "../scenario-catalog.js";

describe("simulation backend selection", () => {
    test("keeps existing EVM scenarios on the evm backend", () => {
        const preset = getScenarioPresetByIdOrName("stale-oracle-sniping");
        expect(preset).not.toBeNull();
        expect(getSimulationBackendKind(preset!)).toBe("evm");
    });

    test("routes Solana proof scenarios to the solana backend", () => {
        const preset = getScenarioPresetByIdOrName("solana-lock-race-attempt");
        expect(preset).not.toBeNull();
        expect(getSimulationBackendKind(preset!)).toBe("solana");
    });
});

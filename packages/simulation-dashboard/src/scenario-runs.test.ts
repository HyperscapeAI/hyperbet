import { describe, expect, test } from "bun:test";

import { getScenarioPresetByIdOrName } from "./scenario-catalog.js";
import { createScenarioRunRecord } from "./scenario-runs.js";

describe("scenario run records", () => {
    test("persist the preset chain key on queued runs", () => {
        const preset = getScenarioPresetByIdOrName("solana-unauthorized-oracle-attack");
        expect(preset).not.toBeNull();

        const run = createScenarioRunRecord(
            preset!,
            {
                seed: "test-seed",
                winner: "B",
            },
            7,
        );

        expect(run.chainKey).toBe("solana");
        expect(run.seed).toBe("test-seed");
        expect(run.winner).toBe("B");
        expect(run.status).toBe("queued");
    });
});

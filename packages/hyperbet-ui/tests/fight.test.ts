import "./setup";
import { describe, expect, it } from "bun:test";

import { simulateFight } from "../src/lib/fight";

describe("simulateFight", () => {
    it("produces deterministic results for the same seed", () => {
        const a = simulateFight(42n);
        const b = simulateFight(42n);

        expect(a.winner).toBe(b.winner);
        expect(a.events.length).toBe(b.events.length);
        expect(a.seed).toBe(42n);
    });

    it("produces different results for different seeds", () => {
        const results = new Set<string>();
        for (let seed = 1n; seed <= 50n; seed += 1n) {
            const { winner } = simulateFight(seed);
            results.add(winner);
        }
        // Over 50 seeds, both A and B should win at least once
        expect(results.has("A")).toBe(true);
        expect(results.has("B")).toBe(true);
    });

    it("always ends with at least one fighter at 0 HP", () => {
        for (let seed = 100n; seed < 120n; seed += 1n) {
            const { events } = simulateFight(seed);
            const lastEvent = events[events.length - 1];
            const minHp = Math.min(lastEvent.attackerHp, lastEvent.defenderHp);
            expect(minHp).toBe(0);
        }
    });

    it("returns a 32-byte replayHash", () => {
        const { replayHash } = simulateFight(999n);
        expect(replayHash).toBeInstanceOf(Uint8Array);
        expect(replayHash.length).toBe(32);
    });

    it("produces non-empty events", () => {
        const { events } = simulateFight(1n);
        expect(events.length).toBeGreaterThan(0);
        expect(events[0].round).toBe(1);
        expect(["A", "B"]).toContain(events[0].attacker);
    });
});

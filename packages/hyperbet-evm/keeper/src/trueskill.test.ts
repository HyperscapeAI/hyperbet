import { describe, expect, it } from "bun:test";

import {
    createInitialRating,
    updateRatings,
    calculateSpotIndex,
} from "./trueskill";

describe("createInitialRating", () => {
    it("returns default mu, sigma, and gamesPlayed", () => {
        const rating = createInitialRating();
        expect(rating.mu).toBe(1000);
        expect(rating.sigma).toBe(300);
        expect(rating.gamesPlayed).toBe(0);
    });
});

describe("updateRatings", () => {
    it("increases winner mu and decreases loser mu", () => {
        const w = createInitialRating();
        const l = createInitialRating();
        const result = updateRatings(w, l);
        expect(result.winner.mu).toBeGreaterThan(w.mu);
        expect(result.loser.mu).toBeLessThan(l.mu);
    });

    it("shrinks sigma for both players after a match", () => {
        const w = createInitialRating();
        const l = createInitialRating();
        const result = updateRatings(w, l);
        expect(result.winner.sigma).toBeLessThan(w.sigma);
        expect(result.loser.sigma).toBeLessThan(l.sigma);
    });

    it("increments gamesPlayed for both players", () => {
        const w = createInitialRating();
        const l = createInitialRating();
        const result = updateRatings(w, l);
        expect(result.winner.gamesPlayed).toBe(1);
        expect(result.loser.gamesPlayed).toBe(1);
    });

    it("converges sigma towards minimum over many games", () => {
        let w = createInitialRating();
        let l = createInitialRating();
        for (let i = 0; i < 100; i++) {
            const result = updateRatings(w, l);
            w = result.winner;
            l = result.loser;
        }
        expect(w.sigma).toBe(50); // MIN_SIGMA
        expect(l.sigma).toBe(50);
    });

    it("gives asymmetric updates when ratings differ", () => {
        const strong = { mu: 1500, sigma: 50, gamesPlayed: 100 };
        const weak = { mu: 800, sigma: 200, gamesPlayed: 5 };

        // Upset: weak beats strong — weak should gain a lot
        const result = updateRatings(weak, strong);
        const weakGain = result.winner.mu - weak.mu;
        const strongLoss = strong.mu - result.loser.mu;
        expect(weakGain).toBeGreaterThan(0);
        expect(strongLoss).toBeGreaterThan(0);
    });
});

describe("calculateSpotIndex", () => {
    it("returns >= 1.0 for any valid rating", () => {
        expect(calculateSpotIndex(createInitialRating())).toBeGreaterThanOrEqual(1);
    });

    it("returns a higher index for established players vs new players", () => {
        const established = { mu: 1500, sigma: 50, gamesPlayed: 100 };
        const newPlayer = createInitialRating();
        expect(calculateSpotIndex(established)).toBeGreaterThan(
            calculateSpotIndex(newPlayer),
        );
    });

    it("penalizes high uncertainty (sigma)", () => {
        const lowSigma = { mu: 1000, sigma: 50, gamesPlayed: 50 };
        const highSigma = { mu: 1000, sigma: 300, gamesPlayed: 0 };
        expect(calculateSpotIndex(lowSigma)).toBeGreaterThan(
            calculateSpotIndex(highSigma),
        );
    });

    it("returns a rounded value with 2 decimal places", () => {
        const rating = { mu: 1234, sigma: 67, gamesPlayed: 30 };
        const index = calculateSpotIndex(rating);
        expect(index).toBe(Math.round(index * 100) / 100);
    });
});

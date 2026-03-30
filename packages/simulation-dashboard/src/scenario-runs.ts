import type { ScenarioResult } from "@hyperbet/mm-core";

import type { ScenarioPreset } from "./scenario-catalog.js";

export type ScenarioRunStatus = "queued" | "running" | "succeeded" | "failed";

export type ScenarioRunRecord = {
    runId: string;
    scenarioId: string;
    scenarioName: string;
    chainKey: ScenarioPreset["chainKey"];
    seed: string;
    ticks: number;
    winner: "A" | "B";
    freshBaseline: boolean;
    status: ScenarioRunStatus;
    stage: string | null;
    requestedAt: number;
    startedAt: number | null;
    finishedAt: number | null;
    error: string | null;
    result: ScenarioResult | null;
};

export function createScenarioRunRecord(
    preset: ScenarioPreset,
    options: {
        seed?: string;
        ticks?: number;
        winner?: "A" | "B";
        freshBaseline?: boolean;
    },
    sequence: number,
): ScenarioRunRecord {
    return {
        runId: `${preset.id}-${Date.now()}-${sequence}`,
        scenarioId: preset.id,
        scenarioName: preset.name,
        chainKey: preset.chainKey,
        seed: options.seed?.trim() || preset.canonicalSeed,
        ticks: Math.max(1, Math.min(200, options.ticks ?? preset.defaultTicks)),
        winner: options.winner ?? preset.defaultWinner,
        freshBaseline: options.freshBaseline ?? false,
        status: "queued",
        stage: "queued",
        requestedAt: Date.now(),
        startedAt: null,
        finishedAt: null,
        error: null,
        result: null,
    };
}

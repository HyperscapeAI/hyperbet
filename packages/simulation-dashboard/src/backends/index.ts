import type { ScenarioResult } from "@hyperbet/mm-core";

import type { ScenarioPreset } from "../scenario-catalog.js";
import type { ScenarioRunRecord } from "../scenario-runs.js";

export type SimulationBackendKind = "evm" | "solana";

export type SimulationBackendState = Record<string, unknown>;

export type SimulationBackendRunCallbacks = {
    onStage?: (stage: string) => void;
    onLog?: (message: string) => void;
};

export type SimulationBackendRunContext = {
    preset: ScenarioPreset;
    run: ScenarioRunRecord;
    callbacks?: SimulationBackendRunCallbacks;
};

export type SimulationBackendRunResult = {
    result: ScenarioResult;
    state: SimulationBackendState;
};

export interface SimulationBackend {
    readonly kind: SimulationBackendKind;
    run(context: SimulationBackendRunContext): Promise<SimulationBackendRunResult>;
}

export function getSimulationBackendKind(
    preset: Pick<ScenarioPreset, "chainKey">,
): SimulationBackendKind {
    return preset.chainKey === "solana" ? "solana" : "evm";
}

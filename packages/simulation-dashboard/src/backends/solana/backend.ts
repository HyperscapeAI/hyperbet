import type {
    SimulationBackend,
    SimulationBackendRunContext,
    SimulationBackendRunResult,
} from "../index.js";
import { normalizeSolanaProofOutcome } from "./normalize.js";
import { runSolanaProofScenario } from "./proof-scenarios.js";
import { SolanaProgramRuntime } from "./program-runtime.js";
import { startSolanaValidator } from "./validator.js";

export class SolanaSimulationBackend implements SimulationBackend {
    readonly kind = "solana" as const;

    async run(
        context: SimulationBackendRunContext,
    ): Promise<SimulationBackendRunResult> {
        const { callbacks, preset, run } = context;

        if (preset.chainKey !== "solana") {
            throw new Error(`Unsupported Solana proof scenario: ${preset.id}`);
        }

        if (run.ticks !== preset.defaultTicks) {
            callbacks?.onLog?.(
                `Solana proof scenario ignores ticks=${run.ticks}; the validator flow is scripted for ${preset.id}.`,
            );
        }

        callbacks?.onStage?.("boot-validator");
        const validator = await startSolanaValidator();
        try {
            const runtime = await SolanaProgramRuntime.create(validator);
            callbacks?.onStage?.("setup-market");
            callbacks?.onStage?.("execute-proof");
            const proofOutcome = await runSolanaProofScenario(runtime, {
                preset,
                seed: run.seed,
                winner: run.winner,
                attackUnauthorizedReporter:
                    preset.id === "solana-unauthorized-oracle-attack",
                onLog: callbacks?.onLog,
                onStage: callbacks?.onStage,
            });
            const { result, state } = normalizeSolanaProofOutcome(proofOutcome);
            return { result, state };
        } finally {
            callbacks?.onStage?.("teardown");
            await validator.stop();
        }
    }
}

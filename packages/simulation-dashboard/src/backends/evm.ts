import type {
    SimulationBackend,
    SimulationBackendRunContext,
    SimulationBackendRunResult,
} from "./index.js";

export class EvmSimulationBackend implements SimulationBackend {
    readonly kind = "evm" as const;

    constructor(
        private readonly executor: (
            context: SimulationBackendRunContext,
        ) => Promise<SimulationBackendRunResult>,
    ) {}

    run(context: SimulationBackendRunContext): Promise<SimulationBackendRunResult> {
        return this.executor(context);
    }
}

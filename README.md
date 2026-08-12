# Hyperbet

Hyperbet is the Solana-only native-SOL duel wagering and spectator application for Hyperia.

## Launch boundary

The v1 release contains exactly:

- the `fight_oracle` Solana program for authoritative duel outcomes
- the `duel_market` Solana program for native-SOL prediction markets
- the Solana browser app
- the read-only HTTP service and separately operated duel keeper
- the shared Solana UI, SDK, simulation, and deployment tooling required by those surfaces

Other experimental packages in the repository are outside the v1 dependency, build, CI, deployment, and operator graph. They are not launchable through root commands or active workflows.

## Start locally

```bash
bun run dev:doctor
bun run dev:bootstrap
bun run dev:local:solana
```

The local release harness starts a fresh validator with only the oracle and duel-market programs, seeds native-SOL state, starts the keeper and app, then runs the browser acceptance suite.

## Verify

```bash
bun run ci:env
bun run ci:scope:solana
bun run ci:gate:registry:launch
bun run ci:gate:solana:build
bun run ci:gate:solana
bun run ci:gate:e2e:solana
bun run ci:prepr
```

The scope gate rejects alternate-chain launch paths, retired product surfaces, token-denominated wagering, extra on-chain programs, mixed keeper entrypoints, and unsafe deployment/runtime configuration.

## Packages

- [`packages/hyperbet-solana`](packages/hyperbet-solana): programs, app, keeper, deployment registry, and Solana operations
- [`packages/hyperbet-ui`](packages/hyperbet-ui): shared Solana launch components
- [`packages/hyperbet-sdk`](packages/hyperbet-sdk): TypeScript Solana client
- [`packages/hyperbet-sdk-py`](packages/hyperbet-sdk-py): Python Solana client
- [`packages/simulation-dashboard`](packages/simulation-dashboard): validator-backed adversarial scenarios

## Operations

- [Development setup](docs/development-setup.md)
- [Production deployment](docs/hyperbet-production-deploy.md)
- [Release readiness](docs/prediction-market-release-prep.md)
- [Operator runbooks](docs/runbooks/README.md)
- [Solana package contract](packages/hyperbet-solana/README.md)

Production deployment and on-chain initialization remain manual, fail closed, and require explicit reviewed identities, economics, upgrade-authority expectations, and configuration-freeze approval.

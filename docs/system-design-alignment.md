# Hyperbet System Design Alignment

## Purpose

This document aligns `hyperbet` and `hyperscape` around one platform model.
In the current sprint baseline, this is a **directional architecture document**,
not an override of the launch-hardening source of truth.

Today, the sprint branch still treats the following as authoritative:

- `@hyperbet/chain-registry` for current chain/runtime truth
- the existing CI/deploy/proof rails for release hardening
- the existing BSC/AVAX wrappers and keepers for current launch surfaces

For the detailed keep/adapt/reject record on the imported
`hyperbet-evm-parity-sweep` direction, and the implemented local
standardization outcome, see
`docs/enoomian-evm-standardization-decisions.md`.

This document captures the intended convergence target while that migration is
still in progress:

- `hyperscape` is the source of truth for duel lifecycle and stream state.
- `hyperbet` is the execution, market, and chain-facing product layer.
- Solana and EVM are execution adapters, not separate products.
- Chain-specific sites such as AVAX, BSC, and Base should be themed deployments of one canonical EVM runtime.

The goal is to prevent design drift while the codebase transitions from mixed chain packages into a cleaner architecture.

For the current Gold asset interpretation and the planned Gold architecture
track, see:

- `docs/protocol/gold-current-state.md`
- `docs/protocol/gold-architecture-spec-plan.md`

## Canonical Responsibilities

### Hyperscape

- Owns duel lifecycle, stream state, simulation state, and canonical result data.
- Publishes oracle lifecycle events to chain targets.
- Exposes the HTTP and streaming APIs that Hyperbet consumes.

### Hyperbet

- Owns prediction and perps market UX.
- Owns chain-facing keepers, market-making, wallet interactions, and deployments.
- Consumes Hyperscape duel truth instead of inventing a separate match state model.

### Solana runtime

- Lives in `packages/hyperbet-solana`.
- Owns Solana app, Solana keeper, Solana deployment tooling, Solana-specific wallet flow, and Solana program interactions.

### EVM runtime

- Lives in `packages/hyperbet-evm`.
- Owns the canonical EVM app shell and the canonicalized additive EVM keeper
  direction on the local sprint-base standardization path.
- `packages/hyperbet-deployments` is subordinate to
  `@hyperbet/chain-registry`, not a competing deployment authority.
- AVAX, BSC, and Base should continue converging toward wrapper shells over
  this runtime, not separate architectures.

### Shared UI

- Lives in `packages/hyperbet-ui`.
- Owns reusable components, chain-agnostic frontend logic, theme system, shared market panels, and shared spectator/streaming views.
- Theme should change presentation, not business logic.

## Package Semantics

### Hyperbet packages

- `packages/hyperbet-ui`
  - shared React UI and theme system
- `packages/hyperbet-evm`
  - canonical EVM app shell
  - canonicalized additive EVM keeper/backend surface on the local
    sprint-base standardization path
- `packages/hyperbet-solana`
  - canonical Solana app + keeper runtime
- `packages/hyperbet-avax`
  - temporary EVM deployment wrapper
- `packages/hyperbet-bsc`
  - temporary EVM deployment wrapper
- `packages/evm-contracts`
  - canonical EVM contracts
- `packages/hyperbet-deployments`
  - additive deployment materialization layer introduced for convergence work
  - subordinate to the sprint branch's current chain-registry truth
- `packages/hyperbet-sdk`
  - shared SDK surface for external consumers
- `packages/market-maker-bot`
  - offchain quoting / liquidity automation

### Hyperscape packages most relevant to Hyperbet

- `../hyperscape/packages/server`
  - duel lifecycle APIs, stream state, and oracle publishing integration
- `../hyperscape/packages/shared`
  - shared simulation/runtime primitives
- `../hyperscape/packages/client`
  - game client UI
- `../hyperscape/packages/duel-oracle-evm`
  - canonical EVM oracle ABI/source
- `../hyperscape/packages/duel-oracle-solana`
  - canonical Solana oracle program/IDL

## Intended Runtime Flow

1. Hyperscape server schedules and runs duel cycles.
2. Hyperscape emits canonical streaming state and duel lifecycle data.
3. Hyperbet keepers consume that duel lifecycle data.
4. Chain-specific keepers update oracle state and market state on their target chain.
5. Hyperbet frontend consumes:
   - streaming state from keeper/Hyperscape APIs
   - chain data from contracts or chain-aware keeper APIs
6. Market maker consumes the same canonical duel state and market state to quote liquidity.
7. Users interact with one shared Hyperbet product model through different chain runtimes.

## Mermaid Diagram

```mermaid
flowchart LR
  subgraph HS[Hyperscape]
    HSClient[Client]
    HSServer[Server]
    HSShared[Shared Runtime]
    HSOracle[Duel Oracle Publisher]
  end

  subgraph Shared[Shared Hyperbet Surface]
    HUI[@hyperbet/ui]
    HDeploy[@hyperbet/deployments]
    HSDK[@hyperbet/sdk]
  end

  subgraph HB[Hyperbet]
    HEVM[hyperbet-evm]
    HSOL[hyperbet-solana]
    HAVAX[hyperbet-avax wrapper]
    HBSC[hyperbet-bsc wrapper]
    HMM[market-maker-bot]
    HContracts[evm-contracts]
  end

  HSShared --> HSServer
  HSClient --> HSServer
  HSServer --> HSOracle

  HSServer -->|stream state / duel lifecycle| HEVM
  HSServer -->|stream state / duel lifecycle| HSOL
  HSServer -->|state feed| HMM

  HSOracle -->|EVM oracle updates| HContracts
  HSOracle -->|Solana oracle updates| HSOL

  HDeploy --> HEVM
  HDeploy --> HSOL
  HDeploy --> HAVAX
  HDeploy --> HBSC

  HUI --> HEVM
  HUI --> HSOL
  HUI --> HAVAX
  HUI --> HBSC

  HContracts --> HEVM
  HSDK --> HEVM
  HSDK --> HSOL

  HEVM --> HAVAX
  HEVM --> HBSC
```

## Design Alignment Decisions

### 1. Keep one product model

Prediction and perps are product capabilities, not chain-specific products.

- Duel lifecycle semantics must be identical across chain runtimes.
- Market metadata and result semantics must come from Hyperscape.
- Keepers should differ by execution adapter, not by business meaning.

### 2. Keep one canonical EVM runtime

`hyperbet-evm` is now the canonical EVM direction on the local sprint-base
standardization path, but deploy adoption and wrapper retirement still follow
the existing sprint operational model.

- AVAX, Base, and BSC should be deployment presets plus theme wrappers.
- Chain wrappers should not own their own keeper/business logic long term.

### 3. Keep one canonical Solana runtime

`hyperbet-solana` remains the Solana-first runtime.

- Solana-specific wallet, PDA, Anchor, and program logic should stay there.

### 4. Converge toward one shared deployment manifest

`@hyperbet/deployments` is the intended materialized manifest layer for:

- contract/program addresses
- chain IDs
- operator/admin accounts
- margin token addresses

It remains subordinate to the sprint branch's existing
`@hyperbet/chain-registry`, which continues to be authoritative for runtime and
release-hardening behavior.

### 5. Keep one shared UI layer

`@hyperbet/ui` should be the primary owner of:

- visual language
- component system
- theme system
- chain-agnostic view logic

Chain packages should only inject:

- theme ID
- addresses and RPC config
- chain label/copy
- wallet provider/runtime setup

## Audit Findings

### Architecture

1. The intended architecture is shared-product / chain-adapter, but the repo is still partly package-per-chain and partly product-per-chain.
2. `hyperbet-evm` is now the right direction, but AVAX and BSC wrappers still exist as semi-independent packages instead of thin deployment shells.
3. `market-maker-bot` is still cross-chain in an ad hoc way rather than consuming canonical runtime modules.

### Keeper boundaries

1. `hyperbet-evm/keeper` is directionally useful but is not yet accepted as the
   canonical keeper baseline; see
   `docs/enoomian-evm-standardization-decisions.md`.
2. `hyperbet-solana/keeper` remains the correct home for Solana-first automation.
3. Shared keeper logic has not yet been extracted into reusable modules, so semantic duplication risk remains.

### UI and UX

1. `@hyperbet/ui` is now correctly positioned as the shared UI surface.
2. The theme model is aligned with the desired deployment strategy.
3. The frontend still mixes shared market concepts with some chain-specific behavior and copy in package apps.
4. Prediction UX is closer to parity than perps UX.

### Contract/runtime semantics

1. EVM prediction flow is structurally integrated.
2. EVM perps are still not fully aligned with the intended economics and runtime behavior.
3. Deployment manifest centralization is correct, but not all consumers are yet manifest-first.

### Cross-repo relationships

1. Hyperscape runtime orchestration still points primarily at `hyperbet-solana` in the duel stack.
2. That means the repo orchestration scripts still encode an older “Solana-first sibling app” assumption.
3. The desired long-term architecture is “shared Hyperbet + chain adapters”, but the orchestration layer has not been updated to reflect that.

## Current State Assessment

### What is aligned

- Canonical EVM runtime package now exists.
- Shared UI/theme direction is correct.
- Shared deployment-manifest package now exists as additive scaffolding.
- Solana and EVM runtime split is conceptually correct.

### What is partially aligned

- Keeper boundaries
- Chain wrappers
- Market-maker ownership
- Perps contract/runtime semantics
- Hyperscape orchestration scripts

### What is not yet aligned

- Thin-wrapper model for AVAX/BSC
- Fully shared keeper semantics
- Fully canonical market-maker integration model
- End-to-end EVM perps parity
- Repo-wide documentation of the target architecture

## Recommended Next Steps

### Phase 1: Runtime semantics

1. Extract shared keeper domain logic into chain-agnostic modules.
2. Leave only execution adapters inside `hyperbet-evm/keeper` and `hyperbet-solana/keeper`.
3. Update Hyperscape duel-stack orchestration so Hyperbet runtime selection is explicit instead of implicitly Solana-first.

### Phase 2: Package ownership

1. Reduce `hyperbet-avax` and `hyperbet-bsc` toward thin wrappers over `hyperbet-evm`.
2. Keep all reusable UI in `@hyperbet/ui`.
3. Keep all EVM contract/address logic in `evm-contracts` + `hyperbet-deployments`.

### Phase 3: Market architecture

1. Recover intended perps semantics from repo evidence.
2. Align EVM perps contracts and keeper APIs to that spec.
3. Revalidate the market-maker against the canonical contract interfaces.

### Phase 4: Product audit

1. Audit UI and UX consistency across Solana and EVM.
2. Audit end-to-end game flow from Hyperscape duel lifecycle to market resolution.
3. Audit package semantics against this document before expanding further.

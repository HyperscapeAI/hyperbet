# Project Rules

## Absolute Rules
- NEVER add branding, attribution, or "Generated with" lines to any output (PRs, commits, code, docs)
- NEVER add Co-Authored-By lines to commits
- NEVER mention Claude, Anthropic, or any AI tool in any committed content

## Commit Style
- Use conventional commits: feat/fix/test/docs/chore/refactor
- Commit messages: imperative mood, concise, focus on "why" not "what"
- No emoji in commits or code unless user explicitly requests

## Code Style
- Solidity: 0.8.20+, OpenZeppelin patterns, Foundry + Hardhat dual test coverage
- Solana/Anchor: checked arithmetic, PDA seed validation, owner checks
- TypeScript: strict mode, bun runtime
- No unnecessary comments, docstrings, or type annotations on unchanged code

## Testing
- Foundry: forge test (fuzz default 256, extended 512+)
- Hardhat: bun x hardhat test
- Deployment: bun test packages/hyperbet-*/tests/
- Market maker: bun run --cwd packages/market-maker-bot test
- Keeper: bun test packages/hyperbet-*/keeper/src/*.test.ts
- TS checks: bun x tsc --noEmit -p packages/hyperbet-{solana,bsc,avax}/app/tsconfig.json

## Architecture
- EVM contracts: packages/evm-contracts/contracts/
- Solana programs: packages/hyperbet-solana/anchor/programs/
- Chain registry: packages/hyperbet-chain-registry/src/index.ts (single source of truth for deployments)
- CREATE2 for deterministic EVM addresses across all chains

# Consolidate `@elizaos/cloud-ui` Component Library

Rename the existing `@elizaos/ui` package to `@elizaos/cloud-ui`, move **all** root `components/` into it organized by domain, and add Storybook stories for every component.

## Current State

| Location | Contents | Stories |
|----------|----------|---------|
| `packages/ui/` (`@elizaos/ui`) | ~100 component files, 12 subdirectories (ai-elements, brand, chat, containers, monetization, voice, etc.) | 33 story files |
| Root `components/` | 136 TSX files across 35 feature directories (account, admin, agents, analytics, apps, auth, billing, chat, containers, dashboard, etc.) | 0 stories |

**Root components** are page-level / feature-specific "use client" components that import primitives from `@elizaos/ui`. They also import from `@/lib/`, `next/image`, `next/navigation`, etc.

## User Review Required

> [!IMPORTANT]
> **Naming decision**: Renaming from `@elizaos/ui` → `@elizaos/cloud-ui` as requested. This changes the import path across the entire codebase.

> [!WARNING]
> **Next.js coupling**: Many root components use `useRouter`, `next/image`, `next/navigation`, and fetch API routes. Moving these into the package means the package needs `next` as a peer dependency, OR we separate into two tiers:
> - **Tier 1 (primitives)**: Framework-agnostic UI primitives (Button, Card, Dialog, etc.) — already in `packages/ui`
> - **Tier 2 (features)**: Next.js-coupled feature components (AgentCard, Sidebar, etc.) — from root `components/`
>
> **Recommendation**: Keep both tiers in ONE package (`@elizaos/cloud-ui`) with sub-path exports (e.g., `@elizaos/cloud-ui` for primitives, `@elizaos/cloud-ui/features/agents` for feature components). This keeps things consolidated while maintaining organizational clarity.

> [!CAUTION]
> This is a **large refactor** touching 170+ component files and ~40 app pages. I recommend doing this in phases. Shall I proceed with a phased approach, or do you want the full migration in one pass?

## Proposed Changes

### Phase 1: Rename package + restructure

#### [MODIFY] [package.json](file:///Users/shawwalters/eliza-workspace/eliza-cloud-v2/packages/ui/package.json)
- Rename `@elizaos/ui` → `@elizaos/cloud-ui`
- Add `next` and `framer-motion` as peer dependencies (needed for feature components)
- Add `next-themes` peer dep (already listed)

#### [MODIFY] [index.ts](file:///Users/shawwalters/eliza-workspace/eliza-cloud-v2/packages/ui/src/index.ts)
- Keep as main barrel export for primitives
- Add new feature-level exports

#### [NEW] Feature component directories under `packages/ui/src/components/`
Move all 35 root `components/` directories into `packages/ui/src/components/` organized by domain:

| Root Dir | → Package Path | Files |
|----------|---------------|-------|
| `components/account/` | `src/components/account/` | 5 files |
| `components/admin/` | `src/components/admin/` | 5 files |
| `components/affiliates/` | `src/components/affiliates/` | 2 files |
| `components/agents/` | `src/components/agents/` | 1 file |
| `components/analytics/` | `src/components/analytics/` ← merge with existing | 10 files |
| `components/api-explorer/` | `src/components/api-explorer/` | 7 files |
| `components/api-keys/` | `src/components/api-keys/` | 4 files |
| `components/app-builder/` | `src/components/app-builder/` | 7 files |
| `components/apps/` | `src/components/apps/` | 16 files |
| `components/auth/` | `src/components/auth/` | 2 files |
| `components/billing/` | `src/components/billing/` | 4 files |
| `components/builders/` | `src/components/builders/` | 1 file |
| `components/character-builder/` | `src/components/character-builder/` | 4 files |
| `components/chat/` | `src/components/chat/` ← merge with existing | 17 files |
| `components/containers/` | `src/components/containers/` ← merge with existing | 12 files |
| `components/dashboard/` | `src/components/dashboard/` | 7 files |
| `components/docs/` | `src/components/docs/` | 3 files |
| `components/earnings/` | `src/components/earnings/` | 2 files |
| `components/gallery/` | `src/components/gallery/` | 2 files |
| `components/image/` | `src/components/image/` ← merge with existing | 4 files |
| `components/invoices/` | `src/components/invoices/` | 1 file |
| `components/knowledge/` | `src/components/knowledge/` | 4 files |
| `components/landing/` | `src/components/landing/` | 18 files |
| `components/layout/` | `src/components/layout/` ← merge with existing | 12 files |
| `components/mcps/` | `src/components/mcps/` | 2 files |
| `components/my-agents/` | `src/components/my-agents/` | 5 files |
| `components/onboarding/` | `src/components/onboarding/` | 2 files |
| `components/organization/` | `src/components/organization/` | 5 files |
| `components/payment/` | `src/components/payment/` | 1 file |
| `components/promotion/` | `src/components/promotion/` | 2 files |
| `components/sandbox/` | `src/components/sandbox/` | 1 file |
| `components/settings/` | `src/components/settings/` | 12 files |
| `components/share/` | `src/components/share/` ← merge with existing | 0 files |
| `components/video/` | `src/components/video/` | 3 files |
| `components/voices/` | `src/components/voices/` ← merge with existing | 5 files |

---

### Phase 2: Update all imports across the codebase

#### [MODIFY] All `app/**/*.tsx` files (~40 files)
- Change `from "@elizaos/ui"` → `from "@elizaos/cloud-ui"`  
- Change `from "@/components/..."` → `from "@elizaos/cloud-ui"` (for migrated components)

#### [MODIFY] [package.json](file:///Users/shawwalters/eliza-workspace/eliza-cloud-v2/package.json) (root)
- Update workspace dependency `@elizaos/ui` → `@elizaos/cloud-ui`

---

### Phase 3: Add Storybook stories for ALL components

For each of the ~136 feature components being moved, create a corresponding `.stories.tsx` file. Components that already have stories (33 in `packages/ui`) will be reviewed but not duplicated.

**Strategy for feature components that depend on Next.js / API calls:**
- Use Storybook decorators to mock `next/navigation`, `next/image`
- Use MSW (Mock Service Worker) or manual mocks for API-dependent stories
- Components with complex server dependencies get "presentation-only" stories with mock data props

**Coverage goal**: Every exported component has at least one Storybook story.

---

### Phase 4: Clean up

#### [DELETE] Root `components/` directory
- After migration, remove the now-empty root `components/` directory

#### [MODIFY] [tsconfig.json](file:///Users/shawwalters/eliza-workspace/eliza-cloud-v2/tsconfig.json) (root)
- Remove `@/components/*` path alias (no longer needed)

---

## Verification Plan

### Automated Tests
1. **Existing UI package tests**: `cd packages/ui && bun run test` — ensure existing unit tests still pass
2. **Full build check**: `bun run build` — verify Next.js build succeeds with all import changes
3. **TypeScript check**: `bun run check-types` — verify no type errors
4. **Storybook build**: `cd packages/ui && bun run build-storybook` — verify all stories compile
5. **Existing test suite**: `bun run test` — verify no regressions in unit/integration tests

### Manual Verification
1. **Storybook review**: Run `cd packages/ui && bun run storybook` and visually verify component rendering
2. **App smoke test**: Run `bun run dev` and navigate through key dashboard pages to verify components render correctly

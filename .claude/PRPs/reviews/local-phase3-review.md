# Local Code Review: Phase 3 Stack Upgrade

**Reviewed**: 2026-04-26
**Branch**: phase3-stack-upgrade → main
**Scope**: Full Phase 3 TypeScript migration (150+ files, 4 commits)
**Decision**: REQUEST CHANGES

## Summary

The Phase 3 migration successfully achieves its structural goals: Bun adoption, ethers.js removal, TypeScript scaffolding, GraphQL codegen setup, and a complete `.js`/`.jsx` → `.ts`/`.tsx` rename pass. All automated checks pass (lint: 0 errors, typecheck: 0 errors, tests: 54/54). However, several issues undermine the migration's stated goals — most critically, `"strict": false` in tsconfig neutralises a large portion of the type-safety gains that TypeScript was adopted for.

---

## Findings

### CRITICAL

**None.**

---

### HIGH

#### H1 — `tsconfig.json`: `strict: false` negates the TypeScript migration
**File**: `tsconfig.json` line 14
**Issue**: `"strict": false` disables `strictNullChecks`, `noImplicitAny`, and 6 other guards. This is the root cause of most of the `any` and missing-type issues found across hooks, components, and store slices. If TypeScript is the goal of Phase 3, this setting defeats it.
**Fix**: Set `"strict": true`. This will surface real type errors that need to be resolved — expect ~50–100 errors on first pass, mostly missing return types and implicit nulls.

#### H2 — `src/vite-env.d.ts`: No `ImportMetaEnv` interface — env vars are untyped
**File**: `src/vite-env.d.ts`
**Issue**: `import.meta.env.VITE_*` accesses have no TypeScript backing. This includes the security-critical `VITE_ORACLE_PUBLIC_KEY` — a stale or missing key silently breaks all prompt encryption with no compile-time warning.
**Fix**:
```typescript
interface ImportMetaEnv {
  readonly VITE_CHAIN_ID: string;
  readonly VITE_ORACLE_PUBLIC_KEY: string;
  readonly VITE_THIRDWEB_CLIENT_ID: string;
  readonly VITE_TOKEN_CONTRACT_ADDRESS: string;
  readonly VITE_AGENT_CONTRACT_ADDRESS: string;
  readonly VITE_ESCROW_CONTRACT_ADDRESS: string;
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_FIREBASE_PROJECT_ID: string;
  // add remaining VITE_* vars
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

#### H3 — `src/client.ts`: Duplicate ThirdWeb client instance
**File**: `src/client.ts`
**Issue**: `src/client.ts` calls `createThirdwebClient()` independently and exports a `default client`. `src/config/thirdweb.ts` is the authoritative source and does the same. Two separate client instances exist in the app. The file is defined but the project should use only `src/config/thirdweb.ts`.
**Fix**: Delete `src/client.ts`. Find any `import client from '@/client'` or `import client from '../client'` and redirect to `@/config/thirdweb`.

#### H4 — `src/features/auth/SessionProvider.tsx`: `retry` missing from `useMemo` deps
**File**: `src/features/auth/SessionProvider.tsx` line ~130
**Issue**: The context value memo includes `retry` in the returned object but not in the dependency array. If `retry` changes (e.g. wallet reconnect), consumers get a stale reference.
**Fix**:
```typescript
const value = useMemo(
  () => ({ sessionKey, status, activeWallet, ownerAddress, retry }),
  [sessionKey, status, activeWallet, ownerAddress, retry],  // add retry
);
```

---

### MEDIUM

#### M1 — `console.log` statements throughout production source
**Issue**: `console.log` is prohibited in production code (global rule; Vite strips in prod but they remain in source). Confirmed counts:
- `src/features/usage/ManagePlanModal.tsx`: 22 occurrences
- `src/hooks/useChatMutations.tsx`: 9 occurrences
- `src/hooks/useLiveResponse.ts`: 7 occurrences
- `src/store/chatSlice.ts`: 4 occurrences (some with styled CSS output)
- `src/layouts/components/nav/NavMain.tsx`: at least 1
**Fix**: Remove all `console.log` statements from non-test source files. Replace critical ones with `console.error/warn` where error-tracking is needed (Sentry already captures those).

#### M2 — `any` casts throughout TypeScript migration
Specific high-impact sites:
- `src/components/ai/message.tsx` lines 14, 20, 28: `[key: string]: any` catch-alls on all component interfaces
- `src/features/usage/ManagePlanModal.tsx`: `as any` on contract ABI calls (lines ~207, 236, 244, 307, 312); `onSubmit: (data: any)` — should use `z.infer<typeof schema>`
- `src/hooks/useLiveResponse.ts`: `newEvents.forEach((e: any) =>`, `(args as any).user` — highest risk, this is the real-time event processing path
- `src/config/thirdweb.ts` line ~41: `} as any)` on the entire chain config — bypasses `DefineChain` validation
- `src/lib/faucetService.ts` lines 14–20: `(result.data as any)` three times — define a typed interface
**Fix**: Replace `any` with proper types at each site. ThirdWeb's `ContractEvent<ABI>` generic eliminates the event-arg casts in `useLiveResponse.ts`. Zod inferred types fix `ManagePlanModal.tsx`. `DefineChain` from `thirdweb/chains` fixes `thirdweb.ts`.

#### M3 — Redux store: `initialState` objects lack explicit type annotations
**Files**: `src/store/chatSlice.ts`, `src/store/uiSlice.ts`, `src/store/appSlice.ts`
**Issue**: Without explicit `SliceState` type annotations, action payload types are inferred as `any` from reducer assignments. This weakens type safety across the Redux layer.
**Fix**: Define and export a `State` interface per slice and annotate `initialState: SliceState = { ... }`.

#### M4 — `codegen.ts`: Missing `documents` glob and `typescript-react-query` plugin
**File**: `codegen.ts`
**Issue**: The current config generates scalar types only — no typed query hooks. The Phase 3 plan states "add `typescript-react-query` plugin to auto-generate typed query hooks". The `documents` field pointing to `src/**/*.graphql` and the `typescript-react-query` plugin are both absent.
**Fix**: Add to `codegen.ts`:
```typescript
documents: 'src/**/*.graphql',
plugins: ['typescript', 'typescript-operations', 'typescript-react-query'],
config: {
  fetcher: { endpoint: '...', fetchParams: '...' }
}
```

#### M5 — `src/lib/searchService.ts`: Stale closure on session change
**File**: `src/lib/searchService.ts`
**Issue**: `setInterval(() => syncSearchIndex(sessionKey, ownerAddress), ...)` captures credentials in a closure at setup time. If the session changes without `teardownSearch()` being called, the interval continues with stale credentials. `mergeSearchIndexDeltas` accepts `deltas: unknown[]` then calls `Object.assign()` without shape validation.
**Fix**: Pass credentials as parameters on each tick rather than closing over them, or force `teardownSearch()` before `setupSearch()` on session change. Add runtime shape validation to `mergeSearchIndexDeltas`.

---

### LOW

#### L1 — `src/lib/crypto.ts`: Docstring says "non-extractable" but code uses `extractable: true`
**File**: `src/lib/crypto.ts` lines 2 vs 33
**Issue**: The comment explaining this (`needed for roflEncryptedKey generation`) is present, so this is documentation inconsistency rather than a bug. Update the docstring to match reality.

#### L2 — Migration artifact: Untyped props in several components
**Files**:
- `src/features/auth/Auth.tsx` line 15: `FooterLink({ label, onClick })` — no prop type
- `src/features/history/RenameConversationModal.tsx` line 28: All props destructured without annotation
- `src/layouts/components/nav/NavMain.tsx` line 41: `handleSelectConversation = conversationId =>` — no param type
**Fix**: Add `interface Props` or inline types at each migration artifact site. These are low-effort cleanup items that make the migration complete.

#### L3 — `src/hooks/useLiveResponse.ts`: Comment says "This is a very hacky workaround" 
**Issue**: The comment flags a technical debt item. While not an immediate problem (tests pass), track this for resolution.

---

## Validation Results

| Check | Result |
|-------|--------|
| Type check (`bun run typecheck`) | Pass |
| Lint (`bun run lint`) | Pass |
| Tests (`bun run test`) | Pass (54/54) |
| Build | Not run (no build env vars) |

*Note: typecheck passes only because `strict: false`. With `strict: true` the pass/fail state changes.*

---

## Files Reviewed

### Source (Modified/Added)
- `tsconfig.json` — Modified
- `src/vite-env.d.ts` — Modified
- `src/client.ts` — Added (duplicate, should be removed)
- `src/config/thirdweb.ts` — Modified
- `src/features/auth/SessionProvider.tsx` — Migrated
- `src/features/auth/Auth.tsx` — Migrated
- `src/features/usage/ManagePlanModal.tsx` — Migrated
- `src/features/history/RenameConversationModal.tsx` — Migrated
- `src/hooks/useChatMutations.tsx` — Migrated
- `src/hooks/useLiveResponse.ts` — Migrated
- `src/hooks/useRecentActivity.ts` — Migrated
- `src/hooks/useStuckRequests.ts` — Migrated
- `src/hooks/useFirestoreCollectionListener.ts` — Migrated
- `src/store/chatSlice.ts` — Migrated
- `src/store/uiSlice.ts` — Migrated
- `src/store/appSlice.ts` — Migrated
- `src/lib/crypto.ts` — Migrated
- `src/lib/syncService.ts` — Migrated
- `src/lib/faucetService.ts` — Migrated
- `src/lib/searchService.ts` — Migrated
- `src/lib/graph/query-types.ts` — Added
- `src/components/ai/message.tsx` — Migrated
- `src/components/ui/sidebar.tsx` — Migrated
- `src/components/ui/scroll-area.tsx` — Migrated
- `src/layouts/components/nav/NavMain.tsx` — Migrated
- `codegen.ts` — Added

### Tests
- `src/hooks/useChatMutations.errors.test.ts` — Added

### Config
- `package.json` — Modified (Bun, viem, remove ethers)
- `.eslintrc.json` — Modified
- `.gitignore` — Modified

---

## Priority Order

1. **H2** — Add `ImportMetaEnv` to `vite-env.d.ts` (quick win, high safety impact)
2. **H3** — Delete `src/client.ts` (remove dead/duplicate code)
3. **H4** — Fix `retry` in `SessionProvider` useMemo deps (correctness bug)
4. **M1** — Strip all `console.log` from production source (global rule compliance)
5. **H1** — Enable `strict: true` in tsconfig (unlock real TypeScript safety; fix resulting errors)
6. **M2** — Replace `any` casts (incremental, can batch by file)
7. **M3** — Type Redux `initialState` objects
8. **M4** — Complete `codegen.ts` for typed query hooks
9. **L1** — Fix `crypto.ts` docstring (non-extractable vs extractable)
10. **L2** — Type untyped props in migration artifact components
11. **L3** — Annotate the "hacky workaround" in `useLiveResponse.ts` with a TODO tracking comment

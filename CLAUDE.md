# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Frontend dApp for SenseAI — the AI Agent providing sentiment and fundamental on-chain analysis for Tradable. Deployed at `senseai.tradable.app`.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start dev server on port 3002 (localnet mode) |
| `npm run dev:testnet` | Dev server against Base Sepolia testnet |
| `npm run build` | Production build (mainnet) |
| `npm run build:testnet` | Build against testnet |
| `npm run lint` / `npm run lint:fix` | ESLint |
| `npm run format` | Prettier |
| `npm run sync-contracts` | Copy ABI files from `able-contracts` and `tokenized-ai-agent` repos |

No test suite configured — validate via `npm run build` and browser testing.

## Architecture

### Provider Stack (`src/main.jsx`)

Providers wrap the app in this order (innermost first in terms of dependency):
`BrowserRouter` → `ThirdwebProvider` → Redux `Provider` → `QueryClientProvider` → `PostHogProvider` → `ThemeProvider` → `SessionProvider`

### Route Structure (`src/pages/App.jsx`)

Public routes: `/auth`, `/error`, `/privacy-policy`, `/terms-and-conditions`, `/website-disclaimer`

Protected routes (require wallet + session): `/` → `UsageDashboard`, `/chat` → `Chat`, `/history` → `History`

All feature pages are lazy-loaded. App waits for Firebase and Thirdweb to initialize before rendering (shows `SplashScreen` until `appStatus === 'ready'`).

### Auth & Session Flow

1. Thirdweb manages wallet connection (supports in-app wallets and external wallets like MetaMask).
2. `SessionProvider` (`src/features/auth/SessionProvider.jsx`) derives a `sessionKey` (Web Crypto `CryptoKey`) by asking the user to sign a fixed message, then passing the signature through `deriveKeyFromEntropy` (`src/lib/crypto.js`). The key is held in React state — never persisted.
3. `useSession()` provides `{ sessionKey, status, ownerAddress, activeWallet }` throughout the app. Status values: `disconnected | deriving | ready | rejected | error`.

### Data Layer

All conversation and message data is encrypted client-side with the user's `sessionKey` using AES-GCM before being stored in **IndexedDB** (via Dexie, `src/lib/db.js`). The DB schema has three tables: `conversations`, `messageCache`, `searchIndex`.

**`src/lib/dataService.js`** — all IndexedDB read/write operations. Functions encrypt/decrypt on every access.

**TanStack Query** (`@tanstack/react-query`) manages server/blockchain state. Query keys follow the pattern `['conversations', sessionKey, ownerAddress]` and `['messages', conversationId, sessionKey, ownerAddress]`. The `sessionKey` in query keys ensures data isolation between wallets.

**`src/hooks/useLiveResponse.js`** — subscribes to on-chain events (via `useContractEvents` from Thirdweb) and orchestrates a retry/backoff sync queue that invalidates TanStack Query caches when blockchain state changes. This is the real-time update mechanism.

### Blockchain Interaction Pattern

All write operations go through `src/hooks/useChatMutations.jsx`. Every mutation:
1. Symmetrically encrypts the payload with the user's `sessionKey`.
2. Asymmetrically encrypts the session key for the TEE oracle using `VITE_ORACLE_PUBLIC_KEY`.
3. Calls a contract method on `EVMAIAgentEscrow` via Thirdweb (`sendAndConfirmTransaction`).
4. Parses the transaction receipt logs to extract on-chain IDs returned by the contract.

Contracts are configured in `src/config/contracts.js` keyed by `chainId`, populated from Vite env vars (`VITE_CHAIN_ID`, `VITE_TOKEN_CONTRACT_ADDRESS`, `VITE_AGENT_CONTRACT_ADDRESS`, `VITE_ESCROW_CONTRACT_ADDRESS`). ABIs live in `src/lib/abi/`.

### Redux Store (`src/store/`)

| Slice | Responsibility |
|-------|---------------|
| `appSlice` | Firebase/Thirdweb init status, app-level errors |
| `chatSlice` | Active conversation ID, in-memory messages, rename modal state |
| `deviceSlice` | Screen dimensions, orientation, PWA/Telegram detection |
| `uiSlice` | UI-level state (sidebar, modals) |
| `asyncSlice` | Async operation tracking |

### Feature Modules (`src/features/`)

Each feature is self-contained with its own components:
- `auth/` — wallet connect screen, protected route guard, session key derivation
- `chat/` — main chat interface, submits prompts via `useChatMutations`
- `history/` — conversation list with rename/delete
- `usage/` — spending plan management (allowance, limits, recent activity)
- `market/` — market pulse display
- `onboarding/` — first-time user flow
- `legal/` — privacy, terms, disclaimer pages and modals

### Key Hooks (`src/hooks/`)

- `useChatMutations` — all blockchain write operations (prompt, regenerate, branch, metadata, cancel, refund)
- `useLiveResponse` — real-time blockchain event listener and query invalidation
- `useConversations` / `useUsagePlan` / `useTokenBalance` — TanStack Query wrappers for on-chain reads
- `useFirestoreDocumentListener` / `useFirestoreCollectionListener` — Firebase Firestore real-time listeners
- `useStuckRequests` — detects pending prompts older than 1 hour eligible for refund

### Path Aliases

`@/` maps to `src/` — always use this alias for imports, never relative paths that traverse directories.

### Multi-Environment Build

Vite modes: `localnet` (chain 31337/Hardhat), `testnet` (chain 84532/Base Sepolia), `mainnet`. Each mode loads a different `.env.*` file. Run `sync-contracts` whenever ABIs change in sibling repos.

Production builds strip `console.log/info/debug` but keep `console.error/warn` for Sentry.

## Cross-Repo Context

This dApp is the user-facing layer of the SenseAI stack. It depends on three sibling repos:

| Sibling | Role |
|---------|------|
| `tokenized-ai-agent` | Provides `EVMAIAgent` and `EVMAIAgentEscrow` contracts that handle all writes |
| `sense-ai-subgraph` | Provides the GraphQL API for all read queries (conversations, messages, prompt status, activity) |
| `able-contracts` | Provides `AbleToken` — the ERC20 payment token users must approve before prompting |

### ABI Sync Process

ABIs in `src/lib/abi/` are not hand-maintained — they are synced from compiled contract artifacts:

```bash
# 1. Compile contracts in their repos (required first)
cd ../able-contracts && npm run compile
cd ../tokenized-ai-agent && npm run compile

# 2. Sync ABIs into this repo
npm run sync-contracts
```

Run this whenever contracts change. Stale ABIs produce silent parse failures when reading on-chain events.

### Critical ABI Contract

`PromptSubmitted` event param order (enforced by contract tests in `tokenized-ai-agent`):
```
(address indexed user, uint256 indexed conversationId, uint256 indexed promptMessageId,
 uint256 answerMessageId, bytes encryptedPayload, bytes roflEncryptedKey)
```
`answerMessageId` is at **param index 3** (0-based, non-indexed). `useChatMutations.jsx` reads it at this index from the receipt log. If this ever changes, both the subgraph and dApp must be updated in lockstep.

### Protocol Constants

| Constant | Value | Where used |
|----------|-------|-----------|
| `CANCELLATION_TIMEOUT_MS` | 3 000 ms (3 s) | Cancel button disable countdown |
| `REFUND_TIMEOUT_MS` | 3 600 000 ms (1 h) | Refund eligibility display |

These are hardcoded in `EVMAIAgentEscrow`. Do not guess at them — verify against the contract.

### VITE_ORACLE_PUBLIC_KEY

`VITE_ORACLE_PUBLIC_KEY` must match the public key of the active ROFL TEE oracle instance. If this key is stale or missing, `createEncryptedPayloads()` either fails silently or produces ciphertext the oracle cannot decrypt — prompts are submitted on-chain but never answered. Validate this key is present and current whenever the oracle is redeployed.

### Ethers.js Note

`ethers` v6 is currently listed as a direct dependency but is functionally redundant alongside ThirdWeb v5, which is built on viem internally. Removing it is planned for Phase 3.

## Phase 3 Planned Upgrades

The following changes are planned for `sense-ai-dapp` after Phase 2 is merged:

| Change | Detail |
|--------|--------|
| **Bun** | Replace `npm` with Bun. Update lockfile and scripts. |
| **viem** | Add as explicit direct dependency (ThirdWeb v5 exposes viem's ABI utils; explicit dep makes tree-shaking clear and allows direct use). |
| **Remove ethers.js** | Remove `ethers` from `package.json` and all import sites. Replace with ThirdWeb v5 / viem equivalents. |
| **TypeScript migration** | Migrate from `.jsx`/`.js` to `.tsx`/`.ts`. Add `tsconfig.json`. |
| **GraphQL codegen** | Add `@graphql-codegen/cli` to auto-generate typed query hooks from `schema.graphql` + `.graphql` query files. |
| **NO wagmi** | ThirdWeb v5 already ships wagmi-equivalent React hooks. Do not add wagmi as a separate dependency. |

Vitest remains the test runner after Phase 3 — it integrates with the Vite pipeline (aliases, plugins, env). Bun adoption brings speed to install/run via `bun run vitest` without needing to change the test framework.

## MCP Tools

Tradable ClickUp MCP is available in this project for task management.

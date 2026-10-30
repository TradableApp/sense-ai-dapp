# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Frontend dApp for SenseAI — the AI Agent providing sentiment and fundamental on-chain analysis for Tradable. Deployed at `senseai.tradable.app`.

## Scripts

| Command                                | Purpose                                                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------- |
| `bun run dev`                          | Start dev server on port 3002 (localnet mode)                                            |
| `bun run dev:testnet`                  | Dev server against Base Sepolia testnet                                                  |
| `bun run build`                        | Disabled (exits 1) — name the mode: `build:localnet` / `build:testnet` / `build:mainnet` |
| `bun run build:testnet`                | Build against testnet                                                                    |
| `bun run deploy:testnet`               | `build:testnet` + `firebase deploy --project local` (tradable-app-garrick)               |
| `bun run deploy:mainnet`               | Guarded: needs `DEPLOY_MAINNET_CONFIRMED=1`; `build:mainnet` + deploy `--project prod`   |
| `bun run lint` / `bun run lint:fix`    | ESLint                                                                                   |
| `bun run format`                       | Prettier                                                                                 |
| `bun run sync-contracts`               | Copy ABI files from `able-contracts` and `tokenized-ai-agent` repos                      |
| `bun run test`                         | Vitest unit tests + the `e2e/__guards__/` static guards                                  |
| `bun run typecheck:e2e`                | Type-check the Playwright suite (separate tsconfig)                                      |
| `bun run test:e2e`                     | Playwright — **see the warning below before running this directly**                      |
| `bun run test:e2e:testnet`             | The `testnet` Playwright project against Base Sepolia — only via the sense-ai-e2e runner |
| `bun run e2e:testnet:fund\|key\|sweep` | Ephemeral-account tooling the runner calls (`e2e/testnet/`); never by hand on a run day  |

## Testing

Two suites, two runners:

- **Vitest** (`bun run test`) — unit tests under `src/`, plus the static guards in
  `e2e/__guards__/`. Runs in CI on every push.
- **Playwright** (`e2e/specs/`) — full-stack e2e against a live localnet (Hardhat + contracts +
  mock oracle + graph-node + IPFS). **Not run in CI at all** — a local run is the only place the
  full stack is exercised.

**Before writing, moving, or debugging any e2e spec, read
[`docs/E2E-ISOLATION-MODEL.md`](docs/E2E-ISOLATION-MODEL.md).** It is short, and it exists
because the isolation rules are not guessable: `evm_revert` permanently wedges graph-node and
freezes the subgraph, so a snapshot in one spec silently breaks _other_ spec files in a way that
looks like flakiness.

**Do not run `bunx playwright test` over the whole suite for a verdict** — use the supported
protocol, which must be started inside tmux (the runner refuses otherwise):

```bash
cd ../sense-ai-e2e && tmux new-session -s e2e 'bash scripts/run-e2e-sharded.sh'
```

**Testnet mode** runs the same specs against the real Base Sepolia stack through the chain
adapter (`e2e/helpers/chain.ts`): seed-derived accounts funded by a treasury, Node-side signing,
no dev-node RPC methods. It is driven only by `sense-ai-e2e/scripts/testnet/run-e2e-testnet.sh`
(real model calls, real test gas). What runs and what is excluded, with reasons, is in
`e2e/CAPABILITIES.md` under "Testnet mode". Specs gate on `LIVE_STACK` from the adapter, never on
`process.env.E2E_LOCAL_SERVICES` (the `live-stack-gate` guard enforces this).

A single `playwright test` invocation reproduces the wedge described above. The tmux
requirement is because the run takes ~70 minutes and owns the ports, chain and Docker stack
throughout — if the caller dies (closed terminal, dropped SSH, an agent harness reaping its
child) the run dies partway and leaves the stack up. Detach with `Ctrl-b d`; it keeps running.

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

**`src/lib/payloadStorage.ts`** — the only module that fetches payload bytes by CID. Source order for Autonomys ids is the per-network GCS mirror (`VITE_PAYLOAD_MIRROR_URL`, written through by the oracle at upload time) and then the Autonomys gateway; legacy Arweave ids go to the Irys gateway only; 404 skips to the next source, 5xx/429/network errors retry with the shared jittered backoff, and callers get a typed `not-found | unavailable | unsupported-cid` result. `syncWithRemote` returns `{ unavailablePayloads }`, holds the sync cursor while anything was unavailable (so The Graph re-serves it next pass) and `useConversations` turns the count into the `storageDegraded` UI flag behind `StorageUnavailableBanner`. The `e2e/__guards__/no-raw-storage-gateways` guard forbids the gateway host names anywhere else in `src/`.

**TanStack Query** (`@tanstack/react-query`) manages server/blockchain state. The conversations key includes `sessionKey` for per-wallet data isolation: `['conversations', sessionKey, ownerAddress]`. The **messages** key does NOT include `sessionKey` — it is `['messages', conversationId, ownerAddress]` (see `Chat.tsx` / `useLiveResponse.ts`). Any code invalidating the messages query MUST use this exact key; adding `sessionKey` makes the invalidation a silent no-op (which previously stranded cancelled-prompt placeholders).

**`src/hooks/useLiveResponse.ts`** — the real-time update mechanism. It does NOT watch contract logs: on Base's public RPC that is one `eth_getLogs` per event per block (the #77 429 storm) and mainnet.base.org refuses `eth_getLogs` outright. Instead `src/hooks/liveStateProbe.ts` polls two `eth_call`s once per block (`pendingEscrowCount(user)`, `spendingLimits(user)`) batched into one request, and a change drives the retry/backoff sync queue that invalidates TanStack Query caches. Backoff on 429, pause while hidden. The `e2e/__guards__/no-log-watchers` guard forbids reintroducing `useContractEvents`.

### PWA Updates

The service worker is registered in `prompt` mode (`vite.config.ts`), never the self-reloading mode — the `e2e/__guards__/pwa-prompt-mode` guard pins this. `src/components/UpdatePrompt.tsx` (mounted next to the `Toaster` in `main.tsx`) turns a waiting worker into a "new version" toast whose Reload action calls `updateServiceWorker(true)`. The toast is deferred, or withdrawn, while `useIsMutating() > 0` or the session status is `deriving`, so a reload can never abort a wallet signature. `src/lib/staleChunkReload.ts` is the separate crash-recovery path for a lazy chunk that 404s after a deploy. Under vitest the virtual register module resolves to `src/test/pwaRegisterStub.ts`.

### Blockchain Interaction Pattern

All write operations go through `src/hooks/useChatMutations.jsx`. Every mutation:

1. Symmetrically encrypts the payload with the user's `sessionKey`.
2. Asymmetrically encrypts the session key for the TEE oracle using `VITE_ORACLE_PUBLIC_KEY`.
3. Calls a contract method on `EVMAIAgentEscrow` via Thirdweb (`sendAndConfirmTransaction`).
4. Parses the transaction receipt logs to extract on-chain IDs returned by the contract.

Contracts are configured in `src/config/contracts.js` keyed by `chainId`, populated from Vite env vars (`VITE_CHAIN_ID`, `VITE_TOKEN_CONTRACT_ADDRESS`, `VITE_AGENT_CONTRACT_ADDRESS`, `VITE_ESCROW_CONTRACT_ADDRESS`). ABIs live in `src/lib/abi/`.

### Redux Store (`src/store/`)

| Slice         | Responsibility                                                 |
| ------------- | -------------------------------------------------------------- |
| `appSlice`    | Firebase/Thirdweb init status, app-level errors                |
| `chatSlice`   | Active conversation ID, in-memory messages, rename modal state |
| `deviceSlice` | Screen dimensions, orientation, PWA/Telegram detection         |
| `uiSlice`     | UI-level state (sidebar, modals)                               |
| `asyncSlice`  | Async operation tracking                                       |

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
- `useLiveResponse` — real-time on-chain state poller (no log watching) and query invalidation
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

| Sibling              | Role                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| `tokenized-ai-agent` | Provides `EVMAIAgent` and `EVMAIAgentEscrow` contracts that handle all writes                    |
| `sense-ai-subgraph`  | Provides the GraphQL API for all read queries (conversations, messages, prompt status, activity) |
| `able-contracts`     | Provides `AbleToken` — the ERC20 payment token users must approve before prompting               |

### ABI Sync Process

ABIs in `src/lib/abi/` are not hand-maintained — they are synced from compiled contract artifacts:

```bash
# 1. Compile contracts in their repos (required first)
cd ../able-contracts && bun run compile
cd ../tokenized-ai-agent && bun run compile

# 2. Sync ABIs into this repo
bun run sync-contracts
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

| Constant                  | Value              | Where used                      |
| ------------------------- | ------------------ | ------------------------------- |
| `CANCELLATION_TIMEOUT_MS` | 3 000 ms (3 s)     | Cancel button disable countdown |
| `REFUND_TIMEOUT_MS`       | 3 600 000 ms (1 h) | Refund eligibility display      |

These are hardcoded in `EVMAIAgentEscrow`. Do not guess at them — verify against the contract.

### VITE_ORACLE_PUBLIC_KEY

`VITE_ORACLE_PUBLIC_KEY` must match the public key of the active ROFL TEE oracle instance. If this key is stale or missing, `createEncryptedPayloads()` either fails silently or produces ciphertext the oracle cannot decrypt — prompts are submitted on-chain but never answered. Validate this key is present and current whenever the oracle is redeployed.

### Ethers.js Note

`ethers` v6 is currently listed as a direct dependency but is functionally redundant alongside ThirdWeb v5, which is built on viem internally. Removing it is planned for Phase 3.

## Phase 3 Planned Upgrades

The following changes are planned for `sense-ai-dapp` after Phase 2 is merged:

| Change                   | Detail                                                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Bun**                  | ✅ Done — `npm` replaced with Bun (`bun.lock` committed, CI runs on Bun 1.3.14).                                                       |
| **viem**                 | Add as explicit direct dependency (ThirdWeb v5 exposes viem's ABI utils; explicit dep makes tree-shaking clear and allows direct use). |
| **Remove ethers.js**     | Remove `ethers` from `package.json` and all import sites. Replace with ThirdWeb v5 / viem equivalents.                                 |
| **TypeScript migration** | Migrate from `.jsx`/`.js` to `.tsx`/`.ts`. Add `tsconfig.json`.                                                                        |
| **GraphQL codegen**      | Add `@graphql-codegen/cli` to auto-generate typed query hooks from `schema.graphql` + `.graphql` query files.                          |
| **NO wagmi**             | ThirdWeb v5 already ships wagmi-equivalent React hooks. Do not add wagmi as a separate dependency.                                     |

Vitest remains the test runner after Phase 3 — it integrates with the Vite pipeline (aliases, plugins, env). Bun adoption brings speed to install/run via `bun run vitest` without needing to change the test framework.

## MCP Tools

Tradable ClickUp MCP is available in this project for task management.

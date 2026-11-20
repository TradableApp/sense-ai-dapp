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
| `bun run sync-contracts`               | Copy ABI files from `able-contracts`, `sense-contracts` and `tokenized-ai-agent`         |
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

All conversation and message data is encrypted client-side with the user's `sessionKey` using AES-GCM before being stored in **IndexedDB** (via Dexie, `src/lib/db.ts`). The DB schema has four tables: `conversations`, `messageCache`, `searchIndex` and `userMetadata` (the sync cursor).

There is one database per agent contract, named `SenseAI:<chainId>:<agent address>` by `src/lib/localStoreName.ts`. Conversation ids are counted by the agent, so a newly deployed agent starts again at 1; in a shared database a returning wallet would see the two agents' conversations merged and the old sync cursor would hide the new history. A missing or malformed chain id or agent address throws instead of naming a shared store, and `vite.config.ts` runs the same rule (`assertLocalStoreConfig`, which calls the function the browser calls) so a build or dev server stops with the reason rather than shipping a blank page; the reason says what was expected and describes the refused value by its shape only (empty, length, `0x` prefix, all hex), so a key pasted into the wrong setting is never printed (Vitest has its own configuration and does not run it; and when a running dev server is restarted by an edited settings file that fails the check, Vite prints the reason and keeps serving the old settings): the store module is in the first bundle, ahead of Sentry and the error boundary. A localnet build or a unit-test run with no agent address (the browser tests that run against no contracts; a test that loads the module unmocked) uses `SenseAI:localnet:unconfigured`. The `e2e/__guards__/local-store-per-agent` guard allows the Dexie library to be loaded only in `src/lib/db.ts` (type imports aside), one database there named from the build's chain id and agent address by `resolveLocalStoreName` imported from `localStoreName` (a local function of that name fails it), and requires the check in `vite.config.ts`. The `e2e/__guards__/build-config-checks` test runs the real Vite configuration, so a check still written there but no longer reached fails too. A localnet redeploy puts the agent at the same address, so after a chain reset clear the site data in a browser that was used before it. A database from before this naming (`SenseAI`) is neither read nor deleted; the wallet's history is synced again from the subgraph.

**`src/lib/dataService.ts`** — all IndexedDB read/write operations. Functions encrypt/decrypt on every access.

**`src/lib/messageCacheStore.ts`** — `writeMessageCache`, the only writer of the `messageCache` table. A prompt being sent, a sync, a branch rebuilding its history and a cancel all change the same stored list; each passes a merge function, and the write happens only if the row is still the one the merge was given (checked and put inside one IndexedDB transaction, merged again otherwise). Encryption stays outside the transaction, because IndexedDB commits a transaction left waiting on Web Crypto. Nothing is evicted: the local store is a full copy of what has been synced. Stored data that cannot be read is left alone unless the writer passes `replaceUnreadable` (the sync, a send, a new branch), so the sync still sees the conversation as unfinished and restores it. The `e2e/__guards__/message-cache-single-writer` guard lists the uses of the table allowed elsewhere (`get`, `where(...).toArray()`, `delete`) and fails on any other mention of it.

**`src/features/chat/promptParent.ts`** — whether a prompt can be sent and what it threads off (`composerStateFor`: `ready`, `loading` or `hold`). A branch's prompt is never flagged as a new conversation, and a branch that shows no messages is held: its history is not on this device, and a prompt sent then would lose the branch's origin. While held, `useHeldBranchRefresh` re-reads the branch's messages every 15 s and asks for a sync every 60 s. The wait lasts from `hold` until `ready` and is not ended by the `loading` each re-read passes through; ending it there would restart both timers every 15 s, and the longer one would never fire. Opening another conversation ends it (the state is kept per conversation), and nothing is asked for while the page is hidden.

**`src/lib/payloadStorage.ts`** — the only module that fetches payload bytes by CID. Source order for Autonomys ids is the per-network GCS mirror (`VITE_PAYLOAD_MIRROR_URL`, written through by the oracle at upload time) and then the Autonomys gateway; legacy Arweave ids go to the Irys gateway only; 404 skips to the next source, 5xx/429/network errors retry with the shared jittered backoff, and callers get a typed `not-found | unavailable | unsupported-cid` result. `syncWithRemote` returns `{ unavailablePayloads }`, holds the sync cursor while anything was unavailable (so The Graph re-serves it next pass) and `useConversations` turns the count into the `storageDegraded` UI flag behind `StorageUnavailableBanner`. The `e2e/__guards__/no-raw-storage-gateways` guard forbids the gateway host names anywhere else in `src/`.

**TanStack Query** (`@tanstack/react-query`) manages server/blockchain state. The conversations key includes `sessionKey` for per-wallet data isolation: `['conversations', sessionKey, ownerAddress]`. The **messages** key does NOT include `sessionKey` — it is `['messages', conversationId, ownerAddress]` (see `Chat.tsx` / `useLiveResponse.ts`). Any code invalidating the messages query MUST use this exact key; adding `sessionKey` makes the invalidation a silent no-op (which previously stranded cancelled-prompt placeholders).

**`src/hooks/useLiveResponse.ts`** — the real-time update mechanism. It does NOT watch contract logs: on Base's public RPC that is one `eth_getLogs` per event per block (the #77 429 storm) and mainnet.base.org refuses `eth_getLogs` outright. Instead `src/hooks/liveStateProbe.ts` polls two `eth_call`s once per block (`pendingEscrowCount(user)`, `spendingLimits(user)`) batched into one request, and a change drives the retry/backoff sync queue that invalidates TanStack Query caches. Backoff on 429, pause while hidden. The `e2e/__guards__/no-log-watchers` guard forbids reintroducing `useContractEvents`.

### PWA Updates

The service worker is registered in `prompt` mode (`vite.config.ts`), never the self-reloading mode — the `e2e/__guards__/pwa-prompt-mode` guard pins this. `src/components/UpdatePrompt.tsx` (mounted next to the `Toaster` in `main.tsx`) turns a waiting worker into a "new version" toast whose Reload action calls `updateServiceWorker(true)`. The toast is deferred, or withdrawn, while `useIsMutating() > 0` or the session status is `deriving`, so a reload can never abort a wallet signature. `src/lib/staleChunkReload.ts` is the separate crash-recovery path for a lazy chunk that 404s after a deploy. Under vitest the virtual register module resolves to `src/test/pwaRegisterStub.ts`.

### Blockchain Interaction Pattern

All write operations go through `src/hooks/useChatMutations.tsx`. Every mutation:

1. Symmetrically encrypts the payload with the user's `sessionKey`.
2. Asymmetrically encrypts the session key for the TEE oracle using `VITE_ORACLE_PUBLIC_KEY`.
3. Calls a contract method on `EVMAIAgentEscrow` via Thirdweb (`sendAndConfirmTransaction`).
4. Parses the transaction receipt logs to extract on-chain IDs returned by the contract.

**One paid send at a time (`src/features/chat/useOneSendAtATime.ts`)** — the chat takes its mutations through this hook, never from `useChatMutations()` directly. The three that send a paid prompt (a prompt or a resent edit, regenerate, branch) carry a mutation key starting `'paid-send'`, and their `mutate` does nothing while a send is under way; `mutateAsync` is not offered. A send is under way from the moment it starts (read from the query client's mutation cache, so a second press in the same moment is refused and the lock is still there when the chat is left and opened again) until the chat's own `onSuccess` has finished writing the prompt to the local store, since only then is the composer cleared and the answer shown as awaited. `isSending` is true for the same span, and the edit box and an answer's actions are off with the reason in `src/components/ai/sendingReason.ts`. Cancel and refund are not part of it. The `e2e/__guards__/one-send-at-a-time` guard requires each wrapped mutation to be declared with the key, no other mutation to have it, no other source file to name a wrapped mutation, and the chat to pass the flag on.

**Fee token (`src/config/feeToken.ts`)** — which token pays the fees is a build setting, `VITE_FEE_TOKEN`, exactly `SENSE` or `ABLE`. A build or dev server in any mode, localnet included, stops unless it is set (`assertFeeTokenConfig` in `src/config/feeTokenConfig.ts`, called from `vite.config.ts`; the e2e harness's sync always writes it on localnet); a misspelt value stops everywhere, and the message describes the refused value by its shape only (`describeShape` in `src/lib/settingShape.ts`, shared with the store check), never the value. Only the unit tests fall back to `SENSE` when it is unset. The fallback is not safe for a deployed build: `SENSE` settings on another token mean a wrong label, no value shown and a first offer to approve the whole balance.

The setting selects a profile: symbol, name, logo, ABI, decimals, whether a market value may be shown (`showsMarketValue`, with `plannedPriceUsd` for test-chain estimates), whether the wallet panel offers send and buy (`transferable`, `purchasable`), whether its owner can pause it (`pausable`, which the fee token check asks), and the default plan limit (`fixed`, or the wallet's balance, which the plan dialog labels "your full balance", or "your balance in whole tokens" when a fraction is left out, while that offer stands: `fullBalanceLabel`). A wallet holding less than the plan's first offer of a token that is neither `purchasable` nor `transferable`, on a chain with no faucet, is pointed to SenseAI on X and the SenseAI Telegram group (`pointsToCommunity` in `src/lib/whereToGetToken.ts`; the links live only in `src/config/communityLinks.ts`, shown by `CommunityLinksNotice` in the plan dialog and, with no faucet to offer, in the insufficient-balance toast's `InsufficientBalanceNotice`). Components read `FEE_TOKEN` and never test for a particular token, so a build for the other token changes only the setting; `feeToken.test.ts` pins both profiles. No price is fetched or shown when `showsMarketValue` is false (`shouldFetchMarketPrice` in `useTokenPrice.ts`; `PlanValueEstimate.tsx` renders nothing and never mounts the price hook). The four connected-wallet buttons share `src/config/walletPanel.ts` (the `wallet-panel-shared` guard); hiding send and buy hides them for every asset in that panel, which is deliberate. The `e2e/__guards__/fee-token-literals` guard forbids a token's name (on its own, glued to letters, or joined by a dash or underscore in lower case) anywhere in `src/`, stylesheets included, outside the two fee token modules and the ABIs, comments included, and in `index.html`, `vite.config.ts` and the text files under `public/` (images and fonts are skipped by extension). In `src/vite-env.d.ts` only the doc comment (one line or several) ending just above the `VITE_FEE_TOKEN` declaration, which documents the setting's two values, may name them.

**Fee token check (`src/lib/feeTokenCheck.ts`, `src/hooks/useFeeTokenCheck.ts`)** — the build setting and the escrow's stored token are not tied together by anything, so with a wallet connected the dApp reads the chain and compares, in this order, one read at a time: the code at the escrow address; the escrow's token (its getter name is spelled only in `feeTokenConfig.ts`) against `VITE_TOKEN_CONTRACT_ADDRESS`; the escrow's `evmAIAgent()` against the chain's configured agent (`CONTRACTS[chainId].agent.address`; with none configured nothing is read and the state is `unknown`); the code at the token address; the token's on-chain symbol against the profile's; `paused()`, only when the profile is `pausable`; and, for a token that is not `transferable`, `isTransferExempt` for the escrow and for the treasury the escrow holds. The order matters: a restricted-token build pointed at an ordinary token cannot be asked about listings (the read reverts), and its symbol is the answer. Code is read with `eth_getCode` from `thirdweb/rpc`, not thirdweb's bytecode helpers, which keep an answer; only `0x` (or `0x` and zeros) means no contract, and anything that is not hex is no answer. An empty answer is read once more before it counts (a lagging backend behind a load-balanced node can answer `0x` for a deployed contract): code on the second read carries on, a failed or non-hex second read is no answer, and only two empty answers in a row give `contract-not-found`. An address whose first answer has code is read once. It guards against a mistake in setting up a build or a deployment, not against a hostile build: the addresses it checks come from the same build. `blocksAction(state, action)` says what each verdict switches off. `contract-not-found` (no code at the escrow or the token), `escrow-uses-other-token`, `escrow-serves-other-agent` (a prompt would be paid for and never answered), `symbol-mismatch`, `token-paused` and `escrow-not-exempt` stop every paying action (`prompt`, which covers regenerate and a resent edit; `plan`; `branch`; `metadata`, which is rename and delete). `treasury-not-exempt` stops only `branch` and `metadata`: a prompt goes user to escrow to treasury and a restricted token allows a transfer when either end is listed, so prompts and plans still work. Cancel and refund are never switched off, though the token may itself refuse them (cancel pays its fee to the treasury; a refund leaves the escrow); a paused token refuses both, and the `token-paused` banner says so and that the payment stays with the escrow. The `treasury-not-exempt` banner says a cancellation will be refused (its fee goes from the user straight to the treasury) and that an unanswered prompt can be refunded after an hour; the `escrow-not-exempt` banner says cancelling and refunds are refused too (both pay out of the escrow). The gate is in `useChatMutations` and, for a plan, in `src/features/usage/usePlanMutations.ts` (setting a plan asks the check inside its mutation; revoking never asks): each paying `mutationFn` in `useChatMutations` calls `refuseIfSwitchedOff(action)`, and setting a plan runs `if (feeTokenCheck.blocks('plan')) throw new FeeTokenBlockedError(…)`, before anything is sent and the error handler shows the banner's words (`FeeTokenBlockedError`'s message is the banner's title and description, so the rename dialog shows them too); `useChatMutations.gate.test.tsx` and `usePlanMutations.test.tsx` drive the real mutations under every state and prove nothing is encrypted, prepared or sent. The composer and the plan dialog's submit are also disabled, and so is every other control for a switched-off action, with the reason as its tooltip and accessible description; the icon buttons, the history menu items and the delete confirmation's Continue are marked with `aria-disabled`, not the native attribute or Radix's `disabled`, so they stay in the Tab and arrow-key order and show the reason on focus, and their click does nothing (`useSwitchedOffReason(action)`, worded by `switchedOffReason` in `src/lib/feeTokenRefusal.ts`, shown by `SwitchedOffButton`): regenerate and the branch menu on an answer, edit on a prompt and the save of an edit, rename and delete in the history menu (`ConversationActionsMenu`, where the switched-off reason comes before the user's own) and the rename dialog's submit. The cancel and refund buttons never ask. `FeeTokenMismatchBanner` (nothing to click) says what is off: it is in `MainLayout`, and because a modal dialog's backdrop hides the page's banner, the plan, rename and delete confirmation dialogs (`DeleteConversationDialog`) mount it themselves and their reasons point at the notice above (`useSwitchedOffReason(action, 'dialog')`). No answer is not a disagreement: before the first answer, or when the first read fails or returns something the contract does not declare, the state is `unknown` and nothing is stopped, with one exception: setting a plan approves the token, so the plan dialog's submit and `usePlanMutations` hold it while `useIsAwaitingFirstAnswer()` is true (the check can read this chain and has never answered; the submit is `aria-disabled` with `AWAITING_CHECK_REASON` as its description, and revoking is never held). While held, the check is asked again every `AWAITING_RECHECK_MS` (5 s) while the page is visible, and at once when the held submit is pressed (`useAskFeeTokenAgain`); a refusal or hold is titled "Not sent". Once any answer has come it is not held again, since the query keeps its last answer; where the check reads nothing (no wallet, or no contracts or agent for the chain) nothing will ever answer, so the plan is not held there. A failed read is rethrown, so the query retries it and keeps its last answer: a confirmed block stays until a read passes. The report does not carry the original error (thirdweb's batch text holds the RPC URL and the other calls in the batch, which can hold the wallet address): `src/lib/feeTokenCheckFailure.ts` sorts it into a kind (`invalid-reading`, `zero-data`, `rpc`, `node`, `no-contracts`, `other`) and keeps its first line with URLs as `<url>` (any scheme; with none, a host with a port, a path or a query, a user part before a host, and a bracketed IPv6 literal), `0x` or `0X` plus nine or more hex digits and sixteen or more bare hex digits (an underscore before them does not hide them) as `<hex>`, capped at 120 characters; a bare four-byte selector (`0x` and exactly eight) is kept, since that is how a token's error arrives from a public node, and so is a source file with its line and column; JSON-escaped slashes and a percent-encoded colon, slash or at sign are read as plain before matching; it never throws (anything it cannot read is `other` with no line). A new `FeeTokenCheckFailure` carrying only that is sent once per page load per chain and kind (tags `check: fee-token` and `failure: <kind>`, fingerprinted by kind). The same scrub (`src/lib/scrubSecrets.ts`) runs on every Sentry breadcrumb (`scrubBreadcrumb` in `src/config/sentry.ts`, as `beforeBreadcrumb`): console lines and fetch and XHR requests keep their message and string data scrubbed, nested data such as a console line's raw arguments is dropped, and a breadcrumb that cannot be read is dropped. Every error and transaction event is scrubbed too (`src/config/sentryEvent.ts`, as `beforeSend` and `beforeSendTransaction`): exception values, message, log entry, transaction name, request URL and headers, the string values of extra and each context, and each span's description and data; nested data, the log entry's parameters, the request body and the query string are dropped, stack frames and exception types are kept, and an event that cannot be read is dropped whole. The scrub reads at most 2048 characters of a piece of text and drops the rest, marked `…[shortened]`, so its cost is bounded. The answer is asked for again every five minutes (`FEE_TOKEN_RECHECK_MS`), since a token's owner can change the list or pause the token. The `e2e/__guards__/transaction-senders` guard (thirdweb's and viem's senders, `wallet_sendCalls`, and thirdweb's pay and transaction widgets; the wallet panel's `ConnectButton` only in the four files that share its settings) lets a transaction be sent only from `useChatMutations.tsx`, `usePlanMutations.ts` and the local faucet, and the `e2e/__guards__/fee-token-gate` guard pins each place the check is asked (it reads code with comments stripped and matches whole statements, so a commented-out refusal or a flag with a condition added fails) and that cancel and refund never depend on it, and `feeTokenCheck.abi.test.ts` pins the reads against the synced ABIs.

**Contract errors (`buildErrorHandler` in `useChatMutations.tsx`, `src/lib/contractErrorSelector.ts`)** — an error is recognised by its name or by its selector. Both are needed: a local node writes the name into the message, while a public node returns only revert data, and thirdweb decodes that against the contract that was called, so an error raised by the token inside an escrow call arrives as a bare selector. The selector is taken from the canonical signature (name and bare parameter types); viem's `toFunctionSelector` given an error item hashes the `error` keyword and parameter names too and matches nothing. A new message needs a row in the by-selector table in `useChatMutations.errors.test.ts`. A refused transfer (`TransferNotAllowed`) is worded by action and, for a cancellation, by the check's current verdict (`refusedTransferMessage` in `src/lib/feeTokenRefusal.ts`, which `buildErrorHandler` is given the verdict for): a payment took nothing; a cancellation leaves the fee held, and the refund is promised only under `treasury-not-exempt` (a refund leaves the escrow, so under `escrow-not-exempt` it would be refused too and the message says to contact support; under `token-paused` it uses the paused wording below; under `contract-not-found` or `escrow-serves-other-agent` the message names no refund time and says to contact support; any other state offers the refund without a promise); a refund needs support. A paused token (`EnforcedPause`, the same `refusedTransferMessage` with the `paused` cause) is worded by action too, whatever the verdict: a payment took nothing; a cancellation leaves the fee held and nothing moves until the token is resumed, after which the oracle may still answer the prompt (and take the payment), or it can be cancelled, or refunded one hour after it was sent; a refund can be tried again once the token is resumed, unless the prompt has been answered by then. No time is given for the resume. The same cancellation wording is used under the `token-paused` verdict.

**Faucet (`src/hooks/useFaucetRequest.ts`, `src/lib/faucetOutcome.ts`, `src/lib/faucetService.ts`)** — both places that offer the faucet (the insufficient-balance toast from `useChatMutations`, whose `InsufficientBalanceNotice` is handed the button's label and handler, and `ManagePlanModal`) call the one `useFaucetRequest` hook. A request closes no toast but, from the insufficient-balance toast (`requestTokensFromOffer`), that toast itself by its fixed id (`FAUCET_OFFER_TOAST_ID`): a dismissal of every toast would also withdraw the update prompt, which reads a dismissal it did not cause as the user declining. It waits with `awaitFaucetReceipt`, which gives back the mined receipt or `timeout`; `faucetOutcome` maps that to `received`, `reverted`, `no-transfer` or `timeout`, and `faucetNotice` maps the outcome to what the user is told. Tokens are announced only when the receipt succeeded and holds a `Transfer` log from the configured fee token contract to the user's address (addresses compared without regard to case), and the amount shown is the one in that log, formatted with the profile's decimals: the faucet sends whatever token its own setting names, so a successful receipt alone proves nothing. A successful receipt that brought the user nothing says so plainly and is reported to Sentry once per page load (tag `check: faucet`); a reverted one says nothing was added, and a timeout says the transfer is still confirming and that the balance is not checked again for it (only a return to the tab or a reload asks again). The balance is refreshed only for `received` and `timeout`. A faucet call that throws takes its loading notice down, says the faucet failed and is logged with `console.error`. A wait for the receipt that throws replaces the sent notice with "Transfer Not Confirmed" (check your balance) and is logged the same way. The chain is read once, when the request is made. With no fee token configured for the wallet's chain the faucet is not asked: the user is told it is not available and Sentry gets a setup fault, once per page load (same tag). The `e2e/__guards__/faucet-single-handler` guard keeps it that way: the faucet is asked and its receipt awaited only in the hook, the result is worded only in `faucetOutcome.ts`, and every file that offers the faucet calls `useFaucetRequest()`.

Contracts are configured in `src/config/contracts.ts` keyed by `chainId`, populated from Vite env vars (`VITE_CHAIN_ID`, `VITE_TOKEN_CONTRACT_ADDRESS`, `VITE_AGENT_CONTRACT_ADDRESS`, `VITE_ESCROW_CONTRACT_ADDRESS`). ABIs live in `src/lib/abi/`.

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

This dApp is the user-facing layer of the SenseAI stack. It depends on four sibling repos:

| Sibling              | Role                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| `tokenized-ai-agent` | Provides `EVMAIAgent` and `EVMAIAgentEscrow` contracts that handle all writes                     |
| `sense-ai-subgraph`  | Provides the GraphQL API for all read queries (conversations, messages, prompt status, activity)  |
| `able-contracts`     | Provides `AbleToken` — the ERC20 payment token users must approve before prompting                |
| `sense-contracts`    | Provides `SenseToken` — the other fee token; moves only to or from addresses its owner has listed |

### ABI Sync Process

ABIs in `src/lib/abi/` are not hand-maintained — they are synced from compiled contract artifacts:

```bash
# 1. Compile contracts in their repos (required first)
cd ../able-contracts && bun run compile
cd ../sense-contracts && bun run compile
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

`answerMessageId` is at **param index 3** (0-based, non-indexed). `useChatMutations.tsx` reads it at this index from the receipt log. If this ever changes, both the subgraph and dApp must be updated in lockstep.

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

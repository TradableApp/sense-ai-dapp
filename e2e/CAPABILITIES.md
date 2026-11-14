# SenseAI E2E — harness capabilities & coverage

What the e2e harness (the `sense-ai-e2e` stack + these `e2e/` helpers) can assert today, what it
can't yet, and how much of the product is covered. Source of truth for the coverage-hardening
work tracked in **CU-86d3bawhh**.

The stack (`sense-ai-e2e/scripts/start-e2e.sh`) brings up: Hardhat (31337) → contracts → oracle
keypair → config/ABI sync → Graph node (Docker) → subgraph deploy → oracle (mocked AI + storage) →
local IPFS gateway. Playwright auto-starts the dApp (`:3002`). Localnet runs **serial**
(`workers:1`). The fresh-account allocator is **chain-aware**: the
counter resets to acct 2 only when the localnet's genesis hash changes (fresh stack); re-running on
the same live chain continues deeper into the pool so "fresh" accounts never carry prior-run state
(conversations, plans). The pool is derived from Hardhat's well-known mnemonic (indices 2..249,
`e2e/helpers/hardhat.ts`) and each claim runs `enableFreshAccount`: `hardhat_setBalance` (gas) +
`hardhat_impersonateAccount` (node-side signing — the mock wallet uses `eth_sendTransaction`, which
fails with "Unknown account" for unimpersonated addresses beyond the node's 20 managed accounts).
Both are dev-node built-ins; no node or hardhat config is involved. Sizing note: Playwright retries spawn new workers and
each burns an account, so a full serial run consumes far more than the test count (58+ observed).
The mock wallet pre-seeds `consentSettings` so the cookie banner never gates tests; the consent
specs themselves (T-UI-16..18) opt out via `injectMockWallet(page, { seedConsent: false })`.

**Derived-account provisioning** happens automatically at allocation (`allocateFreshAccount` →
`enableFreshAccount`: `hardhat_setBalance` + `hardhat_impersonateAccount`) and at context creation
(`createWalletContext`: a Node-side `personal_sign` bridge — impersonation covers transactions
ONLY, so session-key derivation needs local signing). Both are single-source-of-truth helpers used
by the fixtures AND `openDevice`; specs never provision manually.

**Full-suite runs are SHARDED** (`sense-ai-e2e/scripts/run-e2e-sharded.sh`): snapshot-revert
mini-reorgs age graph-node's indexing over a long single-chain run until answer hydration dies for
late-slot projects (see LOCALNET_SETUP troubleshooting). `revertToSnapshot` mines past the orphaned
head and waits for subgraph re-sync (which is why snapshot-using projects carry 120s test budgets),
but chains older than ~45-60 min remain unreliable — the sharded runner keeps every chain young
while executing all 23 spec files.

## Layers an e2e test can observe

| Layer                   | How                                                                  | Helper                   |
| ----------------------- | -------------------------------------------------------------------- | ------------------------ |
| **Smart contract**      | JSON-RPC `eth_call` / `eth_sendTransaction` to Hardhat               | `e2e/helpers/hardhat.ts` |
| **Oracle**              | Indirectly, via its outputs in the subgraph + dApp (no direct probe) | —                        |
| **Indexing (subgraph)** | GraphQL queries to the local Graph node                              | `e2e/helpers/graph.ts`   |
| **dApp (UI)**           | Playwright POMs                                                      | `e2e/pages/*.ts`         |

## Supported today

**Contract (`hardhat.ts`):** `getBlockNumber`, `getBalance`, `mineBlocks`, `increaseTime`,
`takeSnapshot`/`revertToSnapshot`; ERC-20 `getABLEBalance`, `getEscrowBalance`,
`getAllowance`; `fundABLE` (treasury transfer); `approveABLE`, `activatePlan`, `processRefund`; `getPromptFee`,
`setPromptFee` (owner); `getSpendingLimit` → `{allowance, spentAmount, expiresAt}`.

**Indexing (`graph.ts`):** `isGraphRunning`, `getIndexedBlockNumber`, `waitForIndexing(block)`,
`getConversations(owner)` → `[{id}]`, `getPendingPayments(user)` → `[{id, amount}]`.

**dApp (POMs):** ChatPage (send/`sendPromptAndWaitForResponse`, cancel/regenerate/branch locators,
`assistantMessages`/`userMessages` counts, insufficient-balance toast); HistoryPage (search,
rename, delete, open, counts); AuthPage, DashboardPage, PlanModal.

**Fixtures:** `authenticatedPage` (acct 1, cached session), `freshChatPage`/`freshContext`/
`freshUserAccount` (pristine acct 2..19), single-account mock wallet per context.

## NOT yet supported (build as part of CU-86d3bawhh)

**Indexing helpers (subgraph schema already exposes these — just no helper yet):**

- `getMessages(convId)` → `[{messageId, role, messageCID, createdAt, searchDelta}]` (Message is
  indexed with `role`; an answer is a `role:"assistant"` Message).
- `getPromptRequests(convId|user)` → `[{promptMessageId, isCancelled, isAnswered, isRefunded}]`.
- `getConversation(id)` → `{conversationCID, conversationMetadataCID, isDeleted, branchedFrom, lastMessageCreatedAt}`.
- `getRegenerationRequests(user)` → `{originalAnswerMessageId, answerMessageId}`.
- `getPayment(escrowId)` → `{amount, status, finalizedAt}` (status PENDING/COMPLETE/REFUNDED).
- `getFeeConfig()` → `{promptFee, branchFee, cancellationFee, metadataUpdateFee}`.
- `getSearchDelta(messageId)` presence.
- `waitFor*` variants that poll the above (e.g. `waitForAnswer(convId, msgId)`).

**Contract helpers:** agent-contract view reads for message/answer state (currently inferred only
via subgraph/UI); `cancelPrompt`/`processRefund`/`initiateBranch`/`initiateMetadataUpdate`
programmatic sends (only plan/fee writes exist today).

**dApp helpers:** regenerate **mode** selection (default/detailed/concise menu items), branch
action + branched-conversation navigation, cancel action + composer-state assertions, reasoning/
sources block locators.

**Fixtures/infra:** multi-account **two-context** fixture (multi-device same-wallet; multi-wallet
isolation — T-SEC-07 is `fixme`); a direct **oracle** assertion path (log/health probe) if we want
to distinguish "oracle dropped it" from "indexing lag" without reading `sense-ai-e2e/logs/oracle.log`.

## Coverage snapshot (suites → what they assert)

Full inventory in the PR description / CU-86d3bawhh. Today most write-flow specs assert the
**optimistic UI only**; the hardening goal is to add the contract + subgraph cross-checks above so
each flow is verified end-to-end (e.g. a delivered answer ⇒ `PromptRequest.isAnswered == true` and a
`role:"assistant"` Message indexed, not just a rendered bubble).

## Testnet mode (Base Sepolia) — what runs, what cannot, and why

The same specs run against the REAL stack on Base Sepolia (chain 84532): the deployed
`EVMAIAgent`/`EVMAIAgentEscrow`, the ROFL oracle, The Graph Studio subgraph and the hosted dApp
build. Nothing is brought up; the sense-ai-e2e runner (`scripts/testnet/run-e2e-testnet.sh`,
docs/TESTNET_RUN.md) verifies every layer is current, exports the env contract below and then
calls `bunx playwright test --project=testnet`. **Every answer is a real model call and every
transaction costs real test gas**, which is why this is a deliberate run-day action and never CI.

**Chain adapter** (`e2e/helpers/chain.ts`): the suite decides ONCE which chain it is on
(`E2E_CHAIN`, or `E2E_TESTNET=1` from the runner). `rpc()` refuses every dev-node method
(`hardhat_*`, `evm_*`, `anvil_*`, `eth_sendTransaction`) on testnet, so a localnet-only helper
used from a testnet spec fails at the call. `sendFrom()` signs in Node through the keyring
(`e2e/testnet/keyring.ts`) and sends raw. Specs gate on `LIVE_STACK` (true with
`E2E_LOCAL_SERVICES=1` on localnet, always on testnet) — the `live-stack-gate` guard forbids
reading the localnet flag directly, because a spec that did would skip itself on testnet and
report green.

**Accounts.** No well-known mnemonic on a public chain (sweeper bots drain them in seconds). The
runner generates a fresh 32-byte seed per run; accounts derive from it (`e2e/testnet/accounts.ts`,
path m/44'/60'/0'/0/i). Indices `0..E2E_TESTNET_ACCOUNT_COUNT-1` are pre-funded by the runner's
`fund` stage (`bun run e2e:testnet:fund`); index 0 is the shared "user" behind
`authenticatedPage` / `injectMockWallet` and the oracle smoke's sender (`e2e:testnet:key -- 0`).
`allocateFreshAccount` claims indices beyond those, funded just in time from the treasury
(0.0005 ETH + 5 ABLE, `e2e/testnet/treasury.ts`) and recorded in the accounts file BEFORE the
transfer; the `freshUserAccount` fixture sweeps the account back on teardown so the float
outstanding is one account's worth. `bun run e2e:testnet:sweep` returns everything the file lists
and the runner reads every balance from the chain itself as the verdict. The accounts file holds
addresses only; keys live in the process and the `no-real-network-keys` guard forbids any
non-Hardhat 64-hex literal in `e2e/`.

**Mock wallet in signing mode** (`e2e/fixtures/mock-wallet.ts`, `e2e/testnet/bindings.ts`): the
page-side `window.ethereum` knows an address and the chain id, nothing else. Reads cross the
`__mockRpc` binding into the adapter; `personal_sign`, typed data and `eth_sendTransaction` are
signed in Node with the account's derived key. The private provider URL (it embeds an API key)
never enters a page, a trace or a screenshot.

**Env contract** (exported by the runner): `E2E_TESTNET=1`, `E2E_BASE_URL`, `E2E_TESTNET_SEED`,
`E2E_TESTNET_ACCOUNT_COUNT`, `E2E_TESTNET_ACCOUNTS_FILE`, `E2E_TESTNET_RPC_URL`,
`E2E_TESTNET_TREASURY_PRIVATE_KEY`, `E2E_TESTNET_TREASURY_ADDRESS`, `E2E_TESTNET_TOKEN_ADDRESS`,
`E2E_TESTNET_CHAIN_ID`; escrow/agent addresses and the Graph URL come from `.env.testnet`
(loaded by `playwright.config.ts` and the scripts, never overriding the runner's exports). A
missing or malformed variable fails once, by name, before any request.

### Included in the `testnet` project (155 tests, 17 files)

`smoke`, `ui`, `auth`, `chat`, `history`, `branching`, `cancel`, `metadata`, `search`,
`versions`, `multi-device`, `live-sync`, `activity`, `graph`, `reasoning`, `remaining-features`,
`plan`. `T-BRANCH-08` (regenerating an inherited answer inside a branch: the new answer renders in the branch, is indexed under the branch and leaves the original untouched) needs agent contracts that file a regeneration under the conversation it was asked in; against older contracts the answer is filed under the original and the test fails. It checks the stored state on a second device (a clean browser context): the original is unchanged and the regenerated answer is in the branch. `T-BRANCH-09` and `T-BRANCH-10` open a branch on a second device, which holds none of the copies the branching device made: the dApp rebuilds the inherited history from the original conversation's messages, up to the branch point and no further (a prompt sent in the original after the branch was made does not appear in the branch). Chain-aware adaptations: `T-INIT-SMOKE-01/02` check the configured RPC's chain id and the Graph
endpoint; `cancel` advances time by WAITING (`advanceTime`: Base's 2 s blocks move
`block.timestamp` on their own) instead of `evm_increaseTime`; `T-REASON-01` asserts a real
reasoning block with ≥ 1 step and ≥ 1 http(s) source (the mock sentinel is inert on a real
oracle) and `T-REASON-02` is testnet-skipped; `T-STUCK-01` and `T-PENDING-01` are testnet-skipped
(see below); `plan` runs every test on a per-test fresh account funded through the adapter (no
snapshots anywhere in the file), with `T-PLAN-13` testnet-skipped (see below). `multi-device` and `live-sync` claim their extra wallets through `freshAccountPool()` and release them in `afterEach` (the `fresh-account-release` guard forbids a direct `allocateFreshAccount()` in a spec). `cancel` stays included; it FAILED on both 2026-11-02 runs by design of the dApp, not the suite — the composer enabled Cancel only during the 3 s after the receipt, when the escrow still reverts `PromptNotCancellableYet`, and disabled it once the chain would allow it (hidden on localnet by `evm_increaseTime`; sense-ai-dapp #88). The composer now follows the escrow (`src/features/chat/cancelWindow.ts`: disabled with a countdown, then enabled until the answer lands) and `T-CANCEL-04` asserts that order; the Day-2 rerun is the testnet proof.

**Waits.** No spec or page object waits for Playwright's `networkidle`: the live-state probe polls every block and Thirdweb and Sentry keep their own traffic up, so the network never idles and the wait times out with the page rendered (T-INIT-06..10 and T-UI-08 on the 2026-11-02 run day). `waitForAppShell(page)` (`e2e/helpers/app-ready.ts`) is the app-ready wait; the `no-networkidle` guard enforces it. Wait budgets are chain-aware (`e2e/helpers/budgets.ts`): localnet keeps the values the specs were written against, testnet states the acceptable experience on a public chain (own message 45 s, answer 180 s, indexed state 30 s, post-tx navigation 60 s, page load 90 s), sized from the run day where a submit → receipt took up to ~30 s and one answer passed 90 s. The page-load budget is Playwright's `navigationTimeout` (`page.goto` resolves on `load`, i.e. every sub-resource): on the 2026-11-09 run day the hosted build's 3 MB main bundle alone took 21 s during a Firebase Hosting throughput dip and `T-AUTH-05` timed out at the 30 s default; the `navigation-budget` guard keeps the config on the budget rather than a literal. A test that breaches a budget is a finding about the stack, not a retry. Known finding from that run: the user's own prompt renders only after the submit receipt (`T-CHAT-07` took 29 s on the first attempt), so on a slow block the composer shows nothing for the whole confirmation wait.

### Resilience checks (`testnet-resilience` project)

Two run-day checks that a regular testnet run cannot afford, kept in their own project so the
`testnet` project never waits an hour. Run with `bun run test:e2e:testnet:resilience` from the
sense-ai-e2e runner (the same tmux and env contract as the testnet pass). Never in CI.

- **R-EXPIRY-01** (`resilience-expiry.spec.ts`): a fresh account is funded, and the spending limit is
  set Node-side with an absolute `expiresAt` 120 s ahead of the latest block (the dApp form only offers
  whole days). The check waits for chain time, not the wall clock, to pass the expiry, then asserts
  "Limit has expired" on the dashboard, the "Plan Expired" toast on a prompt, `pendingEscrowCount == 0`
  on chain, and the subgraph `SpendingLimit.expiresAt`. No oracle is needed.
- **R-REFUND-01** (`resilience-refund.spec.ts`): the oracle must be DOWN. The runner declares that with
  `E2E_RESILIENCE_ORACLE_DOWN=1`; without it the test skips with a written reason. A prompt is submitted
  through the chat UI and stays pending. The check waits for both refund gates (chain time from the
  contract's `REFUND_TIMEOUT()`, and the dApp's wall-clock gate), polling every 30 s with the page open,
  then clicks the dashboard's Refund button. A fallback sends `processRefund` Node-side if the UI path
  fails after the hour; the path is recorded as `ui` or `script-fallback`, the chain assertions still run,
  and the final assertion fails on a fallback because it is a finding about the UI.

Env contract, on top of the testnet contract above: `E2E_RESILIENCE_ORACLE_DOWN=1` (R-REFUND-01 only)
and optional `E2E_RESILIENCE_EVIDENCE_DIR` (absolute directory; each check writes `expiry.json` or
`refund.json` with transaction hashes, block numbers, timestamps, balances and the refund path). The
evidence writer refuses secret-shaped field names, unprefixed 32-byte hex, URLs with a path, and any
registered secret (RPC URL, seed, treasury key), and it names the field, never the value.

The refund is proven from chain state and the refund transaction's receipt (the subgraph names the
transaction), never from a block-range `eth_getLogs`: an hour of Base Sepolia is ~18,000 blocks and a
provider's free tier caps a log query at 10.

The pure logic (calldata, chain-time wait, refund readiness, skip gate, evidence writer, PaymentRefunded
topics and receipt-log match) is unit-tested in `e2e/helpers/resilience.test.ts`. `e2e/__guards__/testnet-resilience-project.test.ts`
keeps the resilience specs out of the `testnet` project and the regular testnet specs out of this one.

### Excluded, with the reason

| Spec                           | Why it cannot run on a public chain                                                                | Covered by                                                                                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `refunds` (3)                  | `increaseTime(1h)` past the refund window — time travel                                            | localnet suite; `testnet-resilience` R-REFUND-01 (real 1 h refund)                                              |
| `contract-cost` (5)            | owner-only fee setters from the deployer                                                           | localnet suite; contract unit tests (tokenized-ai-agent)                                                        |
| `governance` (10)              | owner key (addOracle, transferOwnership, upgrade) never enters the suite on a real network         | localnet suite; CU-14ym9bvdmjt (admin rehearsal, done by hand)                                                  |
| `faucet` (2)                   | localnet-only faucet path                                                                          | hand-run against the real callable                                                                              |
| `brain`, `brain-substance` (5) | read the oracle's Postgres over Cloud SQL mTLS from a laptop                                       | oracle smoke (`smoke:base-testnet`)                                                                             |
| `security` (4)                 | localnet-shaped request intercepts and storage inspection                                          | localnet suite                                                                                                  |
| `sentry` (4)                   | intercepts the localnet DSN                                                                        | localnet suite                                                                                                  |
| `T-STUCK-01`, `T-PENDING-01`   | need the mock oracle's `__E2E_DROP__` to leave an escrow pending; a real oracle answers everything | `T-STUCK-01`: `testnet-resilience` R-REFUND-01 (oracle down, real stuck prompt); `T-PENDING-01`: localnet suite |
| `T-REASON-02`                  | only the mock oracle can be told to omit reasoning                                                 | localnet suite                                                                                                  |
| `T-PLAN-13`                    | expires a plan with `evm_increaseTime(24 h)` — time travel                                         | localnet suite; `testnet-resilience` R-EXPIRY-01 (real limit expiry, 120 s ahead)                               |
| `T-HIST-11`                    | seven paid prompts to exercise the local message cache, which is the same code on every chain      | localnet suite                                                                                                  |
| `mobile` (ui on Pixel 5)       | not in the first testnet pass — desktop only; add when the desktop pass is green                   | localnet suite                                                                                                  |

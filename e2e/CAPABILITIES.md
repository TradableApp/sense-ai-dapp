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
`e2e/helpers/hardhat.ts`) and each claim is ETH-topped-up via `hardhat_setBalance` — indices ≥ 20
are beyond the node's 20 prefunded accounts. Sizing note: Playwright retries spawn new workers and
each burns an account, so a full serial run consumes far more than the test count (58+ observed).
The mock wallet pre-seeds `consentSettings` so the cookie banner never gates tests; the consent
specs themselves (T-UI-16..18) opt out via `injectMockWallet(page, { seedConsent: false })`.

## Layers an e2e test can observe

| Layer | How | Helper |
|---|---|---|
| **Smart contract** | JSON-RPC `eth_call` / `eth_sendTransaction` to Hardhat | `e2e/helpers/hardhat.ts` |
| **Oracle** | Indirectly, via its outputs in the subgraph + dApp (no direct probe) | — |
| **Indexing (subgraph)** | GraphQL queries to the local Graph node | `e2e/helpers/graph.ts` |
| **dApp (UI)** | Playwright POMs | `e2e/pages/*.ts` |

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

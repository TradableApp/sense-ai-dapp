# 3. `ConversationAdded` must fire for every conversation that has a delivered answer

**Status:** Accepted
**Date:** 2026-06-14

## Context

The dApp's sync (`syncService` → `fetchUpdatesFromTheGraph`) discovers conversations by querying
the subgraph's **`Conversation` entity**, filtered by owner. A conversation that has messages but
no `Conversation` entity is invisible to the dApp — its answers never render.

The `Conversation` entity is created by the subgraph's `handleConversationAdded`, which only runs
when the contract emits `ConversationAdded`. That event is emitted by `EVMAIAgent.submitAnswer`
**only when the oracle's answer bundle carries a non-empty `conversationCID`** — and the oracle
only produces a `conversationCID` when it initialises the conversation on storage.

This created an orphaning bug: if a conversation's **first prompt was cancelled** (so its first
answer was never delivered), and the user then **resent**, the dApp resent with
`isNewConversation=false` (it reused the existing conversationId). The oracle appended with an
empty `conversationCID`, `ConversationAdded` never fired, the `Conversation` entity was never
created, and the resend's answer — though fully on-chain and indexed as a `Message` — was never
surfaced. The chat sat on "Thinking…" forever.

## Decision

**Invariant: the first *delivered answer* in a conversation must cause `ConversationAdded` to
fire** (regardless of how many prompts were cancelled before it). Enforced at two layers:

1. **dApp (primary):** treat a resend into a conversation with no delivered answer as new
   (`conversationHasAnswer` → `buildInitiatePromptPayload` sets `isNewConversation=true`), so the
   oracle re-initialises and emits `conversationCID`. The UI's one-pending-prompt-at-a-time rule
   makes "no delivered answer" an exact signal. Editing the first message is unaffected (that
   conversation *has* a delivered answer).
2. **Oracle (defensive backstop):** when a non-new prompt arrives with no parent CID — the
   structural signature of "first persisted message" — confirm via the conversation's key file
   (`queryTransactionByTags`, the same mechanism `getSessionKey` uses). No key file ⇒ never
   persisted ⇒ initialise + emit `conversationCID`. Key file present ⇒ established ⇒ append, so a
   re-emit can't clobber existing metadata.

## Consequences

- **Positive:** a delivered answer is never orphaned, even after arbitrary cancellations; the
  guarantee holds even if a future/stale client sets `isNewConversation` wrong (the oracle backstop).
- **Negative:** the backstop adds one tag lookup on the rare orphan-risk path (non-new + parentless);
  negligible, and skipped on every normal follow-up.
- **Related:** `ConversationAdded` (and the other indexing-relevant events) must remain
  `eth_call`-free in the subgraph handlers — see the subgraph repo's "read fees from `FeeConfig`,
  not `eth_calls`" decision, which fixed a localnet graph-node↔Hardhat stall on the cancel block.

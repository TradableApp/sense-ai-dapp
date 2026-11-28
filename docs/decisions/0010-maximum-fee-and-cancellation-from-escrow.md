# 10. Every paying call names the most it agrees to pay, and a cancellation is paid from the escrow

**Status:** Accepted
**Applies to:** cross-repo (`tokenized-ai-agent`'s `EVMAIAgentEscrow`, `sense-ai-dapp`,
`sense-ai-subgraph`)
**Date:** 2026-11-27
**Supersedes:** the "Update, 2026-11-25" section added to
[ADR-0004](0004-subgraph-fees-from-feeconfig.md) about where a cancellation's fee comes from

## Context

The escrow's owner can change any fee at any time. A paying call took whatever fee the escrow
held when the transaction was mined, so a fee raised between the user's action and the block
was charged without the user agreeing to it.

A cancellation worked differently from every other payment. It released the whole escrowed
amount to the user and then took the cancellation fee from the user's wallet. So a user could
not cancel a prompt without a token balance, a token approval and room left in the plan's
limit, all for the fee alone; and with a fee token whose transfers need one end to be a listed
address, the fee's transfer from the user to the treasury could be refused.

## Decision

1. **A maximum on every paying call.** `initiatePrompt`, `initiateRegeneration`,
   `initiateBranch`, `initiateMetadataUpdate` and `cancelPrompt` take `_maxFee` as their last
   argument and revert with `FeeAboveMaximum(fee, maxFee)` when the fee charged is above it.
2. **The dApp passes the fee it has just read.** Inside each mutation, after the payment gate has
   been asked and before anything is encrypted or prepared, the dApp reads the fee from the
   escrow (`readEscrowFee` in `src/lib/escrowFee.ts`: `promptFee` for a prompt and a regenerate,
   `branchFee`, `metadataUpdateFee`, `cancellationFee`) and passes that reading as `_maxFee`.
3. **A fee that cannot be read sends nothing.** A read that fails or gives no number throws
   `FeeNotReadError`, which names the fee and carries nothing of the original error: nothing is
   encrypted, prepared or sent, and the user is told "Not Sent" (or "Could Not Cancel").
4. **A cancellation is paid from the escrowed amount.** The escrow charges the cancellation fee
   or the escrowed amount, whichever is lower, sends the fee to the treasury and the rest to the
   user, both from its own balance. The wallet's balance, its approval and the plan's remaining
   limit play no part in a cancellation. The plan stays charged the fee and gets the rest back.
5. **The escrow records what a cancellation settled.** It emits
   `CancellationSettled(escrowId, user, fee, returned)`, and the subgraph files the cancel from
   that event alone: `CANCEL` is minus `fee`, and `CANCEL_RETURN` is `fee + returned`, the
   escrowed amount the cancel released. The cancellation fee is not read from `FeeConfig`, since
   the fee charged can be lower than the configured one, and no handler makes an `eth_call`, so
   ADR-0004's rule holds. `FeeConfig` still carries the four configured fees.

This decision supersedes the "Update, 2026-11-25" section that was written into ADR-0004, an
accepted record, on the branch that made this change. That section said the same as point 5:
the escrow takes the cancellation fee out of the escrowed amount and emits
`CancellationSettled`, the subgraph files a cancel from it, and the cancellation fee is no
longer read from `FeeConfig`. Its substance stands; it is recorded here because an accepted ADR
is not edited.

## Consequences

- **Positive:** no transaction is charged more than the fee read for it; an owner's fee change
  between the read and the block refuses the transaction instead of charging the new fee
  ("Fee Changed" for a paying action: nothing was sent and no tokens were taken; "Could Not
  Cancel" for a cancel: nothing was cancelled; each says that trying again uses the new fee).
- **A cancellation needs nothing from the wallet.** It works with an empty wallet, no approval
  and a spent plan, and its fee moves from the escrow, which a restricted fee token lists, so a
  treasury that is not listed does not refuse it.
- **What the maximum covers:** the dApp shows no fee before a send, so the maximum guards the
  time between the read and the transaction being mined, not a fee the user has seen.
- **The dApp's maximum for a cancel is the escrow's configured fee** (`cancellationFee`, read
  from the escrow as in point 2; this is not the subgraph's read of `FeeConfig`, which point 5
  ends). Since the escrow charges the lower of that fee and the escrowed amount, the reading is
  never below what is charged.
- **Negative:** each paying action makes one more chain read before the wallet is asked, and an
  RPC that cannot answer it stops the send. The contract interface changed, so the dApp, the
  synced ABIs and the escrow must be deployed together; a dApp built before this change cannot
  call the new escrow. The dApp's cancel no longer has wording for a wallet that lacks balance,
  approval or limit, since none applies.
- **Alternatives rejected:**
  - _No maximum:_ a fee change between the user's action and the block is charged silently.
  - _An unlimited maximum on a cancel_ (the maximum of `uint256`): the cancel would accept any
    fee change, which is what the maximum exists to refuse.
  - _A maximum with headroom above the reading:_ the user would agree to a fee higher than the
    one in force, with no screen showing it.
  - _Keep the cancel fee in the wallet:_ cancelling would need a balance, an approval and plan
    room for the fee, and a restricted token could refuse it.
  - _Read the cancel fee from `FeeConfig` in the subgraph:_ the configured fee is not the fee
    charged when the escrowed amount is lower, and reading the contract from a handler breaks
    ADR-0004.

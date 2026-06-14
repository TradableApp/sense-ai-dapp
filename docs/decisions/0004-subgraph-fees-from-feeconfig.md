# 4. Subgraph reads fees from indexed `FeeConfig`, not `eth_calls`

**Status:** Accepted
**Applies to:** `sense-ai-subgraph` (recorded here as a cross-repo decision; the dApp depends on
the subgraph staying indexable, see ADR-0003)
**Date:** 2026-06-14

## Context

The subgraph's `Activity` feed records a fee amount for `BRANCH`, `METADATA_UPDATE`, and
`CANCEL` actions. The handlers originally read those fees via `eth_call`
(`EVMAIAgentEscrow.cancellationFee()` / `branchFee()` / `metadataUpdateFee()`).

On the **localnet** stack this stalled indexing: graph-node `v0.44.0` sends `eth_call` with
**both** `input` and `data` fields; **Hardhat 2.25** rejects the duplicate
(`-32602 duplicate field data`). graph-node halts on the first cancel/branch/metadata block, so
`PromptRequest.isCancelled` never indexes and the dApp can't observe cancellations — which broke
the cancel e2e flow and, transitively, anything that depends on those events.

The Graph's own guidance is **["avoid `eth_calls`"](https://thegraph.com/docs/en/subgraphs/best-practices/avoid-eth-calls/)**:
they are slow, they couple indexing to RPC availability/quirks, and they are a common stall source.

## Decision

**Handlers read fees from the indexed `FeeConfig` singleton entity, never via `eth_call`.**

- `EVMAIAgentEscrow.initialize()` emits `PromptFeeUpdated` / `CancellationFeeUpdated` /
  `MetadataUpdateFeeUpdated` / `BranchFeeUpdated` (and `TreasuryUpdated`) so `FeeConfig` is
  populated on a fresh deploy, not only by post-deploy setters.
- The subgraph handlers load `FeeConfig` (typed reads; `log.warning` + `0` fallback if a field is
  unset) instead of binding the escrow contract and calling it.

This removes every `eth_call` from the event-handling path, so indexing never stalls on the
graph-node↔Hardhat incompatibility, and the same code is correct on testnet/mainnet (where the
`eth_call` would have worked but the best-practice still applies).

## Consequences

- **Positive:** indexing no longer stalls on localnet; `Activity.amount` is populated on all
  networks from a fresh deploy; the subgraph no longer depends on escrow contract bindings.
- **Negative:** fees must be emitted as events (they now are, including on `initialize`); a fee
  read before its `*FeeUpdated` event has been indexed falls back to `0` (logged).
- **Alternative rejected:** pinning the localnet graph-node / Hardhat to compatible versions —
  fixes only localnet, leaves the `eth_call` anti-pattern in place on all networks.

# Architecture Decision Records

Significant design decisions for `sense-ai-dapp` (and cross-repo decisions that originate
here), in the [Michael Nygard ADR format](https://github.com/joelparkerhenderson/architecture-decision-record):
**Context · Decision · Consequences · Status**.

Each ADR is immutable once accepted. A decision that changes a prior one does not edit it —
it adds a new ADR and marks the old one **Superseded by ADR-NNNN**, so the *reasoning history*
is preserved.

| # | Title | Status |
|---|-------|--------|
| [0001](0001-chat-message-state-single-source.md) | Single source of truth for chat message state | Accepted (deferred — post-testnet) |
| [0002](0002-e2e-isolation-fresh-account.md) | E2E isolation: fresh account per test, not snapshot/revert | Accepted |
| [0003](0003-conversation-added-indexing-invariant.md) | `ConversationAdded` must fire for every persisted conversation | Accepted |
| [0004](0004-subgraph-fees-from-feeconfig.md) | Subgraph reads fees from indexed `FeeConfig`, not `eth_calls` (cross-repo) | Accepted |

> ADR-0004 records a `sense-ai-subgraph` decision here because it is the indexing guarantee
> ADR-0003 depends on and the work landed alongside this dApp work. If the subgraph repo later
> grows its own `docs/decisions/`, move it there and leave a pointer.

## When to write an ADR

Write one for a decision a future contributor would ask *"why is it like this?"* about — an
architectural shape, a non-obvious trade-off, or a rejected alternative. Not for routine
changes (those live in the PR body / commit message) or rules (those go in `CLAUDE.md`).

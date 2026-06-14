# 2. E2E isolation: fresh account per test, not snapshot/revert

**Status:** Accepted
**Date:** 2026-06-14

## Context

The full-stack e2e suite (`E2E_LOCAL_SERVICES=1`) runs the dApp against a live local stack:
Hardhat node + contracts + mock oracle + **graph-node** + IndexedDB. Tests need isolation so
one test's on-chain/indexed state doesn't leak into the next.

Two isolation strategies exist in the codebase:

1. **`evm_snapshot` / `evm_revert`** (a shared `TEST_ACCOUNT`, snapshot in `beforeEach`, revert
   in `afterEach`). Used by the original `refunds`, `history`, and `branching` specs.
2. **Fresh funded account per test** (a file-persisted allocator hands each test the next Hardhat
   account; the chain only ever grows). Used by `cancel`, and `chat`/`versions`/`cost`/`faucet`.

`evm_revert` rewinds the chain to a prior block. **graph-node treats that as a reorg** and its
view of the chain diverges from the rewound node — so every test *after* the first in a
snapshot/revert describe indexes against a corrupted subgraph and cascades to failure. This was
diagnosed when `refunds`, `history`, and `branching` all failed every test past the first, on a
*fresh* stack, with the trivial empty-state test failing too. The cancel suite had already
avoided snapshot/revert for exactly this reason.

## Decision

**All full-stack e2e specs use the fresh-account-per-test pattern. `evm_snapshot`/`evm_revert`
is not used for any spec that touches the subgraph.**

- `beforeEach`: `fundABLE(...)` + `activatePlan(...)` for `freshUserAccount` so the composer is live.
- Per-test fresh context + mock wallet impersonating that account (`freshChatPage` /
  `freshHistoryPage` fixtures, built on a shared `freshPage`).
- Time-dependent paths use `increaseTime` (forward-only EVM time); the chain never rewinds.
- The allocator resets to account 2 per `playwright test` invocation, so a **fresh stack per run**
  is mandatory (`stop-e2e.sh` + `start-e2e.sh` between full runs).

The `takeSnapshot`/`revertToSnapshot` helpers remain in `hardhat.ts` for any future
non-subgraph use, but specs must not use them around indexed assertions.

## Consequences

- **Positive:** no graph-node reorg corruption; tests are independent and order-insensitive;
  one consistent pattern across the whole suite; matches how production accounts actually behave
  (monotonic chain, no rewinds).
- **Negative:** consumes Hardhat accounts (bounded; fresh stack per run resets them); a long run
  accrues chain state (acceptable — it only grows).
- **Migration:** `refunds` was migrated first; `history` and `branching` follow (this ADR is the
  rationale for that migration).

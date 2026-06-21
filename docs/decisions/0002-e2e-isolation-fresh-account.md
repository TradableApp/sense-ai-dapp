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
non-subgraph use, but specs must not use them around indexed assertions. The `plan` project is
the one remaining snapshot/revert user — its tests read only on-chain/UI state, never the
subgraph, so the reorg is harmless *to itself*.

## Consequences

- **Positive:** no graph-node reorg corruption; tests are independent and order-insensitive;
  one consistent pattern across the whole suite; matches how production accounts actually behave
  (monotonic chain, no rewinds).
- **Negative:** consumes Hardhat accounts (bounded; fresh stack per run resets them); a long run
  accrues chain state (acceptable — it only grows).
- **Negative (indexing lag):** because the run is serial (`workers: 1`) and the chain/graph only
  grow, graph-node lags further behind as a project progresses — especially after a prompt→answer
  round-trip (oracle/IPFS/message indexing). Indexing assertions (`waitForGraph`) that run *after* a
  round-trip in the same project need >30s headroom (use `{ timeoutMs: 60_000 }`) even though the
  on-chain value is already correct; symptom + rule of thumb are documented in the
  `sense-ai-e2e/docs/LOCALNET_SETUP.md` troubleshooting list (seen in `T-REFUND-03`, `T-GOV-OWN-01`).
- **Negative (cross-project invocation):** the snapshot/revert `plan` project must **not** share a
  single `playwright test` invocation with a graph-asserting project (`activity`, `features`,
  `refunds`, `branching`, etc.). Its `evm_revert`s rewind the chain mid-run, and a graph project
  that runs *later in the same invocation* indexes its first assertion against the still-wedged
  graph-node → an empty/stale read (e.g. `T-ACTIVITY-01` failing with `Last value: []` while
  `T-ACTIVITY-02/03`, running later, recover). Run the `plan` project in its own invocation; CI's
  per-project matrix already isolates them, but a local `--project=plan --project=activity` combined
  run reproduces the wedge. (Combined with the per-invocation allocator reset above, this means:
  graph-asserting projects want their own fresh-stack invocation, separate from `plan`.)
- **Migration:** `refunds` was migrated first; `history` and `branching` follow (this ADR is the
  rationale for that migration).

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
view of the chain diverges from the rewound node — so every test _after_ the first in a
snapshot/revert describe indexes against a corrupted subgraph and cascades to failure. This was
diagnosed when `refunds`, `history`, and `branching` all failed every test past the first, on a
_fresh_ stack, with the trivial empty-state test failing too. The cancel suite had already
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
subgraph, so the reorg is harmless _to itself_.

## Consequences

- **Positive:** no graph-node reorg corruption; tests are independent and order-insensitive;
  one consistent pattern across the whole suite; matches how production accounts actually behave
  (monotonic chain, no rewinds).
- **Negative:** consumes Hardhat accounts (bounded; fresh stack per run resets them); a long run
  accrues chain state (acceptable — it only grows).
- **Negative (indexing lag):** because the run is serial (`workers: 1`) and the chain/graph only
  grow, graph-node lags further behind as a project progresses — especially after a prompt→answer
  round-trip (oracle/IPFS/message indexing). Indexing assertions (`waitForGraph`) that run _after_ a
  round-trip in the same project need >30s headroom (use `{ timeoutMs: 60_000 }`) even though the
  on-chain value is already correct; symptom + rule of thumb are documented in the
  `sense-ai-e2e/docs/LOCALNET_SETUP.md` troubleshooting list (seen in `T-REFUND-03`, `T-GOV-OWN-01`).
- **Negative (cross-project invocation):** the snapshot/revert `plan` project must **not** share a
  single `playwright test` invocation with a graph-asserting project (`activity`, `features`,
  `refunds`, `branching`, etc.). Its `evm_revert`s rewind the chain mid-run, and a graph project
  that runs _later in the same invocation_ indexes its first assertion against the still-wedged
  graph-node → an empty/stale read (e.g. `T-ACTIVITY-01` failing with `Last value: []` while
  `T-ACTIVITY-02/03`, running later, recover). Run the `plan` project in its own invocation; CI's
  per-project matrix already isolates them **[CORRECTION 2026-07-27: this is FALSE — CI runs no
  Playwright at all; see the Amendment below]**, but a local `--project=plan --project=activity` combined
  run reproduces the wedge. (Combined with the per-invocation allocator reset above, this means:
  graph-asserting projects want their own fresh-stack invocation, separate from `plan`.)
- **Migration:** `refunds` was migrated first; `history` and `branching` follow (this ADR is the
  rationale for that migration).

## Amendment — 2026-07-27 (CU-86d3uqgh7)

**This ADR described the target state, and the code had drifted from it.** Four specs were
still using `evm_snapshot`/`evm_revert` — `graph` (which also asserts directly on the
subgraph), `contract-cost`, `chat` and `faucet` — despite the decision above naming `plan`
as the sole permitted user. Nothing enforced it, so the drift was invisible: it produced
intermittent failures in _other_ spec files, run-order dependent, indistinguishable from
flakiness in a summary. Two full 75-minute runs and nine review findings failed to attribute
it.

**The mechanism is worse than "lag".** graph-node does not fall behind and recover; its block
ingestor wedges permanently, retrying a block the revert erased and receiving a zero hash
(`Block data unavailable, block was likely uncled (block hash = 0x0000…0000)`). The subgraph
**freezes**. Measured on an idle machine (load 4.19/14 CPUs): head pinned at block 97 while
the chain advanced to 121, no movement across 30s. The clean discriminator, observed inside a
single file at a single moment: `cancel.spec.ts`'s `T-CANCEL-01`/`03` (indexed reads) failed
while `T-CANCEL-02`/`04` (no indexed read) passed — 4/4 on subgraph dependence alone.

**What changed:**

- `graph`, `contract-cost`, `chat` and `faucet` migrated to fresh-account-per-test. `plan`
  remains the sole snapshot user; it calls `increaseTime`, which a forward-only chain cannot
  undo, and it reads no indexed data.
- `contract-cost` needed more than an account swap: `promptFee` is **global** on the escrow,
  so a fresh account cannot isolate it. It is now captured and restored forward-only in every
  block that changes it — the pattern `T-COST-MULTI` and `T-COST-REGEN` already used.
- New fixtures `freshDashboardPage` and `freshPlanModal`. Their absence is _why_ `cost` and
  `faucet` had kept snapshots: `dashboardPage`/`planModal` are built on `authenticatedPage`,
  i.e. the shared account, so they could not express per-test isolation.
- **Enforcement, so this cannot drift again:** `e2e/__guards__/adr-0002-snapshot-isolation.test.ts`
  fails if any spec other than `plan` uses snapshot/revert, fails if `plan` ever gains an
  indexed read (which would invalidate its exemption), and pins the exemption list to exactly
  `plan.spec.ts` so the guard cannot be defeated by widening the allowlist.
  `sense-ai-e2e`'s `run-e2e-sharded.sh` refuses to start if `plan` is placed in a
  graph-asserting shard.

**Correction to the "cross-project invocation" note above.** That note claims "CI's
per-project matrix already isolates them". That is **false** and was verified so on
2026-07-27: neither repo runs Playwright in CI at all. `sense-ai-dapp/.github/workflows/ci.yml`
runs lint, `typecheck:e2e`, vitest and build; `sense-ai-e2e`'s runs shellcheck, actionlint and
a docker-compose validation. CI never reproduced the wedge because CI never runs these tests.

This matters more than a factual tidy-up. It means there is **no automated safety net** for
this class of defect — a local sharded run is the only place the full stack is exercised. It is
also why the enforcement above is a _static vitest guard_ rather than a reliance on the suite
catching the violation: the guard runs under `bun run test`, so it is the one piece of ADR-0002
protection that executes in CI on every push.

**Note on the guard's strictness.** It bans snapshot/revert in _any_ non-`plan` spec, not just
specs that read the subgraph. That is deliberate: the wedge is **global**, so a spec can
snapshot harmlessly for itself and still break every later indexed read. `faucet` was exactly
that case — it reads nothing indexed, so a narrower rule would have cleared it while its
reverts kept freezing the graph for `cost`/`cancel`/`versions` downstream.

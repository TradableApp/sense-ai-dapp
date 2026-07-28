# E2E isolation model — read this before touching an e2e spec

**Audience:** anyone (human or AI agent) about to write, move, or debug a Playwright spec in this
repo. This is the entry point. It states the rules and the one mechanism behind them, then points
at the detail. It deliberately does not duplicate that detail — if this page and a linked source
disagree, the linked source wins and this page is stale.

---

## The one mechanism you must know

`evm_revert` **permanently wedges graph-node's block ingestor.**

A revert rewinds the chain. graph-node treats that as a reorg and polls for a block that no
longer exists, gets a zero hash, and retries forever:

```
ERRO Trying again after block polling failed: Block data unavailable, block was likely
     uncled (block hash = 0x0000…0000)
```

The subgraph does not lag and recover — it **freezes**. Measured on an idle machine: head pinned
at block 97 while the chain advanced to 121, no movement across 30s of sampling.

**Everything below follows from that one fact.**

Once frozen, every test that reads through the subgraph fails — _including tests in other spec
files that never used a snapshot_. Those failures are run-order dependent and look exactly like
flakiness, which is why this cost two 75-minute runs and nine review findings to attribute. If
you are debugging "the answer never renders" or "later specs fail in cascade", start here.

---

## The rules

| #   | Rule                                                                        | Enforced by                                          |
| --- | --------------------------------------------------------------------------- | ---------------------------------------------------- |
| 1   | Use **fresh-account-per-test** isolation, never `evm_snapshot`/`evm_revert` | `e2e/__guards__/adr-0002-snapshot-isolation.test.ts` |
| 2   | `plan.spec.ts` is the **only** exception                                    | same guard — the exemption list is pinned            |
| 3   | `plan` runs in **its own Playwright invocation**                            | `sense-ai-e2e/scripts/run-e2e-sharded.sh` pre-flight |
| 4   | Global contract state (e.g. `promptFee`) is restored **forward-only**       | `usePromptFeeRestore` in `e2e/helpers/hardhat.ts`    |
| 5   | Endpoints come from env vars, never hardcoded ports                         | `e2e/__guards__/endpoint-consistency.test.ts`        |

All five fail a test or refuse to start if broken. You should not need to remember them — but you
do need to know _why_ when one fires.

### Why `plan` is exempt

It calls `increaseTime`, and **EVM time cannot be rewound on a forward-only chain**. A fresh
account cannot undo a 24-hour clock advance the way it undoes a balance. So `plan` keeps
snapshot/revert, and is contained by running alone. It also reads nothing indexed, so its reverts
harm nothing inside its own invocation.

That is the full test for any future exemption: **unrewindable global state, no indexed reads,
and its own invocation.** All three, or migrate to fresh accounts.

### Why fresh accounts work

A pristine per-test account gives the same isolation as a revert without rewinding the chain.
The allocator (`e2e/helpers/fresh-account.ts`) hands out Hardhat accounts 2–249, provisions ETH
and impersonation at claim time, and resets per invocation (keyed on genesis hash). A fresh
account holds **zero ABLE** by construction — several specs depend on that.

---

## Running the suite

```bash
cd sense-ai-e2e && tmux new-session -s e2e 'bash scripts/run-e2e-sharded.sh'
```

**The runner refuses to start outside tmux/screen**, and that is not ceremony. The run takes
~70 minutes and owns the ports, the chain and the Docker stack for all of it, so if the caller
dies — closed terminal, dropped SSH, an agent harness reaping its child — the run dies partway
and leaves the stack up for the next one to trip over. Detach with `Ctrl-b d`; it keeps running.
Reattach with `tmux attach -t e2e`. (`E2E_ALLOW_NO_TMUX=1` overrides, only for a caller that
already supervises the run.)

Three invocations, fresh stack between each: two graph-asserting shards plus `plan` alone.

**Do not run `bunx playwright test` over everything for a verdict.** One invocation puts `plan`'s
reverts in the same process as graph-asserting projects and reproduces the wedge. Also note
Playwright runs projects in **config order, not the order you pass `--project`** — so
`--project=activity --project=plan` runs `plan` first.

**"Green" means 0 failed AND 0 flaky.** Local `retries` is 1, so the suite can exit 0 while
reporting flaky tests. A non-zero flaky count is a finding.

**CI does not run this suite at all** — neither repo's `ci.yml` invokes Playwright. A local
sharded run is the only place the full stack is exercised, which is why the guards above are
static tests: they run under `bun run test` and are the only automated protection that executes
on every push.

---

## Where the detail lives

| Source                                                                                                | What it holds                                                          |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [`docs/decisions/0002-e2e-isolation-fresh-account.md`](decisions/0002-e2e-isolation-fresh-account.md) | The decision record, its rationale, and the 2026-07-27 amendment       |
| [`sense-ai-e2e/docs/LOCALNET_SETUP.md`](../../sense-ai-e2e/docs/LOCALNET_SETUP.md)                    | Setup, and the troubleshooting list — **start here for a failing run** |
| `sense-ai-e2e/scripts/run-e2e-sharded.sh`                                                             | The shard split and its pre-flight guards                              |
| `e2e/__guards__/`                                                                                     | The enforcement, with the reasoning in each failure message            |
| `e2e/CAPABILITIES.md`                                                                                 | What the suite covers                                                  |

### Debugging a failing run — first three moves

1. **Confirm or rule out the wedge in 10 seconds** — the curl commands are in LOCALNET_SETUP's
   troubleshooting section. Compare chain head to subgraph head; if the subgraph number does not
   move, it is wedged and nothing else you find matters.
2. **Distinguish wedge from machine load** by comparing tests that need an _indexed read_ against
   ones that do not, **in the same spec**. Under the wedge the split is exact; under load
   everything slows. Classify per _test_, never per file.
3. **Read the archived artifacts — do not go looking in `test-results/`.** `test-results/` is
   cleared when Playwright STARTS and `logs/*.log` are truncated per shard, so by the time a
   run finishes only the LAST shard's evidence is still on disk. `run-e2e-sharded.sh` therefore
   copies each shard's traces, HTML report and service logs to
   `sense-ai-e2e/artifacts/shard-<1|2|plan>/` before the next shard starts, and prints that path
   at the end of the run. Look there.

   This applies to **flaky** tests too, and that is the case it exists for: a flake still exits 0,
   so nothing prompts you to go looking. Twice now an investigation has reached for that evidence
   after the run and found it gone.

   Locally `trace` is `'retain-on-failure'`, which keeps the trace of the attempt that **failed**.
   Do not "simplify" it back to `'on-first-retry'` — that records during the RETRY, so a flaky
   test leaves you a trace of the attempt that passed and nothing from the one that didn't.

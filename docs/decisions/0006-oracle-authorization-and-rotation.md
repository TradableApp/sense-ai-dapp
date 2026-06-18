# 6. Oracle authorization & rotation — multi-oracle role + shared decryption key

**Status:** Accepted (deferred — implement after the SenseAI e2e campaign; tracked by
[tokenized-ai-agent#42](https://github.com/TradableApp/tokenized-ai-agent/issues/42) +
[CU-86d3cx5qt](https://app.clickup.com/t/86d3cx5qt))
**Applies to:** system-wide (`tokenized-ai-agent` contracts + oracle, `sense-ai-subgraph`,
`sense-ai-dapp`) — recorded here alongside the other decision logs; move to an oracle/infra
`docs/decisions/` if one is created and leave a pointer.
**Date:** 2026-06-18

## Context

`EVMAIAgent` authorizes the oracle with a single mutable `address public oracle` and an `onlyOracle`
modifier (`msg.sender == oracle`, reverts `UnauthorizedOracle`). `setOracle(address)` is an **atomic
single-address swap** (owner-only). Answer/state submission — `submitAnswer` and two siblings — is
`onlyOracle`-gated. Crucially, the oracle's **signer keypair is also its ECIES decryption identity**:
the dApp encrypts each prompt's session key to that key (`VITE_ORACLE_PUBLIC_KEY`, today build-baked
into the dApp env and never read from chain).

The SenseAI e2e campaign (Area 9d, `T-GOV-ORACLE-02`) demonstrated cross-layer that a **naive oracle
rotation is not zero-downtime**: rotating `setOracle` while a prompt is in flight leaves the running
oracle unable to submit the answer — `submitAnswer` reverts with `UnauthorizedOracle` and the oracle
then hits a **FATAL non-retryable error + CRITICAL alert** that wedges its event loop. Every in-flight
prompt is **orphaned** (recoverable only via the refund path). This is exactly the AUDIT §9(b)
concern: "a prompt submitted under the OLD oracle still gets answered, *or* the rotation is sequenced
so no prompt is orphaned."

The industry-standard pattern for rotating a privileged role without downtime is **role-based access
control with multiple concurrent holders** (grant-then-revoke with an overlap window), not a single
mutable address.

## Decision

Adopt **multi-oracle role-based authorization + a shared decryption key** ("Option B").

1. **Contract:** replace `address oracle` + `onlyOracle` with **OpenZeppelin `AccessControlUpgradeable`
   + an `ORACLE_ROLE`** (`onlyRole(ORACLE_ROLE)` on the three submit functions). Rotation becomes
   `grantRole(ORACLE_ROLE, new)` → cutover → `revokeRole(ORACLE_ROLE, old)`; the overlap window
   prevents in-flight orphaning. Storage-layout care for the UUPS upgrade (append state, preserve the
   `__gap`).
2. **Shared decryption key** across oracle instances — exactly ADR-0005's "shared app-scoped keypair
   via ROFL `appd`" (also required for multi-TEE horizontal scaling). With a shared key, *any*
   authorized oracle can decrypt and answer *any* prompt, so the **new oracle seamlessly picks up
   in-flight AND new prompts** during the overlap — no drain dependency on the old oracle. This is why
   Option B is preferred over Option A (a distinct key per oracle, where the old oracle must drain its
   own old-key prompts while the dApp switches new prompts to the new key — more moving parts and no
   seamless takeover).
3. **dApp:** read the **active oracle key from chain** rather than the build-baked
   `VITE_ORACLE_PUBLIC_KEY` — this also closes the existing staleness gap (an on-chain rotation never
   reaches the env-baked dApp today, so prompts encrypted to a stale key are submitted but never
   answered).
4. **Oracle:** be multi-oracle-aware and **resilient** — a single auth/`onlyOracle` revert must not be
   a FATAL non-retryable wedge (the second finding above).
5. **Subgraph:** index an oracle **set** (`OracleAdded`/`OracleRemoved` or OZ `RoleGranted`/
   `RoleRevoked`) instead of today's single `ProtocolConfig.oracleAddress`. While reworking the
   governance indexing, also adopt the industry-standard **"current + immutable change-log"** pattern:
   keep the mutable `ProtocolConfig`/`FeeConfig` **singletons** for fast current-state reads, and add
   **immutable per-change entities** (`@entity(immutable: true)` — e.g. `OracleChange`/`TreasuryChange`/
   `FeeChange { previous, new, txHash, blockNumber, timestamp, sender }`), *or* extend the existing
   immutable `Activity` entity with governance event types. Today governance changes keep only the
   latest value + `updatedAt` (no audit trail), whereas the codebase already uses the immutable-log
   pattern for *user* actions via `Activity` — governance config should match it for the change history
   (when/from→to/by-whom) that admin operations need.

## Consequences

- **Positive:** zero-downtime oracle rotation (no orphaned in-flight prompts); the same shared-key
  primitive unlocks multi-TEE horizontal scaling (ADR-0005); closes the env-baked oracle-key staleness
  gap; aligns with battle-tested OZ `AccessControl`.
- **Negative / cost:** a **UUPS storage-layout change requiring re-audit + redeploy**; the shared key
  depends on the **ADR-0005 ROFL shared-app-key spike** (a HIGH-risk item); an extra authorized oracle
  is extra attack surface — the admin role must be tightly held and the old oracle revoked promptly
  after cutover.
- **Phased delivery:** P1 contract (AccessControl + `ORACLE_ROLE`, grant/revoke, events, storage-safe
  UUPS, Hardhat tests for overlap/no-orphan) → P2 oracle (multi-oracle + shared key + remove the
  FATAL-wedge) → P3 subgraph (oracle-set indexing) → P4 dApp (read active key from chain) → P5 e2e
  (assert a *sequenced* rotation is zero-downtime, replacing the current orphan guard).
- **Until it lands:** the dApp e2e captures the current behavior — `T-GOV-ORACLE-02` asserts that a
  mid-flight rotation orphans the in-flight prompt — so the known risk is locked in as a regression
  guard rather than silently assumed safe.
- **Alternatives rejected:** the single-address atomic swap (current — orphans in-flight prompts);
  Option A distinct-key-per-oracle (old oracle must drain, more complex dApp key-switching, no seamless
  takeover); operational "drain before rotating" (pause + wait for all pending to settle — doesn't
  help an *urgent* rotation, e.g. a compromised key).

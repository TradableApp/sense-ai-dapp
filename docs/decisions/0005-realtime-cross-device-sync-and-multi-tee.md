# 5. Real-time cross-device sync + multi-TEE scaling (durable + live planes)

**Status:** Accepted (deferred — backlog epic [CU-86d3cjj8n](https://app.clickup.com/t/86d3cjj8n))
**Applies to:** system-wide (`sense-ai-dapp`, `tokenized-ai-agent` oracle/ROFL, infra) — recorded here
alongside the other decision logs; move to an oracle/infra `docs/decisions/` if one is created and
leave a pointer.
**Date:** 2026-06-16

## Context

The dApp keeps conversation/usage state fresh by polling the subgraph: `useConversations` has a
5-minute `staleTime`/`refetchInterval`, `useUsagePlan` a 1-minute `staleTime` + `refetchOnWindowFocus`.
That was a deliberate cost choice — usage is overwhelmingly single-device, so a long poll plus a
focus refetch covers the rare second device without paying for constant subgraph queries. An
event-driven supplement already exists — `useLiveResponse` (`liveResponseEvents.ts`) invalidates
these queries on `AnswerMessageAdded` / `ConversationBranched` / `MetadataUpdateRequested` and
related events — but the poll is still the *primary* freshness driver. Phase 1 below flips that
primacy (events primary, poll fallback) and adds the events not yet watched; it is an incremental
change, not a greenfield event build.

Two pressures push beyond polling:

1. **Cross-device freshness** — an idle second device can lag up to 5 minutes behind. Acceptable
   today, but coarse, and the read query couples two concerns: `useConversations`' `queryFn` runs
   `syncWithRemote` (subgraph → IndexedDB) **and then** reads IndexedDB, so you cannot read the
   local cache without triggering a network sync, nor sync more often than `staleTime` allows.
2. **Live reasoning** — streaming reasoning tokens *as they generate* is high-frequency and
   ephemeral. It cannot ride on-chain events or storage-then-poll.

A naive "stream from the TEE to the device" reintroduces device↔TEE coupling and, once the oracle
scales to multiple ROFL TEEs, the question "which TEE has my prompt and does it know my devices?".

### Cache windows are not a security boundary

Tuning these windows is a UX + RPC-cost tradeoff, **not** a security one:

- Conversation data is encrypted at rest with an **in-memory-only** session key (verified by
  T-SEC-06: no plaintext in IndexedDB). Cache duration does not change that.
- Over-spend is enforced **on-chain** by the escrow spending limit (T-MULTI-06 shows a second device
  observing the shared deduction); the displayed allowance is advisory. A stale balance only risks a
  *failed tx*, never an actual double-spend.

## Decision

Model freshness as **two planes**, and keep the TEE coupled to the **prompt**, never to the device.

| | Durable plane | Live plane |
|---|---|---|
| Carries | final answer + reasoning, encrypted at rest | reasoning tokens as they generate |
| Transport | chain events + storage + subgraph | encrypted pub/sub keyed by `answerMessageId` |
| Lifetime | permanent, cross-device | ephemeral, in-flight prompt only |
| TEE ↔ device knowledge | none | none — keyed by `answerMessageId`, not the device |

**Phase 1 — dApp freshness (near-term, ships alone).** Make on-chain **event-driven invalidation
the primary** mechanism, the poll a fallback: a dedicated WSS `watchContractEvent` filtered by the
user's address — `AnswerMessageAdded` / `ConversationBranched` / `ConversationMetadataUpdated` on
**EVMAIAgent** plus `PaymentFinalized` on **EVMAIAgentEscrow** — invalidates
`['conversations'|'usagePlan'|'tokenBalance']`. Two of these are **additions to the current watch
lists** (`liveResponseEvents.ts`): `ConversationAdded` (EVMAIAgent) is not in `AGENT_EVENT_NAMES`,
and `PaymentFinalized` is not in `ESCROW_EVENT_NAMES` — and because the events span two contracts,
this stays two `watchContractEvent` listeners (the existing agent/escrow split).
This is near-real-time **and cheaper** — query only when something actually changed; an idle device
holds a ~free WSS. **Decouple `syncWithRemote` from the read query** (background sync writes IndexedDB;
the read query reads it and is invalidated by the sync). Tune windows + make polls visibility-aware,
keeping the `getLastSyncedAt` catch-up reconcile as a missed-event safety net.

**Phase 2 — content-free push relay (optional UX).** A 1st-party (Cloud Run/Firebase) service wakes
**closed/background PWAs** where a WSS isn't held, sending a **content-free** "sync now" push (FCM);
the device then pulls + decrypts. The wallet→device-token map lives in the 1st-party backend, **not**
the TEE. Metadata only — never plaintext.

**Phase 3 — live streaming + multi-TEE (gated on scale + the spikes below).**

- **Live reasoning:** the claiming TEE already decrypts the prompt's ECIES envelope, so it holds the
  user's session key. It encrypts each reasoning chunk with that key and **publishes ciphertext to
  `topic(answerMessageId)`** on a broker (NATS / Redis Streams / PubSub). The device — which already
  holds `answerMessageId` from the `PromptSubmitted` receipt (param index 3) — subscribes and decrypts.
  The TEE never opens a connection *to* a device; it publishes to a topic. The final reasoning+answer
  is also persisted encrypted (durable plane) for late joiners / other devices. The dApp already has
  both sides of this structure: `chatSlice.addReasoningStepById` (live append) and
  `MessageFile.reasoning` (durable, the Area-6 shape).
  - *Security:* the broker sees only ciphertext + topic ids + timing. Be explicit about the trust
    level, though: because subscription uses a **wallet-signed token**, the broker operator can
    correlate **device IP ↔ wallet address ↔ specific `answerMessageId` activity, in real time**. The
    wallet↔prompt link is already public on-chain, but the chain doesn't tie it to device network
    identity or live timing — the broker does. This is acceptable only if the broker is **1st-party
    (trusted) infra that does not log subscription metadata beyond operational necessity**; it is not
    a zero-knowledge relay. Transport is verified via ROFL **remote attestation** (RA-TLS / a signed
    attestation in the subscribe handshake) so the device trusts only the genuine enclave; the
    wallet-signed token is defense in depth (the payload is ciphertext regardless).
- **Atomic distribution across TEEs:** on-chain prompt events feed a shared job table in the existing
  `sense-ai-shared-schema` Postgres; replicas claim with `FOR UPDATE SKIP LOCKED` + a lease/heartbeat
  (reclaim on replica death). **Correctness is already guaranteed** by the existing
  `isJobFinalized(answerMessageId)` re-check in `handlePrompt` — a second racer sees the job finalized
  and drops, so duplicate *answers* are impossible; the claim layer only minimizes wasted compute.
  **No wallet/device affinity is required** (optional `hash(user)` affinity later is a cache-warming
  optimization, not correctness).
- **Shared decryption identity** is the one true cross-replica requirement: all ROFL replicas must
  share **one app-scoped keypair** so any replica can decrypt any prompt's ECIES session-key envelope
  (and encrypt the live stream). Use ROFL `appd` app-identity key sealing.

## Consequences

- **Positive:** near-real-time cross-device freshness at lower subgraph cost (Phase 1, ships
  independently); live reasoning without ever coupling the TEE to devices; horizontal scaling with no
  device registry and no per-user→TEE routing; existing `isJobFinalized` guard already provides
  duplicate-answer safety.
- **Negative / cost:** a broker + attestation/authz layer for live streaming; a Postgres job-claim
  table replacing the single-instance `p-queue`/`failed-jobs.json`; the dApp must hold a WSS and
  reconcile missed events.
- **HIGH-risk spikes (gate Phase 3):** (1) **ROFL shared-app-key derivation across replicas** — verify
  `rofl-appd` sealing semantics; without it, threshold/MPC decryption or client-side TEE selection is
  required (much harder). (2) **Live↔durable reasoning consistency** — the streamed reasoning must
  equal the persisted `Message.reasoning[]`; generate once inside the enclave, emit to both sinks.
- **Alternatives rejected:** a direct device↔TEE realtime channel for *sync* (the wrong tool — the TEE
  should write to chain/storage and publish to a prompt topic, not hold device connections); per-user
  sticky routing to a TEE (unnecessary — the chain decouples devices from TEEs); shortening cache
  windows "for security" (the windows are not a security boundary).

The multi-device e2e suite (CU-86d3bawhh) is the Phase-1 regression safety net, and once event-driven
invalidation lands, the "live convergence on an already-open device" case also becomes cleanly
testable (today it is verified by opening a fresh device, since a fetched query only re-syncs on its
5-minute poll).

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
related events — but the poll is still the _primary_ freshness driver. Phase 1 below flips that
primacy (events primary, poll fallback) and adds the events not yet watched; it is an incremental
change, not a greenfield event build.

Two pressures push beyond polling:

1. **Cross-device freshness** — an idle second device can lag up to 5 minutes behind. Acceptable
   today, but coarse, and the read query couples two concerns: `useConversations`' `queryFn` runs
   `syncWithRemote` (subgraph → IndexedDB) **and then** reads IndexedDB, so you cannot read the
   local cache without triggering a network sync, nor sync more often than `staleTime` allows.
2. **Live reasoning** — streaming reasoning tokens _as they generate_ is high-frequency and
   ephemeral. It cannot ride on-chain events or storage-then-poll.

A naive "stream from the TEE to the device" reintroduces device↔TEE coupling and, once the oracle
scales to multiple ROFL TEEs, the question "which TEE has my prompt and does it know my devices?".

### Cache windows are not a security boundary

Tuning these windows is a UX + RPC-cost tradeoff, **not** a security one:

- Conversation data is encrypted at rest with an **in-memory-only** session key (verified by
  T-SEC-06: no plaintext in IndexedDB). Cache duration does not change that.
- Over-spend is enforced **on-chain** by the escrow spending limit (T-MULTI-06 shows a second device
  observing the shared deduction); the displayed allowance is advisory. A stale balance only risks a
  _failed tx_, never an actual double-spend.

## Decision

Model freshness as **two planes**, and keep the TEE coupled to the **prompt**, never to the device.

|                        | Durable plane                               | Live plane                                        |
| ---------------------- | ------------------------------------------- | ------------------------------------------------- |
| Carries                | final answer + reasoning, encrypted at rest | reasoning tokens as they generate                 |
| Transport              | chain events + storage + subgraph           | encrypted pub/sub keyed by `answerMessageId`      |
| Lifetime               | permanent, cross-device                     | ephemeral, in-flight prompt only                  |
| TEE ↔ device knowledge | none                                        | none — keyed by `answerMessageId`, not the device |

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
  The TEE never opens a connection _to_ a device; it publishes to a topic. The final reasoning+answer
  is also persisted encrypted (durable plane) for late joiners / other devices. (Superseded for the
  live plane: see "Live plane as agreed" below. The live side is an overlay in memory, not a Redux
  append.)
  - _Security:_ the broker sees only ciphertext + topic ids + timing. Be explicit about the trust
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
  and drops, so duplicate _answers_ are impossible; the claim layer only minimizes wasted compute.
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
- **Alternatives rejected:** a direct device↔TEE realtime channel for _sync_ (the wrong tool — the TEE
  should write to chain/storage and publish to a prompt topic, not hold device connections); per-user
  sticky routing to a TEE (unnecessary — the chain decouples devices from TEEs); shortening cache
  windows "for security" (the windows are not a security boundary).

The multi-device e2e suite (CU-86d3bawhh) is the Phase-1 regression safety net, and once event-driven
invalidation lands, the "live convergence on an already-open device" case also becomes cleanly
testable (today it is verified by opening a fresh device, since a fetched query only re-syncs on its
5-minute poll).

### Current behaviour confirmed by e2e (2026-06-21, [CU-86d3dvxdy](https://app.clickup.com/t/86d3dvxdy))

The e2e Area-11 work tried to assert live convergence on an _idle_ second device and confirmed it is
not reliable today, with a sharper edge than the "5-minute lag" framing above:

- The existing `useLiveResponse` event path _is_ eligible to update an idle device (the same-wallet
  gate `args.user === ownerAddress` passes for a second device of the same wallet), but live delivery
  rides `useContractEvents({ watch:true, useIndexer:false })`, whose RPC filters "intermittently miss
  events" (the hook's own comment, wevm/wagmi#3883). The only backstop — the effect-6 fallback poll —
  is gated on `activeConversationId && pendingAnswerRef.current`, so it helps **only** a device
  awaiting its **own** answer in the open conversation, never a passive observer.
- Consequence for an idle device: `['conversations']` still reconverges on its 5-min `refetchInterval`,
  but **`['usagePlan']` has no `refetchInterval` at all** (60s `staleTime` + `refetchOnWindowFocus`
  only) — so a missed event leaves usage/spent stale **until window-focus or remount**, not merely for
  5 minutes. Phase 1 should give `usagePlan` a bounded background poll (or rely on the new robust event
  layer) independent of active-conversation pending state.
- The desired behaviour is encoded as `test.fixme` `T-LIVE-01`/`T-LIVE-02` in
  `e2e/specs/live-sync.spec.ts` — un-fixme when Phase 1 lands.

### Live plane as agreed (2026-11-21)

The live plane is built without a broker, and it differs from the Phase 3 sketch above in four ways:

- **Served by the TEE, keyed by the answer, not by the device.** The oracle answering a prompt
  runs a small HTTP server in its ROFL TEE: `GET /stream/{answerMessageId}`. It holds only
  ciphertext frames per answer in memory and never learns which device reads them.
- **Proof of key, no wallet token.** The reader proves it holds the prompt's session key with
  `X-SenseAI-Stream-Proof` = base64url(HMAC-SHA256(session key, `senseai-stream:` + answer id)).
  The oracle hands the server only the expected proof, never the key. No wallet-signed token is
  sent, so nothing ties a device's network identity to a wallet beyond what the chain already
  shows. The proof travels in a header, so the dApp reads with `fetch()`, not `EventSource`,
  and the proof stays out of URLs and access logs.
- **Live equals stored.** Each frame (reset, sources, step, attempt, answer, done) is sealed with
  the session key as the answer file is, and the stored reasoning and sources are a projection
  of the same frames. The answer frame is sent only after the oracle's own `submitAnswer` is
  mined. When the stored answer lands, the dApp compares it with what it showed and reports a
  difference by kind only; the stored record is always what is rendered.
- **An overlay, never a store.** The dApp keeps what it shows in memory (`src/lib/liveReasoning/`,
  `useLiveReasoning`), writes none of it to IndexedDB, Redux, the query cache or browser storage,
  and keeps every chat rule (composer, cancel, paid sends) on the stored messages. With
  `VITE_REASONING_STREAM_URL` unset or the stream unreachable the chat is exactly as before.

The interface contract (names, limits, refusals, the shared test vector) lives in
`tokenized-ai-agent/oracle/src/stream/streamContract.js` and its dApp copy
`src/lib/liveReasoning/contract.ts`; a change to one is a change to both. What still rests on
measurement on real ROFL (where TLS ends, proxy buffering and idle limits, which set
`VITE_REASONING_STREAM_MODE` and the server's timings) is recorded with the Phase 0 findings.

### Accepted limits of the live plane (2026-11-22)

Known and accepted as they are; each is bounded, and the stored record is what is finally shown.

- **An answer's state is answered before its proof is checked.** Whether an answer id is open,
  finished, dropped or unknown shows in the status code without a proof. Answer ids and
  submissions are already public on chain, so this adds only when the TEE started and finished
  a job.
- **A proof is fixed for each key and answer.** It works for the whole run from anywhere, and
  what it yields is ciphertext. Reader places per answer are capped; closing the oldest reader
  in place of refusing the newest is a possible later change.
- **An interrupted run that no successful run follows.** Its steps are shown as retrying and are
  stored nowhere. This is the one place something shown is not also stored, and it lasts only
  while the page is open and the answer is still awaited.
- **A frame's type is inside its ciphertext.** The reader refuses a frame over the answer frame
  limit before decoding it; a smaller frame of another type that is over that type's own limit
  is decrypted and parsed, then refused. The type stays encrypted, but frames are not padded:
  anyone who sees the traffic (record sizes and timing on the wire, or the `data:` lengths for
  a proof holder) can tell the frame types apart and learns the number of steps and attempts,
  each step's length and timing, and the answer's length before it is stored. It sees no
  plaintext, and the stored answer file's size is public anyway.
- **The server holds at most 1 MiB of frames per answer**, below the largest run the contract
  allows on paper. A run past it gets a 503 on the stream and the chat shows the stored answer
  when it lands.

### Connections behind the ROFL proxy (2026-11-26)

The ROFL proxy in front of the oracle's stream server closes every connection about 30 s after it
opens, whether frames are passing or not (measured on a Sapphire testnet machine, 2026-11-25; the
proxy's passthrough mode has the same limit, and its documentation names no setting for it). The
live plane is built around that:

- **The server ends each connection at 25 s** (`STREAM_MAX_CONN_MS`; 30 s or more stops the
  oracle's start-up), so a stream is ended cleanly and never cut. The reader reconnects from its
  cursor and the frames made meanwhile are sent first on the new connection. A server that
  disconnects at will and a client that resumes by event id is the pattern of the HTML standard's
  server-sent events and of the Model Context Protocol's SEP-1699.
- **The reader follows a quiet connection at once** when the server held it open 10 s or more
  (`HELD_OPEN_MS`), rather than waiting the `retry:` line.
- **No overlap of the old and new connection.** Measured beside the plain reader on the same
  answer, it gave the same lateness: ordinary network jitter is larger than a reconnect.
- **The server does not send `Connection: close`** (agreed by Garrick, 2026-11-26). Measured in
  Chromium, Firefox and WebKit on the same answer, with and without it: no frame was lost or
  repeated either way and frame lateness was the same, but with the header a reconnect took about
  200 ms longer in Chromium and Firefox (about 600 to 800 ms against 400 to 640 ms). WebKit keeps
  its connection for the next stream; the proxy ends that second stream at about 20 s, which WebKit
  reads as a normal end, and its reconnect on the kept connection takes about 100 ms. Keeping
  connections is HTTP/1.1's default and the header would fix no fault a browser sees; the reader
  resumes from its cursor however a stream ends.

What a user sees: a reconnect about every 25 s while an answer is awaited, about 0.1 to 0.6 s to
the next first byte, and a frame that lands in it shown that much late. To be read again on a
mainnet machine before launch; a real Safari on a device has not been measured.

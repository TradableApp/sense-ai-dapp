# 11. Answer ratings are stored under an id only the session key holder can compute

**Status:** Accepted
**Applies to:** `sense-ai-dapp` (the rating id, the send and the read); the `submitAiFeedback`
callable and the Firestore rule live in `Tradable`
**Date:** 2026-11-27

## Context

A user can rate an answer with a thumbs up or down. The dApp sent each rating to the
`submitAiFeedback` callable with the wallet address, the conversation id, the message id, the
prompt's id and the value, so the stored record named the wallet and the conversation it came
from. Conversations are otherwise private to the wallet: their content is encrypted on the
device with the session key.

The requirements were: a rating can be saved, changed, removed and shown again on another
device of the same wallet; nothing stored with it names the wallet, the conversation or the
message; only the user can find their own rating; and the backend can still tell which network
and agent a rating is for.

## Decision

1. **The id is keyed by the session key.** The document id is
   base64url(HMAC-SHA256(session key, `senseai-rating:` + chain id + `:` + agent address in lower
   case + `:` + conversation id + `:` + message id)), 43 characters (`ratingDocId`,
   `src/lib/answerRating.ts`; every part is checked first). The HMAC is shared with the live
   reasoning stream's proof (`src/lib/sessionKeyHmac.ts`), whose label is `senseai-stream:`, so
   a rating id and a stream proof are never equal.
2. **One way in.** A rating is sent only through `submitAiFeedback` with
   `{ docId, feedbackValue, chainId, agentAddress }` (`src/lib/feedbackService.ts`): no wallet
   address and no conversation or message id. Pressing the same rating again sends `null`, which
   removes it.
3. **Read one document by id.** Ratings are read one document at a time by id
   (`readAnswerRating`), one query per answer shown, read once and kept, at most four at once
   through one shared limiter; a saved rating is put into that cache, and another device's change
   shows after a reload. The query key is
   `['answerRating', ownerAddress, conversationId, messageId]`: it carries neither the session
   key nor the rating id.
4. **The rule allows a get by the id's shape only.** The Firestore rule for `senseai_feedback`
   allows a client to get a document only under the rating id's shape, and allows no list and no
   client write; the callable writes.
5. **The id stays on the device.** It never goes into a URL, a log line, a report or a query key,
   and errors are logged by name only.

The `ratings-by-session-key` guard keeps the collection named in `answerRating.ts` alone (which
only gets a document by id), the id computed only by the send and the read, the send free of the
wallet address, and the id out of log and report calls.

## Consequences

- **Positive:** a stored rating names no wallet, conversation or message, and the collection
  cannot be listed by a client; the user's devices find the same rating because they derive the
  same session key for the same wallet, site and chain; the backend still sees the network, the
  agent and the value, which is what a count of ratings per deployment needs.
- **The rating follows the key.** A new session message version, or another key for the same
  wallet, gives new ids: ratings made under the old key are no longer shown. They are not
  deleted.
- **Who else can compute an id:** the session key is wrapped for the oracle with each paid
  request, so the oracle could compute the ids of that wallet's ratings as well. Nobody without
  the key can.
- **Negative:** ratings cannot be grouped by user or by conversation on the backend, and a rating
  cannot be joined to the answer it rates without the key. A change made on another device shows
  only after a reload. Ratings written before this change are under ids the dApp never computes,
  so it does not read them. The dApp change depends on the callable and the rule being deployed
  with it.
- **Alternatives rejected:**
  - _Keep the wallet, conversation and message ids in the record:_ the record names the wallet
    and its conversations, against the privacy of everything else the dApp stores.
  - _A plain hash of the ids:_ its inputs are not secret (the wallet address is public and the
    agent counts conversation and message ids), so the id would not be the user's alone.
  - _Store ratings only on the device:_ they would not reach the user's other devices, and the
    backend could not count them.
  - _Reuse the stream proof's value:_ one value would serve two purposes; the separate label
    keeps a rating id and a stream proof from ever being equal.

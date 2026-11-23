# 8. A remote switch closes paid actions per network and agent

**Status:** Accepted
**Applies to:** `sense-ai-dapp` (the reader and the gate); the Firestore rule lives in
`Tradable`, the owner's close/open script in `sense-ai-e2e`
**Date:** 2026-11-20

## Context

Changing the contract pair, maintenance and incidents need every running copy of the dApp
(open tabs, installed PWAs) to stop taking new payments for one pair, without a reload and
without a contract change. Until now the only way was a
runbook: deploy a build and hope every copy reloads. A copy that kept running would go on
paying into a pair that is being retired.

The requirements were: one switch, read live; while closed, prompt, regenerate,
edit-and-resend, branch, rename, delete and setting a plan are refused before anything is
built, while cancelling, refunding and revoking a plan still work; a banner says why in
words that live in the app; the closure survives a reload, offline included; it is scoped
to the network and agent a build is for; and one place in the code decides whether a paid
action may go ahead.

## Decision

**a. Where it lives: a Firestore document**, read-only to the dApp, written only by the owner
through the Firestore API with their own credentials (the client rule refuses every write).
The rule is `allow get: if true; allow list, write: if false;`.

**b. Scope: keyed by chain id and agent**, `senseai_prompts_switch/{chainId}_{agentLower}`.
There is no global document.

**c. What an unreadable switch means.** Only the server's word changes the state. A document
the server confirms is absent is open; `closed: true` is closed; `closed: false` is open; a
document that is present but malformed (or names a reason this build does not know) is
closed, in generic words, and reported once per page load by its shape. An error, an
offline start or a cached answer is unknown, and the last confirmed state is kept; a
confirmed closure is saved in `localStorage` and cleared by a confirmed open. With nothing
heard and nothing saved, unknown stops nothing.

**d. Payload: reason codes only**, `{ closed, reason: 'pair-retired' | 'maintenance' |
'incident', updatedAt }`. Each code maps to wording in the app; no text from the document is
ever shown. There is no minimum build: the `pair-retired` wording asks for a reload.

In the dApp, `usePaymentGate` joins the switch to the fee token check and is the only reader
of either: every paying mutation refuses through it (`PaymentSwitchedOffError`), every
control for a paid action asks it, and `PaymentsSwitchedOffBanner` shows the switch's notice
first and any fee token notice after it. One `onSnapshot` per page feeds a store read with
`useSyncExternalStore`, so a change reaches every open copy with no reload.

## Consequences

- **Positive:** the owner can close one pair without a deploy or a contract change; an open
  tab stops and restarts payments live; a malformed write closes rather than opens and is
  reported; an outage changes nothing; a hostile or mistaken write cannot move funds, block
  money coming back or put text on the page.
- **Negative:** a write by someone with the owner's permissions can close a pair (denial of
  service) or reopen it during a switch. Copies older than this change never hear the switch,
  nor does a copy that is offline from its start, has Firestore blocked or never had an
  answer, so the switch cannot be the only safeguard when a pair is retired. A signature already in the wallet when the switch closes cannot be
  recalled. App Check with Firestore reads in the PWA, how fast a backgrounded or installed
  app hears a change, and a mobile wallet's in-app browser keeping the listener can only be
  proven in a deployed environment. Writes to the document are recorded only if the owner
  turns on Firestore's data access audit logging, which is the owner's choice.
- **Negative (by decision c):** with nothing saved, a paid send can go through before the
  server's first answer; a browser that refuses storage and is reloaded while offline reads as
  unknown, which is open. Saved closures for a retired pair stay on the device (keyed by that
  pair, so they close nothing else). A listener that cannot read the document (rules not
  deployed, App Check refusing, a blocked host) is reported to Sentry, but it cannot close a
  tab: such a tab keeps its last state.
- **Alternatives rejected:**
  - _Where:_ an on-chain flag (needs a contract upgrade; pausing the escrow was ruled out);
    Remote Config (its SDK is not loaded, and it caches for 12 hours); a static JSON file
    (polling only, and tied to hosting deploys).
  - _Scope:_ one global flag (one wrong write closes every network, and the old and new pair
    cannot differ during a switch).
  - _Unreadable:_ unknown = closed (an outage or a failed attestation would stop every
    payment).
  - _Payload:_ free text (an injection risk, and the wording would leave the app's control);
    a minimum build number (the reload wording covers it).

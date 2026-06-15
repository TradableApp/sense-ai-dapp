# 1. Single source of truth for chat message state

**Status:** Accepted — deferred to post-testnet (tracked: ClickUp `86d3bk3cg`)
**Date:** 2026-06-14

## Context

Chat messages currently live in **two** places that must be hand-kept-in-sync:

- **Redux** `chatSlice.activeConversationMessages` — what `Chat.tsx` renders.
- **TanStack Query** (IndexedDB-backed, hydrated from The Graph by `syncService`) — `messagesFromQuery`.

A hand-rolled heuristic, `isQueryAhead` (`src/features/chat/messageReconcile.ts`), reconciles
the two on every query settle, deciding whether to overwrite Redux with the query.

This seam was the root cause of a whole class of bugs found during e2e hardening (CU-86d3bawhh):

- **Stuck composer after cancel** — a stale query re-hydrated a placeholder that cancel had removed.
- **Wiped optimistic placeholders** — `isQueryAhead` could not distinguish a *dropped cancelled*
  placeholder from a *fresh pending* one (resend / regenerate / edit are structurally identical
  in the message arrays), so it either left the composer stuck or wiped a legitimate placeholder
  (regenerate's version pager vanished).
- **A silently no-op'd invalidation** — `deleteMessageFromConversation` keyed the messages query
  with `sessionKey`, which the query never had, so the invalidation did nothing.
- **A tombstone set** (`cancelledAnswerIdsRef`) that only exists because the two stores can disagree.

Each fix patched a reconciliation race. The dual store is the underlying smell.

## Decision

Make **TanStack Query the single source of truth** for message state, with the standard
optimistic-mutation lifecycle, and have the component read it directly:

- `onMutate` → cancel in-flight refetches, snapshot, optimistically patch the query cache
  (add placeholder on submit / remove on cancel).
- `onError` → roll back to the snapshot.
- `onSettled` → invalidate to reconcile against authoritative chain state.

This removes `isQueryAhead`, the `cancelledAnswerIdsRef` tombstone, the hydrate `useEffect`,
and the query-key-mismatch class of bug. Redux keeps only UI state (active conversation id,
modals), **not** the message list.

**We defer the refactor to after testnet.** It touches the core data flow (`Chat.tsx`,
`useChatMutations`, `useLiveResponse`, `syncService`, `dataService`, `chatSlice`) and is too
risky to do mid-bugfix before there is a deploy target. The now-green e2e suite (cancel /
versions / chat / refunds, and the upcoming history/branching migration) is the safety net
that makes the refactor safe to attempt.

## Consequences

- **Positive:** eliminates the reconciliation-race bug class; less code (one store, no heuristic);
  one canonical query key everywhere; idiomatic TanStack patterns are well understood.
- **Negative / risk:** large blast radius across the core data flow; must be done as a focused
  effort with the e2e suite green first.
- **Interim:** until the refactor lands, the gaining-only `isQueryAhead` + the explicit
  `cancelledAnswerIdsRef` tombstone (a recognised deletion-tombstone pattern) are the correct,
  validated fixes within the current architecture — not to be removed piecemeal.

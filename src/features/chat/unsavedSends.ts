import { useCallback, useMemo, useSyncExternalStore } from 'react';

import type { QueryClient } from '@tanstack/react-query';

/** Which paid send it was (a prompt or an edit, regenerate, branch). */
export type SendKind = 'prompt' | 'regenerate' | 'branch';

/** The key the new-chat composer is held under: a new conversation has no id until sent. */
export const NEW_CONVERSATION_KEY = 'new';

/**
 * A paid send that was confirmed on chain but not saved on this device. While it is held,
 * the composer of its conversation cannot send (a prompt would thread off the answer before
 * it, a silent fork), and regenerate and branch on the affected answer are off (a second press
 * would pay again). Cancel and refund are never held.
 *
 * It ends at whichever comes first:
 * - its message is in its conversation's stored messages (or, for a branch, the branch is in
 *   the stored list). That is the state an ordinary save leaves, so from there the chat works
 *   as it does after any send: the answer is awaited, and what a prompt threads off is right.
 * - a reading of the wallet's pending count is below the highest seen since the hold began
 *   (the count known when it began included), or is zero (`endsHoldAt`; not for a branch,
 *   whose fee is paid directly and moves no count). Every reading counts, not only a change:
 *   the answer can land before the hold exists (a save given up on after 30 s), and the count
 *   is then back where it was with nothing changing. The oracle answered, or the user
 *   cancelled or was refunded, a pending prompt, and the sync brings this one's history in.
 *   The highest seen, not the count at the start alone: a count read before the send was
 *   counted is one too low, and the hold would then wait for every other pending prompt. If
 *   the fall was another device's prompt, the hold ends early and the warning, which stays up
 *   until closed, is still what stands between the user and a second payment.
 *
 * Kept in memory per query client, as the lock's count is, so a chat left and opened again
 * still holds; a reload ends it, and the sync then shows what the chain has. Every reason a
 * hold gives says to reload the page if it stays.
 */
export interface UnsavedSend {
	owner: string;
	kind: SendKind;
	/** Conversations whose composer is held; `NEW_CONVERSATION_KEY` for the new-chat one. */
	composerKeys: readonly string[];
	/** The answer whose regenerate and branch are off, in its conversation. */
	answer: { conversationKey: string; answerId: string } | null;
	/** Ends the hold once this message is in this conversation's stored messages. */
	shownAs: { conversationKey: string; messageId: string } | null;
	/** Ends the hold once this conversation is in the stored list. */
	listedAs: string | null;
	/** Ends the hold when the wallet's pending count is seen to fall. */
	endsOnPendingFall: boolean;
}

/** What this device has stored now, as the chat reads it. */
export interface ShownNow {
	conversationKey: string | null;
	storedMessageIds: readonly string[];
	listedConversationIds: readonly string[];
}

type Fields = Record<string, unknown>;

const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null;

/** A non-empty id as a string, or null: ids are numeric strings, and 0 means none here. */
function idOf(value: unknown): string | null {
	if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') {
		return null;
	}
	const id = String(value);
	return id === '' || id === '0' ? null : id;
}

function promptHold(variables: Fields, data: Fields, owner: string): UnsavedSend | null {
	const promptId = idOf(data.promptMessageId);
	const sentIn = idOf(variables.conversationId);
	const conversationKey = sentIn ?? idOf(data.conversationId);
	if (!promptId || !conversationKey) return null;
	const parentId = idOf(variables.parentId);
	return {
		owner,
		kind: 'prompt',
		composerKeys: sentIn ? [sentIn] : [NEW_CONVERSATION_KEY, conversationKey],
		answer: sentIn && parentId ? { conversationKey, answerId: parentId } : null,
		shownAs: { conversationKey, messageId: promptId },
		// A new conversation is listed once its first answer is indexed.
		listedAs: sentIn ? null : conversationKey,
		endsOnPendingFall: true,
	};
}

function regenerateHold(variables: Fields, data: Fields, owner: string): UnsavedSend | null {
	const conversationKey = idOf(variables.conversationId);
	const answerId = idOf(variables.originalAnswerMessageId);
	const newAnswerId = idOf(data.newAnswerMessageId);
	if (!conversationKey || !answerId || !newAnswerId) return null;
	return {
		owner,
		kind: 'regenerate',
		composerKeys: [conversationKey],
		answer: { conversationKey, answerId },
		shownAs: { conversationKey, messageId: newAnswerId },
		listedAs: null,
		endsOnPendingFall: true,
	};
}

function branchHold(variables: Fields, data: Fields, owner: string): UnsavedSend | null {
	const conversationKey = idOf(variables.originalConversationId);
	const answerId = idOf(variables.branchPointMessageId);
	const branchId = idOf(data.newConversationId);
	if (!conversationKey || !answerId || !branchId) return null;
	// A branch adds nothing to the conversation it came from, so that composer threads off
	// the right answer and is not held.
	return {
		owner,
		kind: 'branch',
		composerKeys: [],
		answer: { conversationKey, answerId },
		shownAs: null,
		listedAs: branchId,
		endsOnPendingFall: false,
	};
}

const HOLD_BY_KIND = { prompt: promptHold, regenerate: regenerateHold, branch: branchHold };

/** What a send's variables and receipt say to hold, or null when they say nothing usable. */
export function unsavedSendFor(
	kind: SendKind,
	variables: unknown,
	data: unknown,
	owner: string,
): UnsavedSend | null {
	if (!isFields(variables) || !isFields(data)) return null;
	return HOLD_BY_KIND[kind](variables, data, owner);
}

/** A held send and the highest pending count seen for its wallet since it began. */
interface HeldEntry {
	send: UnsavedSend;
	peak: bigint | null;
}

interface HoldStore {
	entries: readonly HeldEntry[];
	/** The last reading of each wallet's pending count. */
	latestCount: Map<string, bigint>;
	listeners: Set<() => void>;
}

const storeByClient = new WeakMap<QueryClient, HoldStore>();

function storeFor(queryClient: QueryClient): HoldStore {
	const known = storeByClient.get(queryClient);
	if (known) return known;
	const store: HoldStore = { entries: [], latestCount: new Map(), listeners: new Set() };
	storeByClient.set(queryClient, store);
	return store;
}

function replaceEntries(store: HoldStore, entries: readonly HeldEntry[]): void {
	// An external store, its list replaced and announced, as useSyncExternalStore expects.
	// eslint-disable-next-line no-param-reassign
	store.entries = entries;
	store.listeners.forEach(listener => listener());
}

export function holdUnsavedSend(queryClient: QueryClient, send: UnsavedSend): void {
	const store = storeFor(queryClient);
	const peak = store.latestCount.get(send.owner) ?? null;
	replaceEntries(store, [...store.entries, { send, peak }]);
}

function isShown(send: UnsavedSend, shown: ShownNow): boolean {
	const isMessageStored =
		send.shownAs !== null &&
		send.shownAs.conversationKey === shown.conversationKey &&
		shown.storedMessageIds.includes(send.shownAs.messageId);
	const isListed = send.listedAs !== null && shown.listedConversationIds.includes(send.listedAs);
	return isMessageStored || isListed;
}

/** Ends the holds of `owner` that what is stored now shows. */
export function endShownSends(queryClient: QueryClient, owner: string, shown: ShownNow): void {
	const store = storeFor(queryClient);
	const kept = store.entries.filter(({ send }) => send.owner !== owner || !isShown(send, shown));
	if (kept.length !== store.entries.length) replaceEntries(store, kept);
}

/**
 * Whether a reading of the pending count ends a hold whose highest count seen is `peak`
 * (null when none was known): a reading of zero, or one below the peak. See `UnsavedSend`.
 */
export function endsHoldAt(peak: bigint | null, count: bigint): boolean {
	return count === 0n || (peak !== null && count < peak);
}

const higher = (peak: bigint | null, count: bigint) =>
	peak === null || count > peak ? count : peak;

/** A reading of `owner`'s pending count: ends the holds it ends, and raises the others' peak. */
export function notePendingCount(queryClient: QueryClient, owner: string, count: bigint): void {
	const store = storeFor(queryClient);
	store.latestCount.set(owner, count);
	const isCounted = ({ send }: HeldEntry) => send.owner === owner && send.endsOnPendingFall;
	if (!store.entries.some(isCounted)) return;
	const kept = store.entries.flatMap(entry => {
		if (!isCounted(entry)) return [entry];
		if (endsHoldAt(entry.peak, count)) return [];
		const peak = higher(entry.peak, count);
		// The same entry when nothing moved, so a steady count announces nothing.
		return [peak === entry.peak ? entry : { ...entry, peak }];
	});
	const isChanged = kept.some((entry, index) => entry !== store.entries[index]);
	if (kept.length !== store.entries.length || isChanged) replaceEntries(store, kept);
}

const NONE: readonly UnsavedSend[] = [];

/** The unsaved sends held for `owner` in this query client, the same list until it changes. */
export function useUnsavedSends(
	queryClient: QueryClient,
	owner: string | null | undefined,
): readonly UnsavedSend[] {
	const store = storeFor(queryClient);
	const subscribe = useCallback(
		(listener: () => void) => {
			store.listeners.add(listener);
			return () => {
				store.listeners.delete(listener);
			};
		},
		[store],
	);
	const entries = useSyncExternalStore(subscribe, () => store.entries);
	return useMemo(() => {
		const sends = owner ? entries.filter(entry => entry.send.owner === owner) : [];
		return sends.length > 0 ? sends.map(entry => entry.send) : NONE;
	}, [entries, owner]);
}

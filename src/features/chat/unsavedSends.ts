import { useCallback, useMemo, useSyncExternalStore } from 'react';

import type { QueryClient } from '@tanstack/react-query';

import { HOLD_LASTS_MS, readSavedSends, writeSavedSends } from './unsavedSendsStorage';

export { HOLD_LASTS_MS };

/** Which paid send it was (a prompt or an edit, regenerate, branch). */
export type SendKind = 'prompt' | 'regenerate' | 'branch';

/** The key the new-chat composer is held under: a new conversation has no id until sent. */
export const NEW_CONVERSATION_KEY = 'new';

/** A message shown from a receipt, as the chat holds it. */
export interface ShownMessage {
	id?: string | number | null;
	[field: string]: unknown;
}

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
 * - a reading of the wallet's pending count whose request went out after the hold began is
 *   zero, or below the highest such reading (`endsHoldAt`; not for a branch, whose fee is
 *   paid directly and moves no count). Every reading counts, not only a change: the answer can
 *   land before the hold exists (a save given up on after 30 s), and the count is then back
 *   where it was with nothing changing. A reading asked for before the hold began says
 *   nothing about this send (sent before it was counted, or answered by a lagging node), so it
 *   neither ends the hold nor sets the count a later one is compared with. If the fall was
 *   another device's prompt, the hold ends early and the warning, which stays up until
 *   closed, is still what stands between the user and a second payment.
 * - `HOLD_LASTS_MS` (the refund timeout) after the send was confirmed: a refund can then be
 *   claimed and the stuck-request list shows the payment.
 *
 * Kept per query client, as the lock's count is, so a chat left and opened again still holds,
 * and saved per wallet and agent store (`unsavedSendsStorage.ts`: ids, kind, keys and the
 * time only), so a reload keeps it until one of the ends above. The prompt shown from its
 * receipt is kept with the hold in memory only (`shownPrompt`), and shown again when its
 * conversation is opened again.
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
	/** When the send was confirmed: the hold ends `HOLD_LASTS_MS` after it. */
	confirmedAt: number;
	/** The prompt shown from its receipt; in memory only, never saved. */
	shownPrompt?: readonly ShownMessage[];
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

/** What a send holds, before the time it was confirmed is added. */
type Hold = Omit<UnsavedSend, 'confirmedAt' | 'shownPrompt'>;

function promptHold(variables: Fields, data: Fields, owner: string): Hold | null {
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

function regenerateHold(variables: Fields, data: Fields, owner: string): Hold | null {
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

function branchHold(variables: Fields, data: Fields, owner: string): Hold | null {
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
	confirmedAt: number,
): UnsavedSend | null {
	if (!isFields(variables) || !isFields(data)) return null;
	const hold = HOLD_BY_KIND[kind](variables, data, owner);
	return hold && { ...hold, confirmedAt };
}

/**
 * A held send, when it began on this page (registered, or restored after a reload) and the
 * highest pending count read since then by a request sent after it began.
 */
interface HeldEntry {
	send: UnsavedSend;
	startedAt: number;
	peak: bigint | null;
}

interface HoldStore {
	entries: readonly HeldEntry[];
	/** The wallets whose saved holds have been read into this client. */
	restored: Set<string>;
	listeners: Set<() => void>;
}

const storeByClient = new WeakMap<QueryClient, HoldStore>();

function storeFor(queryClient: QueryClient): HoldStore {
	const known = storeByClient.get(queryClient);
	if (known) return known;
	const store: HoldStore = { entries: [], restored: new Set(), listeners: new Set() };
	storeByClient.set(queryClient, store);
	return store;
}

const ownerKey = (owner: string) => owner.toLowerCase();
const isOwners = (owner: string) => (entry: HeldEntry) =>
	ownerKey(entry.send.owner) === ownerKey(owner);

/** The same send, whatever page registered or restored it. */
const sameSend = (a: UnsavedSend, b: UnsavedSend) =>
	a.kind === b.kind &&
	a.confirmedAt === b.confirmedAt &&
	a.shownAs?.messageId === b.shownAs?.messageId &&
	a.listedAs === b.listedAs &&
	a.answer?.answerId === b.answer?.answerId;

/** Replaces the list and announces it; saves the holds of each wallet named in `owners`. */
function replaceEntries(store: HoldStore, entries: readonly HeldEntry[], owners: string[]): void {
	// An external store, its list replaced and announced, as useSyncExternalStore expects.
	// eslint-disable-next-line no-param-reassign
	store.entries = entries;
	owners.forEach(owner =>
		writeSavedSends(
			owner,
			entries.filter(isOwners(owner)).map(entry => entry.send),
		),
	);
	store.listeners.forEach(listener => listener());
}

/**
 * Reads `owner`'s saved holds into this client once. Done while a reader renders, before it
 * reads the list, so nothing is announced: the reader sees them in the same render.
 */
function restoreOnce(store: HoldStore, owner: string): void {
	const key = ownerKey(owner);
	if (store.restored.has(key)) return;
	store.restored.add(key);
	const now = Date.now();
	const restored = readSavedSends(owner, now)
		.filter(saved => !store.entries.some(entry => sameSend(entry.send, saved)))
		.map(send => ({ send, startedAt: now, peak: null }));
	// eslint-disable-next-line no-param-reassign
	if (restored.length > 0) store.entries = [...store.entries, ...restored];
}

export function holdUnsavedSend(
	queryClient: QueryClient,
	send: UnsavedSend,
	now: number = Date.now(),
): void {
	const store = storeFor(queryClient);
	restoreOnce(store, send.owner);
	replaceEntries(store, [...store.entries, { send, startedAt: now, peak: null }], [send.owner]);
}

/** Keeps the entries `keep` says to; saves and announces only when one was dropped. */
function keepEntries(store: HoldStore, owner: string, keep: (_entry: HeldEntry) => boolean) {
	const kept = store.entries.filter(entry => !isOwners(owner)(entry) || keep(entry));
	if (kept.length !== store.entries.length) replaceEntries(store, kept, [owner]);
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
	keepEntries(storeFor(queryClient), owner, ({ send }) => !isShown(send, shown));
}

/** Ends the holds of `owner` whose send was confirmed `HOLD_LASTS_MS` or more before `now`. */
export function endExpiredSends(queryClient: QueryClient, owner: string, now: number): void {
	keepEntries(storeFor(queryClient), owner, ({ send }) => send.confirmedAt + HOLD_LASTS_MS > now);
}

/**
 * Whether a reading of the pending count ends a hold whose highest count read since it began
 * is `peak` (null before any): a reading of zero, or one below the peak. See `UnsavedSend`.
 */
export function endsHoldAt(peak: bigint | null, count: bigint): boolean {
	return count === 0n || (peak !== null && count < peak);
}

const higher = (peak: bigint | null, count: bigint) =>
	peak === null || count > peak ? count : peak;

/**
 * A reading of `owner`'s pending count whose request went out at `requestedAt`. It ends the
 * holds it ends and raises the others' peak, counting only for holds that began before the
 * request went out.
 */
export function notePendingCount(
	queryClient: QueryClient,
	owner: string,
	count: bigint,
	requestedAt: number,
): void {
	const store = storeFor(queryClient);
	const isCounted = (entry: HeldEntry) =>
		isOwners(owner)(entry) && entry.send.endsOnPendingFall && requestedAt >= entry.startedAt;
	if (!store.entries.some(isCounted)) return;
	const kept = store.entries.flatMap(entry => {
		if (!isCounted(entry)) return [entry];
		if (endsHoldAt(entry.peak, count)) return [];
		const peak = higher(entry.peak, count);
		// The same entry when nothing moved, so a steady count announces nothing.
		return [peak === entry.peak ? entry : { ...entry, peak }];
	});
	if (kept.length !== store.entries.length) replaceEntries(store, kept, [owner]);
	else if (kept.some((entry, index) => entry !== store.entries[index])) {
		// Only a peak moved: nothing saved changes, so the list is replaced without saving.
		replaceEntries(store, kept, []);
	}
}

/**
 * Keeps the prompt shown from its receipt with the hold of the send whose prompt is
 * `messageId`, in memory only, so the chat can show it again when its conversation is opened
 * again. It goes when the hold ends.
 */
export function attachShownPrompt(
	queryClient: QueryClient,
	owner: string,
	messageId: string,
	messages: readonly ShownMessage[],
): void {
	const store = storeFor(queryClient);
	const index = store.entries.findIndex(
		entry => isOwners(owner)(entry) && entry.send.shownAs?.messageId === messageId,
	);
	if (index === -1) return;
	const entry = store.entries[index];
	const entries = store.entries.map((each, at) =>
		at === index ? { ...entry, send: { ...entry.send, shownPrompt: messages } } : each,
	);
	replaceEntries(store, entries, []);
}

const NONE: readonly UnsavedSend[] = [];

/** The unsaved sends held for `owner` in this query client, the same list until it changes. */
export function useUnsavedSends(
	queryClient: QueryClient,
	owner: string | null | undefined,
): readonly UnsavedSend[] {
	const store = storeFor(queryClient);
	if (owner) restoreOnce(store, owner);
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
		const sends = owner ? entries.filter(isOwners(owner)) : [];
		return sends.length > 0 ? sends.map(entry => entry.send) : NONE;
	}, [entries, owner]);
}

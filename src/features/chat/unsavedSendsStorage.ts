import { resolveLocalStoreName } from '@/lib/localStoreName';
import { refundOpensAt } from '@/lib/refund';

import type { SendKind, UnsavedSend } from './unsavedSends';

/**
 * Saving the holds of paid sends that were confirmed but not saved here, so a reload keeps
 * them. What is saved is ids, the kind, conversation keys and the confirmation time: never
 * a prompt's text or any message content (the prompt shown from its receipt stays in memory).
 * Every storage access is wrapped: storage that throws leaves the holds in memory only.
 */

/**
 * How long a hold lasts at most: until the refund of its send is offered (the refund timeout
 * and `REFUND_UNLOCK_MARGIN_MS`), so the hold never ends while the Refund button is still locked.
 */
export const HOLD_LASTS_MS = refundOpensAt(0);

// A saved time this far ahead of the clock was not written by this build.
const CLOCK_SKEW_MS = 5 * 60_000;

const KINDS: readonly SendKind[] = ['prompt', 'regenerate', 'branch'];
const ID = /^\d{1,78}$/;
const NEW_CONVERSATION_KEY = 'new';

/** The agent store this build reads, or null when the build names none it could use. */
function agentStoreName(): string | null {
	try {
		return resolveLocalStoreName(
			import.meta.env.VITE_CHAIN_ID,
			import.meta.env.VITE_AGENT_CONTRACT_ADDRESS,
			import.meta.env.MODE,
		);
	} catch {
		return null;
	}
}

/** Where `owner`'s holds are saved for this build's agent store, or null when none can be. */
export function savedSendsKey(owner: string): string | null {
	const store = agentStoreName();
	return store ? `senseai:unsavedSends:${store}:${owner.toLowerCase()}` : null;
}

type Fields = Record<string, unknown>;
const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null;
const isId = (value: unknown): value is string => typeof value === 'string' && ID.test(value);

/** A saved `{ conversationKey, <idName> }`, null, or undefined when it is neither. */
function readPlace(value: unknown, idName: 'answerId' | 'messageId') {
	if (value === null) return null;
	if (!isFields(value) || !isId(value.conversationKey) || !isId(value[idName])) return undefined;
	return { conversationKey: value.conversationKey, id: value[idName] as string };
}

function isInForce(confirmedAt: unknown, now: number): confirmedAt is number {
	return (
		typeof confirmedAt === 'number' &&
		Number.isFinite(confirmedAt) &&
		confirmedAt <= now + CLOCK_SKEW_MS &&
		confirmedAt + HOLD_LASTS_MS > now
	);
}

/** A conversation's id as a hold names it: conversations are numbered from 1. */
const isConversationKey = (value: unknown): value is string => isId(value) && value !== '0';

function areComposerKeys(value: unknown): value is string[] {
	return (
		Array.isArray(value) &&
		value.every(key => key === NEW_CONVERSATION_KEY || isConversationKey(key))
	);
}

/** One saved hold rebuilt from the fields this build writes, or null if any is off. */
function readSend(value: unknown, owner: string, now: number): UnsavedSend | null {
	if (!isFields(value)) return null;
	const { kind, composerKeys, listedAs, endsOnPendingFall, confirmedAt } = value;
	const isOwners =
		typeof value.owner === 'string' && value.owner.toLowerCase() === owner.toLowerCase();
	if (!isOwners || !KINDS.includes(kind as SendKind) || typeof endsOnPendingFall !== 'boolean') {
		return null;
	}
	if (!isInForce(confirmedAt, now) || !areComposerKeys(composerKeys)) return null;
	if (listedAs !== null && !isId(listedAs)) return null;
	const answer = readPlace(value.answer, 'answerId');
	const shownAs = readPlace(value.shownAs, 'messageId');
	if (answer === undefined || shownAs === undefined) return null;
	return {
		owner: value.owner as string,
		kind: kind as SendKind,
		composerKeys,
		answer: answer && { conversationKey: answer.conversationKey, answerId: answer.id },
		shownAs: shownAs && { conversationKey: shownAs.conversationKey, messageId: shownAs.id },
		listedAs,
		endsOnPendingFall,
		confirmedAt,
	};
}

/** `owner`'s saved holds in force at `now`; anything this build did not write is ignored. */
export function parseSavedSends(
	raw: string | null,
	owner: string,
	now: number,
): readonly UnsavedSend[] {
	if (raw === null) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.flatMap(value => {
			const send = readSend(value, owner, now);
			return send ? [send] : [];
		});
	} catch {
		return [];
	}
}

/**
 * What is saved of a hold: ids, kind, keys and time, each field picked by name down to the
 * nested places, so nothing kept beside them in memory (the prompt shown) is ever written.
 */
function savedFields(send: UnsavedSend) {
	const { owner, kind, composerKeys, answer, shownAs, listedAs, endsOnPendingFall, confirmedAt } =
		send;
	return {
		owner,
		kind,
		composerKeys: [...composerKeys],
		answer: answer && { conversationKey: answer.conversationKey, answerId: answer.answerId },
		shownAs: shownAs && { conversationKey: shownAs.conversationKey, messageId: shownAs.messageId },
		listedAs,
		endsOnPendingFall,
		confirmedAt,
	};
}

/**
 * `owner`'s saved holds, or null when nothing can be read: storage that throws, or a build
 * that names no store. Null is not "none saved": it must not end a hold another tab saved.
 */
export function readSavedSends(owner: string, now: number): readonly UnsavedSend[] | null {
	const key = savedSendsKey(owner);
	if (!key) return null;
	try {
		return parseSavedSends(localStorage.getItem(key), owner, now);
	} catch {
		return null;
	}
}

/** Saves `owner`'s holds, or removes the entry when there are none; whether storage took it. */
export function writeSavedSends(owner: string, sends: readonly UnsavedSend[]): boolean {
	const key = savedSendsKey(owner);
	if (!key) return false;
	try {
		if (sends.length === 0) localStorage.removeItem(key);
		else localStorage.setItem(key, JSON.stringify(sends.map(savedFields)));
		return true;
	} catch {
		// The holds stay in memory for this page: a reload then shows what the chain has.
		return false;
	}
}

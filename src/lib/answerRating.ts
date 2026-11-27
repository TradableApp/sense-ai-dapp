import { doc, getDoc } from 'firebase/firestore';

import { db } from '@/config/firebase';
import sessionKeyHmac from '@/lib/sessionKeyHmac';

export type AnswerRating = 'like' | 'dislike';

/** Where ratings are stored. Named here only; this module only gets a document by its id. */
const RATING_COLLECTION = 'senseai_feedback';

/** Put first in the hashed message, so a rating id is never equal to any other session-key HMAC. */
const RATING_LABEL = 'senseai-rating:';

/**
 * The shape of a rating id: 32 bytes in base64url with no padding is 43 characters, and the last
 * one carries two zero bits, so it is one of 16. The server and the rules check the same shape.
 */
export const RATING_DOC_ID = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;

const CHAIN_ID = /^[1-9][0-9]*$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const DECIMAL_ID = /^(0|[1-9][0-9]*)$/;

export interface RatingTarget {
	chainId: string | number;
	agentAddress: string;
	conversationId: string | number;
	messageId: string | number;
}

const asText = (value: unknown): string =>
	typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : String(value ?? '');

/**
 * The id one answer's rating is stored under:
 * base64url(HMAC-SHA256(session key, "senseai-rating:" + chain id + ":" + agent address in lower
 * case + ":" + conversation id + ":" + message id)).
 *
 * Only the holder of the session key can compute it, so only they can read their rating back or
 * replace it. The chain and agent are part of it because a new agent counts its ids from 1 again.
 * Every part is checked first, and a part cannot hold the separator, so two different answers never
 * share a message. The id goes only to the callable and to a get of the one document: never into a
 * URL, a log line, a report or a query key.
 */
export async function ratingDocId(sessionKey: CryptoKey, target: RatingTarget): Promise<string> {
	const chainId = asText(target.chainId);
	const conversationId = asText(target.conversationId);
	const messageId = asText(target.messageId);
	if (!CHAIN_ID.test(chainId)) {
		throw new TypeError('A rating needs a chain id, a whole number above 0.');
	}
	if (typeof target.agentAddress !== 'string' || !ADDRESS.test(target.agentAddress)) {
		throw new TypeError('A rating needs the agent address, 0x followed by 40 hex digits.');
	}
	if (!DECIMAL_ID.test(conversationId) || !DECIMAL_ID.test(messageId)) {
		throw new TypeError('A rating needs canonical decimal conversation and message ids.');
	}
	const agent = target.agentAddress.toLowerCase();
	return sessionKeyHmac(
		sessionKey,
		`${RATING_LABEL}${chainId}:${agent}:${conversationId}:${messageId}`,
	);
}

/** The build's chain id and agent address (lower case), or null when either is unusable. */
export function ratingDeployment(): { chainId: string; agentAddress: string } | null {
	const chainId = String(import.meta.env.VITE_CHAIN_ID ?? '');
	const agentAddress = String(import.meta.env.VITE_AGENT_CONTRACT_ADDRESS ?? '');
	if (!CHAIN_ID.test(chainId) || !ADDRESS.test(agentAddress)) return null;
	return { chainId, agentAddress: agentAddress.toLowerCase() };
}

/** A stored record's value, or null for anything that is not a like or a dislike. */
export function parseRating(data: unknown): AnswerRating | null {
	if (data === null || typeof data !== 'object') return null;
	const value = (data as { feedbackValue?: unknown }).feedbackValue;
	return value === 'like' || value === 'dislike' ? value : null;
}

/** Reads one rating by its id: one get, null when there is none. */
export async function readAnswerRating(docId: string): Promise<AnswerRating | null> {
	if (!RATING_DOC_ID.test(docId)) throw new TypeError('Not a rating id.');
	if (!db) throw new Error('Firestore is not initialised.');
	const snapshot = await getDoc(doc(db, RATING_COLLECTION, docId));
	return snapshot.exists() ? parseRating(snapshot.data()) : null;
}

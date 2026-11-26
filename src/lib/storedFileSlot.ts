/**
 * Whether a decrypted storage file belongs to the slot it was fetched for. The indexer chooses
 * which file each slot (a conversation, a message, a message's search delta) points at, and the
 * storage hosts serve the bytes; decrypting with the wallet's key proves the oracle wrote the
 * file for this wallet, not for which slot. So each file is checked against the identifiers it
 * carries, as the oracle writes them (`oracle/src/formatters.js` in `tokenized-ai-agent`):
 * - a conversation file carries its `id` and the wallet it belongs to (`ownerAddress`, compared
 *   without regard to letter case; a file with none is refused, as the oracle has always written it);
 * - a message file carries its `id` and its `conversationId`;
 * - a search delta is `{ [messageId]: { cid: conversationId, c: keywords } }`, one key.
 * The conversation metadata file (`title`, `isDeleted`, `lastUpdatedAt`) carries no identifier,
 * so it cannot be tied to its conversation. What can be held is its kind: a file that carries a
 * field only a conversation file or a message file has is refused (`metadataFileFits`), and only
 * its three fields, each of its own type, are ever taken from it (`metadataFields`).
 *
 * Ids are compared as decimal strings, as the oracle writes them and the indexer serves them.
 */
import * as Sentry from '@sentry/react';

export type StoredFileKind = 'conversation' | 'metadata' | 'message' | 'search-delta';

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/** Whether a value is the id given, as text (a missing id never is). */
const isId = (value: unknown, id: string): boolean =>
	(typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') &&
	String(value) === id;

/** Whether a value is the wallet address given, as text, without regard to letter case. */
const isOwner = (value: unknown, ownerAddress: string): boolean =>
	typeof value === 'string' &&
	ownerAddress !== '' &&
	value.toLowerCase() === ownerAddress.toLowerCase();

export const conversationFileFits = (
	file: unknown,
	conversationId: string,
	ownerAddress: string,
): boolean =>
	isRecord(file) && isId(file.id, conversationId) && isOwner(file.ownerAddress, ownerAddress);

export const messageFileFits = (
	file: unknown,
	messageId: string,
	conversationId: string,
): boolean =>
	isRecord(file) && isId(file.id, messageId) && isId(file.conversationId, conversationId);

export function searchDeltaFits(
	delta: unknown,
	messageId: string,
	conversationId: string,
): boolean {
	if (!isRecord(delta)) return false;
	const keys = Object.keys(delta);
	if (keys.length !== 1 || keys[0] !== messageId) return false;
	const entry = delta[messageId];
	return isRecord(entry) && isId(entry.cid, conversationId);
}

/** Fields a conversation file or a message file carries and a metadata file never does. */
const NOT_METADATA_FIELDS = [
	'id',
	'conversationId',
	'ownerAddress',
	'role',
	'content',
	'parentCID',
];

export const metadataFileFits = (file: unknown): boolean =>
	isRecord(file) && !NOT_METADATA_FIELDS.some(field => field in file);

/** What a conversation record takes from its metadata file. */
export interface MetadataFields {
	title?: string;
	isDeleted?: boolean;
	lastUpdatedAt?: number;
}

/** The metadata file's three fields, each only when it has its own type; nothing else. */
export function metadataFields(file: unknown): MetadataFields {
	if (!isRecord(file)) return {};
	const { title, isDeleted, lastUpdatedAt } = file;
	return {
		...(typeof title === 'string' ? { title } : {}),
		...(typeof isDeleted === 'boolean' ? { isDeleted } : {}),
		...(typeof lastUpdatedAt === 'number' && Number.isFinite(lastUpdatedAt)
			? { lastUpdatedAt }
			: {}),
	};
}

const reported = new Set<StoredFileKind>();

/**
 * Reports a file that did not belong to its slot, once per page load per kind, by the kind
 * only: never the CID, an id, the wallet or anything the file holds. A report never throws.
 */
export function reportStoredFileMismatch(kind: StoredFileKind): void {
	if (reported.has(kind)) return;
	reported.add(kind);
	try {
		const error = new Error(
			`A stored ${kind} file did not belong to the slot it was fetched for; it was not stored and the sync cursor is held.`,
		);
		error.name = 'StoredFileMismatch';
		Sentry.captureException(error, {
			tags: { check: 'stored-file', mismatch: kind },
			fingerprint: ['stored-file-mismatch', kind],
		});
	} catch {
		// The file is already left out and the cursor held.
	}
}

/** Starts reporting afresh, as a page load does. For tests, which share this module. */
export function forgetStoredFileReports(): void {
	reported.clear();
}

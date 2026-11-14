import { decryptData, encryptData } from '@/lib/crypto';
import db from '@/lib/db';
import type { Message } from '@/lib/types';

/**
 * What a writer wants stored, given what is stored now (`null` when the conversation has no
 * stored messages yet). Returning `null` means "leave it as it is". It can run more than once
 * for one write, so it must depend only on its argument.
 */
export type MessageCacheMerge = (
	// eslint-disable-next-line no-unused-vars -- the name documents the type's parameter
	current: Message[] | null,
) => Message[] | null | Promise<Message[] | null>;

// A writer loses the race only when another write lands during its merge and encryption, a few
// milliseconds. Five in a row means something is writing in a loop, which is a bug to surface.
const MAX_ATTEMPTS = 5;

const readRow = (ownerAddress: string, conversationId: string) =>
	db.messageCache.get([ownerAddress, conversationId]);

const decryptMessages = async (
	sessionKey: CryptoKey,
	encryptedData: string | undefined,
): Promise<Message[] | null> => {
	if (!encryptedData) return null;
	const decrypted = await decryptData(sessionKey, encryptedData);
	// A blob that does not hold a list is treated as empty, so the next write repairs it.
	return Array.isArray(decrypted) ? (decrypted as Message[]) : [];
};

/**
 * The only way a conversation's stored messages are written.
 *
 * Several things write the same row: a prompt being sent, a sync, a branch rebuilding the
 * history it inherited, a cancel removing a placeholder. Each read the row, changed the list and
 * put it back, so whichever wrote last silently dropped what the other had stored in between.
 *
 * Here the write happens only if the row is still the one the merge was given. The check and
 * the put share one IndexedDB transaction, so nothing can land between them; if the row changed
 * first, the merge runs again on what is stored now. Encryption stays outside the transaction:
 * IndexedDB commits a transaction as soon as it is left waiting on anything that is not its own
 * request, and Web Crypto is such a wait. Every encryption uses a fresh IV, so two rows are the
 * same row exactly when their ciphertext is the same string.
 *
 * @returns The messages now stored (what the merge returned, or what was already there when it
 *          returned `null`).
 */
export const writeMessageCache = async (
	sessionKey: CryptoKey,
	ownerAddress: string,
	conversationId: string,
	merge: MessageCacheMerge,
): Promise<Message[] | null> => {
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
		// eslint-disable-next-line no-await-in-loop -- each attempt must see the previous one's outcome
		const seen = (await readRow(ownerAddress, conversationId))?.encryptedData;
		// eslint-disable-next-line no-await-in-loop
		const current = await decryptMessages(sessionKey, seen);
		// eslint-disable-next-line no-await-in-loop
		const next = await merge(current);
		if (next === null) return current;

		// eslint-disable-next-line no-await-in-loop
		const encryptedData = await encryptData(sessionKey, next);
		// eslint-disable-next-line no-await-in-loop
		const written = await db.transaction('rw', db.messageCache, async () => {
			const latest = (await readRow(ownerAddress, conversationId))?.encryptedData;
			if (latest !== seen) return false;
			await db.messageCache.put({
				ownerAddress,
				conversationId,
				encryptedData,
				lastAccessedAt: Date.now(),
			});
			return true;
		});
		if (written) return next;
	}

	throw new Error(
		`The stored messages of conversation "${conversationId}" kept changing while they were being written.`,
	);
};

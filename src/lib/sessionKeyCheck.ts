/**
 * A key check value: one small known value encrypted under the session key and kept in the
 * local store, so a later session can tell whether its key is the one the store was written
 * under.
 *
 * On first use of a store with a key the value is written (`written`). A later session reads
 * it: when it decrypts to the value the key is the same (`matches`); when it cannot be
 * decrypted, or decrypts to something else, the history on this device was written under
 * another key (`mismatch`), which a wallet whose signature changed gives. Any other error is
 * thrown.
 *
 * The record is never replaced. A mismatched one is left as it is: it is what tells every
 * later session under the new key that this device holds history it cannot open, and a
 * session under the old key (the same signature again) still matches it. Replacing it would
 * make the next session under the new key say nothing while the old history is still here.
 *
 * It lives in `userMetadata`, the table that holds the sync cursor, under its own primary key
 * (`sessionKeyCheckId`): the cursor's row is rewritten under whatever key the sync runs with,
 * so the check could not live in that row.
 */
import { getAddress } from 'viem';

import { decryptDataOrNull, encryptData } from '@/lib/crypto';
import db from '@/lib/db';

export type SessionKeyCheck = 'written' | 'matches' | 'mismatch';

/** What is encrypted. Its content is public; only the key that sealed it matters. */
export const SESSION_KEY_CHECK_VALUE = Object.freeze({ check: 'senseai-session-key' });

/** The record's primary key: apart from the cursor's (the bare address), one per account. */
export const sessionKeyCheckId = (ownerAddress: string): string =>
	`session-key-check:${getAddress(ownerAddress.toLowerCase())}`;

const isCheckValue = (value: unknown): boolean =>
	typeof value === 'object' &&
	value !== null &&
	(value as { check?: unknown }).check === SESSION_KEY_CHECK_VALUE.check;

const isConstraintError = (error: unknown): boolean =>
	typeof error === 'object' &&
	error !== null &&
	(error as { name?: unknown }).name === 'ConstraintError';

async function readCheck(sessionKey: CryptoKey, id: string): Promise<SessionKeyCheck | null> {
	const record = await db.userMetadata.get(id);
	if (!record) return null;
	const value = await decryptDataOrNull(sessionKey, record.encryptedData);
	return isCheckValue(value) ? 'matches' : 'mismatch';
}

export async function checkSessionKey(
	sessionKey: CryptoKey,
	ownerAddress: string,
): Promise<SessionKeyCheck> {
	const id = sessionKeyCheckId(ownerAddress);
	const existing = await readCheck(sessionKey, id);
	if (existing) return existing;

	// Sealed before the write: Web Crypto cannot run inside an IndexedDB transaction.
	const encryptedData = await encryptData(sessionKey, SESSION_KEY_CHECK_VALUE);
	try {
		// `add`, not `put`: it refuses a record that is already there, so a record another tab
		// wrote in the meantime is read, never replaced.
		await db.userMetadata.add({ ownerAddress: id, encryptedData });
		return 'written';
	} catch (error) {
		if (!isConstraintError(error)) throw error;
		return (await readCheck(sessionKey, id)) ?? 'mismatch';
	}
}

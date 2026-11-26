import { beforeEach, describe, expect, it, vi } from 'vitest';

import { decryptData, deriveKeyFromEntropy, encryptData } from '@/lib/crypto';
import db from '@/lib/db';
import { checkSessionKey, SESSION_KEY_CHECK_VALUE, sessionKeyCheckId } from '@/lib/sessionKeyCheck';

vi.mock('@/lib/db', () => ({
	default: { userMetadata: { get: vi.fn(), add: vi.fn(), put: vi.fn() } },
}));

const mockDb = db as unknown as {
	userMetadata: {
		get: ReturnType<typeof vi.fn>;
		add: ReturnType<typeof vi.fn>;
		put: ReturnType<typeof vi.fn>;
	};
};

// Hardhat's well-known account 0, checksummed and in lower case.
const OWNER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const CHECK_ID = `session-key-check:${OWNER}`;

const constraintError = () =>
	Object.assign(new Error('Key already exists'), { name: 'ConstraintError' });

describe('checkSessionKey', () => {
	let key: CryptoKey;
	let otherKey: CryptoKey;

	beforeEach(async () => {
		vi.clearAllMocks();
		key = await deriveKeyFromEntropy('this-signature', OWNER);
		otherKey = await deriveKeyFromEntropy('another-signature', OWNER);
		mockDb.userMetadata.get.mockResolvedValue(undefined);
		mockDb.userMetadata.add.mockResolvedValue(CHECK_ID);
	});

	it('keeps its record apart from the sync cursor, under the checksummed account', () => {
		expect(sessionKeyCheckId(OWNER)).toBe(CHECK_ID);
		expect(sessionKeyCheckId(OWNER.toLowerCase())).toBe(CHECK_ID);
		expect(sessionKeyCheckId(OWNER)).not.toBe(OWNER);
	});

	it('writes the check value under the key on first use of the store', async () => {
		await expect(checkSessionKey(key, OWNER)).resolves.toBe('written');

		expect(mockDb.userMetadata.add).toHaveBeenCalledTimes(1);
		const record = mockDb.userMetadata.add.mock.calls[0][0];
		expect(record.ownerAddress).toBe(CHECK_ID);
		expect(await decryptData(key, record.encryptedData)).toEqual(SESSION_KEY_CHECK_VALUE);
		expect(mockDb.userMetadata.put).not.toHaveBeenCalled();
	});

	it('matches a record written under the same key, and writes nothing', async () => {
		mockDb.userMetadata.get.mockResolvedValue({
			ownerAddress: CHECK_ID,
			encryptedData: await encryptData(key, SESSION_KEY_CHECK_VALUE),
		});

		await expect(checkSessionKey(key, OWNER.toLowerCase())).resolves.toBe('matches');
		expect(mockDb.userMetadata.get).toHaveBeenCalledWith(CHECK_ID);
		expect(mockDb.userMetadata.add).not.toHaveBeenCalled();
		expect(mockDb.userMetadata.put).not.toHaveBeenCalled();
	});

	it('reports a record written under another key, and leaves it as it is', async () => {
		mockDb.userMetadata.get.mockResolvedValue({
			ownerAddress: CHECK_ID,
			encryptedData: await encryptData(otherKey, SESSION_KEY_CHECK_VALUE),
		});

		await expect(checkSessionKey(key, OWNER)).resolves.toBe('mismatch');
		expect(mockDb.userMetadata.add).not.toHaveBeenCalled();
		expect(mockDb.userMetadata.put).not.toHaveBeenCalled();
	});

	it('reports a record that decrypts to something else', async () => {
		mockDb.userMetadata.get.mockResolvedValue({
			ownerAddress: CHECK_ID,
			encryptedData: await encryptData(key, { something: 'else' }),
		});

		await expect(checkSessionKey(key, OWNER)).resolves.toBe('mismatch');
	});

	it('fails on a record that fails for another reason than not decrypting', async () => {
		mockDb.userMetadata.get.mockResolvedValue({ ownerAddress: CHECK_ID, encryptedData: 42 });

		await expect(checkSessionKey(key, OWNER)).rejects.toBeInstanceOf(TypeError);
		expect(mockDb.userMetadata.add).not.toHaveBeenCalled();
	});

	it('reads the record another tab wrote first instead of replacing it', async () => {
		const written = await encryptData(otherKey, SESSION_KEY_CHECK_VALUE);
		mockDb.userMetadata.get
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce({ ownerAddress: CHECK_ID, encryptedData: written });
		mockDb.userMetadata.add.mockRejectedValue(constraintError());

		await expect(checkSessionKey(key, OWNER)).resolves.toBe('mismatch');
		expect(mockDb.userMetadata.put).not.toHaveBeenCalled();
	});

	it('fails when the write fails for another reason', async () => {
		mockDb.userMetadata.add.mockRejectedValue(new Error('QuotaExceededError'));

		await expect(checkSessionKey(key, OWNER)).rejects.toThrow('QuotaExceededError');
	});
});

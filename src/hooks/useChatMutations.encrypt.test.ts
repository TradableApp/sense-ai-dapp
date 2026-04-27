import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/config/thirdweb', () => ({ client: {} }));
vi.mock('thirdweb', () => ({}));
vi.mock('thirdweb/react', () => ({}));
vi.mock('thirdweb/wallets', () => ({}));
vi.mock('@/lib/ecies', () => ({
	default: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
}));
vi.mock('@/lib/crypto', () => ({
	encryptData: vi.fn(async () => 'iv.cipher'),
	decryptData: vi.fn(),
	deriveKeyFromEntropy: vi.fn(),
}));

import { createEncryptedPayloads } from './useChatMutations';

describe('createEncryptedPayloads', () => {
	beforeEach(() => {
		vi.spyOn(window.crypto.subtle, 'exportKey').mockResolvedValue(new ArrayBuffer(32));
		// @ts-expect-error intentionally removing env var to test missing-key path
		delete import.meta.env.VITE_ORACLE_PUBLIC_KEY;
	});

	it('throws when VITE_ORACLE_PUBLIC_KEY is not set', async () => {
		const mockKey = {} as CryptoKey;
		const payload = { test: 'data' };

		await expect(createEncryptedPayloads(mockKey, payload)).rejects.toThrow(
			'VITE_ORACLE_PUBLIC_KEY is not set in .env',
		);
	});
});

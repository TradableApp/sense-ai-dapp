import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/config/thirdweb', () => ({ client: {} }));
vi.mock('thirdweb', () => ({}));
vi.mock('thirdweb/react', () => ({}));
vi.mock('thirdweb/wallets', () => ({}));
vi.mock('ethers', () => ({
	ethers: {
		toUtf8Bytes: vi.fn(() => new Uint8Array([1, 2, 3])),
		hexlify: vi.fn(() => '0xdeadbeef'),
	},
}));
vi.mock('eth-crypto', () => ({
	default: {
		encryptWithPublicKey: vi.fn(async () => ({
			iv: 'iv',
			ephemPublicKey: 'epk',
			ciphertext: 'ct',
			mac: 'mac',
		})),
		cipher: { stringify: vi.fn(() => 'stringified') },
	},
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
		delete import.meta.env.VITE_ORACLE_PUBLIC_KEY;
	});

	it('throws when VITE_ORACLE_PUBLIC_KEY is not set', async () => {
		const mockKey = {};
		const payload = { test: 'data' };

		await expect(createEncryptedPayloads(mockKey, payload)).rejects.toThrow(
			'VITE_ORACLE_PUBLIC_KEY is not set in .env',
		);
	});
});

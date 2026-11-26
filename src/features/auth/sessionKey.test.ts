import { type Hex, numberToHex, parseSignature } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { beforeAll, describe, expect, it } from 'vitest';

import {
	canonicalSignature,
	deriveSessionKey,
	sessionKeyInfo,
	SessionSignatureError,
} from '@/features/auth/sessionKey';
import { buildSessionMessage, SESSION_MESSAGE_VERSION } from '@/features/auth/sessionMessage';
import { deriveKeyFromEntropy } from '@/lib/crypto';

// Hardhat's well-known accounts 0 and 1 (public test keys).
const HARDHAT_0 = privateKeyToAccount(
	'0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
);
const HARDHAT_1 = privateKeyToAccount(
	'0x59c6995e998f97a5a0044966f0945389dc9c86dae88c7a8412f4603b6b78690d',
);

// The order of secp256k1's group: s and n - s are the two valid s values of one signature.
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const ERC6492_MAGIC = '6492649264926492649264926492649264926492649264926492649264926492';

const message = buildSessionMessage({
	mode: 'test',
	chainId: '31337',
	walletAddress: HARDHAT_0.address,
});

const rawKey = async (key: CryptoKey) =>
	new Uint8Array(await window.crypto.subtle.exportKey('raw', key));

let signature: Hex;
let encodings: Record<string, string>;

beforeAll(async () => {
	signature = await HARDHAT_0.signMessage({ message });
	const { r, s, yParity } = parseSignature(signature);
	const highS = numberToHex(SECP256K1_N - BigInt(s), { size: 32 }).slice(2);
	encodings = {
		'upper-case hex': `0x${signature.slice(2).toUpperCase()}`,
		'v as 0 or 1': `${signature.slice(0, 130)}${yParity === 0 ? '00' : '01'}`,
		'the high-s twin': `${r}${highS}${yParity === 0 ? '1c' : '1b'}`,
	};
});

describe('canonicalSignature', () => {
	it('gives the form viem writes: lower-case hex, 65 bytes, low s, v 27 or 28', () => {
		expect(canonicalSignature(signature)).toBe(signature.toLowerCase());
		expect(canonicalSignature(signature)).toMatch(/^0x[0-9a-f]{128}(1b|1c)$/);
	});

	it('brings every encoding of one signature to the same form', () => {
		Object.values(encodings).forEach(encoding => {
			expect(encoding).not.toBe(signature);
			expect(canonicalSignature(encoding)).toBe(canonicalSignature(signature));
		});
	});

	it.each([
		['an ERC-6492 wrapped signature', () => `${signature}${'00'.repeat(64)}${ERC6492_MAGIC}`],
		['a longer smart-account signature', () => `${signature}${'ab'.repeat(32)}`],
		['a shorter one', () => signature.slice(0, 128)],
		['an unknown v', () => `${signature.slice(0, 130)}05`],
		['an r of 0', () => `0x${'00'.repeat(32)}${signature.slice(66)}`],
		['text that is not hex', () => `0x${'zz'.repeat(65)}`],
	])('refuses %s as not a plain ECDSA signature', (_name, make) => {
		expect(() => canonicalSignature(make())).toThrow(
			expect.objectContaining({ name: 'SessionSignatureError', kind: 'not-plain-ecdsa' }),
		);
	});
});

describe('deriveSessionKey', () => {
	it('derives the same key from every encoding of one signature', async () => {
		const expected = await rawKey(
			await deriveSessionKey({ message, signature, walletAddress: HARDHAT_0.address }),
		);

		await Promise.all(
			Object.values(encodings).map(async encoding => {
				const key = await deriveSessionKey({
					message,
					signature: encoding,
					walletAddress: HARDHAT_0.address,
				});
				expect(await rawKey(key)).toEqual(expected);
			}),
		);
	});

	it('derives the same key however the address is cased', async () => {
		const checksummed = await deriveSessionKey({
			message,
			signature,
			walletAddress: HARDHAT_0.address,
		});
		const lower = await deriveSessionKey({
			message,
			signature,
			walletAddress: HARDHAT_0.address.toLowerCase(),
		});

		expect(await rawKey(lower)).toEqual(await rawKey(checksummed));
	});

	it('is bound to the message version', async () => {
		const canonical = canonicalSignature(signature);
		const thisVersion = await deriveKeyFromEntropy(
			canonical,
			HARDHAT_0.address,
			sessionKeyInfo(SESSION_MESSAGE_VERSION),
		);
		const nextVersion = await deriveKeyFromEntropy(
			canonical,
			HARDHAT_0.address,
			sessionKeyInfo(SESSION_MESSAGE_VERSION + 1),
		);
		const derived = await deriveSessionKey({
			message,
			signature,
			walletAddress: HARDHAT_0.address,
		});

		expect(await rawKey(derived)).toEqual(await rawKey(thisVersion));
		expect(await rawKey(nextVersion)).not.toEqual(await rawKey(thisVersion));
	});

	it('refuses a signature by another account', async () => {
		const byOther = await HARDHAT_1.signMessage({ message });

		await expect(
			deriveSessionKey({ message, signature: byOther, walletAddress: HARDHAT_0.address }),
		).rejects.toMatchObject({ name: 'SessionSignatureError', kind: 'other-signer' });
	});

	it('refuses a signature of another message', async () => {
		const ofOther = await HARDHAT_0.signMessage({ message: `${message} ` });

		await expect(
			deriveSessionKey({ message, signature: ofOther, walletAddress: HARDHAT_0.address }),
		).rejects.toBeInstanceOf(SessionSignatureError);
	});

	it('refuses a wrapped smart-account signature before deriving anything', async () => {
		await expect(
			deriveSessionKey({
				message,
				signature: `${signature}${'00'.repeat(64)}${ERC6492_MAGIC}`,
				walletAddress: HARDHAT_0.address,
			}),
		).rejects.toMatchObject({ kind: 'not-plain-ecdsa' });
	});
});

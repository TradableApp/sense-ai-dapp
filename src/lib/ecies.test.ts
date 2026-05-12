import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';

import eciesEncrypt from './ecies';

// Valid 32-byte secp256k1 private key (for deriving a test public key)
const PRIV_1 = '11'.repeat(32);

function privToUncompressedHex(privHex: string): string {
	const pubBytes = secp256k1.getPublicKey(hexToBytes(privHex), false);
	return bytesToHex(pubBytes);
}

const PUB_1 = privToUncompressedHex(PRIV_1);

describe('eciesEncrypt', () => {
	it('returns a Uint8Array', async () => {
		const plaintext = new Uint8Array([1, 2, 3, 4]);
		const result = await eciesEncrypt(PUB_1, plaintext);
		expect(result).toBeInstanceOf(Uint8Array);
	});

	it('starts with version byte 0x01', async () => {
		const result = await eciesEncrypt(PUB_1, new Uint8Array([42]));
		expect(result[0]).toBe(0x01);
	});

	it('has correct minimum length (1 + 65 + 12 + 1 + 16 = 95)', async () => {
		const plaintext = new Uint8Array([0xff]);
		const result = await eciesEncrypt(PUB_1, plaintext);
		// 1 version + 65 ephemPubKey + 12 nonce + plaintextLen + 16 GCM tag
		expect(result.length).toBe(1 + 65 + 12 + plaintext.length + 16);
	});

	it('ephemeral public key bytes at offset 1-65 are a valid uncompressed secp256k1 key', async () => {
		const result = await eciesEncrypt(PUB_1, new Uint8Array([1, 2, 3]));
		expect(result[1]).toBe(0x04); // uncompressed prefix
		expect(result.length).toBeGreaterThanOrEqual(66);
	});

	it('produces different ciphertexts on repeated calls (randomness)', async () => {
		const plaintext = new Uint8Array([1, 2, 3]);
		const a = await eciesEncrypt(PUB_1, plaintext);
		const b = await eciesEncrypt(PUB_1, plaintext);
		expect(bytesToHex(a)).not.toBe(bytesToHex(b));
	});

	it('accepts a public key with 0x04 prefix', async () => {
		const pubWith0x04 = `04${PUB_1.slice(2)}`; // PUB_1 already starts with 04
		const result = await eciesEncrypt(pubWith0x04, new Uint8Array([9]));
		expect(result).toBeInstanceOf(Uint8Array);
		expect(result[0]).toBe(0x01);
	});

	it('accepts a public key with 0x prefix', async () => {
		const pubWith0x = `0x${PUB_1}`;
		const result = await eciesEncrypt(pubWith0x, new Uint8Array([9]));
		expect(result).toBeInstanceOf(Uint8Array);
		expect(result[0]).toBe(0x01);
	});

	it('accepts a public key with 0x04 prefix (full 0x04 prefixed form)', async () => {
		const pubFull = `0x04${PUB_1.slice(2)}`;
		const result = await eciesEncrypt(pubFull, new Uint8Array([9]));
		expect(result).toBeInstanceOf(Uint8Array);
	});

	it('works with empty plaintext', async () => {
		const result = await eciesEncrypt(PUB_1, new Uint8Array(0));
		expect(result.length).toBe(1 + 65 + 12 + 0 + 16);
	});

	it('works with a 32-byte session key (primary use case)', async () => {
		const sessionKey = new Uint8Array(32).fill(0xab);
		const result = await eciesEncrypt(PUB_1, sessionKey);
		expect(result.length).toBe(1 + 65 + 12 + 32 + 16);
	});
});

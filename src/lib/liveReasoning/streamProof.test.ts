import { describe, expect, it } from 'vitest';

import streamProof from './streamProof';
import { bytesToHex, importVectorKey, STREAM_VECTORS } from './vector.testdata';

const VECTOR = STREAM_VECTORS.proof;

const fromBase64Url = (text: string): Uint8Array => {
	const padded = text.replace(/-/g, '+').replace(/_/g, '/');
	return Uint8Array.from(atob(padded + '='.repeat((4 - (padded.length % 4)) % 4)), c =>
		c.charCodeAt(0),
	);
};

describe('streamProof', () => {
	it("gives the vector's proof for answer 42 from the vector's session key", async () => {
		const key = await importVectorKey();

		const proof = await streamProof(key, '42');

		expect(proof).toBe(VECTOR.proof);
		expect(proof).toHaveLength(43);
		expect(bytesToHex(fromBase64Url(proof))).toBe(VECTOR.proofHex);
	});

	it('turns + and / into - and _ (answer 45, whose HMAC in base64 has both)', async () => {
		const key = await importVectorKey();
		// HMAC-SHA256(vector key, "senseai-stream:45"); its plain base64 has a + and a /.
		const hex = 'c42c9a1c40b71d4dd808d4035fb5ed5a51da47ebe3aaff4bfec5c849084faf29';

		const proof = await streamProof(key, '45');

		expect(proof).toBe('xCyaHEC3HU3YCNQDX7XtWlHaR-vjqv9L_sXISQhPryk');
		expect(bytesToHex(fromBase64Url(proof))).toBe(hex);
	});

	it('differs per answer id, so one proof opens no other answer', async () => {
		const key = await importVectorKey();

		expect(await streamProof(key, '43')).not.toBe(VECTOR.proof);
	});

	it('refuses an answer id that is not the canonical decimal form', async () => {
		const key = await importVectorKey();

		await Promise.all(
			['042', '-1', '', '0x2a'].map(bad =>
				expect(streamProof(key, bad)).rejects.toThrow(TypeError),
			),
		);
	});
});

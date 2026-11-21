import { describe, expect, it } from 'vitest';

import streamProof from './streamProof';
import { bytesToHex, importVectorKey, VECTOR } from './vector.testdata';

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

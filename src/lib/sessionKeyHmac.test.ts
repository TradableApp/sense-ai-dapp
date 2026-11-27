import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { importVectorKey, STREAM_VECTORS } from '@/lib/liveReasoning/vector.testdata';

import sessionKeyHmac from './sessionKeyHmac';

const expected = (message: string) =>
	createHmac('sha256', Buffer.from(STREAM_VECTORS.keyHex, 'hex'))
		.update(message)
		.digest('base64url');

describe('sessionKeyHmac', () => {
	it('is base64url(HMAC-SHA256(raw session key, message)) with no padding', async () => {
		const key = await importVectorKey();

		const messages = ['', 'a', 'senseai-rating:1', 'senseai-stream:45', 'é∑'];
		const macs = await Promise.all(messages.map(message => sessionKeyHmac(key, message)));

		macs.forEach((mac, i) => {
			expect(mac).toBe(expected(messages[i]));
			expect(mac).toMatch(/^[A-Za-z0-9_-]{43}$/);
		});
	});

	it('gives the stream proof vector for its message', async () => {
		const key = await importVectorKey();

		expect(await sessionKeyHmac(key, 'senseai-stream:42')).toBe(STREAM_VECTORS.proof.proof);
	});
});

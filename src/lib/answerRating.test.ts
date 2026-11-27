import { createHmac } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import streamProof from '@/lib/liveReasoning/streamProof';
import { importVectorKey, STREAM_VECTORS } from '@/lib/liveReasoning/vector.testdata';

import {
	parseRating,
	RATING_DOC_ID,
	ratingDeployment,
	ratingDocId,
	readAnswerRating,
} from './answerRating';

const getDocMock = vi.fn();
const docMock = vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }));

vi.mock('firebase/firestore', () => ({
	doc: (db: unknown, ...segments: string[]) => docMock(db, ...segments),
	getDoc: (ref: unknown) => getDocMock(ref),
}));
vi.mock('@/config/firebase', () => ({ db: { name: 'test-db' } }));

const AGENT = '0x00000000000000000000000000000000000000A1';
const TARGET = { chainId: '84532', agentAddress: AGENT, conversationId: '7', messageId: '42' };

const expectedId = (message: string) =>
	createHmac('sha256', Buffer.from(STREAM_VECTORS.keyHex, 'hex'))
		.update(message)
		.digest('base64url');

describe('ratingDocId', () => {
	it('is the HMAC of the rating label, chain, agent in lower case, conversation and message', async () => {
		const key = await importVectorKey();

		const id = await ratingDocId(key, TARGET);

		expect(id).toBe(expectedId(`senseai-rating:84532:${AGENT.toLowerCase()}:7:42`));
		expect(id).toHaveLength(43);
		expect(id).toMatch(RATING_DOC_ID);
	});

	it('takes numeric ids as their decimal text', async () => {
		const key = await importVectorKey();

		expect(
			await ratingDocId(key, { ...TARGET, chainId: 84532, conversationId: 7, messageId: 42 }),
		).toBe(await ratingDocId(key, TARGET));
	});

	it('differs when any part differs', async () => {
		const key = await importVectorKey();
		const base = await ratingDocId(key, TARGET);
		const changed = [
			{ ...TARGET, chainId: '8453' },
			{ ...TARGET, agentAddress: '0x00000000000000000000000000000000000000a2' },
			{ ...TARGET, conversationId: '8' },
			{ ...TARGET, messageId: '43' },
			// Moving a digit across the separator gives another message, so another id.
			{ ...TARGET, conversationId: '74', messageId: '2' },
		];

		const ids = await Promise.all(changed.map(target => ratingDocId(key, target)));

		ids.forEach(id => expect(id).not.toBe(base));
	});

	it('never equals the stream proof for the same key and answer id', async () => {
		const key = await importVectorKey();

		const proof = await streamProof(key, '42');

		expect(await ratingDocId(key, TARGET)).not.toBe(proof);
		expect(proof).toBe(STREAM_VECTORS.proof.proof);
	});

	it('every id has the shape the server checks, last character included', async () => {
		const key = await importVectorKey();

		const ids = await Promise.all(
			Array.from({ length: 64 }, (_, i) => ratingDocId(key, { ...TARGET, messageId: String(i + 1) })),
		);

		ids.forEach(id => expect(id).toMatch(RATING_DOC_ID));
	});

	it('refuses a malformed part, and the error names none of the values', async () => {
		const key = await importVectorKey();
		const bad = [
			{ chainId: '' },
			{ chainId: '0' },
			{ chainId: '084532' },
			{ chainId: '0x14a34' },
			{ agentAddress: '' },
			{ agentAddress: '0x1234' },
			{ agentAddress: `${AGENT}0` },
			{ conversationId: '' },
			{ conversationId: '07' },
			{ conversationId: '-1' },
			{ conversationId: '1:2' },
			{ messageId: '' },
			{ messageId: '4.2' },
			{ messageId: 'undefined' },
		];

		const errors = await Promise.all(
			bad.map(part => ratingDocId(key, { ...TARGET, ...part }).catch((e: unknown) => e)),
		);

		errors.forEach((error, i) => {
			expect(error).toBeInstanceOf(TypeError);
			const value = Object.values(bad[i])[0];
			if (value.length > 1) expect((error as Error).message).not.toContain(value);
		});
	});
});

describe('RATING_DOC_ID', () => {
	it('refuses anything but 43 base64url characters ending in a 32-byte encoding', () => {
		const good = `${'A'.repeat(42)}w`;
		expect(good).toMatch(RATING_DOC_ID);
		const bad = [
			'',
			'42',
			'A'.repeat(43).slice(1),
			`${good}A`,
			`${'A'.repeat(42)}B`,
			`${'A'.repeat(42)}=`,
			`${'A'.repeat(41)}+A`,
			`${'A'.repeat(41)}/A`,
		];
		bad.forEach(id => expect(id).not.toMatch(RATING_DOC_ID));
	});
});

describe('ratingDeployment', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("is the build's chain id and agent address in lower case", () => {
		vi.stubEnv('VITE_CHAIN_ID', '84532');
		vi.stubEnv('VITE_AGENT_CONTRACT_ADDRESS', AGENT);

		expect(ratingDeployment()).toEqual({ chainId: '84532', agentAddress: AGENT.toLowerCase() });
	});

	it('is null when the build names no usable chain or agent', () => {
		vi.stubEnv('VITE_CHAIN_ID', '');
		vi.stubEnv('VITE_AGENT_CONTRACT_ADDRESS', AGENT);
		expect(ratingDeployment()).toBeNull();

		vi.stubEnv('VITE_CHAIN_ID', '84532');
		vi.stubEnv('VITE_AGENT_CONTRACT_ADDRESS', 'not-an-address');
		expect(ratingDeployment()).toBeNull();
	});
});

describe('readAnswerRating', () => {
	const ID = `${'A'.repeat(42)}w`;

	beforeEach(() => {
		getDocMock.mockReset();
		docMock.mockClear();
	});

	it('gets the one document under the id from the rating collection', async () => {
		getDocMock.mockResolvedValue({ exists: () => true, data: () => ({ feedbackValue: 'like' }) });

		expect(await readAnswerRating(ID)).toBe('like');
		expect(docMock).toHaveBeenCalledWith({ name: 'test-db' }, 'senseai_feedback', ID);
		expect(getDocMock).toHaveBeenCalledTimes(1);
	});

	it('is null for a rating that does not exist', async () => {
		getDocMock.mockResolvedValue({ exists: () => false, data: () => undefined });

		expect(await readAnswerRating(ID)).toBeNull();
	});

	it('refuses to read an id of the wrong shape and sends nothing', async () => {
		await expect(readAnswerRating('42')).rejects.toThrow(TypeError);
		expect(getDocMock).not.toHaveBeenCalled();
	});
});

describe('parseRating', () => {
	it('keeps only like or dislike', () => {
		expect(parseRating({ feedbackValue: 'like' })).toBe('like');
		expect(parseRating({ feedbackValue: 'dislike' })).toBe('dislike');
		const unusable = [
			undefined,
			null,
			{},
			{ feedbackValue: null },
			{ feedbackValue: 'Like' },
			{ feedbackValue: 1 },
			'like',
		];
		unusable.forEach(data => expect(parseRating(data)).toBeNull());
	});
});

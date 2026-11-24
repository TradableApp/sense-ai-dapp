import { describe, expect, it } from 'vitest';

import { FOLLOW_MAX_AGE_MS, pendingAnswerIds } from './pendingAnswers';

const NOW = 1_800_000_000_000;

const user = (id: string, extra: object = {}) => ({
	id,
	role: 'user',
	content: 'q',
	createdAt: NOW,
	...extra,
});
const placeholder = (id: string, extra: object = {}) => ({
	id,
	role: 'assistant',
	content: null,
	createdAt: NOW,
	...extra,
});

describe('pendingAnswerIds', () => {
	it('follows a content-less placeholder and a synced pending prompt', () => {
		const messages = [
			user('41'),
			placeholder('42'),
			user('43', { status: 'pending', answerMessageId: '44' }),
		];

		expect(pendingAnswerIds(messages, NOW)).toEqual(['42', '44']);
	});

	it('does not follow a refunded or a cancelled placeholder', () => {
		const messages = [
			placeholder('42', { status: 'refunded' }),
			placeholder('44', { status: 'cancelled' }),
		];

		expect(pendingAnswerIds(messages, NOW)).toEqual([]);
	});

	it('does not follow a synced pending prompt whose answer is already listed', () => {
		const messages = [
			user('41', { status: 'pending', answerMessageId: '42' }),
			{ id: '42', role: 'assistant', content: 'Prices rose.', createdAt: NOW },
		];

		expect(pendingAnswerIds(messages, NOW)).toEqual([]);
	});

	it.each([
		['a placeholder', (createdAt: number) => [placeholder('42', { createdAt })]],
		[
			'a synced pending prompt',
			(createdAt: number) => [user('41', { status: 'pending', answerMessageId: '42', createdAt })],
		],
	])('follows %s up to the age its stream can still exist, and not beyond', (_kind, build) => {
		expect(pendingAnswerIds(build(NOW - FOLLOW_MAX_AGE_MS), NOW)).toEqual(['42']);
		expect(pendingAnswerIds(build(NOW - FOLLOW_MAX_AGE_MS - 1), NOW)).toEqual([]);
	});

	it('does not follow a prompt awaiting its refund', () => {
		const twoHoursAgo = NOW - 2 * 60 * 60 * 1000;

		expect(pendingAnswerIds([placeholder('42', { createdAt: twoHoursAgo })], NOW)).toEqual([]);
	});

	it('does not follow a message whose time is unknown', () => {
		const messages = [
			placeholder('42', { createdAt: undefined }),
			user('43', { status: 'pending', answerMessageId: '44', createdAt: Number.NaN }),
		];

		expect(pendingAnswerIds(messages, NOW)).toEqual([]);
	});

	it('is one hour (the refund window) plus the two minutes the server keeps a run', () => {
		expect(FOLLOW_MAX_AGE_MS).toBe(3_600_000 + 120_000);
	});
});

import * as Sentry from '@sentry/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initialLiveState, type LiveAnswerState } from './liveReducer';
import { compareLiveWithStored, forgetLiveReports, reconcileWithStored } from './reconcile';

vi.mock('@sentry/react', () => ({ captureException: vi.fn() }));

const STEPS = [
	{ title: 'Reading', description: 'Read the news.', attempt: 1 },
	{ title: 'Weighing', description: 'Weighed it.', attempt: 1 },
];
const SOURCES = [{ title: 'News', url: 'https://n.example', attempt: 1 }];

const answered = (overrides: Partial<LiveAnswerState> = {}): LiveAnswerState => ({
	...initialLiveState('42'),
	run: '0123456789abcdef',
	replica: 'deadbeef',
	steps: STEPS,
	sources: SOURCES,
	answer: { text: 'Prices rose.', answerMessageCID: 'bafy1' },
	outcome: 'answered',
	...overrides,
});

// Stored items written before the stream existed carry no attempt; they count as attempt 1.
const stored = {
	content: 'Prices rose.',
	reasoning: STEPS.map(({ title, description }) => ({ title, description })),
	sources: SOURCES.map(({ title, url }) => ({ title, url })),
};

beforeEach(() => {
	vi.clearAllMocks();
	forgetLiveReports();
});

describe('compareLiveWithStored', () => {
	it('matches when what was shown equals what is stored', () => {
		expect(compareLiveWithStored(answered(), stored)).toEqual({ kind: 'match' });
	});

	it('names a step whose text differs', () => {
		const live = answered({ steps: [STEPS[0], { ...STEPS[1], description: 'Other.' }] });

		expect(compareLiveWithStored(live, stored)).toEqual({
			kind: 'mismatch',
			mismatch: 'step-text',
		});
	});

	it('names a step count that differs', () => {
		expect(compareLiveWithStored(answered({ steps: [STEPS[0]] }), stored)).toEqual({
			kind: 'mismatch',
			mismatch: 'step-count',
		});
	});

	it('names a step whose attempt differs', () => {
		const live = answered({ steps: [STEPS[0], { ...STEPS[1], attempt: 2 }] });

		expect(compareLiveWithStored(live, stored)).toEqual({
			kind: 'mismatch',
			mismatch: 'step-text',
		});
	});

	it('names sources that differ', () => {
		expect(compareLiveWithStored(answered({ sources: [] }), stored)).toEqual({
			kind: 'mismatch',
			mismatch: 'source-count',
		});
		expect(
			compareLiveWithStored(
				answered({ sources: [{ ...SOURCES[0], url: 'https://x.example' }] }),
				stored,
			),
		).toEqual({ kind: 'mismatch', mismatch: 'source-text' });
	});

	it('names an answer text that differs', () => {
		const live = answered({ answer: { text: 'Prices fell.', answerMessageCID: 'bafy1' } });

		expect(compareLiveWithStored(live, stored)).toEqual({
			kind: 'mismatch',
			mismatch: 'answer-text',
		});
	});

	it('does not compare the answer text when no answer frame came (over the size limit)', () => {
		expect(compareLiveWithStored(answered({ answer: null }), stored)).toEqual({ kind: 'match' });
	});

	it('does not compare a run that has not finished answering', () => {
		expect(compareLiveWithStored(answered({ outcome: null }), stored)).toEqual({
			kind: 'not-comparable',
		});
	});
});

describe('reconcileWithStored', () => {
	it('reports a mismatch to Sentry once per answer, by kind only, never with text', () => {
		const live = answered({ answer: { text: 'Prices fell.', answerMessageCID: 'bafy1' } });

		reconcileWithStored('42', live, stored);
		reconcileWithStored('42', live, stored);

		expect(Sentry.captureException).toHaveBeenCalledTimes(1);
		const [error, context] = vi.mocked(Sentry.captureException).mock.calls[0];
		expect(context).toMatchObject({
			tags: { check: 'live-reasoning', mismatch: 'answer-text', replica: 'deadbeef' },
		});
		const sent = JSON.stringify([String(error), (error as Error).message, context]);
		['Prices', 'Reading', 'Read the news', 'n.example', '"42"'].forEach(text =>
			expect(sent).not.toContain(text),
		);
	});

	it('reports each answer on its own', () => {
		const live = answered({ steps: [] });

		reconcileWithStored('42', live, stored);
		reconcileWithStored('43', live, stored);

		expect(Sentry.captureException).toHaveBeenCalledTimes(2);
	});

	it('reports nothing when the two match or cannot be compared', () => {
		reconcileWithStored('42', answered(), stored);
		reconcileWithStored('43', answered({ outcome: 'interrupted', steps: [] }), stored);

		expect(Sentry.captureException).not.toHaveBeenCalled();
	});
});

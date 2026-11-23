import { describe, expect, it } from 'vitest';

import {
	currentAttemptOf,
	storedAnswerAttempt,
	storedCurrentAttempt,
	withCheckedAnswerAttempt,
} from '@/lib/reasoningAttempts';

describe('storedAnswerAttempt', () => {
	it('takes a positive safe integer', () => {
		expect(storedAnswerAttempt(1)).toBe(1);
		expect(storedAnswerAttempt(3)).toBe(3);
	});

	it.each([0, -1, 1.5, Number.NaN, Infinity, 2 ** 53, '2', null, undefined, {}, [2], true])(
		'ignores %p',
		value => {
			expect(storedAnswerAttempt(value)).toBeUndefined();
		},
	);
});

describe('withCheckedAnswerAttempt', () => {
	it('keeps a valid answer attempt', () => {
		expect(withCheckedAnswerAttempt({ content: 'A', answerAttempt: 2 })).toEqual({
			content: 'A',
			answerAttempt: 2,
		});
	});

	it('drops one that is not a positive safe integer, and changes nothing else', () => {
		const file = { content: 'A', answerAttempt: '2' };

		expect(withCheckedAnswerAttempt(file)).toEqual({ content: 'A' });
		// The decrypted file is left as it was.
		expect(file).toEqual({ content: 'A', answerAttempt: '2' });
	});

	it('leaves a file without one as it is', () => {
		expect(withCheckedAnswerAttempt({ content: 'A' })).toEqual({ content: 'A' });
	});
});

describe('storedCurrentAttempt', () => {
	const earlierOnly = [{ attempt: 1 }, { attempt: 1 }];

	it('is the stored answer attempt when there is one, though the answering attempt has no items', () => {
		expect(storedCurrentAttempt(earlierOnly, 2)).toBe(2);
	});

	it('is the highest attempt among the items when the record says none (as before)', () => {
		expect(storedCurrentAttempt(earlierOnly, undefined)).toBe(1);
		expect(storedCurrentAttempt([{ attempt: 1 }, { attempt: 2 }], undefined)).toBe(2);
		expect(storedCurrentAttempt(earlierOnly, undefined)).toBe(currentAttemptOf(earlierOnly));
	});

	it('ignores a value that is not a positive safe integer', () => {
		expect(storedCurrentAttempt(earlierOnly, '2')).toBe(1);
		expect(storedCurrentAttempt(earlierOnly, 0)).toBe(1);
	});
});

import { describe, expect, it } from 'vitest';

import { CANCEL_ACTION } from '@/lib/feeTokenRefusal';

import { notRecordedMessage } from './notRecorded';

describe('notRecordedMessage', () => {
	it('says what a cancel that recorded nothing left as it was', () => {
		const { title, description } = notRecordedMessage(CANCEL_ACTION);

		expect(title).toBe('Not Cancelled');
		expect(description).toContain('nothing was cancelled');
	});

	it('never calls a transaction that went through reverted, whatever the action', () => {
		const { title, description } = notRecordedMessage('an action with no wording of its own');

		expect(title).toBe('Nothing Changed');
		expect(`${title} ${description}`).not.toMatch(/revert/i);
		expect(description).toContain('went through');
	});
});

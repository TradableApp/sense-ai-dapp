import { describe, expect, it } from 'vitest';

import { FEE_TOKEN_STATES } from '@/test/feeTokenVerdicts';

import {
	CANCEL_ACTION,
	REFUND_ACTION,
	REFUND_OUTLOOK,
	refusedTransferMessage,
} from './feeTokenRefusal';

describe('REFUND_OUTLOOK', () => {
	// A state without a row would fall back to the uncertain wording without anyone deciding
	// it. Every state has its row, so a verdict added later is a decision, not a default.
	it('has a row for every state of the fee token check', () => {
		expect(Object.keys(REFUND_OUTLOOK).sort()).toEqual([...FEE_TOKEN_STATES].sort());
	});

	it('promises a refund only where the escrow is listed and refuses it where it is not', () => {
		expect(REFUND_OUTLOOK['treasury-not-exempt']).toBe('works');
		expect(REFUND_OUTLOOK['escrow-not-exempt']).toBe('refused');
		expect(REFUND_OUTLOOK.ok).toBe('uncertain');
		expect(REFUND_OUTLOOK.unknown).toBe('uncertain');
	});

	// A paused token refuses every movement: the refund fails too until it resumes.
	it('says a refund waits for the token to resume while it is paused', () => {
		expect(REFUND_OUTLOOK['token-paused']).toBe('paused');
	});

	// With no contract at an address the app pays through, or an escrow serving another agent,
	// nothing on this device can say when a refund would work: no time is promised.
	it.each(['contract-not-found', 'escrow-serves-other-agent'] as const)(
		'sends the user to support with no refund time under %s',
		verdict => {
			expect(REFUND_OUTLOOK[verdict]).toBe('support');
		},
	);
});

describe('refusedTransferMessage for a paused token', () => {
	it('says a refused payment took nothing', () => {
		expect(refusedTransferMessage('send message', 'unknown', 'paused')).toEqual({
			title: 'Payments Paused',
			description: expect.stringMatching(/no tokens were taken/i),
		});
	});

	// Whatever the check said last, the pause is the newer fact: the token said so just now.
	it.each(FEE_TOKEN_STATES)('says a refused cancellation leaves the fee held under %s', verdict => {
		const { title, description } = refusedTransferMessage(CANCEL_ACTION, verdict, 'paused');

		expect(title).toBe('Could Not Cancel');
		expect(description).toMatch(/still held/i);
		expect(description).toMatch(/until the token is resumed/i);
		expect(description).not.toMatch(/hour/i);
	});

	it('says a refused refund waits for the token to be resumed', () => {
		const { title, description } = refusedTransferMessage(REFUND_ACTION, 'unknown', 'paused');

		expect(title).toBe('Refund Not Sent');
		expect(description).toMatch(/still held/i);
		expect(description).toMatch(/once the token is resumed/i);
		expect(description).not.toMatch(/hour/i);
	});
});

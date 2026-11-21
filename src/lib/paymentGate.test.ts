import { describe, expect, it } from 'vitest';

import { blocksAction, feeTokenBlockCopy, PAID_ACTIONS } from '@/lib/feeTokenCheck';
import { type PromptsSwitchState, SWITCH_WORDINGS, switchCopy } from '@/lib/promptsSwitch';
import { DISAGREEING_STATES, FEE_TOKEN_STATES } from '@/test/feeTokenVerdicts';

import {
	gateBlocks,
	gateCopy,
	gateNotice,
	type PaymentGateState,
	PaymentSwitchedOffError,
	switchedOffReason,
} from './paymentGate';

const OPEN: PromptsSwitchState = { status: 'open' };
const UNKNOWN: PromptsSwitchState = { status: 'unknown' };
const closed = (wording: (typeof SWITCH_WORDINGS)[number] = 'maintenance'): PromptsSwitchState => ({
	status: 'closed',
	wording,
});

const every = <T>(prompts: PromptsSwitchState, map: (_s: PaymentGateState, _a: string) => T) =>
	FEE_TOKEN_STATES.flatMap(feeToken =>
		PAID_ACTIONS.map(action => ({ feeToken, action, value: map({ feeToken, prompts }, action) })),
	);

describe('gateBlocks', () => {
	// With the switch open or unheard, the gate is exactly the fee token check.
	it.each([
		['open', OPEN],
		['unknown', UNKNOWN],
	])('with the switch %s it equals the fee token check for every verdict and action', (_, s) => {
		FEE_TOKEN_STATES.forEach(feeToken => {
			PAID_ACTIONS.forEach(action => {
				expect(gateBlocks({ feeToken, prompts: s }, action), `${feeToken} ${action}`).toBe(
					blocksAction(feeToken, action),
				);
			});
		});
	});

	it.each(SWITCH_WORDINGS)('closed (%s) blocks every paid action under every verdict', w => {
		every(closed(w), (state, action) => gateBlocks(state, action as never)).forEach(c =>
			expect(c.value, `${c.feeToken} ${c.action}`).toBe(true),
		);
	});
});

describe('gateCopy', () => {
	it('with the switch open it is the fee token notice, or nothing', () => {
		FEE_TOKEN_STATES.forEach(feeToken => {
			const fee = feeTokenBlockCopy(feeToken, 'PTS');
			expect(gateCopy({ feeToken, prompts: OPEN }, 'PTS')).toEqual(fee ? [fee] : []);
			expect(gateCopy({ feeToken, prompts: UNKNOWN }, 'PTS')).toEqual(fee ? [fee] : []);
		});
	});

	it.each(SWITCH_WORDINGS)('closed (%s) with the check passing is the switch notice alone', w => {
		expect(gateCopy({ feeToken: 'ok', prompts: closed(w) }, 'PTS')).toEqual([switchCopy(w)]);
		expect(gateCopy({ feeToken: 'unknown', prompts: closed(w) }, 'PTS')).toEqual([switchCopy(w)]);
	});

	it.each(DISAGREEING_STATES)('closed beside %s puts the switch first, then the check', v => {
		const notices = gateCopy({ feeToken: v, prompts: closed('incident') }, 'PTS');

		expect(notices).toEqual([
			switchCopy('incident', { otherProblem: true }),
			feeTokenBlockCopy(v, 'PTS'),
		]);
	});
});

describe('gateNotice', () => {
	it('is null for an action that is allowed', () => {
		expect(gateNotice({ feeToken: 'ok', prompts: OPEN }, 'prompt', 'PTS')).toBeNull();
		expect(
			gateNotice({ feeToken: 'treasury-not-exempt', prompts: OPEN }, 'prompt', 'PTS'),
		).toBeNull();
	});

	it('is the check notice when only the check blocks', () => {
		expect(gateNotice({ feeToken: 'token-paused', prompts: OPEN }, 'plan', 'PTS')).toEqual(
			feeTokenBlockCopy('token-paused', 'PTS'),
		);
	});

	it('is the switch notice when the switch is closed, whatever the check says', () => {
		expect(gateNotice({ feeToken: 'ok', prompts: closed('pair-retired') }, 'branch', 'PTS')).toEqual(
			switchCopy('pair-retired'),
		);
		expect(
			gateNotice({ feeToken: 'token-paused', prompts: closed('pair-retired') }, 'branch', 'PTS'),
		).toEqual(switchCopy('pair-retired', { otherProblem: true }));
	});
});

describe('PaymentSwitchedOffError', () => {
	it('carries the notice as its message, so any place that shows it reads plainly', () => {
		const state: PaymentGateState = { feeToken: 'escrow-not-exempt', prompts: OPEN };
		const error = new PaymentSwitchedOffError(state, 'metadata', 'PTS');

		const copy = feeTokenBlockCopy('escrow-not-exempt', 'PTS');
		expect(error.message).toBe(`${copy?.title}. ${copy?.description}`);
		expect(error.notice).toEqual(copy);
		expect(error.state).toEqual(state);
		expect(error.name).toBe('PaymentSwitchedOffError');
	});

	it('speaks for the switch when the switch is closed', () => {
		const error = new PaymentSwitchedOffError(
			{ feeToken: 'ok', prompts: closed('maintenance') },
			'prompt',
			'PTS',
		);

		const copy = switchCopy('maintenance');
		expect(error.message).toBe(`${copy.title}. ${copy.description}`);
	});
});

describe('switchedOffReason', () => {
	it('is the switch title when the switch is closed', () => {
		expect(
			switchedOffReason({ feeToken: 'token-paused', prompts: closed('incident') }, 'prompt', 'PTS'),
		).toBe(`${switchCopy('incident').title}. The notice at the top of the page says why.`);
	});

	it('is the check title when only the check blocks, and points above in a dialog', () => {
		expect(
			switchedOffReason({ feeToken: 'contract-not-found', prompts: OPEN }, 'metadata', 'PTS', 'dialog'),
		).toBe(`${feeTokenBlockCopy('contract-not-found', 'PTS')?.title}. The notice above says why.`);
	});
});

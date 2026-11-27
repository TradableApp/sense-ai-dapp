import { describe, expect, it } from 'vitest';

import { blocksAction, feeTokenBlockCopy, PAID_ACTIONS } from '@/lib/feeTokenCheck';
import { ORACLE_KEY_VERDICTS, oracleKeyBlockCopy, oracleKeyBlocks } from '@/lib/oracleKeyCheck';
import { type PromptsSwitchState, SWITCH_WORDINGS, switchCopy } from '@/lib/promptsSwitch';
import { DISAGREEING_STATES, FEE_TOKEN_STATES } from '@/test/feeTokenVerdicts';

import {
	gateBlocks,
	gateCopy,
	gateNotice,
	gateSections,
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
		PAID_ACTIONS.map(action => ({
			feeToken,
			action,
			value: map({ feeToken, prompts, oracleKey: 'unknown' }, action),
		})),
	);

describe('gateBlocks', () => {
	// With the switch open or unheard, the gate is exactly the fee token check.
	it.each([
		['open', OPEN],
		['unknown', UNKNOWN],
	])('with the switch %s it equals the fee token check for every verdict and action', (_, s) => {
		FEE_TOKEN_STATES.forEach(feeToken => {
			PAID_ACTIONS.forEach(action => {
				expect(
					gateBlocks({ feeToken, prompts: s, oracleKey: 'unknown' }, action),
					`${feeToken} ${action}`,
				).toBe(blocksAction(feeToken, action));
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
			expect(gateCopy({ feeToken, prompts: OPEN, oracleKey: 'unknown' }, 'PTS')).toEqual(
				fee ? [fee] : [],
			);
			expect(gateCopy({ feeToken, prompts: UNKNOWN, oracleKey: 'unknown' }, 'PTS')).toEqual(
				fee ? [fee] : [],
			);
		});
	});

	it.each(SWITCH_WORDINGS)('closed (%s) with the check passing is the switch notice alone', w => {
		expect(gateCopy({ feeToken: 'ok', prompts: closed(w), oracleKey: 'unknown' }, 'PTS')).toEqual([
			switchCopy(w),
		]);
		expect(
			gateCopy({ feeToken: 'unknown', prompts: closed(w), oracleKey: 'unknown' }, 'PTS'),
		).toEqual([switchCopy(w)]);
	});

	it.each(DISAGREEING_STATES)('closed beside %s puts the switch first, then the check', v => {
		const notices = gateCopy(
			{ feeToken: v, prompts: closed('incident'), oracleKey: 'unknown' },
			'PTS',
		);

		expect(notices).toEqual([
			switchCopy('incident', { otherProblem: true }),
			feeTokenBlockCopy(v, 'PTS'),
		]);
	});
});

describe('gateNotice', () => {
	it('is null for an action that is allowed', () => {
		expect(
			gateNotice({ feeToken: 'ok', prompts: OPEN, oracleKey: 'unknown' }, 'prompt', 'PTS'),
		).toBeNull();
		expect(
			gateNotice(
				{ feeToken: 'treasury-not-exempt', prompts: OPEN, oracleKey: 'unknown' },
				'prompt',
				'PTS',
			),
		).toBeNull();
	});

	it('is the check notice when only the check blocks', () => {
		expect(
			gateNotice({ feeToken: 'token-paused', prompts: OPEN, oracleKey: 'unknown' }, 'plan', 'PTS'),
		).toEqual(feeTokenBlockCopy('token-paused', 'PTS'));
	});

	it('is the switch notice when the switch is closed, whatever the check says', () => {
		expect(
			gateNotice(
				{ feeToken: 'ok', prompts: closed('pair-retired'), oracleKey: 'unknown' },
				'branch',
				'PTS',
			),
		).toEqual(switchCopy('pair-retired'));
		expect(
			gateNotice(
				{ feeToken: 'token-paused', prompts: closed('pair-retired'), oracleKey: 'unknown' },
				'branch',
				'PTS',
			),
		).toEqual(switchCopy('pair-retired', { otherProblem: true }));
	});
});

describe('PaymentSwitchedOffError', () => {
	it('carries the notice as its message, so any place that shows it reads plainly', () => {
		const state: PaymentGateState = {
			feeToken: 'escrow-not-exempt',
			prompts: OPEN,
			oracleKey: 'unknown',
		};
		const error = new PaymentSwitchedOffError(state, 'metadata', 'PTS');

		const copy = feeTokenBlockCopy('escrow-not-exempt', 'PTS');
		expect(error.message).toBe(`${copy?.title}. ${copy?.description}`);
		expect(error.notice).toEqual(copy);
		expect(error.state).toEqual(state);
		expect(error.name).toBe('PaymentSwitchedOffError');
	});

	it('speaks for the switch when the switch is closed', () => {
		const error = new PaymentSwitchedOffError(
			{ feeToken: 'ok', prompts: closed('maintenance'), oracleKey: 'unknown' },
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
			switchedOffReason(
				{ feeToken: 'token-paused', prompts: closed('incident'), oracleKey: 'unknown' },
				'prompt',
				'PTS',
			),
		).toBe(`${switchCopy('incident').title}. The notice at the top of the page says why.`);
	});

	it('is the check title when only the check blocks, and points above in a dialog', () => {
		expect(
			switchedOffReason(
				{ feeToken: 'contract-not-found', prompts: OPEN, oracleKey: 'unknown' },
				'metadata',
				'PTS',
				'dialog',
			),
		).toBe(`${feeTokenBlockCopy('contract-not-found', 'PTS')?.title}. The notice above says why.`);
	});
});

describe('with the oracle key check', () => {
	const ORACLE_STATES = [...ORACLE_KEY_VERDICTS, 'unknown'] as const;
	const KEY_STOPS = ['mismatch', 'no-key'] as const;

	it('with the switch open, an action is stopped when either check stops it', () => {
		FEE_TOKEN_STATES.forEach(feeToken => {
			ORACLE_STATES.forEach(oracleKey => {
				PAID_ACTIONS.forEach(action => {
					expect(
						gateBlocks({ feeToken, prompts: OPEN, oracleKey }, action),
						`${feeToken} ${oracleKey} ${action}`,
					).toBe(blocksAction(feeToken, action) || oracleKeyBlocks(oracleKey, action));
				});
			});
		});
	});

	it.each(KEY_STOPS)('%s stops a prompt, a branch and a rename or delete, never a plan', state => {
		const stopped = PAID_ACTIONS.filter(action =>
			gateBlocks({ feeToken: 'ok', prompts: OPEN, oracleKey: state }, action),
		);
		expect(stopped.sort()).toEqual(['branch', 'metadata', 'prompt']);
	});

	it.each(KEY_STOPS)('%s alone shows its notice, and refuses in its words', state => {
		const gate = { feeToken: 'ok', prompts: OPEN, oracleKey: state } as const;
		const copy = oracleKeyBlockCopy(state);

		expect(gateCopy(gate, 'PTS')).toEqual([copy]);
		expect(gateNotice(gate, 'prompt', 'PTS')).toEqual(copy);
		expect(new PaymentSwitchedOffError(gate, 'branch', 'PTS').message).toBe(
			`${copy?.title}. ${copy?.description}`,
		);
		expect(switchedOffReason(gate, 'metadata', 'PTS')).toBe(
			`${copy?.title}. The notice at the top of the page says why.`,
		);
	});

	it('comes after the switch and the fee token notice, and then says money back is not affected', () => {
		const sections = gateSections(
			{ feeToken: 'token-paused', prompts: closed('incident'), oracleKey: 'mismatch' },
			'PTS',
		);

		expect(sections.map(section => section.source)).toEqual(['switch', 'feeToken', 'oracleKey']);
		expect(sections[2].notice).toEqual(oracleKeyBlockCopy('mismatch', { otherProblem: true }));
	});

	it('a refusal is explained by the notice whose check stops it, not one that comes first', () => {
		// An unlisted treasury does not stop a prompt; the oracle key does.
		const gate = { feeToken: 'treasury-not-exempt', prompts: OPEN, oracleKey: 'no-key' } as const;

		expect(gateCopy(gate, 'PTS')).toHaveLength(2);
		expect(gateNotice(gate, 'prompt', 'PTS')).toEqual(
			oracleKeyBlockCopy('no-key', { otherProblem: true }),
		);
		expect(gateNotice(gate, 'branch', 'PTS')).toEqual(
			feeTokenBlockCopy('treasury-not-exempt', 'PTS'),
		);
		expect(gateNotice(gate, 'plan', 'PTS')).toBeNull();
	});

	it.each(['match', 'no-key-localnet', 'unknown'] as const)('%s adds nothing', state => {
		expect(gateCopy({ feeToken: 'ok', prompts: OPEN, oracleKey: state }, 'PTS')).toEqual([]);
	});
});

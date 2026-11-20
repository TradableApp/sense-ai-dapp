import { describe, expect, it, vi } from 'vitest';

import { ESCROW_FEE_TOKEN_GETTER, FEE_TOKEN_NAMES } from '@/config/feeTokenConfig';

import {
	assessFeeToken,
	blocksAction,
	feeTokenBlockCopy,
	PAID_ACTIONS,
	type FeeTokenReader,
	type FeeTokenReadings,
	readFeeTokenVerdict,
} from './feeTokenCheck';

const TOKEN = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
const OTHER_TOKEN = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const ESCROW = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0';
const TREASURY = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

const restricted = { symbol: 'PTS', transferable: false };
const open = { symbol: 'COIN', transferable: true };

const readings = (over: Record<string, unknown> = {}): FeeTokenReadings =>
	({
		configuredToken: TOKEN,
		escrowToken: TOKEN,
		onChainSymbol: 'PTS',
		expectedSymbol: 'PTS',
		restricted: true,
		escrowExempt: true,
		treasuryExempt: true,
		...over,
	} as FeeTokenReadings);

describe('assessFeeToken', () => {
	it('passes when the escrow, the symbol and both exemptions agree with the build', () => {
		expect(assessFeeToken(readings())).toBe('ok');
	});

	it('compares addresses without regard to case', () => {
		expect(assessFeeToken(readings({ escrowToken: TOKEN.toLowerCase() }))).toBe('ok');
		expect(
			assessFeeToken(readings({ configuredToken: TOKEN.toUpperCase().replace('0X', '0x') })),
		).toBe('ok');
	});

	it('says the escrow uses another token when its stored token is not the configured one', () => {
		expect(assessFeeToken(readings({ escrowToken: OTHER_TOKEN }))).toBe('escrow-uses-other-token');
	});

	it('says the symbol differs when the token on chain is not the one the build names', () => {
		expect(assessFeeToken(readings({ onChainSymbol: 'COIN' }))).toBe('symbol-mismatch');
	});

	it('compares symbols without regard to case or surrounding space', () => {
		expect(assessFeeToken(readings({ onChainSymbol: ' pts ' }))).toBe('ok');
	});

	it('treats an exemption that was never read as not listed', () => {
		const unread = { ...readings(), escrowExempt: undefined } as unknown as FeeTokenReadings;
		expect(assessFeeToken(unread)).toBe('escrow-not-exempt');
	});

	it('says which party is not listed when a restricted token would refuse it', () => {
		expect(assessFeeToken(readings({ escrowExempt: false }))).toBe('escrow-not-exempt');
		expect(assessFeeToken(readings({ treasuryExempt: false }))).toBe('treasury-not-exempt');
	});

	it('reports the escrow first when neither is listed: nothing works without it', () => {
		expect(assessFeeToken(readings({ escrowExempt: false, treasuryExempt: false }))).toBe(
			'escrow-not-exempt',
		);
	});

	it('ignores exemptions for a token anyone can send', () => {
		expect(
			assessFeeToken({
				configuredToken: TOKEN,
				escrowToken: TOKEN,
				onChainSymbol: 'COIN',
				expectedSymbol: 'COIN',
				restricted: false,
			}),
		).toBe('ok');
	});

	it('reports a wrong token before anything read from that token', () => {
		expect(
			assessFeeToken(
				readings({ escrowToken: OTHER_TOKEN, onChainSymbol: 'COIN', escrowExempt: false }),
			),
		).toBe('escrow-uses-other-token');
	});
});

function reader(over: {
	escrowToken?: unknown;
	treasury?: unknown;
	symbol?: unknown;
	exempt?: Record<string, unknown>;
}): FeeTokenReader & { calls: string[] } {
	const calls: string[] = [];
	const exempt = over.exempt ?? { [ESCROW]: true, [TREASURY]: true };
	return {
		calls,
		escrow: vi.fn(async method => {
			calls.push(`escrow.${method}`);
			return method === ESCROW_FEE_TOKEN_GETTER
				? over.escrowToken ?? TOKEN
				: over.treasury ?? TREASURY;
		}),
		token: vi.fn(async (method, params) => {
			calls.push(`token.${method}${params ? `(${params[0]})` : ''}`);
			return method === 'symbol' ? over.symbol ?? 'PTS' : exempt[params?.[0] as string];
		}),
	};
}

const check = (r: FeeTokenReader, profile = restricted) =>
	readFeeTokenVerdict({ reader: r, configuredToken: TOKEN, escrowAddress: ESCROW, profile });

describe('readFeeTokenVerdict', () => {
	it('reads the escrow token, the treasury, the symbol and both exemptions for a restricted token', async () => {
		const r = reader({});
		await expect(check(r)).resolves.toBe('ok');
		expect(r.calls.sort()).toEqual(
			[
				`escrow.${ESCROW_FEE_TOKEN_GETTER}`,
				'escrow.treasury',
				'token.symbol',
				`token.isTransferExempt(${ESCROW})`,
				`token.isTransferExempt(${TREASURY})`,
			].sort(),
		);
	});

	it('asks about exemptions for the treasury the escrow holds, not one from the build', async () => {
		const elsewhere = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
		const r = reader({ treasury: elsewhere, exempt: { [ESCROW]: true, [elsewhere]: false } });
		await expect(check(r)).resolves.toBe('treasury-not-exempt');
	});

	it('does not ask a token anyone can send about exemptions', async () => {
		const r = reader({ symbol: 'COIN' });
		await expect(check(r, open)).resolves.toBe('ok');
		expect(r.calls.some(call => call.startsWith('token.isTransferExempt'))).toBe(false);
	});

	it('does not read the configured token at all when the escrow uses another one', async () => {
		const r = reader({ escrowToken: OTHER_TOKEN });
		await expect(check(r)).resolves.toBe('escrow-uses-other-token');
		expect(r.calls.some(call => call.startsWith('token.'))).toBe(false);
	});

	it('passes each verdict through', async () => {
		await expect(check(reader({ symbol: 'COIN' }))).resolves.toBe('symbol-mismatch');
		await expect(check(reader({ exempt: { [ESCROW]: false, [TREASURY]: true } }))).resolves.toBe(
			'escrow-not-exempt',
		);
	});

	it.each([
		[
			'an escrow token that is not an address',
			{ escrowToken: 'not-an-address' },
			/escrow token is not an address/,
		],
		['a treasury that is not an address', { treasury: 42 }, /treasury is not an address/],
		['a symbol that is not text', { symbol: 7 }, /symbol is not text/],
		[
			'an escrow exemption that is not yes or no',
			{ exempt: { [ESCROW]: 'yes', [TREASURY]: true } },
			/escrow exemption is not yes or no/,
		],
		[
			'a missing treasury exemption',
			{ exempt: { [ESCROW]: true } },
			/treasury exemption is not yes or no/,
		],
	])(
		'throws on %s: a reading that cannot be trusted is not a verdict',
		async (_label, over, message) => {
			await expect(check(reader(over))).rejects.toThrow(message);
		},
	);

	it('gives the symbol verdict even when the token cannot answer about exemptions', async () => {
		// A restricted profile pointed at an ordinary token: the exemption read reverts, and
		// the symbol is the answer.
		const r = reader({ symbol: 'COIN' });
		const token = r.token;
		r.token = vi.fn(async (method, params) => {
			if (method === 'isTransferExempt') throw new Error('execution reverted');
			return token(method, params);
		});
		await expect(check(r)).resolves.toBe('symbol-mismatch');
	});

	it('lets a failed read reach the caller', async () => {
		const r = reader({});
		r.escrow = vi.fn().mockRejectedValue(new Error('429 Too Many Requests'));
		await expect(check(r)).rejects.toThrow('429');
	});
});

describe('blocksAction', () => {
	const table = {
		ok: [],
		unknown: [],
		'escrow-uses-other-token': ['prompt', 'plan', 'branch', 'metadata'],
		'symbol-mismatch': ['prompt', 'plan', 'branch', 'metadata'],
		'escrow-not-exempt': ['prompt', 'plan', 'branch', 'metadata'],
		// Prompts go from the user to the escrow and on to the treasury, and either end being
		// listed is enough. Only a fee paid straight from the user to the treasury is refused.
		'treasury-not-exempt': ['branch', 'metadata'],
	} as const;

	it.each(Object.entries(table))(
		'%s stops exactly the actions that would fail',
		(state, stopped) => {
			const blocked = PAID_ACTIONS.filter(action =>
				blocksAction(state as keyof typeof table, action),
			);
			expect([...blocked].sort()).toEqual([...stopped].sort());
		},
	);
});

describe('feeTokenBlockCopy', () => {
	const blocking = [
		'escrow-uses-other-token',
		'symbol-mismatch',
		'escrow-not-exempt',
		'treasury-not-exempt',
	] as const;

	it('has nothing to say when the check passed or has no answer', () => {
		expect(feeTokenBlockCopy('ok', 'PTS')).toBeNull();
		expect(feeTokenBlockCopy('unknown', 'PTS')).toBeNull();
	});

	it.each(blocking)('says what is switched off for %s', verdict => {
		const copy = feeTokenBlockCopy(verdict, 'PTS');
		expect(copy?.title).toMatch(/switched off/i);
		expect(copy?.description).toMatch(/switched off/i);
	});

	it('does not claim to know what the wallet approved or paid earlier', () => {
		blocking.forEach(verdict => {
			expect(feeTokenBlockCopy(verdict, 'PTS')?.description).not.toMatch(/nothing (has been|was)/i);
		});
	});

	it('tells a wrong pairing apart from a token that cannot be received', () => {
		expect(feeTokenBlockCopy('symbol-mismatch', 'PTS')?.description).not.toMatch(/cannot receive/i);
		expect(feeTokenBlockCopy('escrow-uses-other-token', 'PTS')?.description).toMatch(/same token/i);
		expect(feeTokenBlockCopy('escrow-not-exempt', 'PTS')?.description).toMatch(
			/cannot receive PTS/,
		);
	});

	it('says prompts still work when only the treasury is not listed', () => {
		const copy = feeTokenBlockCopy('treasury-not-exempt', 'PTS');
		expect(copy?.title).toMatch(/some actions/i);
		expect(copy?.description).toMatch(/prompts still work/i);
		expect(copy?.description).toMatch(/cancel/i);
	});

	it('points to support inside the app, and names only the token the build is for', () => {
		const all = blocking
			.map(verdict => JSON.stringify(feeTokenBlockCopy(verdict, 'PTS')))
			.join(' ');
		expect(all).toMatch(/Support in the menu/);
		expect(all).not.toMatch(new RegExp(`\\b(${FEE_TOKEN_NAMES.join('|')})\\b`));
	});
});

import { describe, expect, it, vi } from 'vitest';

import {
	assessFeeToken,
	feeTokenBlockCopy,
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

const readings = (over: Partial<FeeTokenReadings> = {}): FeeTokenReadings => ({
	configuredToken: TOKEN,
	escrowToken: TOKEN,
	onChainSymbol: 'PTS',
	expectedSymbol: 'PTS',
	restricted: true,
	escrowExempt: true,
	treasuryExempt: true,
	...over,
});

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
			assessFeeToken(
				readings({
					restricted: false,
					onChainSymbol: 'COIN',
					expectedSymbol: 'COIN',
					escrowExempt: undefined,
					treasuryExempt: undefined,
				}),
			),
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
	ableToken?: unknown;
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
			return method === 'ableToken' ? over.ableToken ?? TOKEN : over.treasury ?? TREASURY;
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
				'escrow.ableToken',
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
		const r = reader({ ableToken: OTHER_TOKEN });
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
		['an escrow token that is not an address', { ableToken: 'not-an-address' }],
		['a treasury that is not an address', { treasury: 42 }],
		['a symbol that is not text', { symbol: 7 }],
		['an exemption that is not yes or no', { exempt: { [ESCROW]: 'yes', [TREASURY]: true } }],
		['a missing exemption', { exempt: { [ESCROW]: true } }],
	])('throws on %s: a reading that cannot be trusted is not a verdict', async (_label, over) => {
		await expect(check(reader(over))).rejects.toThrow(/fee token check/i);
	});

	it('lets a failed read reach the caller', async () => {
		const r = reader({});
		r.escrow = vi.fn().mockRejectedValue(new Error('429 Too Many Requests'));
		await expect(check(r)).rejects.toThrow('429');
	});
});

describe('feeTokenBlockCopy', () => {
	it('has nothing to say when the check passed', () => {
		expect(feeTokenBlockCopy('ok', 'PTS')).toBeNull();
	});

	it.each([
		'escrow-uses-other-token',
		'symbol-mismatch',
		'escrow-not-exempt',
		'treasury-not-exempt',
	] as const)('tells the user payments are off and nothing was charged for %s', verdict => {
		const copy = feeTokenBlockCopy(verdict, 'PTS');
		expect(copy?.title).toMatch(/payments are switched off/i);
		expect(copy?.description).toMatch(/nothing (has been|was) (approved|charged)/i);
	});

	it('names only the token the build is for', () => {
		const all = (
			[
				'escrow-uses-other-token',
				'symbol-mismatch',
				'escrow-not-exempt',
				'treasury-not-exempt',
			] as const
		)
			.map(verdict => JSON.stringify(feeTokenBlockCopy(verdict, 'PTS')))
			.join(' ');
		expect(all).not.toMatch(/\b(ABLE|SENSE)\b/);
	});
});

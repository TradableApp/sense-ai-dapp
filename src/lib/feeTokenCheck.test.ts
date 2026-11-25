import { describe, expect, it, vi } from 'vitest';

import { ESCROW_FEE_TOKEN_GETTER, FEE_TOKEN_NAMES } from '@/config/feeTokenConfig';

import {
	assessFeeToken,
	blocksAction,
	ESCROW_AGENT_GETTER,
	FEE_TOKEN_VERDICTS,
	feeTokenBlockCopy,
	type FeeTokenReader,
	type FeeTokenReadings,
	PAID_ACTIONS,
	readFeeTokenVerdict,
} from './feeTokenCheck';

const TOKEN = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
const OTHER_TOKEN = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const ESCROW = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0';
const TREASURY = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const AGENT = '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9';
const OTHER_AGENT = '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9';
/** What a node returns for an address with a contract on it. */
const DEPLOYED = '0x6080604052348015600e575f5ffd5b50';

const restricted = { symbol: 'PTS', transferable: false, pausable: true };
const open = { symbol: 'COIN', transferable: true, pausable: true };
const unpausable = { ...restricted, pausable: false };

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
	agent?: unknown;
	treasury?: unknown;
	symbol?: unknown;
	paused?: unknown;
	exempt?: Record<string, unknown>;
	codeAt?: Record<string, unknown>;
	/** Successive answers to the code read at an address; an Error is thrown. */
	codeSequence?: Record<string, readonly unknown[]>;
}): FeeTokenReader & { calls: string[] } {
	const calls: string[] = [];
	const exempt = over.exempt ?? { [ESCROW]: true, [TREASURY]: true };
	const codeAt: Record<string, unknown> = { [ESCROW]: DEPLOYED, [TOKEN]: DEPLOYED, ...over.codeAt };
	return {
		calls,
		code: vi.fn(async address => {
			const asked = calls.filter(call => call === `code(${address})`).length;
			calls.push(`code(${address})`);
			const sequence = over.codeSequence?.[address];
			const answer = sequence ? sequence[asked] : codeAt[address];
			if (answer instanceof Error) throw answer;
			return answer;
		}),
		escrow: vi.fn(async method => {
			calls.push(`escrow.${method}`);
			if (method === ESCROW_FEE_TOKEN_GETTER) return over.escrowToken ?? TOKEN;
			if (method === ESCROW_AGENT_GETTER) return 'agent' in over ? over.agent : AGENT;
			return 'treasury' in over ? over.treasury : TREASURY;
		}),
		token: vi.fn(async (method, params) => {
			calls.push(`token.${method}${params ? `(${params[0]})` : ''}`);
			if (method === 'symbol') return over.symbol ?? 'PTS';
			if (method === 'paused') return 'paused' in over ? over.paused : false;
			return exempt[params?.[0] as string];
		}),
	};
}

const check = (r: FeeTokenReader, profile = restricted) =>
	readFeeTokenVerdict({
		reader: r,
		configuredToken: TOKEN,
		configuredAgent: AGENT,
		escrowAddress: ESCROW,
		profile,
	});

describe('readFeeTokenVerdict', () => {
	it('reads both codes, the escrow token, its agent, the treasury, the symbol, the pause flag and both exemptions for a restricted token', async () => {
		const r = reader({});
		await expect(check(r)).resolves.toBe('ok');
		expect(r.calls.sort()).toEqual(
			[
				`code(${ESCROW})`,
				`code(${TOKEN})`,
				`escrow.${ESCROW_FEE_TOKEN_GETTER}`,
				`escrow.${ESCROW_AGENT_GETTER}`,
				'escrow.treasury',
				'token.symbol',
				'token.paused',
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

	it('says the escrow uses another token even when its treasury cannot be read as an address', async () => {
		await expect(check(reader({ escrowToken: OTHER_TOKEN, treasury: null }))).resolves.toBe(
			'escrow-uses-other-token',
		);
	});

	it('says the escrow uses another token even when its treasury cannot be read at all', async () => {
		const r = reader({ escrowToken: OTHER_TOKEN });
		const { escrow } = r;
		r.escrow = vi.fn(async method => {
			if (method === 'treasury') throw new Error('429 Too Many Requests');
			return escrow(method);
		});
		await expect(check(r)).resolves.toBe('escrow-uses-other-token');
	});

	it('says the escrow serves another agent when its agent is not the one the build names', async () => {
		const r = reader({ agent: OTHER_AGENT });

		const verdict = await check(r);

		expect(verdict).toBe('escrow-serves-other-agent');
	});

	it('does not read the token at all when the escrow serves another agent', async () => {
		const r = reader({ agent: OTHER_AGENT });

		await check(r);

		expect(r.calls.some(call => call.startsWith('token.'))).toBe(false);
	});

	it('names a wrong token before a wrong agent, and does not ask about the agent', async () => {
		const r = reader({ escrowToken: OTHER_TOKEN, agent: OTHER_AGENT });

		const verdict = await check(r);

		expect(verdict).toBe('escrow-uses-other-token');
		expect(r.calls).not.toContain(`escrow.${ESCROW_AGENT_GETTER}`);
	});

	it('compares the agent address without regard to case', async () => {
		const r = reader({ agent: AGENT.toLowerCase() });

		const verdict = await check(r);

		expect(verdict).toBe('ok');
	});

	it('makes the reads in the order the verdicts are decided', async () => {
		const r = reader({});

		await check(r);

		expect(r.calls.slice(0, 6)).toEqual([
			`code(${ESCROW})`,
			`escrow.${ESCROW_FEE_TOKEN_GETTER}`,
			`escrow.${ESCROW_AGENT_GETTER}`,
			`code(${TOKEN})`,
			'token.symbol',
			'token.paused',
		]);
	});

	it('says no contract is found when the escrow address has no code, and reads nothing else', async () => {
		const r = reader({ codeAt: { [ESCROW]: '0x' } });

		const verdict = await check(r);

		expect(verdict).toBe('contract-not-found');
		expect(r.calls).toEqual([`code(${ESCROW})`, `code(${ESCROW})`]);
	});

	it('says no contract is found when the token address has no code, and does not ask the token', async () => {
		const r = reader({ codeAt: { [TOKEN]: '0x' } });

		const verdict = await check(r);

		expect(verdict).toBe('contract-not-found');
		expect(r.calls.some(call => call.startsWith('token.'))).toBe(false);
	});

	it.each(['0x0', '0x00', '0x0000000000'])('treats %s, zeros only, as no code', empty => {
		const r = reader({ codeAt: { [ESCROW]: empty } });

		return expect(check(r)).resolves.toBe('contract-not-found');
	});

	it('reads the code at each address once when the first answer has code', async () => {
		const r = reader({});

		await check(r);

		expect(r.calls.filter(call => call === `code(${ESCROW})`)).toHaveLength(1);
		expect(r.calls.filter(call => call === `code(${TOKEN})`)).toHaveLength(1);
	});

	it.each([
		['the escrow', ESCROW],
		['the token', TOKEN],
	])(
		'carries on when an empty answer at %s is followed by code: one empty answer is not a block',
		async (_label, address) => {
			const r = reader({ codeSequence: { [address]: ['0x', DEPLOYED] } });

			const verdict = await check(r);

			expect(verdict).toBe('ok');
			expect(r.calls.filter(call => call === `code(${address})`)).toHaveLength(2);
		},
	);

	it('says no contract is found only after two empty answers in a row', async () => {
		const r = reader({ codeSequence: { [TOKEN]: ['0x', '0x'] } });

		const verdict = await check(r);

		expect(verdict).toBe('contract-not-found');
		expect(r.calls.filter(call => call === `code(${TOKEN})`)).toHaveLength(2);
	});

	it.each([
		['fails', new Error('fetch failed'), /fetch failed/],
		['is not hex', 'deployed', /code at the escrow is not hex/],
	])('has no answer when the second code read %s', async (_label, second, message) => {
		const r = reader({ codeSequence: { [ESCROW]: ['0x', second] } });

		const outcome = check(r);

		await expect(outcome).rejects.toThrow(message);
	});

	it.each(['0x01', '0xfe', '0x6080', '0x00ff'])(
		'treats short code such as %s as a contract: only zeros mean none',
		async code => {
			const r = reader({ codeAt: { [ESCROW]: code, [TOKEN]: code } });

			const verdict = await check(r);

			expect(verdict).toBe('ok');
		},
	);

	it('names a wrong agent before a token address with no code', async () => {
		const r = reader({ agent: OTHER_AGENT, codeAt: { [TOKEN]: '0x' } });

		const verdict = await check(r);

		expect(verdict).toBe('escrow-serves-other-agent');
	});

	it.each([
		['nothing', undefined],
		['a number', 42],
		['an empty string', ''],
		['text that is not hex', 'deployed'],
		['hex digits without the prefix', '6080'],
		['a prefix followed by something that is not hex', '0x60zz'],
	])(
		'has no answer when the code reading is %s: only an empty answer means no contract',
		async (_label, value) => {
			const r = reader({ codeAt: { [ESCROW]: value } });

			const outcome = check(r);

			await expect(outcome).rejects.toThrow(/code at the escrow is not hex/);
		},
	);

	it('has no answer when the code read itself fails', async () => {
		const r = reader({});
		r.code = vi.fn().mockRejectedValue(new Error('fetch failed'));

		const outcome = check(r);

		await expect(outcome).rejects.toThrow('fetch failed');
	});

	it('says the token is paused when its owner has stopped every transfer', async () => {
		const r = reader({ paused: true });

		const verdict = await check(r);

		expect(verdict).toBe('token-paused');
	});

	it('asks a token anyone can send whether it is paused too', async () => {
		const r = reader({ symbol: 'COIN', paused: true });

		const verdict = await check(r, open);

		expect(verdict).toBe('token-paused');
	});

	it('does not ask a token that cannot be paused', async () => {
		const r = reader({ paused: true });

		const verdict = await check(r, unpausable);

		expect(verdict).toBe('ok');
		expect(r.calls).not.toContain('token.paused');
	});

	it('names a different symbol before asking about a pause', async () => {
		const r = reader({ symbol: 'COIN', paused: true });

		const verdict = await check(r);

		expect(verdict).toBe('symbol-mismatch');
		expect(r.calls).not.toContain('token.paused');
	});

	it('names a pause before the listings, and does not ask about them', async () => {
		const r = reader({ paused: true, exempt: { [ESCROW]: false, [TREASURY]: false } });

		const verdict = await check(r);

		expect(verdict).toBe('token-paused');
		expect(r.calls.some(call => call.startsWith('token.isTransferExempt'))).toBe(false);
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
		['an agent that is not an address', { agent: 'agent' }, /agent is not an address/],
		['an escrow token in short hex', { escrowToken: '0x1234' }, /escrow token is not an address/],
		['an agent in short hex', { agent: AGENT.slice(0, 20) }, /agent is not an address/],
		['a treasury in short hex', { treasury: TREASURY.slice(0, 41) }, /treasury is not an address/],
		['an agent one digit too long', { agent: `${AGENT}0` }, /agent is not an address/],
		['a treasury that is not an address', { treasury: 42 }, /treasury is not an address/],
		['a symbol that is not text', { symbol: 7 }, /symbol is not text/],
		['a pause flag that is not yes or no', { paused: 'no' }, /pause flag is not yes or no/],
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
		const { token } = r;
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
		'escrow-serves-other-agent': ['prompt', 'plan', 'branch', 'metadata'],
		'contract-not-found': ['prompt', 'plan', 'branch', 'metadata'],
		'token-paused': ['prompt', 'plan', 'branch', 'metadata'],
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
		'escrow-serves-other-agent',
		'contract-not-found',
		'token-paused',
	] as const;

	it('has words for every verdict that stops something: a block is never silent', () => {
		const stopping = FEE_TOKEN_VERDICTS.filter(verdict => verdict !== 'ok');

		const silent = stopping.filter(verdict => feeTokenBlockCopy(verdict, 'PTS') === null);

		expect(stopping.length).toBeGreaterThan(0);
		expect(silent).toEqual([]);
	});

	it('the banner list covers every verdict', () => {
		expect([...FEE_TOKEN_VERDICTS].sort()).toEqual(['ok', ...blocking].sort());
	});

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

	it('says no contract was found when an address the app uses has none', () => {
		const copy = feeTokenBlockCopy('contract-not-found', 'PTS');

		expect(copy?.title).toMatch(/payments are switched off/i);
		expect(copy?.description).toMatch(/no contract was found/i);
	});

	it('says the payment contract serves another agent, so a prompt would not be answered', () => {
		const copy = feeTokenBlockCopy('escrow-serves-other-agent', 'PTS');

		expect(copy?.title).toMatch(/payments are switched off/i);
		expect(copy?.description).toMatch(/different agent/i);
		expect(copy?.description).toMatch(/never answered/i);
	});

	it('says a paused token also stops cancelling and refunds, and where a payment stays', () => {
		const copy = feeTokenBlockCopy('token-paused', 'PTS');

		expect(copy?.title).toMatch(/payments are switched off/i);
		expect(copy?.description).toMatch(/PTS is paused/);
		expect(copy?.description).toMatch(
			/cancelling a prompt or claiming a refund will also be refused/i,
		);
		expect(copy?.description).toMatch(/until PTS can move/);
		expect(copy?.description).toMatch(/stays with the SenseAI payment contract/);
	});

	it('names no price and no market value for any verdict', () => {
		blocking.forEach(verdict => {
			const description = feeTokenBlockCopy(verdict, 'PTS')?.description ?? '';

			expect(description, verdict).not.toMatch(/\$|USD|price|market|value/i);
		});
	});

	it('says prompts still work when only the treasury is not listed', () => {
		const copy = feeTokenBlockCopy('treasury-not-exempt', 'PTS');
		expect(copy?.title).toMatch(/some actions/i);
		expect(copy?.description).toMatch(/prompts still work/i);
	});

	// A cancellation pays its fee and the rest of the payment out of the escrow, which is
	// listed, so the token lets both through whether or not the treasury is listed. A refund
	// leaves the escrow too.
	it('says cancelling and refunds still work when only the treasury is not listed', () => {
		const description = feeTokenBlockCopy('treasury-not-exempt', 'PTS')?.description ?? '';

		expect(description).toMatch(/cancelling a prompt and claiming a refund still work/i);
		expect(description).not.toMatch(/refused too|will be refused/i);
	});

	// Both a cancellation and a refund pay the prompt's payment from the escrow back to the
	// user, and an unlisted escrow can move nothing to an unlisted user.
	it('says cancelling and refunds are refused too when the escrow is not listed', () => {
		const description = feeTokenBlockCopy('escrow-not-exempt', 'PTS')?.description ?? '';

		expect(description).toMatch(/cancelling a prompt or claiming a refund would be refused too/i);
	});

	it('points to support inside the app, and names only the token the build is for', () => {
		const all = blocking
			.map(verdict => JSON.stringify(feeTokenBlockCopy(verdict, 'PTS')))
			.join(' ');
		expect(all).toMatch(/Support in the menu/);
		expect(all).not.toMatch(new RegExp(`\\b(${FEE_TOKEN_NAMES.join('|')})\\b`));
	});
});

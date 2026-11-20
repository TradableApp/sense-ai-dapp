import { encodeAbiParameters, keccak256, pad, parseUnits, stringToBytes } from 'viem';
import { describe, expect, it } from 'vitest';

import { faucetNotice, faucetOutcome, type FaucetOutcome } from './faucetOutcome';

const TOKEN = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
const OTHER_TOKEN = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const FAUCET = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const USER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const SOMEONE_ELSE = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
const TRANSFER_TOPIC = keccak256(stringToBytes('Transfer(address,address,uint256)'));

/** A Transfer log as a node returns it: lower-case addresses, padded topics. */
function transferLog(token: string, to: string, value: bigint) {
	return {
		address: token.toLowerCase(),
		topics: [
			TRANSFER_TOPIC,
			pad(FAUCET.toLowerCase() as `0x${string}`),
			pad(to.toLowerCase() as `0x${string}`),
		],
		data: encodeAbiParameters([{ type: 'uint256' }], [value]),
	};
}

const expected = { token: TOKEN, recipient: USER, decimals: 18 };

describe('faucetOutcome', () => {
	it('is received when the receipt succeeded and holds the fee token sent to the user', () => {
		const receipt = { status: 'success', logs: [transferLog(TOKEN, USER, parseUnits('250', 18))] };

		expect(faucetOutcome(receipt, expected)).toEqual({ kind: 'received', amount: '250' });
	});

	it('compares the token and the user without regard to case', () => {
		const receipt = { status: 'success', logs: [transferLog(TOKEN, USER, parseUnits('5', 18))] };
		const upper = { ...expected, token: TOKEN.toUpperCase().replace('0X', '0x') };

		expect(faucetOutcome(receipt, upper)).toEqual({ kind: 'received', amount: '5' });
	});

	it("formats the amount with the profile's decimals", () => {
		const receipt = { status: 'success', logs: [transferLog(TOKEN, USER, 1_500_000n)] };

		expect(faucetOutcome(receipt, { ...expected, decimals: 6 })).toEqual({
			kind: 'received',
			amount: '1.5',
		});
	});

	it('adds up every transfer of the fee token to the user', () => {
		const logs = [
			transferLog(TOKEN, USER, parseUnits('2', 18)),
			transferLog(TOKEN, USER, parseUnits('3', 18)),
		];

		expect(faucetOutcome({ status: 'success', logs }, expected)).toEqual({
			kind: 'received',
			amount: '5',
		});
	});

	it('is reverted for a receipt that did not succeed, whatever its logs', () => {
		const logs = [transferLog(TOKEN, USER, parseUnits('250', 18))];

		expect(faucetOutcome({ status: 'reverted', logs }, expected)).toEqual({ kind: 'reverted' });
		expect(faucetOutcome({ logs }, expected)).toEqual({ kind: 'reverted' });
	});

	it.each([
		['no logs at all', []],
		['a transfer of another token', [transferLog(OTHER_TOKEN, USER, parseUnits('250', 18))]],
		['a transfer to someone else', [transferLog(TOKEN, SOMEONE_ELSE, parseUnits('250', 18))]],
		['a log that is not a transfer', [{ address: TOKEN, topics: [pad('0x01')], data: '0x' }]],
	])('is no-transfer for a successful receipt with %s', (_, logs) => {
		expect(faucetOutcome({ status: 'success', logs }, expected)).toEqual({ kind: 'no-transfer' });
	});

	it('is no-transfer for a successful receipt whose logs are null, as viem gives none', () => {
		expect(faucetOutcome({ status: 'success', logs: null }, expected)).toEqual({
			kind: 'no-transfer',
		});
	});

	it('is a timeout when no receipt came', () => {
		expect(faucetOutcome('timeout', expected)).toEqual({ kind: 'timeout' });
	});
});

describe('faucetNotice', () => {
	// A made-up symbol: the notice names whatever token the profile names, and no other.
	const symbol = 'PTS';
	const outcomes: FaucetOutcome[] = [
		{ kind: 'received', amount: '250' },
		{ kind: 'reverted' },
		{ kind: 'no-transfer' },
		{ kind: 'timeout' },
	];

	it('announces tokens only for a transfer that arrived, with its amount', () => {
		expect(faucetNotice({ kind: 'received', amount: '250' }, symbol)).toEqual({
			tone: 'success',
			title: 'Tokens Received',
			description: '250 PTS added to your wallet.',
		});
	});

	it.each([
		['reverted', 'error', /could not send/i],
		['no-transfer', 'error', /no tokens arrived/i],
		['timeout', 'info', /not been confirmed yet/i],
	] as const)('says plainly what happened when %s', (kind, tone, description) => {
		const notice = faucetNotice({ kind } as FaucetOutcome, symbol);

		expect(notice.tone).toBe(tone);
		expect(notice.title).not.toBe('Tokens Received');
		expect(notice.description).toMatch(description);
	});

	// After a timeout the balance is asked once, at once; it is asked again only when the
	// user comes back to the tab or reloads, so nothing may promise that it updates by itself.
	it('does not promise a balance update that comes only when the user looks again', () => {
		const { description } = faucetNotice({ kind: 'timeout' }, symbol);

		expect(description).not.toMatch(/will update/i);
		expect(description).toMatch(/not checked again for it/i);
		expect(description).toMatch(/coming back to this tab or reloading the page/i);
	});

	it('refuses an outcome it does not know rather than calling it still confirming', () => {
		const unknownOutcome = { kind: 'refunded' } as unknown as FaucetOutcome;

		expect(() => faucetNotice(unknownOutcome, symbol)).toThrow(/refunded/);
	});

	it.each(outcomes)('shows no price for $kind', outcome => {
		const { title, description } = faucetNotice(outcome, symbol);

		expect(`${title} ${description}`).not.toMatch(/\$|USD|price/i);
	});
});

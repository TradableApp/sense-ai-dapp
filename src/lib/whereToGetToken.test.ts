import { describe, expect, it } from 'vitest';

import { FEE_TOKEN_PROFILES } from '@/config/feeToken';

import pointsToCommunity from './whereToGetToken';

const { SENSE, ABLE } = FEE_TOKEN_PROFILES;

describe('pointsToCommunity', () => {
	it('points a wallet with none of a token it cannot get in the app to the community', () => {
		expect(pointsToCommunity({ balance: 0, profile: SENSE, isFaucetOffered: false })).toBe(true);
	});

	it.each([
		['the wallet holds some', { balance: 0.5, profile: SENSE, isFaucetOffered: false }],
		[
			'the balance is not known yet',
			{ balance: undefined, profile: SENSE, isFaucetOffered: false },
		],
		['the faucet is offered on this chain', { balance: 0, profile: SENSE, isFaucetOffered: true }],
		['the token can be bought in the app', { balance: 0, profile: ABLE, isFaucetOffered: false }],
		[
			'the token can be sent to the wallet, though not bought',
			{ balance: 0, profile: { ...SENSE, transferable: true }, isFaucetOffered: false },
		],
	])('does not when %s', (_label, input) => {
		expect(pointsToCommunity(input)).toBe(false);
	});
});

import { describe, expect, it } from 'vitest';

import ableTokenLogo from '@/assets/able-token-logo.svg';
import senseLogo from '@/assets/logos/senseai-logo.svg';
import AbleTokenABI from '@/lib/abi/AbleToken.json';
import SenseTokenABI from '@/lib/abi/SenseToken.json';

import { defaultPlanLimit, FEE_TOKEN_PROFILES, selectFeeToken } from './feeToken';

const { SENSE, ABLE } = FEE_TOKEN_PROFILES;
const hasError = (abi: readonly unknown[], name: string) =>
	abi.some(entry => {
		const item = entry as { type?: string; name?: string };
		return item.type === 'error' && item.name === name;
	});

describe('fee token profiles', () => {
	it('SENSE is a credit that cannot be sent, bought or priced', () => {
		expect(SENSE.symbol).toBe('SENSE');
		expect(SENSE.icon).toBe(senseLogo);
		expect(SENSE.abi).toBe(SenseTokenABI.abi);
		expect(hasError(SENSE.abi, 'TransferNotAllowed')).toBe(true);
		expect(SENSE.showsMarketValue).toBe(false);
		expect(SENSE.transferable).toBe(false);
		expect(SENSE.purchasable).toBe(false);
	});

	// Selecting this profile is the whole of the dApp's side of a move to the other token:
	// everything SENSE turns off comes back from these values, with no code change.
	it('ABLE keeps the send and buy buttons, the market value and a fixed default limit', () => {
		expect(ABLE.symbol).toBe('ABLE');
		expect(ABLE.name).toBe('ABLE Token');
		expect(ABLE.icon).toBe(ableTokenLogo);
		expect(ABLE.abi).toBe(AbleTokenABI.abi);
		expect(ABLE.showsMarketValue).toBe(true);
		expect(ABLE.transferable).toBe(true);
		expect(ABLE.purchasable).toBe(true);
		expect(ABLE.defaultPlanLimit).toEqual({ kind: 'fixed', amount: 1000 });
	});

	it('no profile names the other token', () => {
		expect(`${SENSE.symbol} ${SENSE.name}`).not.toMatch(/able/i);
		expect(`${ABLE.symbol} ${ABLE.name}`).not.toMatch(/sense/i);
	});
});

describe('selectFeeToken', () => {
	it.each(['ABLE', 'able', ' ABLE '])('reads %j as ABLE', value => {
		expect(selectFeeToken(value)).toBe(ABLE);
	});

	it.each(['SENSE', 'sense'])('reads %j as SENSE', value => {
		expect(selectFeeToken(value)).toBe(SENSE);
	});

	// The safe way to be wrong: a build that forgot the setting never shows a price or a
	// send button for a credit that has neither.
	it.each([undefined, '', 'USDC', 'undefined'])('falls back to SENSE for %j', value => {
		expect(selectFeeToken(value)).toBe(SENSE);
	});
});

describe('defaultPlanLimit', () => {
	it('is the fixed amount for ABLE whatever the wallet holds', () => {
		expect(defaultPlanLimit(ABLE, 0)).toBe(1000);
		expect(defaultPlanLimit(ABLE, 25_000)).toBe(1000);
		expect(defaultPlanLimit(ABLE, undefined)).toBe(1000);
	});

	it('is what the wallet holds for SENSE, in whole tokens', () => {
		expect(defaultPlanLimit(SENSE, 75)).toBe(75);
		expect(defaultPlanLimit(SENSE, 75.9)).toBe(75);
	});

	it('is the small starting amount for SENSE when the wallet is empty or unread', () => {
		const { defaultPlanLimit: rule } = SENSE;
		if (rule.kind !== 'walletBalance') throw new Error('SENSE default limit is not balance-based');

		expect(defaultPlanLimit(SENSE, 0)).toBe(rule.whenEmpty);
		expect(defaultPlanLimit(SENSE, 0.4)).toBe(rule.whenEmpty);
		expect(defaultPlanLimit(SENSE, undefined)).toBe(rule.whenEmpty);
		expect(defaultPlanLimit(SENSE, Number.NaN)).toBe(rule.whenEmpty);
	});
});

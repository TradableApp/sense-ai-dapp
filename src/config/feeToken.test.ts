import { afterEach, describe, expect, it, vi } from 'vitest';

import ableTokenLogo from '@/assets/able-token-logo.svg';
import senseLogo from '@/assets/logos/senseai-logo.svg';
import AbleTokenABI from '@/lib/abi/AbleToken.json';
import SenseTokenABI from '@/lib/abi/SenseToken.json';

import {
	assertFeeTokenConfig,
	defaultPlanLimit,
	FEE_TOKEN_PROFILES,
	FeeTokenConfigError,
	type FeeTokenProfile,
	selectFeeToken,
} from './feeToken';

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

describe('fee token profiles — what the contracts fix', () => {
	// Amounts are converted with 18 decimals throughout the dApp. Both tokens use 18.
	it.each(Object.values(FEE_TOKEN_PROFILES))('$symbol has 18 decimals', profile => {
		expect(profile.decimals).toBe(18);
	});

	it('only a priced token carries a planned price for test-chain estimates', () => {
		expect((SENSE as FeeTokenProfile).plannedPriceUsd).toBeUndefined();
		expect(ABLE.plannedPriceUsd).toBe(0.015);
	});

	// An empty wallet must still be offered a limit the form accepts (greater than zero).
	// 25 is a small round amount: enough for a first few prompts once the wallet is funded.
	it('offers an empty SENSE wallet a limit of 25', () => {
		expect(SENSE.defaultPlanLimit).toEqual({ kind: 'walletBalance', whenEmpty: 25 });
	});
});

describe('FEE_TOKEN — the build setting is what selects the profile', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.resetModules();
	});

	it.each(['ABLE', 'SENSE'])('a build set to %s gets that profile', async value => {
		vi.stubEnv('VITE_FEE_TOKEN', value);
		vi.resetModules();

		const { FEE_TOKEN } = await import('./feeToken');

		expect(FEE_TOKEN.symbol).toBe(value);
	});
});

// The fallback to SENSE is right for a developer's machine and wrong for a deployed build:
// SENSE settings on another token mean a wrong label, no value shown, and a first offer
// to approve the wallet's whole balance. A deployed build must name its token.
describe('assertFeeTokenConfig', () => {
	it.each(['testnet', 'mainnet', 'production', 'development'])(
		'stops a %s build with no fee token named',
		mode => {
			expect(() => assertFeeTokenConfig(mode, {})).toThrow(FeeTokenConfigError);
			expect(() => assertFeeTokenConfig(mode, { VITE_FEE_TOKEN: '' })).toThrow(FeeTokenConfigError);
		},
	);

	it.each(['ABEL', 'able', ' ABLE', 'SENSE ', 'ABLE_TOKEN', 'true'])(
		'stops a build whose fee token is written %j',
		value => {
			expect(() => assertFeeTokenConfig('testnet', { VITE_FEE_TOKEN: value })).toThrow(
				FeeTokenConfigError,
			);
		},
	);

	it.each(['SENSE', 'ABLE'])('accepts a build that names %s exactly', value => {
		expect(() => assertFeeTokenConfig('mainnet', { VITE_FEE_TOKEN: value })).not.toThrow();
	});

	it.each(['localnet', 'test'])('lets a %s run fall back when none is named', mode => {
		expect(() => assertFeeTokenConfig(mode, {})).not.toThrow();
	});

	it.each(['localnet', 'test'])('still stops a %s run that names an unknown token', mode => {
		expect(() => assertFeeTokenConfig(mode, { VITE_FEE_TOKEN: 'ABEL' })).toThrow(
			FeeTokenConfigError,
		);
	});
});

// @vitest-environment node
//
// The suite asks `feeToken()` which token the build under test was made for. It must answer from
// the setting, and stop as the build does when the setting is not exactly one of the names: a
// suite that guessed would assert the wrong symbol and the wrong transfer rule. No token is named
// here; the names come from the list the build chooses from.
import { describe, expect, it } from 'vitest';

import { FEE_TOKEN_BASICS, FEE_TOKEN_NAMES, FeeTokenConfigError } from '@/config/feeTokenConfig';

import { feeToken, feeTokenSymbolPattern } from './feeToken';

describe('feeToken', () => {
	it.each(FEE_TOKEN_NAMES)('answers with the profile the setting names (%s)', name => {
		expect(feeToken({ VITE_FEE_TOKEN: name })).toEqual(FEE_TOKEN_BASICS[name]);
	});

	it('gives each setting its own symbol and transfer rule', () => {
		const [first, second] = FEE_TOKEN_NAMES.map(name => feeToken({ VITE_FEE_TOKEN: name }));

		expect(first.symbol).not.toBe(second.symbol);
		expect(first.transferable).not.toBe(second.transferable);
	});

	it.each([
		['missing', undefined],
		['empty', ''],
		['in lower case', FEE_TOKEN_NAMES[1].toLowerCase()],
		['padded', ` ${FEE_TOKEN_NAMES[1]} `],
		['misspelt', `${FEE_TOKEN_NAMES[1]}X`],
	])('stops when the setting is %s, as the build does', (_label, value) => {
		expect(() => feeToken({ VITE_FEE_TOKEN: value })).toThrow(FeeTokenConfigError);
	});

	it('never prints the refused value', () => {
		const pasted = '0xdeadbeefdeadbeefdeadbeef';

		let message = '';
		try {
			feeToken({ VITE_FEE_TOKEN: pasted });
		} catch (err) {
			message = (err as Error).message;
		}

		expect(message).toMatch(/VITE_FEE_TOKEN/);
		expect(message).not.toContain(pasted);
	});
});

describe('feeTokenSymbolPattern', () => {
	it('matches the symbol as a whole word only, in its own letter case', () => {
		const { VITE_FEE_TOKEN: previous } = process.env;
		const [name] = FEE_TOKEN_NAMES;
		process.env.VITE_FEE_TOKEN = name;
		try {
			const { symbol } = FEE_TOKEN_BASICS[name];
			const pattern = feeTokenSymbolPattern();

			expect(pattern.test(`12.5 ${symbol}`)).toBe(true);
			expect(pattern.test(`12.5 ${symbol}AI`)).toBe(false);
			expect(pattern.test(`12.5 ${symbol.toLowerCase()}`)).toBe(false);
		} finally {
			if (previous === undefined) delete process.env.VITE_FEE_TOKEN;
			else process.env.VITE_FEE_TOKEN = previous;
		}
	});
});

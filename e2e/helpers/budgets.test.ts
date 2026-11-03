// @vitest-environment node
//
// The suite's wait budgets state what the dApp owes the user on each chain. Localnet keeps the
// values the specs grew up with (instant blocks, sub-second indexing). Testnet budgets are the
// acceptable experience on a public chain, sized from the 2026-11-02 Base Sepolia run day; a
// breach is a finding, not a retry.
import { describe, expect, it } from 'vitest';

import { BUDGET, budgetsFor } from './budgets';
import { CHAIN } from './chain';

describe('wait budgets', () => {
	it('localnet keeps the budgets the specs were written against', () => {
		expect(budgetsFor('localnet')).toEqual({
			ownMessageVisibleMs: 15_000,
			answerMs: 90_000,
			indexMs: 10_000,
			navigateAfterTxMs: 20_000,
		});
	});

	it('testnet gives every budget at least the localnet headroom, never less', () => {
		const local = budgetsFor('localnet');
		const testnet = budgetsFor('testnet');
		for (const key of Object.keys(local) as (keyof typeof local)[]) {
			expect(testnet[key], key).toBeGreaterThanOrEqual(local[key]);
		}
	});

	it('testnet budgets cover the run-day tail: own message ~30 s, one answer past 90 s', () => {
		const testnet = budgetsFor('testnet');
		expect(testnet.ownMessageVisibleMs).toBeGreaterThan(30_000);
		expect(testnet.answerMs).toBeGreaterThan(90_000);
	});

	it('BUDGET is the budget for the configured chain', () => {
		expect(BUDGET).toEqual(budgetsFor(CHAIN));
	});
});

// @vitest-environment node
//
// Static guard over src/ (pure Node; see the adr-0002 guard for why the environment is
// pinned per file).
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { E2E_DIR, stripComments } from './source-scan';

/**
 * A mined transaction is not a transaction that succeeded: thirdweb resolves the receipt of
 * one that reverted, and only its `status` tells them apart. Every place that waits for a
 * receipt reads it before anything is shown, saved or sent on:
 * - `useChatMutations.tsx` sends through one function, `sendConfirmed`, which throws
 *   `TransactionRevertedError` on any status but `success`, and `TransactionNotConfirmedError`
 *   when no receipt came within thirdweb's wait (each mutation's error path then says what is
 *   known and refreshes the plan and balance);
 * - `usePlanMutations.ts` keeps each receipt and checks its status before the next step;
 * - the faucet maps a receipt that is not `success` to `reverted` (`faucetOutcome.ts`).
 * The transaction-senders guard lists the files that may send at all.
 */
const SRC = path.resolve(E2E_DIR, '..', 'src');
const read = (...parts: string[]) => stripComments(readFileSync(path.join(SRC, ...parts), 'utf8'));

describe('the chat and history mutations', () => {
	const code = read('hooks', 'useChatMutations.tsx');

	it("call thirdweb's sender in one place only", () => {
		expect(code.match(/\bsendAndConfirmTransaction\(/g) ?? []).toHaveLength(1);
	});

	// A receipt that does not come within thirdweb's wait is told as not confirmed, not failed.
	it('read the status of that receipt before returning it', () => {
		expect(code).toMatch(
			/async function sendConfirmed\([^)]*\)[^{]*\{\s*const receipt = await sendAndConfirmTransaction\(\{[^}]*\}\)\.catch\(\s*rethrowUnconfirmed\(action\),?\s*\);\s*throwIfReverted\(receipt, action\);\s*return receipt;\s*\}/,
		);
	});

	it('send each of the six transactions through it', () => {
		expect(code.match(/await sendConfirmed\(/g) ?? []).toHaveLength(6);
	});
});

describe('the plan mutations', () => {
	const code = read('features', 'usage', 'usePlanMutations.ts');

	it('keep every receipt and check its status', () => {
		const sends = code.match(/await send\(/g) ?? [];
		const kept = [...code.matchAll(/const (\w+) = await send\(/g)].map(match => match[1]);

		expect(sends.length).toBeGreaterThan(0);
		expect(kept).toHaveLength(sends.length);
		kept.forEach(name => expect(code).toContain(`if (${name}.status !== 'success')`));
	});
});

describe('the faucet', () => {
	it('words a receipt that did not succeed as reverted', () => {
		expect(read('lib', 'faucetOutcome.ts')).toContain(
			"if (receipt.status !== 'success') return { kind: 'reverted' };",
		);
	});
});

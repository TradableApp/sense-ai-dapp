// @vitest-environment node
//
// Static guard over src/ (pure Node; see the adr-0002 guard for why the environment is
// pinned per file).
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { E2E_DIR, sourceFiles, stripComments } from './source-scan';

/**
 * Every place that offers the faucet goes through `useFaucetRequest`, which announces
 * tokens only for a transfer of the fee token that reached the user. A place that asked the
 * faucet, or announced the result, on its own would bring back the toast that called any
 * successful receipt a delivery. Nothing renders those places in a unit test, so this reads
 * the source.
 */
const SRC = path.resolve(E2E_DIR, '..', 'src');
const HOOK = path.join('hooks', 'useFaucetRequest.ts');
const OUTCOME = path.join('lib', 'faucetOutcome.ts');

const code = sourceFiles(
	SRC,
	file => /\.(ts|tsx)$/.test(file) && !/\.test\.(ts|tsx)$/.test(file),
).map(file => ({ file, source: stripComments(readFileSync(path.join(SRC, file), 'utf8')) }));

/** The files whose code matches `pattern`. */
const filesMatching = (pattern: RegExp) =>
	code.filter(({ source }) => pattern.test(source)).map(({ file }) => file);

describe('the faucet has one handler', () => {
	it('asks the faucet and waits for its receipt only in the hook', () => {
		expect(filesMatching(/\brequestTestTokens\(/)).toEqual([HOOK]);
		// A call, not the definition (`function awaitFaucetReceipt<Receipt …>(`).
		expect(filesMatching(/(?<!function )\bawaitFaucetReceipt\(/)).toEqual([HOOK]);
	});

	it('words the result only where the outcome is mapped', () => {
		expect(filesMatching(/Tokens Received|added to your wallet|Tokens Not Received/)).toEqual([
			OUTCOME,
		]);
		expect(filesMatching(/Tokens Sent|Still Confirming/).sort()).toEqual([HOOK, OUTCOME].sort());
	});

	it('every place that offers the faucet goes through the hook', () => {
		const offering = filesMatching(/\bfaucetAmount\b/).filter(file => file !== HOOK);

		expect(offering.length).toBeGreaterThanOrEqual(2);
		offering.forEach(file => {
			const { source } = code.find(entry => entry.file === file) ?? { source: '' };
			expect(source, file).toMatch(/\buseFaucetRequest\(\)/);
		});
	});
});

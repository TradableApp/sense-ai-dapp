// @vitest-environment node
//
// Static guard over e2e/specs: on testnet every fresh account is real money from the test
// treasury (ETH + ABLE), returned only when something releases it. The `freshUserAccount`
// fixture releases in teardown; a spec that calls allocateFreshAccount() itself must claim
// through a tracked pool that it releases in afterEach. The 2026-11-02 run day lost 400+ ABLE
// to four multi-device accounts nobody swept, and every later fresh-account spec then failed
// on "funding source ABLE depleted". Likewise, the shared user is Hardhat #1 only on localnet:
// specs reach it through sharedAccount(), never the TEST_ACCOUNT constant.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SPECS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'specs');
const DIRECT_ALLOCATE = /\ballocateFreshAccount\s*\(/;
const HARDHAT_SHARED_ACCOUNT = /\bTEST_ACCOUNT\b/;

// Recursive: readdirSync is shallow by default, so a spec moved into a subdirectory would
// silently escape the guard while the minimum-count check kept passing on the top level.
function specFiles(): string[] {
	return readdirSync(SPECS_DIR, { recursive: true }).filter(
		(f): f is string => typeof f === 'string' && f.endsWith('.spec.ts'),
	);
}

function offendersIn(file: string, source: string, pattern: RegExp): string[] {
	return source.split('\n').flatMap((line, i) => (pattern.test(line) ? [`${file}:${i + 1}`] : []));
}

function offenders(pattern: RegExp): string[] {
	return specFiles().flatMap(file =>
		offendersIn(file, readFileSync(path.join(SPECS_DIR, file), 'utf8'), pattern),
	);
}

describe('fresh accounts are released and the shared user is chain-aware', () => {
	it('has specs to inspect', () => {
		expect(specFiles().length).toBeGreaterThan(15);
	});

	it('matches code, not the comments that explain why a spec uses the pool', () => {
		const source = [
			'// use freshAccountPool(), not allocateFreshAccount() — see TEST_ACCOUNT notes',
			'/* allocateFreshAccount() is forbidden here',
			'   and so is TEST_ACCOUNT */',
			"const url = 'https://example.test'; // allocateFreshAccount() in a trailing comment",
			'const account = await allocateFreshAccount();',
		].join('\n');
		expect(offendersIn('x.spec.ts', source, DIRECT_ALLOCATE)).toEqual(['x.spec.ts:5']);
		expect(offendersIn('x.spec.ts', source, HARDHAT_SHARED_ACCOUNT)).toEqual([]);
	});

	it('no spec calls allocateFreshAccount() directly — use the freshUserAccount fixture or a released pool', () => {
		const found = offenders(DIRECT_ALLOCATE);
		expect(
			found,
			`Claim through freshAccountPool() (helpers/fresh-account) and release it in afterEach:\n  ${found.join(
				'\n  ',
			)}`,
		).toEqual([]);
	});

	it('no spec references the Hardhat TEST_ACCOUNT — use sharedAccount() from fixtures/mock-wallet', () => {
		const found = offenders(HARDHAT_SHARED_ACCOUNT);
		expect(found, `Hardhat #1 is not the shared user on testnet:\n  ${found.join('\n  ')}`).toEqual(
			[],
		);
	});
});

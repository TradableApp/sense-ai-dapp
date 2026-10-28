// @vitest-environment node
//
// Static guard over e2e/specs: the "does a real stack exist" decision is made once, in
// helpers/chain.ts (LIVE_STACK), and specs gate on that. A spec that reads the localnet flag
// directly would silently skip itself on testnet, where the stack is real but the flag is
// unset — and a skipped spec reports green.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SPECS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'specs');
const RAW_GATE = /process\.env\.E2E_LOCAL_SERVICES/;

describe('specs gate on LIVE_STACK, never on the raw localnet flag', () => {
	it('has specs to inspect', () => {
		expect(readdirSync(SPECS_DIR).filter(f => f.endsWith('.spec.ts')).length).toBeGreaterThan(15);
	});

	it('no spec reads process.env.E2E_LOCAL_SERVICES directly', () => {
		const offenders = readdirSync(SPECS_DIR)
			.filter(f => f.endsWith('.spec.ts'))
			.flatMap(file =>
				readFileSync(path.join(SPECS_DIR, file), 'utf8')
					.split('\n')
					.flatMap((line, i) => (RAW_GATE.test(line) ? [`${file}:${i + 1}`] : [])),
			);
		expect(
			offenders,
			`Gate on LIVE_STACK from helpers/chain instead:\n  ${offenders.join('\n  ')}`,
		).toEqual([]);
	});
});

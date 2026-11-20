// @vitest-environment node
//
// Static guard over src/ (pure Node; see the adr-0002 guard for why the environment is
// pinned per file).
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { E2E_DIR, sourceFiles } from './source-scan';

/**
 * The fee token is named in one place: `src/config/feeToken.ts`.
 *
 * Which token pays the fees is a build setting. Every label, logo, ABI and behaviour that
 * depends on it comes from the profile that setting selects, so a build for another token
 * needs no code change and cannot show one token's name beside another's balance. A token
 * name written into a component would survive that switch unnoticed. Comments count: a
 * comment that names one token goes stale the day the other is selected.
 *
 * The contract ABIs are exempt (they are named after their contracts), and so is the one
 * line in `vite-env.d.ts` that documents the setting's two values.
 */

const SRC = path.resolve(E2E_DIR, '..', 'src');
const ALLOWED = [
	path.join('config', 'feeToken.ts'),
	path.join('lib', 'abi') + path.sep,
	'vite-env.d.ts',
];
const isChecked = (file: string) =>
	/\.(ts|tsx|js|jsx)$/.test(file) &&
	!/\.test\.(ts|tsx|js|jsx)$/.test(file) &&
	!ALLOWED.some(allowed => file === allowed || file.startsWith(allowed));

// Upper-case names as whole words (not the "able" in "available"), the lower-case forms
// used as keys, and the file names of one token's logo and ABI.
const TOKEN_NAME =
	/\b(ABLE|SENSE)\b|\bAble(Token)?\b|\bSenseToken\b|['"`](able|sense)['"`]|able-token-logo/;

describe('the fee token is named only in its profile', () => {
	it('finds no token name anywhere else in src/', () => {
		const offenders = sourceFiles(SRC, isChecked).flatMap(file =>
			readFileSync(path.join(SRC, file), 'utf8')
				.split('\n')
				.flatMap((line, i) => (TOKEN_NAME.test(line) ? [`src/${file}:${i + 1}`] : [])),
		);

		expect(offenders).toEqual([]);
	});

	it('still recognises the names it forbids', () => {
		const samples = [
			'Insufficient ABLE Balance',
			'{amount} SENSE',
			"import AbleTokenABI from '@/lib/abi/AbleToken.json';",
			"queryKey: ['tokenPrice', 'able', chainId]",
			"import logo from '@/assets/able-token-logo.svg';",
		];
		const allowed = ['available', 'SenseAI', 'disabled', 'a sensible default', 'purchasable'];

		samples.forEach(sample => expect(TOKEN_NAME.test(sample), sample).toBe(true));
		allowed.forEach(sample => expect(TOKEN_NAME.test(sample), sample).toBe(false));
	});
});

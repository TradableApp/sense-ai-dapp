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

// A token's name in any letter case, wherever it is not part of a longer word: on its own,
// joined by `_` or `-`, at a camelCase boundary (`ableTokenAbi`, `isSenseBuild`), or in a
// file name. "available", "disabled" and the product name "SenseAI" are longer words and
// do not match; neither does lower-case "sense" or "able" on its own in a sentence, which
// would forbid ordinary English.
const BOUNDED = (name: string) =>
	`(?:^|[^A-Za-z])(?:${name.toUpperCase()}|${name[0].toUpperCase()}${name.slice(1)})(?![A-Za-z])`;
const TOKEN_NAME = new RegExp(
	[
		BOUNDED('able'),
		BOUNDED('sense'),
		'(?:Able|Sense)Token',
		// lower-case forms that can only be the token: a key, or part of an identifier or file
		'[\'"`](?:able|sense)[\'"`]',
		'(?:^|[^A-Za-z])(?:able|sense)(?:Token|[-_]token)',
		'[a-z](?:Able|Sense)(?:Token|Build|Profile|Abi)\\b',
	].join('|'),
);

describe('the fee token is named only in its profile', () => {
	it('finds no token name anywhere else in src/', () => {
		const offenders = sourceFiles(SRC, isChecked).flatMap(file =>
			readFileSync(path.join(SRC, file), 'utf8')
				.split('\n')
				.flatMap((line, i) => (TOKEN_NAME.test(line) ? [`src/${file}:${i + 1}`] : [])),
		);

		expect(offenders).toEqual([]);
	});

	it('scans the files where a token name would be shown', () => {
		const scanned = sourceFiles(SRC, isChecked);

		expect(scanned).toContain(path.join('config', 'contracts.ts'));
		expect(scanned).toContain(path.join('features', 'usage', 'ManagePlanModal.tsx'));
		expect(scanned).not.toContain(path.join('config', 'feeToken.ts'));
		expect(scanned.length).toBeGreaterThan(100);
	});

	it('still recognises the names it forbids', () => {
		const samples = [
			'Insufficient ABLE Balance',
			'{amount} SENSE',
			'${amount} ABLEs'.replace('ABLEs', 'ABLE.'),
			"import AbleTokenABI from '@/lib/abi/AbleToken.json';",
			"import SenseTokenABI from '@/lib/abi/SenseToken.json';",
			"queryKey: ['tokenPrice', 'able', chainId]",
			"profile === 'sense'",
			"import logo from '@/assets/able-token-logo.svg';",
			"import logo from '@/assets/sense-token-logo.svg';",
			'export const FAUCET_AMOUNT_ABLE = 100;',
			'const IS_SENSE_BUILD = true;',
			'const ableTokenAbi = load();',
			'const isSenseBuild = true;',
			'Sense credits cannot be sent',
		];
		const allowed = [
			'available',
			'SenseAI',
			'senseai-logo.svg',
			'disabled',
			'a sensible default',
			'purchasable',
			'transferable',
			'it makes sense to wait',
			'you will be able to cancel',
			'isTransferable',
		];

		samples.forEach(sample => expect(TOKEN_NAME.test(sample), sample).toBe(true));
		allowed.forEach(sample => expect(TOKEN_NAME.test(sample), sample).toBe(false));
	});
});

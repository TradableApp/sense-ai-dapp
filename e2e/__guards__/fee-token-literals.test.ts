// @vitest-environment node
//
// Static guard over src/, index.html, vite.config.ts and public/ (pure Node; see the adr-0002 guard for why the environment is
// pinned per file).
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { E2E_DIR, sourceFiles } from './source-scan';

/**
 * The fee token is named in one place: `src/config/feeToken.ts`, with the list of names
 * a build may choose in `feeTokenConfig.ts` beside it.
 *
 * Which token pays the fees is a build setting. Every label, logo, ABI and behaviour that
 * depends on it comes from the profile that setting selects, so a build for another token
 * needs no code change and cannot show one token's name beside another's balance. A token
 * name written into a component would survive that switch unnoticed. Comments count: a
 * comment that names one token goes stale the day the other is selected.
 *
 * The page (`index.html`), the build config and the text files under `public/` are read
 * too: what they hold is served as it is. The contract ABIs are exempt (they are named
 * after their contracts), and so is the one comment in `vite-env.d.ts` that documents the
 * setting's two values, on its declaration.
 */

const ROOT = path.resolve(E2E_DIR, '..');
const SRC = path.join(ROOT, 'src');
const PUBLIC = path.join(ROOT, 'public');
const ALLOWED = [
	path.join('config', 'feeToken.ts'),
	path.join('config', 'feeTokenConfig.ts'),
	path.join('lib', 'abi') + path.sep,
];
const isChecked = (file: string) =>
	/\.(ts|tsx|js|jsx)$/.test(file) &&
	!/\.test\.(ts|tsx|js|jsx)$/.test(file) &&
	!ALLOWED.some(allowed => file === allowed || file.startsWith(allowed));

// Served as they are, so a name in them reaches the user unchanged. Images and fonts are
// binary and cannot be read for a name.
const BINARY = /\.(png|jpe?g|gif|webp|avif|ico|bmp|woff2?|ttf|otf|eot)$/i;

/** Every file scanned, by its path from the repository root. */
function scannedFiles(): string[] {
	return [
		...sourceFiles(SRC, isChecked).map(file => path.join('src', file)),
		'index.html',
		'vite.config.ts',
		...sourceFiles(
			PUBLIC,
			file => !BINARY.test(file) && statSync(path.join(PUBLIC, file)).isFile(),
		).map(file => path.join('public', file)),
	];
}

const VITE_ENV = path.join('src', 'vite-env.d.ts');

/**
 * Whether line `index` of `file` may name a token: only the one-line doc comment that sits
 * on the `VITE_FEE_TOKEN` declaration in `vite-env.d.ts`, which documents the setting's two
 * values. Anything else there that names a token fails like any other file.
 */
function isExemptLine(file: string, lines: string[], index: number): boolean {
	return (
		file === VITE_ENV &&
		/^\s*\/\*\*.*\*\/\s*$/.test(lines[index]) &&
		/^\s*readonly VITE_FEE_TOKEN\b/.test(lines[index + 1] ?? '')
	);
}

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

/** The 1-based numbers of the lines in `source` that name a token and are not exempt. */
function offendingLines(file: string, source: string): number[] {
	const lines = source.split('\n');
	return lines.flatMap((line, i) =>
		TOKEN_NAME.test(line) && !isExemptLine(file, lines, i) ? [i + 1] : [],
	);
}

describe('the fee token is named only in its profile', () => {
	it('finds no token name anywhere else', () => {
		const offenders = scannedFiles().flatMap(file =>
			offendingLines(file, readFileSync(path.join(ROOT, file), 'utf8')).map(
				line => `${file}:${line}`,
			),
		);

		expect(offenders).toEqual([]);
	});

	it('scans the files where a token name would be shown', () => {
		const scanned = scannedFiles();

		expect(scanned).toContain(path.join('src', 'config', 'contracts.ts'));
		expect(scanned).toContain(path.join('src', 'features', 'usage', 'ManagePlanModal.tsx'));
		expect(scanned).not.toContain(path.join('src', 'config', 'feeToken.ts'));
		expect(scanned.length).toBeGreaterThan(100);
	});

	it('scans the page, the build config and the text files under public/', () => {
		const scanned = scannedFiles();

		expect(scanned).toContain('index.html');
		expect(scanned).toContain('vite.config.ts');
		expect(scanned).toContain(VITE_ENV);
		expect(scanned).toContain(path.join('public', 'favicon.svg'));
		expect(scanned.filter(file => /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf)$/.test(file))).toEqual(
			[],
		);
	});

	it('reports a token name in the page or the build config', () => {
		expect(offendingLines('index.html', '<head>\n\t<title>ABLE Agent</title>')).toEqual([2]);
		expect(offendingLines('vite.config.ts', "\tname: 'SENSE wallet',")).toEqual([1]);
		expect(
			offendingLines(path.join('public', 'manifest.json'), '{"name": "Sense credits"}'),
		).toEqual([1]);
	});

	it('exempts in vite-env.d.ts only the comment documenting the setting', () => {
		const documented = [
			'\t/** `SENSE` or `ABLE`: which token pays the fees. Unset or unknown means `SENSE`. */',
			'\treadonly VITE_FEE_TOKEN: string | undefined;',
		];

		expect(offendingLines(VITE_ENV, documented.join('\n'))).toEqual([]);
		expect(
			offendingLines(
				VITE_ENV,
				['\t/** The ABLE price feed. */', '\treadonly VITE_PRICE: string;'].join('\n'),
			),
		).toEqual([1]);
		expect(
			offendingLines(VITE_ENV, [documented[0], '\treadonly VITE_OTHER: string;'].join('\n')),
		).toEqual([1]);
		expect(
			offendingLines(VITE_ENV, [...documented, '\treadonly VITE_ABLE_URL: string;'].join('\n')),
		).toEqual([3]);
	});

	it('still recognises the names it forbids', () => {
		const samples = [
			'Insufficient ABLE Balance',
			'{amount} SENSE',
			'costs 5 ABLE.',
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

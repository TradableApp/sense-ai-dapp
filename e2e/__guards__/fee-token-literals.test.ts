// @vitest-environment node
//
// Static guard over src/ (stylesheets included), index.html, vite.config.ts, public/ and the
// e2e suite's own code (pure Node; see the adr-0002 guard for why the environment is pinned
// per file).
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { E2E_DIR, offendersIn, sourceFiles } from './source-scan';

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
	/\.(ts|tsx|js|jsx|css)$/.test(file) &&
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

/** The first and last line of the doc comment that ends on `end`, or null if none does. */
function docCommentEndingAt(lines: string[], end: number): [number, number] | null {
	if (end < 0 || !/\*\/\s*$/.test(lines[end])) return null;
	for (let i = end; i >= 0; i -= 1) {
		if (/^\s*\/\*\*/.test(lines[i])) return [i, end];
		// Another comment's end before reaching an opening means this is not one block.
		if (i < end && /\*\//.test(lines[i])) return null;
	}
	return null;
}

/**
 * Whether line `index` of `file` may name a token: only the doc comment (one line or
 * several) that ends on the line just above the `VITE_FEE_TOKEN` declaration in
 * `vite-env.d.ts`, which documents the setting's two values. Anything else there that
 * names a token fails like any other file.
 */
function isExemptLine(file: string, lines: string[], index: number): boolean {
	if (file !== VITE_ENV) return false;
	const declaration = lines.findIndex(line => /^\s*readonly VITE_FEE_TOKEN\b/.test(line));
	const block = docCommentEndingAt(lines, declaration - 1);
	return block !== null && index >= block[0] && index <= block[1];
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
		// glued to letters: after a lower-case letter (`buyABLE`, `getSense`, but not the
		// product name `useSenseAI`), or in capitals before a lower-case one (`SENSEpoints`,
		// but not `DISABLEd`)
		'[a-z](?:ABLE|SENSE)',
		'[a-z](?:Able|Sense)(?![a-z]|AI)',
		'(?<![A-Z])(?:ABLE|SENSE)[a-z]',
		// lower-case and joined by a dash or underscore, as in a stylesheet (`.able-badge`,
		// `--sense-accent`), but not the product's own `sense-ai` or `sense_ai`
		'(?:^|[^A-Za-z])(?:able|sense)[-_](?!ai\\b)',
		// lower-case as an object key (`{ able: 0.015 }`, a key on its own line) or a member
		// access (`profiles.sense`); a key needs a brace, a comma or the start of the line
		// before it, so "makes sense: wait" in a sentence is not one
		`(?:[{,]\\s*|^\\s*)['"]?(?:able|sense)['"]?\\s*:`,
		'\\.(?:able|sense)(?![\\w-])',
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
		// Stylesheets are served too: a class or a `content:` can carry a name to the screen.
		expect(scanned).toContain(path.join('src', 'index.css'));
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

	it('exempts a doc comment over several lines that ends just above the declaration', () => {
		const wrapped = [
			'\t/**',
			'\t * `SENSE` or `ABLE`: which token pays the fees.',
			"\t * Unset stops every build but localnet's.",
			'\t */',
			'\treadonly VITE_FEE_TOKEN: string | undefined;',
		];

		expect(offendingLines(VITE_ENV, wrapped.join('\n'))).toEqual([]);
	});

	it('does not exempt a doc comment separated from the declaration by another', () => {
		const separated = [
			'\t/**',
			'\t * `SENSE` or `ABLE`: which token pays the fees.',
			'\t */',
			'\treadonly VITE_OTHER: string;',
			'\treadonly VITE_FEE_TOKEN: string | undefined;',
		];

		expect(offendingLines(VITE_ENV, separated.join('\n'))).toEqual([2]);
	});

	it('does not exempt a doc comment over several lines above another declaration', () => {
		const elsewhere = [
			'\t/**',
			'\t * The ABLE price feed,',
			'\t * or the SENSE one.',
			'\t */',
			'\treadonly VITE_PRICE: string;',
			'\treadonly VITE_FEE_TOKEN: string | undefined;',
		];

		expect(offendingLines(VITE_ENV, elsewhere.join('\n'))).toEqual([2, 3]);
	});

	it('the exempt comment in vite-env.d.ts says what the build does with the setting', () => {
		const lines = readFileSync(path.join(ROOT, VITE_ENV), 'utf8').split('\n');
		const documented = lines.filter((_, i) => isExemptLine(VITE_ENV, lines, i)).join(' ');

		expect(documented).not.toBe('');
		// Unset stops every build, localnet's included, and a misspelt value stops every build.
		expect(documented).not.toMatch(/unknown means/i);
		expect(documented).toMatch(/localnet/i);
		expect(documented).toMatch(/stops/i);
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
			// glued to letters on either side
			'const buyABLE = true;',
			'getSENSE()',
			'const SENSEpoints = 1;',
			'ABLEbalance',
			'const buyAble = true;',
			'getSense()',
			// in a stylesheet
			'.able-badge { color: red; }',
			'--sense-accent: #fff;',
			'content: "SENSE";',
			// a lower-case property key or member access
			'const prices = { able: 0.015 };',
			"const prices = { 'sense': 0 };",
			'\tsense: SENSE_PROFILE,',
			'const profile = profiles.sense;',
			'return FEE_TOKEN_PROFILES.able',
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
			'useSenseAI()',
			'const DISABLED = true;',
			'TABLE_NAME',
			'ENABLE_SYNC',
			'isCapable',
			'Senses and sensed',
			'sense-ai-dapp',
			'general/sense_ai',
			'enable',
			'tablet',
			'sensitive',
			'it makes sense: wait',
			'const disabled = { enabled: true };',
			'isSensible.value',
			'senseai.tradable.app',
		];

		samples.forEach(sample => expect(TOKEN_NAME.test(sample), sample).toBe(true));
		allowed.forEach(sample => expect(TOKEN_NAME.test(sample), sample).toBe(false));
	});
});

/**
 * The e2e suite runs against whichever token the build was made for, so it reads the same
 * profile the app reads (`e2e/helpers/feeToken.ts`) rather than naming a token. A helper
 * called after one token, a symbol written into a locator or a test title that names one
 * would pass for that token and fail, or prove nothing, for the other.
 *
 * Code only: comments are stripped first. The guards and the unit tests under `e2e/` are not
 * scanned; their samples have to name the tokens they check for.
 */
const E2E_TOKEN_NAME = new RegExp(
	[
		TOKEN_NAME.source,
		// a lower-case regular expression literal (`/able/i`), which a locator can carry
		'\\/(?:able|sense)\\/[a-z]*',
		// the same word inside a longer case-insensitive pattern (`/you have \d+ able/i`)
		'\\/(?:[^\\/\\\\\\n]|\\\\.)*(?<![A-Za-z])(?:able|sense)(?![A-Za-z])(?:[^\\/\\\\\\n]|\\\\.)*\\/[a-hj-z]*i',
		// the same word inside a string handed to RegExp, in any quote style, on the line that
		// calls it; a word boundary written as `\\b` (or any `\\` escape) before it counts as
		// a boundary. A wrapped call is first joined to its first argument (`e2eOffenders`).
		'RegExp\\(.*[\'"`][^\'"`]*(?:(?<![A-Za-z])|(?<=\\\\[A-Za-z]))(?:able|sense)(?![A-Za-z])',
	].join('|'),
);

const isE2eSource = (file: string) =>
	/\.(ts|tsx|js|mjs)$/.test(file) &&
	!/\.test\.(ts|tsx|js|mjs)$/.test(file) &&
	!file.startsWith(`__guards__${path.sep}`);

/**
 * The `file:line` of every line of e2e code in `source` that names a token. The check reads one
 * line at a time, so a `RegExp(` call that a formatter wrapped is first moved down onto the line
 * that holds its first argument (the line count, and so every reported line, stays the same).
 */
function e2eOffenders(file: string, source: string): string[] {
	const joined = source.replace(/RegExp\([ \t]*\n([ \t]*)/g, '\n$1RegExp(');
	return offendersIn(file, joined, E2E_TOKEN_NAME);
}

/** Every e2e source file scanned, by its path from the repository root. The Playwright config
 *  is e2e code too: it holds the projects, their gates and the testnet spec list. */
function scannedE2eFiles(): string[] {
	return [
		...sourceFiles(E2E_DIR, isE2eSource).map(file => path.join('e2e', file)),
		'playwright.config.ts',
	];
}

describe('the e2e suite reads the fee token from its profile', () => {
	it('names no token in a helper, a page object, a fixture or a spec', () => {
		const offenders = scannedE2eFiles().flatMap(file =>
			e2eOffenders(file, readFileSync(path.join(ROOT, file), 'utf8')),
		);

		expect(offenders).toEqual([]);
	});

	it('scans the helpers, page objects, fixtures, specs and testnet scripts', () => {
		const scanned = scannedE2eFiles();

		expect(scanned).toContain(path.join('e2e', 'helpers', 'hardhat.ts'));
		expect(scanned).toContain(path.join('e2e', 'helpers', 'contracts.ts'));
		expect(scanned).toContain(path.join('e2e', 'pages', 'DashboardPage.ts'));
		expect(scanned).toContain(path.join('e2e', 'fixtures', 'index.ts'));
		expect(scanned).toContain(path.join('e2e', 'specs', 'plan.spec.ts'));
		expect(scanned).toContain(path.join('e2e', 'testnet', 'fund.ts'));
		expect(scanned.some(file => file.includes('__guards__'))).toBe(false);
		expect(scanned.some(file => /\.test\.ts$/.test(file))).toBe(false);
	});

	it('scans the Playwright config, which holds the projects and their gates', () => {
		expect(scannedE2eFiles()).toContain('playwright.config.ts');
	});

	it('recognises a token name in e2e code and leaves comments and ordinary words alone', () => {
		const flagged = [
			'export async function fundABLE(',
			'const balance = await getABLEBalance(TOKEN_ADDRESS, owner);',
			'export const ABLE = (whole: number | bigint): bigint => {',
			'export function parseAble(text: string): number {',
			"test('T-PLAN-11: Cannot set plan with 0 ABLE', async () => {});",
			'return this.page.getByText(/insufficient ABLE balance/i).first();',
			'.or(this.page.getByText(/able/i).filter({ hasText: /\\d/ }).first());',
			'const fee = 3n * SENSE;',
			'name: /get \\d+ (localnet|testnet) able|sending tokens/i,',
			'const hint = modal.getByText(/you have [\\d.]+ sense/i);',
			// a lower-case name inside a string handed to RegExp, in any quote style
			".getByText(new RegExp('insufficient able balance', 'i'))",
			'return new RegExp("\\\\bable\\\\b", "i");',
			'name: new RegExp("get \\\\d+ (localnet|testnet) sense|sending tokens", "i"),',
			"new RegExp(`you have [\\\\d.]+ sense`, 'i'),",
			"export const TOKEN = 'ABLE';",
		];
		const left = [
			'// funds the wallet with ABLE from the treasury',
			'/** Reads the SENSE balance. */',
			'export async function fundFeeToken(',
			'await expect(button).toBeEnabled();',
			"test('T-XFER-01: a holder cannot send to another holder', async () => {});",
			"await page.goto('https://senseai.tradable.app');",
			'await expect(page.getByText(/unable to connect|disabled/i)).toBeVisible();',
			// the symbol read from the profile, and ordinary words, inside a RegExp string
			`.getByText(new RegExp(\`insufficient \${feeToken().symbol} balance\`, 'i'))`,
			`return new RegExp(\`\\\\b\${feeToken().symbol}\\\\b\`);`,
			"new RegExp('unable to connect|disabled|sensible', 'i')",
		];

		flagged.forEach(line =>
			expect(offendersIn('sample.ts', line, E2E_TOKEN_NAME), line).toEqual(['sample.ts:1']),
		);
		left.forEach(line => expect(offendersIn('sample.ts', line, E2E_TOKEN_NAME), line).toEqual([]));
	});

	it('reads a RegExp string that a formatter put on the line after the call', () => {
		const wrapped = [
			'\tget insufficientBalanceToast() {',
			'\t\treturn this.page.getByText(',
			'\t\t\tnew RegExp(',
			"\t\t\t\t'insufficient able balance',",
			"\t\t\t\t'i',",
			'\t\t\t),',
			'\t\t);',
		].join('\n');
		const fromProfile = wrapped.replace(
			"'insufficient able balance'",
			`\`insufficient \${symbol} balance\``,
		);

		expect(e2eOffenders('sample.ts', wrapped)).toEqual(['sample.ts:4']);
		expect(e2eOffenders('sample.ts', fromProfile)).toEqual([]);
	});
});

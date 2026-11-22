// @vitest-environment node
//
// The testnet project launches headless Chromium with the GPU process disabled. On the
// 2026-11-09/10 Base Sepolia run days a fresh context stopped scheduling animation frames once per
// run while its JS kept running (T-HIST-10, T-PLAN-01); the software compositor is the standard
// remedy for that class of headless stall on macOS, and the flag must not quietly disappear.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { E2E_DIR, stripComments } from './source-scan';

const CONFIG = stripComments(readFileSync(join(E2E_DIR, '..', 'playwright.config.ts'), 'utf8'));

/** What to do when a project takes the desktop device itself, so the message says it. */
const DIRECT_DEVICE_FIX =
	"A project takes devices['Desktop Chrome'] directly, so it launches without --disable-gpu. " +
	'Give it `use: DESKTOP_CHROME`, or `use: { ...DESKTOP_CHROME, <its own options> }` with no ' +
	'launchOptions of its own.';

const FLAG = /['"]--disable-gpu['"]/;

/** Every project entry in `config`: from its `name:` (two tabs deep) to the brace closing it. */
function projectBlocks(config: string): { name: string; block: string }[] {
	return [...config.matchAll(/\n\t\tname: ['"]([^'"]+)['"]/g)].map(match => {
		const start = match.index ?? 0;
		const end = config.indexOf('\n\t},', start);
		return { name: match[1], block: config.slice(start, end > start ? end : undefined) };
	});
}

/** Why one project would launch without the flag, or null when it has it. */
function projectProblem(block: string): string | null {
	if (!/\buse:/.test(block)) {
		return 'has no `use`, so it launches with no flag: give it `use: DESKTOP_CHROME`';
	}
	// Any launchOptions of its own replace the shared ones whole (a spread is shallow), so they
	// must carry the flag themselves.
	const ownLaunch = block.match(/launchOptions:\s*\{[^}]*\}/g) ?? [];
	if (ownLaunch.some(options => !FLAG.test(options))) {
		return 'sets launchOptions without --disable-gpu, which replace the shared ones: drop them';
	}
	const shared = /use:\s*DESKTOP_CHROME\b|\.\.\.DESKTOP_CHROME\b/.test(block);
	if (!shared && ownLaunch.length === 0) {
		return 'takes neither DESKTOP_CHROME nor a device with the flag: give it `use: DESKTOP_CHROME`';
	}
	return null;
}

/**
 * Why the projects in `config` would launch Chromium without the flag: one line per problem,
 * none when every project has it.
 */
function launchFlagProblems(config: string): string[] {
	const problems: string[] = [];
	// Either quote style: the shared setting is the one place the raw device may appear.
	const uses = config.match(/devices\[['"]Desktop Chrome['"]\]/g) ?? [];
	if (uses.length !== 1) problems.push(DIRECT_DEVICE_FIX);
	for (const { name, block } of projectBlocks(config)) {
		const problem = projectProblem(block);
		if (problem) problems.push(`project '${name}' ${problem}`);
	}
	return problems;
}

/** A config with the shared setting and the given project entries. */
const sampleConfig = (...projects: string[]) =>
	[
		'const DESKTOP_CHROME = {',
		"\t...devices['Desktop Chrome'],",
		"\tlaunchOptions: { args: ['--disable-gpu'] },",
		'};',
		'const LOCALNET_PROJECTS: Project[] = [',
		...projects,
		'];',
	].join('\n');
const project = (name: string, ...body: string[]) =>
	['\t{', `\t\tname: '${name}',`, `\t\ttestMatch: '**/${name}.spec.ts',`, ...body, '\t},'].join(
		'\n',
	);

describe('testnet project launch args', () => {
	it('the testnet project takes the shared setting that passes --disable-gpu to Chromium', () => {
		const start = CONFIG.indexOf("name: 'testnet'");
		expect(start).toBeGreaterThan(-1);
		// The project entry ends at the first `},` that closes a top-level project object (one tab
		// deep inside `projects: [`). Slicing on `];` would stop early at an array-literal testMatch.
		const end = CONFIG.indexOf('\n\t},', start);
		const block = CONFIG.slice(start, end > start ? end : undefined);
		// Through the shared setting, whose flag is pinned below.
		expect(block).toMatch(/\.\.\.DESKTOP_CHROME\b/);
	});
});

// The same stall reached the localnet suite on 2026-11-21 (T-HIST-11: no frame painted for 23 s
// under host load while the page's JavaScript kept running, so a click waited its full 15 s for
// "stable"). So every project launches Chromium with the flag, through one shared setting.
describe('every project launch args', () => {
	it('the shared desktop setting passes --disable-gpu to Chromium', () => {
		expect(CONFIG).toMatch(
			/const DESKTOP_CHROME = \{\s*\.\.\.devices\['Desktop Chrome'\],\s*launchOptions:\s*\{[^}]*args:\s*\[[^\]]*'--disable-gpu'/,
		);
	});

	it('every project in the config launches with the flag', () => {
		const names = projectBlocks(CONFIG).map(({ name }) => name);

		// Every project is read, on every chain's list.
		expect(names).toEqual(
			expect.arrayContaining(['testnet', 'testnet-resilience', 'smoke', 'mobile']),
		);
		expect(names).toHaveLength((CONFIG.match(/\n\t\tname: /g) ?? []).length);
		expect(launchFlagProblems(CONFIG)).toEqual([]);
	});

	it('passes projects that take the shared setting, or a device of their own with the flag', () => {
		const sound = sampleConfig(
			project('smoke', '\t\tuse: DESKTOP_CHROME,'),
			project('testnet', '\t\tuse: {', '\t\t\t...DESKTOP_CHROME,', '\t\t},'),
			project(
				'mobile',
				"\t\tuse: { ...devices['Pixel 5'], launchOptions: { args: ['--disable-gpu'] } },",
			),
		);

		expect(launchFlagProblems(sound)).toEqual([]);
	});

	it.each([
		['takes the desktop device directly', "\t\tuse: { ...devices['Desktop Chrome'] },"],
		['takes the desktop device in double quotes', '\t\tuse: { ...devices["Desktop Chrome"] },'],
		['has no use at all'],
		['sets only a viewport', '\t\tuse: { viewport: { width: 1280, height: 720 } },'],
		[
			'replaces the shared args with its own launchOptions',
			'\t\tuse: { ...DESKTOP_CHROME, launchOptions: { slowMo: 50 } },',
		],
		[
			'sets empty launchOptions after the shared setting',
			'\t\tuse: {',
			'\t\t\t...DESKTOP_CHROME,',
			'\t\t\tlaunchOptions: {},',
			'\t\t},',
		],
		['takes another device without the flag', "\t\tuse: { ...devices['iPad Mini'] },"],
	])('refuses a project that %s', (_label, ...body) => {
		const config = sampleConfig(
			project('smoke', '\t\tuse: DESKTOP_CHROME,'),
			project('x', ...body),
		);

		expect(launchFlagProblems(config).length).toBeGreaterThan(0);
	});

	it('tells the reader of a project with the raw desktop device what to write instead', () => {
		const config = sampleConfig(project('x', "\t\tuse: { ...devices['Desktop Chrome'] },"));

		expect(launchFlagProblems(config).join('\n')).toMatch(/use: DESKTOP_CHROME/);
	});
});

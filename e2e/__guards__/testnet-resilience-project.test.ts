// @vitest-environment node
//
// The run-day resilience specs (1 h refund, real limit expiry) must run in their own Playwright
// project, never inside the regular `testnet` project, and the regular testnet specs must never
// leak into the resilience project. Both lists are read from playwright.config.ts so this guard
// fails on the config itself, not on a copy of it.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { E2E_DIR, stripComments } from './source-scan';

const ROOT = path.join(E2E_DIR, '..');
const CONFIG = stripComments(readFileSync(path.join(ROOT, 'playwright.config.ts'), 'utf8'));
const PACKAGE_JSON = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
	scripts: Record<string, string>;
};
const SPECS_DIR = path.join(E2E_DIR, 'specs');

/** The quoted names inside `const <NAME> = [ ... ];`. */
function namedList(name: string): string[] {
	const match = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`).exec(CONFIG);
	if (!match) throw new Error(`playwright.config.ts has no const ${name} list`);
	return [...match[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
}

/** The project object block whose `name:` is `projectName`, from its name to the closing brace. */
function projectBlock(projectName: string): string {
	const start = CONFIG.indexOf(`name: '${projectName}'`);
	if (start < 0) throw new Error(`playwright.config.ts has no project named ${projectName}`);
	const end = CONFIG.indexOf('\n\t},', start);
	return CONFIG.slice(start, end > start ? end : undefined);
}

const TESTNET_SPECS = namedList('TESTNET_SPECS');
const RESILIENCE_SPECS = namedList('RESILIENCE_SPECS');
const RESILIENCE_FILES = readdirSync(SPECS_DIR)
	.filter(f => /^resilience-.*\.spec\.ts$/.test(f))
	.map(f => f.replace(/\.spec\.ts$/, ''))
	.sort();

describe('testnet-resilience project is separate from the testnet project', () => {
	it('every resilience spec file is listed in RESILIENCE_SPECS, and nothing else is', () => {
		expect(RESILIENCE_FILES.length).toBeGreaterThan(0);
		expect([...RESILIENCE_SPECS].sort()).toEqual(RESILIENCE_FILES);
	});

	it('no resilience spec is in the regular TESTNET_SPECS list', () => {
		const leaked = RESILIENCE_SPECS.filter(spec => TESTNET_SPECS.includes(spec));
		expect(leaked, 'resilience specs must not run in the testnet project').toEqual([]);
	});

	it('the testnet project still builds its testMatch from TESTNET_SPECS only', () => {
		const block = projectBlock('testnet');
		expect(block).toMatch(/testMatch:\s*TESTNET_SPECS\.map\(/);
		expect(block).not.toMatch(/resilience/);
	});

	it('the testnet-resilience project runs exactly the resilience specs', () => {
		const block = projectBlock('testnet-resilience');
		expect(block).toMatch(/testMatch:\s*RESILIENCE_SPECS\.map\(/);
		expect(block).not.toMatch(/TESTNET_SPECS/);
	});

	it('the resilience project is wired into the testnet branch of the config, not localnet', () => {
		expect(CONFIG).toMatch(
			/projects:\s*CHAIN === 'testnet'\s*\?\s*\[\s*\.\.\.TESTNET_PROJECTS\s*,\s*\.\.\.RESILIENCE_PROJECTS\s*\]\s*:\s*LOCALNET_PROJECTS/,
		);
	});

	it('the resilience project passes the same software-compositor flag as testnet', () => {
		expect(projectBlock('testnet-resilience')).toMatch(
			/launchOptions:\s*\{[^}]*args:\s*\[[^\]]*'--disable-gpu'/,
		);
	});

	it('a package.json script runs only the resilience project', () => {
		expect(PACKAGE_JSON.scripts['test:e2e:testnet:resilience']).toBe(
			'playwright test --project=testnet-resilience',
		);
	});
});

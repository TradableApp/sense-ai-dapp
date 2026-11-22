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

	it('no project takes the desktop device without the shared setting', () => {
		const uses = CONFIG.match(/devices\['Desktop Chrome'\]/g) ?? [];
		expect(uses).toHaveLength(1);
	});

	it('every project that names a device of its own passes the flag too', () => {
		const own = [
			...CONFIG.matchAll(/use:\s*\{[^}]*devices\['(?!Desktop Chrome)[^']+'\][^}]*\}?[^}]*\}/g),
		];
		expect(own.length).toBeGreaterThan(0);
		for (const [block] of own) expect(block).toContain("'--disable-gpu'");
	});
});

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
	it('the testnet project passes --disable-gpu to Chromium', () => {
		const start = CONFIG.indexOf("name: 'testnet'");
		expect(start).toBeGreaterThan(-1);
		// The project entry ends at the first `},` that closes a top-level project object (one tab
		// deep inside `projects: [`). Slicing on `];` would stop early at an array-literal testMatch.
		const end = CONFIG.indexOf('\n\t},', start);
		const block = CONFIG.slice(start, end > start ? end : undefined);
		expect(block).toMatch(/launchOptions:\s*\{[^}]*args:\s*\[[^\]]*'--disable-gpu'/);
	});
});

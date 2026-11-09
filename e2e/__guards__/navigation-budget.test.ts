// @vitest-environment node
//
// `page.goto` resolves on the browser's `load` event, which waits on every sub-resource — the
// 3 MB main bundle, fonts, the recaptcha and PostHog scripts. On a hosted build that time is set
// by the CDN, not the dApp, so its timeout is a chain-aware budget (`pageLoadMs`), never a number
// typed into playwright.config.ts. A literal there silently re-imposes the 30 s default that
// failed T-AUTH-05 on the 2026-11-09 Base Sepolia run day.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { E2E_DIR, stripComments } from './source-scan';

const CONFIG = stripComments(readFileSync(join(E2E_DIR, '..', 'playwright.config.ts'), 'utf8'));

describe('navigation timeout is a budget, not a literal', () => {
	it('playwright.config.ts sets navigationTimeout from BUDGET.pageLoadMs', () => {
		expect(CONFIG).toMatch(/navigationTimeout:\s*BUDGET\.pageLoadMs\b/);
	});

	it('no project or shared use block hard-codes a numeric navigationTimeout', () => {
		expect(CONFIG.match(/navigationTimeout:\s*[\d_]+/g) ?? []).toEqual([]);
	});
});

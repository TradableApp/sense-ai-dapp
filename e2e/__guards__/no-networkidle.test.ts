// @vitest-environment node
//
// Static guard over the Playwright suite: no wait on Playwright's `networkidle` state. The dApp
// never idles on a live chain — the live-state probe (src/hooks/liveStateProbe.ts) polls every
// block, Thirdweb and Sentry keep their own traffic up — so `waitForLoadState('networkidle')`
// times out after 30 s with the page fully rendered. On the 2026-11-02 Base Sepolia run day it
// failed T-INIT-10 (run 1) and then T-INIT-06..09 and T-UI-08 (run 2) while every assertion they
// were about to make would have passed. Wait for the app shell instead: `waitForAppShell(page)`
// in e2e/helpers/app-ready.ts.
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { E2E_DIR, offenders, offendersIn, sourceFiles } from './source-scan';

const NETWORKIDLE = /['"`]networkidle['"`]/;
const isSpec = (f: string) => f.endsWith('.spec.ts');
const isSource = (f: string) => f.endsWith('.ts') && !f.endsWith('.test.ts');
const SCANNED = [
	{ dir: path.join(E2E_DIR, 'specs'), matches: isSpec },
	{ dir: path.join(E2E_DIR, 'pages'), matches: isSource },
	{ dir: path.join(E2E_DIR, 'fixtures'), matches: isSource },
	{ dir: path.join(E2E_DIR, 'helpers'), matches: isSource },
];

describe('no wait on networkidle anywhere in the Playwright suite', () => {
	it('has files to inspect in every scanned directory', () => {
		// Fails loudly if a directory is emptied or renamed, instead of passing with nothing scanned.
		const [specs, pages, fixtures, helpers] = SCANNED.map(
			({ dir, matches }) => sourceFiles(dir, matches).length,
		);
		expect(specs).toBeGreaterThan(15);
		expect(pages).toBeGreaterThan(3);
		expect(fixtures).toBeGreaterThan(1); // mock-wallet, index
		expect(helpers).toBeGreaterThan(3); // app-ready, budgets, chain, contracts, graph, …
	});

	it('matches code, not the comments that explain why a file avoids networkidle', () => {
		const source = [
			"// NOT waitForLoadState('networkidle'): the poller never idles",
			"/* 'networkidle' is forbidden here */",
			"await page.waitForLoadState('networkidle');",
			"await page.goto('/', { waitUntil: 'networkidle' });",
		].join('\n');
		expect(offendersIn('x.spec.ts', source, NETWORKIDLE)).toEqual(['x.spec.ts:3', 'x.spec.ts:4']);
	});

	it("no spec, page object, fixture or helper waits for 'networkidle' — use waitForAppShell(page)", () => {
		const found = SCANNED.flatMap(({ dir, matches }) => offenders(dir, matches, NETWORKIDLE));
		expect(
			found,
			`The live-state probe keeps the network busy; wait for the app shell instead:\n  ${found.join(
				'\n  ',
			)}`,
		).toEqual([]);
	});
});

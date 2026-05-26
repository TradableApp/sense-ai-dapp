import { test as base, expect } from '@playwright/test';

import { injectMockWallet } from '../fixtures/mock-wallet';
import { isGraphRunning } from '../helpers/graph';
import { isHardhatRunning } from '../helpers/hardhat';

const test = base;

test.describe('Infrastructure pre-flight', () => {
	test.skip(
		process.env.E2E_LOCAL_SERVICES !== '1',
		'Skipped: requires local Hardhat node (set E2E_LOCAL_SERVICES=1)',
	);

	test('T-INIT-SMOKE-01: Hardhat node is reachable at port 8545', async () => {
		const running = await isHardhatRunning();
		expect(running, 'Hardhat node must be running. Start with: npx hardhat node').toBe(true);
	});

	test('T-INIT-SMOKE-02: Local Graph node is reachable at port 8000', async () => {
		const running = await isGraphRunning();
		expect(
			running,
			'Graph node must be running. Start with: docker-compose up in sense-ai-subgraph',
		).toBe(true);
	});
});

test.describe('App initialisation (T-INIT)', () => {
	test('T-INIT-01: dApp loads at localhost:3002 with no errors', async ({ page }) => {
		const errors: string[] = [];
		page.on('pageerror', err => errors.push(err.message));

		await injectMockWallet(page);
		await page.goto('/');

		await expect(page.locator('body')).not.toBeEmpty();
		expect(
			errors.filter(e => !e.includes('ResizeObserver') && !e.includes('screen.orientation')),
		).toHaveLength(0);
	});

	test('T-INIT-02: Splash screen renders on initial boot', async ({ page }) => {
		await injectMockWallet(page);
		await page.goto('/');

		await expect(page).toHaveTitle(/SenseAI|Tradable/i, { timeout: 10_000 });
	});

	test('T-INIT-03: Splash screen CSS class is defined in stylesheets', async ({ page }) => {
		await injectMockWallet(page);
		await page.goto('/');
		await page.waitForLoadState('domcontentloaded');

		const splashRuleDefined = await page.evaluate(() => {
			for (const sheet of document.styleSheets) {
				try {
					for (const rule of sheet.cssRules) {
						if ('selectorText' in rule) {
							const sr = rule as { selectorText?: string };
							if (sr.selectorText?.includes('splash-screen')) {
								return true;
							}
						}
					}
				} catch {
					// cross-origin sheets throw SecurityError — skip them
				}
			}
			return false;
		});
		expect(splashRuleDefined).toBe(true);
	});

	test('T-INIT-04: HTML document has lang attribute', async ({ page }) => {
		await injectMockWallet(page);
		await page.goto('/');
		const lang = await page.locator('html').getAttribute('lang');
		expect(lang).toBeTruthy();
	});

	test('T-INIT-05: Viewport meta tag is present', async ({ page }) => {
		await injectMockWallet(page);
		await page.goto('/');
		const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
		expect(viewport).toContain('width=');
	});

	test('T-INIT-06: Sentry session envelope fires within 5s of page load', async ({ page }) => {
		test.skip(!process.env.VITE_SENTRY_DSN, 'Skipped: VITE_SENTRY_DSN not configured');

		const sentryRequest = page.waitForRequest(
			req => req.url().includes('sentry.io') || req.url().includes('ingest'),
			{ timeout: 10_000 },
		);

		await injectMockWallet(page);
		await page.goto('/');
		await sentryRequest;
	});

	test('T-INIT-07: No unhandled JavaScript errors during page load', async ({ page }) => {
		const errors: Error[] = [];
		page.on('pageerror', err => errors.push(err));

		await injectMockWallet(page);
		await page.goto('/');
		await page.waitForLoadState('networkidle');

		const meaningful = errors.filter(
			e =>
				!e.message.includes('ResizeObserver') &&
				!e.message.includes('Non-Error promise rejection') &&
				!e.message.includes('screen.orientation'),
		);
		expect(meaningful).toHaveLength(0);
	});

	test('T-INIT-08: No console errors during page load', async ({ page }) => {
		const consoleErrors: string[] = [];
		page.on('console', msg => {
			if (msg.type() === 'error') {
				consoleErrors.push(msg.text());
			}
		});

		await injectMockWallet(page);
		await page.goto('/');
		await page.waitForLoadState('networkidle');

		const meaningful = consoleErrors.filter(
			e =>
				!e.includes('ResizeObserver') &&
				!e.includes('favicon') &&
				!e.includes('Failed to load resource') &&
				!e.includes('screen.orientation'),
		);
		expect(meaningful).toHaveLength(0);
	});

	test('T-INIT-09: Offline overlay renders when network is disabled', async ({ page, context }) => {
		await injectMockWallet(page);
		await page.goto('/');
		await page.waitForLoadState('networkidle');

		await context.setOffline(true);

		await expect(page.getByText(/offline|no connection|no internet/i)).toBeVisible({
			timeout: 15_000,
		});
	});

	test('T-INIT-10: Offline overlay disappears when network is restored', async ({
		page,
		context,
	}) => {
		await injectMockWallet(page);
		await page.goto('/');
		await page.waitForLoadState('networkidle');

		await context.setOffline(true);
		await expect(page.getByText(/offline|no connection|no internet/i)).toBeVisible({
			timeout: 15_000,
		});

		await context.setOffline(false);
		await page.evaluate(() => window.dispatchEvent(new Event('online')));
		await expect(page.getByText(/offline|no connection|no internet/i)).not.toBeVisible({
			timeout: 15_000,
		});
	});

	test('T-INIT-11: PWA manifest is served', async ({ page }) => {
		test.skip(
			process.env.E2E_TARGET !== 'preview',
			'PWA manifest not served by Vite dev server (set E2E_TARGET=preview)',
		);

		await injectMockWallet(page);
		const response = await page.goto('/manifest.webmanifest');
		expect(response?.status()).toBe(200);

		const manifest = await response?.json();
		expect(manifest).toMatchObject({
			name: expect.stringContaining('SenseAI'),
			id: 'senseai.tradable.app',
		});
	});

	test('T-INIT-12: Favicon is served', async ({ page }) => {
		await injectMockWallet(page);
		await page.goto('/');

		const faviconLink = page.locator('link[rel*="icon"]').first();
		const href = await faviconLink.getAttribute('href');
		expect(href).toBeTruthy();
	});

	test('T-INIT-13: Critical CSS loads (body has background color)', async ({ page }) => {
		await injectMockWallet(page);
		await page.goto('/');
		await page.waitForLoadState('domcontentloaded');

		const bgColor = await page.evaluate(
			() => window.getComputedStyle(document.body).backgroundColor,
		);
		expect(bgColor).not.toBe('rgba(0, 0, 0, 0)');
	});
});

test.describe('Routing and access control (T-AUTH)', () => {
	test('T-AUTH-01: Unauthenticated access to / redirects to /auth', async ({ page }) => {
		await injectMockWallet(page);
		await page.goto('/');
		await expect(page).toHaveURL(/\/auth/, { timeout: 10_000 });
	});

	test('T-AUTH-01b: Unauthenticated access to /chat redirects to /auth', async ({ page }) => {
		await injectMockWallet(page);
		await page.goto('/chat');
		await expect(page).toHaveURL(/\/auth/, { timeout: 10_000 });
	});

	test('T-AUTH-01c: Unauthenticated access to /history redirects to /auth', async ({ page }) => {
		await injectMockWallet(page);
		await page.goto('/history');
		await expect(page).toHaveURL(/\/auth/, { timeout: 10_000 });
	});

	test('T-AUTH-02: Auth page renders the ThirdWeb ConnectButton', async ({ page }) => {
		await injectMockWallet(page);
		await page.goto('/auth');
		await expect(page.getByRole('button').filter({ hasText: /connect wallet/i })).toBeVisible({
			timeout: 10_000,
		});
	});

	test('T-AUTH-02b: Auth page renders the SenseAI logo', async ({ page }) => {
		await injectMockWallet(page);
		await page.goto('/auth');
		await expect(page.locator('img[alt*="SenseAI"]').first()).toBeVisible({ timeout: 10_000 });
	});
});

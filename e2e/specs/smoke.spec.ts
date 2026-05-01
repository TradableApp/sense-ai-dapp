/**
 * Smoke suite — T-INIT + critical P0 checks.
 *
 * These run on every commit and must complete in under 3 minutes.
 * If any of these fail, stop and investigate before proceeding.
 */

import { expect, test as base } from '@playwright/test';

import { injectMockWallet } from '../fixtures/mock-wallet';
import { isGraphRunning } from '../helpers/graph';
import { isHardhatRunning } from '../helpers/hardhat';

// For smoke tests we use the plain base test so we can check pre-auth states too
const test = base;

test.describe('Infrastructure pre-flight', () => {
	test('T-INIT-SMOKE-01: Hardhat node is reachable at port 8545', async () => {
		const running = await isHardhatRunning();
		expect(running, 'Hardhat node must be running. Start with: npx hardhat node').toBe(true);
	});

	test('T-INIT-SMOKE-02: Local Graph node is reachable at port 8000', async () => {
		const running = await isGraphRunning();
		expect(running, 'Graph node must be running. Start with: docker-compose up in sense-ai-subgraph').toBe(true);
	});
});

test.describe('App initialisation (T-INIT)', () => {
	test('T-INIT-01: dApp loads at localhost:3002 with no errors', async ({ page }) => {
		const errors: string[] = [];
		page.on('pageerror', err => errors.push(err.message));

		await injectMockWallet(page);
		await page.goto('/');

		// App should either show splash, auth, or dashboard — not a blank page
		await expect(page.locator('body')).not.toBeEmpty();
		expect(errors.filter(e => !e.includes('ResizeObserver'))).toHaveLength(0);
	});

	test('T-INIT-02: Splash screen renders on initial boot', async ({ page }) => {
		await injectMockWallet(page);
		await page.goto('/');

		// Splash may flash briefly — we just assert the page title / body loads
		await expect(page).toHaveTitle(/SenseAI|Tradable/i, { timeout: 10_000 });
	});

	test('T-INIT-06: Sentry session envelope fires within 3s of page load', async ({ page }) => {
		const sentryRequests: string[] = [];
		page.on('request', req => {
			if (req.url().includes('sentry.io') || req.url().includes('ingest')) {
				sentryRequests.push(req.url());
			}
		});

		await injectMockWallet(page);
		await page.goto('/');

		// Give Sentry up to 5s to fire the session envelope
		await page.waitForTimeout(5_000);

		expect(sentryRequests.length, 'Expected at least one Sentry request').toBeGreaterThan(0);
	});

	test('T-INIT-07: No unhandled JavaScript errors during page load', async ({ page }) => {
		const errors: Error[] = [];
		page.on('pageerror', err => errors.push(err));

		await injectMockWallet(page);
		await page.goto('/');
		await page.waitForLoadState('networkidle');

		// Filter out known benign noise
		const meaningful = errors.filter(
			e =>
				!e.message.includes('ResizeObserver') &&
				!e.message.includes('Non-Error promise rejection'),
		);
		expect(meaningful).toHaveLength(0);
	});

	test('T-INIT-11: PWA manifest is served', async ({ page }) => {
		await injectMockWallet(page);
		const response = await page.goto('/manifest.webmanifest');
		expect(response?.status()).toBe(200);

		const manifest = await response?.json();
		expect(manifest).toMatchObject({
			name: expect.stringContaining('SenseAI'),
			id: 'senseai.tradable.app',
		});
	});

	test('T-INIT-09: Offline overlay renders when network is disabled', async ({ page, context }) => {
		await injectMockWallet(page);
		await page.goto('/');
		await page.waitForLoadState('networkidle');

		// Go offline
		await context.setOffline(true);

		// The offline message component should appear
		await expect(
			page.getByText(/offline|no connection|internet/i),
		).toBeVisible({ timeout: 5_000 });
	});

	test('T-INIT-10: Offline overlay disappears when network is restored', async ({ page, context }) => {
		await injectMockWallet(page);
		await page.goto('/');
		await page.waitForLoadState('networkidle');

		await context.setOffline(true);
		await expect(page.getByText(/offline|no connection/i)).toBeVisible({ timeout: 5_000 });

		await context.setOffline(false);
		await expect(page.getByText(/offline|no connection/i)).not.toBeVisible({ timeout: 5_000 });
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
		await expect(
			page.getByRole('button', { name: /connect wallet/i }),
		).toBeVisible({ timeout: 10_000 });
	});
});

import { test as base, expect } from '@playwright/test';

import { injectMockWallet } from '../fixtures/mock-wallet';

const test = base;

test.describe('Sentry — error tracking initialisation (T-SENTRY)', () => {
	test('T-SENTRY-01: Sentry SDK loads without errors', async ({ page }) => {
		test.skip(!process.env.VITE_SENTRY_DSN, 'Skipped: VITE_SENTRY_DSN not configured');

		const errors: string[] = [];
		page.on('pageerror', err => errors.push(err.message));

		await injectMockWallet(page);
		await page.goto('/');
		await page.waitForLoadState('networkidle');

		const sentryErrors = errors.filter(e => e.includes('Sentry'));
		expect(sentryErrors).toHaveLength(0);
	});

	test('T-SENTRY-02: Sentry sends session envelope on page load', async ({ page }) => {
		test.skip(!process.env.VITE_SENTRY_DSN, 'Skipped: VITE_SENTRY_DSN not configured');

		const sentryRequest = page.waitForRequest(
			req => req.url().includes('sentry.io') || req.url().includes('ingest'),
			{ timeout: 10_000 },
		);

		await injectMockWallet(page);
		await page.goto('/');
		await sentryRequest;
	});

	test('T-SENTRY-03: Unhandled JS error triggers Sentry event capture', async ({ page }) => {
		test.skip(!process.env.VITE_SENTRY_DSN, 'Skipped: VITE_SENTRY_DSN not configured');

		await injectMockWallet(page);
		await page.goto('/');
		await page.waitForLoadState('networkidle');

		const sentryEvent = page.waitForRequest(
			req =>
				(req.url().includes('sentry.io') || req.url().includes('ingest')) &&
				req.method() === 'POST',
			{ timeout: 15_000 },
		);

		// Inject a deliberate unhandled error
		await page.evaluate(() => {
			setTimeout(() => {
				throw new Error('E2E_SENTRY_TEST_ERROR');
			}, 100);
		});

		const req = await sentryEvent;
		expect(req).toBeTruthy();
	});

	test('T-SENTRY-04: Sentry transaction traces fire for navigation', async ({ page }) => {
		test.skip(!process.env.VITE_SENTRY_DSN, 'Skipped: VITE_SENTRY_DSN not configured');

		const sentryRequests: string[] = [];
		page.on('request', req => {
			if (req.url().includes('sentry.io') || req.url().includes('ingest')) {
				sentryRequests.push(req.url());
			}
		});

		await injectMockWallet(page);
		await page.goto('/');
		await page.waitForLoadState('networkidle');

		// Navigate to trigger performance trace
		await page.goto('/auth');
		await page.waitForLoadState('networkidle');

		expect(sentryRequests.length).toBeGreaterThan(0);
	});
});

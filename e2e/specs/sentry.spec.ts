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

	test('T-SENTRY-03: Sentry captures unhandled errors', async ({ page }) => {
		test.skip(!process.env.VITE_SENTRY_DSN, 'Skipped: VITE_SENTRY_DSN not configured');
		test.skip(
			process.env.E2E_LOCAL_SERVICES !== '1',
			'Skipped: needs authenticated session to trigger error boundary (set E2E_LOCAL_SERVICES=1)',
		);

		test.fixme(true, 'Pending: needs error injection mechanism');
	});
});

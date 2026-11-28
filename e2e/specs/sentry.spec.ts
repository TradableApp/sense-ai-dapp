import { test as base, expect } from '@playwright/test';

import { injectMockWallet } from '../fixtures/mock-wallet';
import { waitForAppShell } from '../helpers/app-ready';
import { isSentryUrl } from '../helpers/sentryRequest';

const test = base;

test.describe('Sentry — error tracking initialisation (T-SENTRY)', () => {
	test('T-SENTRY-01: Sentry SDK loads without errors', async ({ page }) => {
		test.skip(!process.env.VITE_SENTRY_DSN, 'Skipped: VITE_SENTRY_DSN not configured');

		const errors: string[] = [];
		page.on('pageerror', err => errors.push(err.message));

		await injectMockWallet(page);
		await page.goto('/');
		await waitForAppShell(page);

		const sentryErrors = errors.filter(e => e.includes('Sentry'));
		expect(sentryErrors).toHaveLength(0);
	});

	test('T-SENTRY-02: Sentry sends session envelope on page load', async ({ page }) => {
		test.skip(!process.env.VITE_SENTRY_DSN, 'Skipped: VITE_SENTRY_DSN not configured');

		await injectMockWallet(page);
		// Same warm-load pattern as smoke's T-INIT-06: assert against a warm
		// navigation so dev-server compile and first-load contention can't
		// swallow the envelope window (this assertion was intermittent under
		// suite load even at trace sampling 1.0).
		await page.goto('/');
		await waitForAppShell(page);

		const sentryRequest = page.waitForRequest(
			req => isSentryUrl(req.url()),
			{ timeout: 10_000 },
		);
		await page.goto('/');
		await sentryRequest;
	});

	test('T-SENTRY-03: Unhandled JS error triggers Sentry event capture', async ({ page }) => {
		test.skip(!process.env.VITE_SENTRY_DSN, 'Skipped: VITE_SENTRY_DSN not configured');

		await injectMockWallet(page);
		await page.goto('/');
		await waitForAppShell(page);

		const sentryEvent = page.waitForRequest(
			req =>
				isSentryUrl(req.url()) &&
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

		await injectMockWallet(page);
		await page.goto('/');
		await waitForAppShell(page);

		// A trace is sent when its page goes idle or is left, some time after the page is ready,
		// so the test waits for the request itself. Counting the requests seen by the time the
		// page was ready passed or failed on timing alone. The request is known by its envelope:
		// a session or an error report is not a trace.
		const transaction = page.waitForRequest(
			req =>
				isSentryUrl(req.url()) &&
				req.method() === 'POST' &&
				(req.postData() ?? '').includes('"type":"transaction"'),
			{ timeout: 15_000 },
		);
		await page.goto('/auth');
		await waitForAppShell(page);

		await transaction;
	});
});

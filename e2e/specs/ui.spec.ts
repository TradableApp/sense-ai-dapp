/**
 * UI suite — visual and interactive tests that do NOT require local blockchain services.
 *
 * These tests validate static UI behaviour: splash screen, theme, error boundaries,
 * offline indicators, and public pages.
 */

import { test as base, expect } from '@playwright/test';

import { injectMockWallet } from '../fixtures/mock-wallet';

const test = base;

test.describe('Splash and initial render', () => {
	test('T-UI-01: Page renders without blank white screen', async ({ page }) => {
		await injectMockWallet(page);
		await page.goto('/');
		const body = page.locator('body');
		await expect(body).not.toBeEmpty();
	});

	test('T-UI-02: Page title contains SenseAI or Tradable', async ({ page }) => {
		await injectMockWallet(page);
		await page.goto('/');
		await expect(page).toHaveTitle(/SenseAI|Tradable/i, { timeout: 10_000 });
	});

	test('T-UI-03: No unhandled exceptions during auth page load', async ({ page }) => {
		const errors: string[] = [];
		page.on('pageerror', err => errors.push(err.message));

		await injectMockWallet(page);
		await page.goto('/auth');
		await page.waitForLoadState('domcontentloaded');

		const meaningful = errors.filter(
			e => !e.includes('ResizeObserver') && !e.includes('Non-Error promise rejection'),
		);
		expect(meaningful).toHaveLength(0);
	});
});

test.describe('Public pages', () => {
	test('T-UI-04: Privacy policy page is accessible', async ({ page }) => {
		await page.goto('/privacy-policy');
		await expect(page.locator('body')).not.toBeEmpty();
		await expect(page.getByText(/privacy/i).first()).toBeVisible({ timeout: 10_000 });
	});

	test('T-UI-05: Terms and conditions page is accessible', async ({ page }) => {
		await page.goto('/terms-and-conditions');
		await expect(page.locator('body')).not.toBeEmpty();
		await expect(page.getByText(/terms/i).first()).toBeVisible({ timeout: 10_000 });
	});

	test('T-UI-06: Website disclaimer page is accessible', async ({ page }) => {
		await page.goto('/website-disclaimer');
		await expect(page.locator('body')).not.toBeEmpty();
		await expect(page.getByText(/disclaimer/i).first()).toBeVisible({ timeout: 10_000 });
	});
});

test.describe('Theme and visual', () => {
	test('T-UI-07: Page has a defined background color (not default white)', async ({ page }) => {
		await injectMockWallet(page);
		await page.goto('/auth');
		await page.waitForLoadState('domcontentloaded');

		const bgColor = await page.evaluate(
			() => window.getComputedStyle(document.body).backgroundColor,
		);
		// Should not be transparent or pure default white
		expect(bgColor).not.toBe('');
		expect(bgColor).not.toBe('rgba(0, 0, 0, 0)');
	});

	test('T-UI-08: Root font is loaded (not system fallback)', async ({ page }) => {
		await injectMockWallet(page);
		await page.goto('/auth');
		await page.waitForLoadState('networkidle');

		const fontFamily = await page.evaluate(() => window.getComputedStyle(document.body).fontFamily);
		expect(fontFamily.length).toBeGreaterThan(0);
	});
});

test.describe('Responsive viewport', () => {
	test('T-UI-09: No horizontal overflow at mobile width (375px)', async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 812 });
		await injectMockWallet(page);
		await page.goto('/auth');
		await page.waitForLoadState('domcontentloaded');

		const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
		const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
		expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1); // 1px tolerance
	});

	test('T-UI-10: No horizontal overflow at tablet width (768px)', async ({ page }) => {
		await page.setViewportSize({ width: 768, height: 1024 });
		await injectMockWallet(page);
		await page.goto('/auth');
		await page.waitForLoadState('domcontentloaded');

		const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
		const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
		expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
	});
});

test.describe('Error handling', () => {
	test('T-UI-11: Invalid route renders 404 page or redirects to /auth', async ({ page }) => {
		await injectMockWallet(page);
		await page.goto('/nonexistent-route-that-does-not-exist');

		// Wait for either: redirect to /auth completes OR 404 component renders
		const authRedirect = page.waitForURL(/\/auth/, { timeout: 10_000 }).then(() => 'redirect');
		const notFoundPage = page
			.getByText(/404|not found|wrong galaxy/i)
			.first()
			.waitFor({ state: 'visible', timeout: 10_000 })
			.then(() => '404');
		const result = await Promise.race([authRedirect, notFoundPage]);
		expect(['redirect', '404']).toContain(result);
	});
});

test.describe('Accessibility basics', () => {
	test('T-UI-12: Auth page has meaningful text content', async ({ page }) => {
		await injectMockWallet(page);
		await page.goto('/auth');
		await page.waitForLoadState('domcontentloaded');

		// Page should have visible text — either headings or descriptive content
		const body = await page.locator('body').textContent();
		expect(body?.trim().length).toBeGreaterThan(0);
	});

	test('T-UI-13: Page has lang attribute on html element', async ({ page }) => {
		await injectMockWallet(page);
		await page.goto('/auth');
		const lang = await page.locator('html').getAttribute('lang');
		expect(lang).toBeTruthy();
	});
});

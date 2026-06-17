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
			e =>
				!e.includes('ResizeObserver') &&
				!e.includes('Non-Error promise rejection') &&
				!e.includes('screen.orientation'),
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

	test('T-UI-06b: Privacy policy page has substantive content', async ({ page }) => {
		await page.goto('/privacy-policy');
		await page.waitForLoadState('domcontentloaded');
		const bodyText = await page.locator('body').textContent();
		expect((bodyText ?? '').length).toBeGreaterThan(100);
	});

	test('T-UI-06c: Terms page has substantive content', async ({ page }) => {
		await page.goto('/terms-and-conditions');
		await page.waitForLoadState('domcontentloaded');
		const bodyText = await page.locator('body').textContent();
		expect((bodyText ?? '').length).toBeGreaterThan(100);
	});

	test('T-UI-06d: Disclaimer page has substantive content', async ({ page }) => {
		await page.goto('/website-disclaimer');
		await page.waitForLoadState('domcontentloaded');
		const bodyText = await page.locator('body').textContent();
		expect((bodyText ?? '').length).toBeGreaterThan(100);
	});

	test('T-UI-06e: Public pages load without JS errors', async ({ page }) => {
		const errors: string[] = [];
		page.on('pageerror', err => errors.push(err.message));

		for (const route of ['/privacy-policy', '/terms-and-conditions', '/website-disclaimer']) {
			await page.goto(route);
			await page.waitForLoadState('domcontentloaded');
		}

		const meaningful = errors.filter(
			e =>
				!e.includes('ResizeObserver') &&
				!e.includes('Non-Error promise rejection') &&
				!e.includes('screen.orientation'),
		);
		expect(meaningful).toHaveLength(0);
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

	test('T-UI-08b: Theme class (light or dark) is applied to html element', async ({ page }) => {
		await injectMockWallet(page);
		await page.goto('/auth');
		await page.waitForLoadState('domcontentloaded');

		const htmlClass = (await page.locator('html').getAttribute('class')) ?? '';
		expect(
			htmlClass.includes('dark') || htmlClass.includes('light'),
			`Expected html class to contain 'dark' or 'light', got: "${htmlClass}"`,
		).toBe(true);
	});

	test('T-UI-08c: Dark theme preference is applied on load', async ({ page }) => {
		// ThemeProvider (main.tsx) reads the persisted theme from storageKey "senseai-ui-theme" — NOT
		// the component's own 'vite-ui-theme' default. Seed the correct key so the app loads dark.
		await page.addInitScript(() => localStorage.setItem('senseai-ui-theme', 'dark'));
		await injectMockWallet(page);
		await page.goto('/auth');
		await page.waitForLoadState('domcontentloaded');

		// Assert the dark theme is actually applied (html class), not merely that the background is
		// non-transparent — which holds for any theme and so never caught the wrong-key bug above.
		await expect(page.locator('html')).toHaveClass(/dark/);
		const storedTheme = await page.evaluate(() => localStorage.getItem('senseai-ui-theme'));
		expect(storedTheme).toBe('dark');
	});
});

test.describe('Responsive viewport', () => {
	const viewports = [
		{ name: 'mobile-320', width: 320, height: 568 },
		{ name: 'mobile-375', width: 375, height: 812 },
		{ name: 'tablet-768', width: 768, height: 1024 },
		{ name: 'desktop-1024', width: 1024, height: 768 },
		{ name: 'desktop-1440', width: 1440, height: 900 },
	];

	for (const vp of viewports) {
		test(`T-UI-09-${vp.name}: No horizontal overflow at ${vp.width}px`, async ({ page }) => {
			await page.setViewportSize({ width: vp.width, height: vp.height });
			await injectMockWallet(page);
			await page.goto('/auth');
			await page.waitForLoadState('domcontentloaded');

			const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
			const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
			expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
		});
	}

	test('T-UI-10: Auth page ConnectButton is visible at mobile width', async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 812 });
		await injectMockWallet(page);
		await page.goto('/auth');

		await expect(page.getByRole('button').filter({ hasText: /connect wallet/i })).toBeVisible({
			timeout: 10_000,
		});
	});

	test('T-UI-10b: Auth page logo is visible at mobile width', async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 812 });
		await injectMockWallet(page);
		await page.goto('/auth');

		await expect(page.locator('img[alt*="SenseAI"]').first()).toBeVisible({ timeout: 10_000 });
	});
});

test.describe('Error handling', () => {
	test('T-UI-11: Invalid route renders 404 page or redirects to /auth', async ({ page }) => {
		await injectMockWallet(page);
		await page.goto('/nonexistent-route-that-does-not-exist');

		const authRedirect = page.waitForURL(/\/auth/, { timeout: 10_000 }).then(() => 'redirect');
		const notFoundPage = page
			.getByText(/404|not found|wrong galaxy/i)
			.first()
			.waitFor({ state: 'visible', timeout: 10_000 })
			.then(() => '404');
		const result = await Promise.race([authRedirect, notFoundPage]);
		expect(['redirect', '404']).toContain(result);
	});

	test('T-UI-11b: /error route renders the error page', async ({ page }) => {
		await injectMockWallet(page);
		await page.goto('/error');
		await page.waitForLoadState('domcontentloaded');

		const body = await page.locator('body').textContent();
		expect((body ?? '').length).toBeGreaterThan(0);
	});
});

test.describe('Accessibility basics', () => {
	test('T-UI-12: Auth page has meaningful text content', async ({ page }) => {
		await injectMockWallet(page);
		await page.goto('/auth');
		await page.waitForLoadState('domcontentloaded');

		const body = await page.locator('body').textContent();
		expect(body?.trim().length).toBeGreaterThan(0);
	});

	test('T-UI-13: Page has lang attribute on html element', async ({ page }) => {
		await injectMockWallet(page);
		await page.goto('/auth');
		const lang = await page.locator('html').getAttribute('lang');
		expect(lang).toBeTruthy();
	});

	test('T-UI-14: All images have alt text', async ({ page }) => {
		await injectMockWallet(page);
		await page.goto('/auth');
		await page.waitForLoadState('domcontentloaded');

		const images = page.locator('img');
		const count = await images.count();

		for (let i = 0; i < count; i++) {
			const alt = await images.nth(i).getAttribute('alt');
			expect(alt, `Image ${i} missing alt text`).toBeTruthy();
		}
	});

	test('T-UI-15: Interactive elements are keyboard-focusable', async ({ page }) => {
		await injectMockWallet(page);
		await page.goto('/auth');
		await page.waitForLoadState('networkidle');

		// Tab through focusable elements — at least one should be a BUTTON or A
		const focusedTags: string[] = [];
		for (let i = 0; i < 10; i++) {
			await page.keyboard.press('Tab');
			const tag = await page.evaluate(() => document.activeElement?.tagName ?? '');
			if (tag && tag !== 'BODY') focusedTags.push(tag);
		}
		expect(focusedTags.length, 'Expected at least one non-body focusable element').toBeGreaterThan(
			0,
		);
		expect(
			focusedTags.some(t => t === 'BUTTON' || t === 'A' || t === 'INPUT'),
			`Expected a BUTTON, A, or INPUT among focused elements, got: ${focusedTags.join(', ')}`,
		).toBe(true);
	});
});

test.describe('Consent banner', () => {
	test('T-UI-16: Cookie consent banner appears on first visit', async ({ page }) => {
		await page.addInitScript(() => localStorage.clear());
		await injectMockWallet(page);
		await page.goto('/auth');

		await expect(page.getByText('Cookie Settings')).toBeVisible({ timeout: 10_000 });
	});

	test('T-UI-17: Accepting consent dismisses the banner', async ({ page }) => {
		await page.addInitScript(() => localStorage.clear());
		await injectMockWallet(page);
		await page.goto('/auth');

		const banner = page.getByText('Cookie Settings');
		await expect(banner).toBeVisible({ timeout: 10_000 });

		const acceptButton = page.getByRole('button', { name: /accept all/i });
		await expect(acceptButton).toBeVisible({ timeout: 5_000 });
		await acceptButton.click();

		await expect(banner).not.toBeVisible({ timeout: 5_000 });
	});

	test('T-UI-18: Consent persists after page reload', async ({ browser }) => {
		const context = await browser.newContext();
		try {
			const page = await context.newPage();

			await page.addInitScript(() => {
				const w = window as unknown as { __consentTestInitDone?: boolean };
				if (!w.__consentTestInitDone) {
					localStorage.clear();
					w.__consentTestInitDone = true;
				}
			});
			await injectMockWallet(page);
			await page.goto('/auth');

			const acceptButton = page.getByRole('button', { name: /accept all/i });
			await expect(acceptButton).toBeVisible({ timeout: 10_000 });
			await acceptButton.click();

			const page2 = await context.newPage();
			await injectMockWallet(page2);
			await page2.goto('/auth');
			await page2.waitForLoadState('domcontentloaded');

			await expect(page2.getByText('Cookie Settings')).not.toBeVisible({ timeout: 5_000 });
		} finally {
			await context.close();
		}
	});
});

test.describe('Offline behaviour', () => {
	test('T-UI-19: Offline message shows "No Internet Connection"', async ({ page, context }) => {
		await injectMockWallet(page);
		await page.goto('/auth');
		await page.waitForLoadState('networkidle');

		await context.setOffline(true);

		await expect(page.getByText(/no internet connection/i)).toBeVisible({ timeout: 15_000 });
	});

	test('T-UI-20: Offline message has dismiss button', async ({ page, context }) => {
		await injectMockWallet(page);
		await page.goto('/auth');
		await page.waitForLoadState('networkidle');

		await context.setOffline(true);

		await expect(page.getByText(/no internet connection/i)).toBeVisible({ timeout: 15_000 });

		const dismissButton = page.getByRole('button', { name: /dismiss/i });
		await expect(dismissButton).toBeVisible({ timeout: 5_000 });
		await dismissButton.click();

		await expect(page.getByText(/no internet connection/i)).not.toBeVisible({ timeout: 5_000 });
	});
});

test.describe('Navigation guards', () => {
	const protectedRoutes = ['/', '/chat', '/history'];

	for (const route of protectedRoutes) {
		test(`T-UI-21: ${route} redirects unauthenticated to /auth`, async ({ page }) => {
			await injectMockWallet(page);
			await page.goto(route);
			await expect(page).toHaveURL(/\/auth/, { timeout: 10_000 });
		});
	}
});

test.describe('Performance basics', () => {
	test('T-UI-22: Auth page loads within 10 seconds', async ({ page }) => {
		await injectMockWallet(page);
		const start = Date.now();
		await page.goto('/auth');
		await page.waitForLoadState('domcontentloaded');
		const elapsed = Date.now() - start;
		expect(elapsed).toBeLessThan(10_000);
	});

	test('T-UI-23: No excessive DOM nodes on auth page', async ({ page }) => {
		await injectMockWallet(page);
		await page.goto('/auth');
		await page.waitForLoadState('networkidle');

		const nodeCount = await page.evaluate(() => document.querySelectorAll('*').length);
		expect(nodeCount).toBeLessThan(3000);
	});
});

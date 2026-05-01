import { test as base, type BrowserContext, type Page } from '@playwright/test';

import { injectMockWalletIntoContext } from './mock-wallet';
import { AuthPage } from '../pages/AuthPage';
import { ChatPage } from '../pages/ChatPage';
import { DashboardPage } from '../pages/DashboardPage';
import { HistoryPage } from '../pages/HistoryPage';
import { PlanModal } from '../pages/PlanModal';

/**
 * Path where authenticated browser storage state is saved between test runs.
 * Using import.meta.url keeps this portable without __dirname in ESM.
 */
export const AUTH_STATE_PATH = new URL('../.auth/user.json', import.meta.url).pathname;

// ── Custom fixture types ───────────────────────────────────────────────────

interface SenseAIFixtures {
	/** Context with mock wallet injected — no auth performed yet */
	walletContext: BrowserContext;
	/** Page from walletContext — for tests that exercise the auth flow itself */
	walletPage: Page;
	/** Page that is already authenticated (wallet connected + session signed) */
	authenticatedPage: Page;

	// Page Object Models (available in all tests)
	authPage: AuthPage;
	dashboardPage: DashboardPage;
	chatPage: ChatPage;
	historyPage: HistoryPage;
	planModal: PlanModal;
}

// ── Extended test ──────────────────────────────────────────────────────────

export const test = base.extend<SenseAIFixtures>({
	/**
	 * A fresh BrowserContext with the mock EIP-1193 wallet pre-injected.
	 * All pages opened from this context will have window.ethereum available.
	 */
	walletContext: async ({ browser }, use) => {
		const context = await browser.newContext();
		await injectMockWalletIntoContext(context);
		await use(context);
		await context.close();
	},

	/**
	 * A page from walletContext — has the mock wallet but is not authenticated.
	 * Use this for T-AUTH tests that exercise the connection flow itself.
	 */
	walletPage: async ({ walletContext }, use) => {
		const page = await walletContext.newPage();
		await use(page);
		await page.close();
	},

	/**
	 * A page that has completed the full auth flow (wallet connect + signature).
	 *
	 * On first run, performs the live flow and saves storageState so subsequent
	 * tests in the same run skip the connect/sign step entirely.
	 *
	 * NOTE: storageState persists localStorage/sessionStorage but NOT IndexedDB.
	 * Session keys are re-derived on each run from the saved ThirdWeb wallet state.
	 */
	authenticatedPage: async ({ browser }, use) => {
		let context: BrowserContext;

		try {
			context = await browser.newContext({ storageState: AUTH_STATE_PATH });
			await injectMockWalletIntoContext(context);
		} catch {
			context = await browser.newContext();
			await injectMockWalletIntoContext(context);
		}

		const page = await context.newPage();
		await page.goto('/');

		if (page.url().includes('/auth')) {
			const authPage = new AuthPage(page);
			await authPage.connectAndSign();
			await context.storageState({ path: AUTH_STATE_PATH });
		}

		await use(page);
		await page.close();
		await context.close();
	},

	// ── Page Object Model fixtures ─────────────────────────────────────────

	authPage: async ({ walletPage }, use) => {
		await use(new AuthPage(walletPage));
	},

	dashboardPage: async ({ authenticatedPage }, use) => {
		await use(new DashboardPage(authenticatedPage));
	},

	chatPage: async ({ authenticatedPage }, use) => {
		await use(new ChatPage(authenticatedPage));
	},

	historyPage: async ({ authenticatedPage }, use) => {
		await use(new HistoryPage(authenticatedPage));
	},

	planModal: async ({ authenticatedPage }, use) => {
		await use(new PlanModal(authenticatedPage));
	},
});

export { expect } from '@playwright/test';

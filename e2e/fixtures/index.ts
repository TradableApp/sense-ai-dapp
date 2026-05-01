import { fileURLToPath } from 'url';
import path from 'path';

import { test as base, type BrowserContext, type Page } from '@playwright/test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { AuthPage } from '../pages/AuthPage';
import { ChatPage } from '../pages/ChatPage';
import { DashboardPage } from '../pages/DashboardPage';
import { HistoryPage } from '../pages/HistoryPage';
import { PlanModal } from '../pages/PlanModal';
import { injectMockWalletIntoContext } from './mock-wallet';

/** Path where authenticated browser storage state is saved */
export const AUTH_STATE_PATH = path.join(__dirname, '../.auth/user.json');

// ── Custom fixture types ───────────────────────────────────────────────────

interface SenseAIFixtures {
	/** Context with mock wallet injected — no auth performed yet */
	walletContext: BrowserContext;
	/** Page from walletContext */
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
	 * Use this for T-AUTH tests that test the connection flow itself.
	 */
	walletPage: async ({ walletContext }, use) => {
		const page = await walletContext.newPage();
		await use(page);
		await page.close();
	},

	/**
	 * A page that has completed the full auth flow (wallet connect + signature).
	 *
	 * On the first run, performs the live auth flow and saves storageState.
	 * On subsequent runs (same worker), reuses the saved state — no re-signing.
	 *
	 * NOTE: storageState caches localStorage/sessionStorage but NOT IndexedDB.
	 * In-app session keys are derived fresh each time from the saved wallet state.
	 */
	authenticatedPage: async ({ browser }, use) => {
		let context: BrowserContext;

		try {
			// Try to reuse saved auth state (fast path)
			context = await browser.newContext({ storageState: AUTH_STATE_PATH });
			await injectMockWalletIntoContext(context);
		} catch {
			// No saved state yet — perform full auth
			context = await browser.newContext();
			await injectMockWalletIntoContext(context);
		}

		const page = await context.newPage();
		await page.goto('/');

		// If redirected to /auth, the saved state didn't work — do the full flow
		if (page.url().includes('/auth')) {
			const authPage = new AuthPage(page);
			await authPage.connectAndSign();
			// Save state for subsequent tests
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

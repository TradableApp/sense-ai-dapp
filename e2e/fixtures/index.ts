import { fileURLToPath } from 'url';

import { test as base, type BrowserContext, type Page } from '@playwright/test';

import { buildMockWalletScript, injectMockWalletIntoContext } from './mock-wallet';
import { allocateFreshAccount } from '../helpers/fresh-account';
import { type HardhatAccount } from '../helpers/hardhat';
import { AuthPage } from '../pages/AuthPage';
import { ChatPage } from '../pages/ChatPage';
import { DashboardPage } from '../pages/DashboardPage';
import { HistoryPage } from '../pages/HistoryPage';
import { PlanModal } from '../pages/PlanModal';

/**
 * Path where authenticated browser storage state is saved between test runs.
 * Using import.meta.url keeps this portable without __dirname in ESM. Decode via
 * fileURLToPath (not `.pathname`, which leaves spaces percent-encoded and would
 * write to a literal "…/Web%20and%20App%20Development/…" directory on paths with
 * spaces).
 */
export const AUTH_STATE_PATH = fileURLToPath(new URL('../.auth/user.json', import.meta.url));

// ── Custom fixture types ───────────────────────────────────────────────────

interface SenseAIFixtures {
	/** Context with mock wallet injected — no auth performed yet */
	walletContext: BrowserContext;
	/** Page from walletContext — for tests that exercise the auth flow itself */
	walletPage: Page;
	/** Page that is already authenticated (wallet connected + session signed) */
	authenticatedPage: Page;

	// ── Per-test fresh user (answer-flow specs) ──────────────────────────────
	/** A freshly-claimed Hardhat account (2..19) — a brand-new user for this test */
	freshUserAccount: HardhatAccount;
	/** Context whose mock wallet impersonates `freshUserAccount`, no cached auth */
	freshContext: BrowserContext;
	/** ChatPage for a `freshContext` page that has completed a real fresh connect */
	freshChatPage: ChatPage;

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

	// ── Per-test fresh-user fixtures (answer-flow specs) ──────────────────────
	// Production's first-ever connect IS the fresh-connect flow, and it works
	// because a real injected wallet emits connect/chainChanged/accountsChanged
	// after eth_requestAccounts. These fixtures exercise that exact path on a
	// pristine account so the answer pipeline is tested the way it runs in prod
	// (not via the cached-storageState boot the other specs use).

	/**
	 * Claims the next fresh Hardhat account for this test. File-persisted so the
	 * allocation survives Playwright worker recycling (see helpers/fresh-account).
	 */
	// eslint-disable-next-line no-empty-pattern
	freshUserAccount: async ({}, use) => {
		const account = await allocateFreshAccount();
		await use(account);
	},

	/**
	 * A fresh context with NO cached auth, whose mock wallet impersonates the
	 * claimed account — so the page must perform a real mid-session connect.
	 */
	freshContext: async ({ browser, freshUserAccount }, use) => {
		const context = await browser.newContext();
		await context.addInitScript(buildMockWalletScript(freshUserAccount));
		await use(context);
		await context.close();
	},

	/**
	 * A ChatPage whose page has completed the full fresh connect + session sign.
	 * The spec funds + activates `freshUserAccount` (in beforeEach) before the
	 * test body touches this fixture, so the plan is live when /chat loads.
	 */
	freshChatPage: async ({ freshContext }, use) => {
		const page = await freshContext.newPage();
		await page.goto('/');

		// A fresh context has no cached session, so the app ALWAYS redirects to /auth —
		// don't gate on page.url(). page.goto resolves on the `load` event, BEFORE
		// React's async Firebase/Thirdweb init and the ProtectedRoute redirect, so the
		// URL can still read '/' here; a url-check would then silently skip the connect
		// and run the test unauthenticated (latent CI flake). connectAndSign waits for
		// the connect button regardless of the redirect's timing.
		await new AuthPage(page).connectAndSign();

		await use(new ChatPage(page));
		await page.close();
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

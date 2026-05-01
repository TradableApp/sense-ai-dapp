import { defineConfig, devices } from '@playwright/test';

/**
 * Base URL of the locally running dApp.
 * Start it with `bun run dev` before running Playwright.
 */
const BASE_URL = 'http://localhost:3002';

export default defineConfig({
	testDir: './e2e/specs',
	/* Run tests in parallel within a file */
	fullyParallel: false,
	/* Fail the build on CI if you accidentally left test.only */
	forbidOnly: !!process.env.CI,
	/* Retry once on CI to reduce flakiness */
	retries: process.env.CI ? 1 : 0,
	/* Reporter */
	reporter: [['html', { outputFolder: 'playwright-report' }], ['list']],

	use: {
		baseURL: BASE_URL,
		/* Collect trace on retry */
		trace: 'on-first-retry',
		/* Screenshot on failure */
		screenshot: 'only-on-failure',
		/* Viewport */
		viewport: { width: 1280, height: 800 },
	},

	projects: [
		/**
		 * smoke — ~10 P0 sanity checks.
		 * Run on every commit. Should complete in < 3 minutes.
		 */
		{
			name: 'smoke',
			testMatch: '**/smoke.spec.ts',
			use: { ...devices['Desktop Chrome'] },
		},

		/**
		 * auth — wallet connection and session key derivation.
		 * Run when touching auth, ThirdWeb config, or SessionProvider.
		 */
		{
			name: 'auth',
			testMatch: '**/auth.spec.ts',
			use: { ...devices['Desktop Chrome'] },
		},

		/**
		 * plan — spending limit management (set, update, cancel).
		 * Run when touching ManagePlanModal, useUsagePlan, or escrow contract.
		 */
		{
			name: 'plan',
			testMatch: '**/plan.spec.ts',
			use: { ...devices['Desktop Chrome'] },
		},

		/**
		 * chat — prompt submission, oracle response, cancel.
		 * Run when touching useChatMutations, ECIES, or oracle.
		 */
		{
			name: 'chat',
			testMatch: '**/chat.spec.ts',
			use: { ...devices['Desktop Chrome'] },
		},

		/**
		 * history — conversation list, search, rename, delete.
		 * Run when touching dataService, syncService, or History page.
		 */
		{
			name: 'history',
			testMatch: '**/history.spec.ts',
			use: { ...devices['Desktop Chrome'] },
		},

		/**
		 * refunds — stuck payments, cancellation, refund eligibility.
		 */
		{
			name: 'refunds',
			testMatch: '**/refunds.spec.ts',
			use: { ...devices['Desktop Chrome'] },
		},

		/**
		 * security — ECIES encryption, no plaintext leaks, no key in storage.
		 * Run when touching ecies.ts, crypto.ts, or contract calldata.
		 */
		{
			name: 'security',
			testMatch: '**/security.spec.ts',
			use: { ...devices['Desktop Chrome'] },
		},

		/**
		 * graph — The Graph data layer and subgraph indexing.
		 */
		{
			name: 'graph',
			testMatch: '**/graph.spec.ts',
			use: { ...devices['Desktop Chrome'] },
		},

		/**
		 * sentry — Sentry initialisation and error capture.
		 */
		{
			name: 'sentry',
			testMatch: '**/sentry.spec.ts',
			use: { ...devices['Desktop Chrome'] },
		},

		/**
		 * regression — full suite. Run on all PRs and before testnet deployment.
		 * Excludes specs tagged @skip-localnet.
		 */
		{
			name: 'regression',
			testMatch: '**/*.spec.ts',
			use: { ...devices['Desktop Chrome'] },
		},
	],
});

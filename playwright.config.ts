import { defineConfig, devices } from '@playwright/test';

const BASE_URL = 'http://localhost:3002';

export default defineConfig({
	testDir: './e2e/specs',

	/**
	 * Run tests in parallel within a file. Each test gets its own browser context
	 * so there is no shared state between tests.
	 */
	fullyParallel: true,

	/** Fail the build on CI if you accidentally left test.only in */
	forbidOnly: !!process.env.CI,

	/** Retry once on CI to absorb transient flakiness */
	retries: process.env.CI ? 1 : 0,

	/** Cap workers on CI to avoid overwhelming the Hardhat node */
	workers: process.env.CI ? 2 : undefined,

	reporter: [['html', { outputFolder: 'playwright-report', open: 'never' }], ['list']],

	use: {
		baseURL: BASE_URL,
		/** Default assertion timeout — tight enough to catch regressions */
		actionTimeout: 15_000,
		navigationTimeout: 30_000,
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
		viewport: { width: 1280, height: 800 },
	},

	/**
	 * Automatically start the dApp dev server if it isn't already running.
	 * In CI the server is always started fresh; locally an existing server is reused.
	 * The Hardhat node, oracle, and Graph node must be started manually — see
	 * docs/LOCALNET_SETUP.md.
	 */
	webServer: {
		command: 'bun run dev',
		url: BASE_URL,
		reuseExistingServer: !process.env.CI,
		timeout: 60_000,
	},

	projects: [
		/**
		 * smoke — infrastructure pre-flight + P0 sanity checks.
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
		 * chat — prompt submission, oracle response, cancellation.
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
		 * security — ECIES encryption correctness, no plaintext leaks, no keys in storage.
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
		 */
		{
			name: 'regression',
			testMatch: '**/*.spec.ts',
			use: { ...devices['Desktop Chrome'] },
		},
	],
});

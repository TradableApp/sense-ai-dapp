import { expect, test } from '../fixtures';
import { getPendingPayments, waitForGraph } from '../helpers/graph';
import { activatePlan, fundABLE } from '../helpers/hardhat';
import { DashboardPage } from '../pages/DashboardPage';
import { PlanModal } from '../pages/PlanModal';

const TOKEN_ADDRESS = process.env.VITE_TOKEN_CONTRACT_ADDRESS ?? '';
const ESCROW_ADDRESS = process.env.VITE_ESCROW_CONTRACT_ADDRESS ?? '';
const PLAN_ALLOWANCE = 10n ** 18n * 100n; // 100 ABLE
const SKIP_REASON =
	'Skipped: requires Hardhat node + oracle + Graph node (set E2E_LOCAL_SERVICES=1)';
// The ThemeProvider is mounted in main.tsx with storageKey="senseai-ui-theme" (NOT the component's
// own default of 'vite-ui-theme'); the persisted theme lives under this key.
const THEME_STORAGE_KEY = 'senseai-ui-theme';

// Area 8 — remaining features. MarketPulse is an unwired placeholder stub (logged separately) and
// the testnet-faucet cloud-fn path is out of localnet scope; these cover the rest.

test.describe('Theme toggle (T-THEME)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);

	// The theme control lives in the sidebar (NavSecondary), which only renders inside the
	// authenticated MainLayout. The default dashboard ('/') shows the first-run onboarding screen,
	// whose full-bleed WarpBackground intentionally overlays the sidebar — but theme switching has
	// nothing to do with onboarding. So we exercise it from '/history': a normal protected route
	// whose sidebar is interactable with no plan/blockchain setup (the theme is pure client state).
	// Existing T-UI-08b/c only assert the applied/loaded theme; these assert the toggle *actions*.
	test.beforeEach(async ({ authenticatedPage }) => {
		await authenticatedPage.goto('/history');
		await expect(
			authenticatedPage.getByRole('heading', { name: /conversations/i }),
		).toBeVisible({ timeout: 30_000 });
	});

	test('T-THEME-01: selecting Dark then Light flips the html class and persists', async ({
		authenticatedPage,
	}) => {
		const page = authenticatedPage;
		const html = page.locator('html');
		const themeTrigger = page.getByRole('button', { name: /toggle theme/i }).first();

		await themeTrigger.click();
		await page.getByRole('menuitem', { name: /^dark$/i }).click();
		await expect(html).toHaveClass(/dark/);
		expect(await page.evaluate(key => localStorage.getItem(key), THEME_STORAGE_KEY)).toBe('dark');

		await themeTrigger.click();
		await page.getByRole('menuitem', { name: /^light$/i }).click();
		await expect(html).toHaveClass(/light/);
		await expect(html).not.toHaveClass(/dark/);
		expect(await page.evaluate(key => localStorage.getItem(key), THEME_STORAGE_KEY)).toBe('light');
	});

	test('T-THEME-02: System mode persists and follows the OS color-scheme live', async ({
		authenticatedPage,
	}) => {
		const page = authenticatedPage;
		const html = page.locator('html');
		const themeTrigger = page.getByRole('button', { name: /toggle theme/i }).first();

		// Pin a known OS preference so the System selection resolves deterministically.
		await page.emulateMedia({ colorScheme: 'light' });
		await themeTrigger.click();
		await page.getByRole('menuitem', { name: /^system$/i }).click();
		expect(await page.evaluate(key => localStorage.getItem(key), THEME_STORAGE_KEY)).toBe('system');
		await expect(html).toHaveClass(/light/);

		// In System mode the ThemeProvider subscribes to prefers-color-scheme and re-applies the class
		// live, with no further user action. Emulate the OS flipping to dark…
		await page.emulateMedia({ colorScheme: 'dark' });
		await expect(html).toHaveClass(/dark/);
		// …and back to light.
		await page.emulateMedia({ colorScheme: 'light' });
		await expect(html).toHaveClass(/light/);
		await expect(html).not.toHaveClass(/dark/);

		// The user's selection is unchanged — still 'system' regardless of the OS swings.
		expect(await page.evaluate(key => localStorage.getItem(key), THEME_STORAGE_KEY)).toBe('system');
	});
});

test.describe('Onboarding flow (T-ONBOARD)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');

	// NOTE: deliberately NO fund/activate here — a fresh wallet with no spending limit is exactly
	// the first-run state that should surface onboarding (UsageDashboard renders OnboardingFlow when
	// useUsagePlan returns no plan).
	test('T-ONBOARD-01: a fresh wallet sees the onboarding card, and Get Started opens the plan modal', async ({
		freshUserAccount,
		freshPage,
	}) => {
		expect(freshUserAccount.address).toBeTruthy();
		const dashboard = new DashboardPage(freshPage);
		const planModal = new PlanModal(freshPage);

		// freshPage lands on '/' after connect; with no plan UsageDashboard renders OnboardingFlow.
		// (The card title is a shadcn CardTitle <div>, not a heading element — match by text.)
		await expect(freshPage.getByText(/activate your ai agent/i)).toBeVisible({ timeout: 30_000 });
		// The card states the value props a first-run user weighs before committing a spending limit.
		await expect(freshPage.getByText(/set a limit/i)).toBeVisible();
		await expect(freshPage.getByText(/one-time approval/i)).toBeVisible();
		await expect(freshPage.getByText(/change anytime/i)).toBeVisible();

		await dashboard.getStartedButton.click();
		// Get Started opens ManagePlanModal (existingPlan=null) — the entry point to activate a plan.
		await expect(planModal.modal).toBeVisible({ timeout: 10_000 });
	});

	// First-run completion: a brand-new wallet activating its first plan straight from onboarding,
	// and the dashboard transitioning out of the onboarding screen. plan.spec (T-PLAN-05) covers the
	// allowance/escrow *mechanics* of activation with the shared cached account; this asserts the
	// first-run *journey* on a genuinely fresh wallet (ADR-0002 — no snapshot/revert).
	test('T-ONBOARD-02: completing onboarding activates a plan and reveals the dashboard', async ({
		freshUserAccount,
		freshPage,
	}) => {
		const dashboard = new DashboardPage(freshPage);
		const planModal = new PlanModal(freshPage);

		// Localnet has no faucet — seed the fresh wallet from the deployer so it can authorize a limit.
		await fundABLE(TOKEN_ADDRESS, freshUserAccount.address, PLAN_ALLOWANCE);

		await expect(dashboard.getStartedButton).toBeVisible({ timeout: 30_000 });
		await dashboard.getStartedButton.click();
		await planModal.fillAndSubmit(10, 30);
		await planModal.waitForTxCompletion();

		// The onboarding screen is replaced by the real dashboard (PlanStatusCard); the onboarding
		// "Get Started" CTA is gone.
		await dashboard.assertHasPlan();
		await expect(dashboard.getStartedButton).toHaveCount(0);
	});
});

test.describe('Stuck-request auto-detection (T-STUCK)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');

	test.beforeEach(async ({ freshUserAccount }) => {
		await fundABLE(TOKEN_ADDRESS, freshUserAccount.address, PLAN_ALLOWANCE);
		await activatePlan(TOKEN_ADDRESS, ESCROW_ADDRESS, freshUserAccount.address, PLAN_ALLOWANCE);
	});

	test('T-STUCK-01: the dashboard auto-detects a pending (stuck) prompt and surfaces the refund affordance', async ({
		freshUserAccount,
		freshChatPage,
		freshPage,
	}) => {
		// A dropped prompt (the __E2E_DROP__ sentinel) is never answered, so its escrow stays PENDING
		// — exactly the "stuck" state useStuckRequests detects.
		await freshChatPage.goto();
		await freshChatPage.sendDroppedPrompt('A prompt the oracle will never answer');

		// Wait for the pending payment to index, so useStuckRequests (subgraph + on-chain escrow
		// status check) has something to surface.
		await waitForGraph(
			() => getPendingPayments(freshUserAccount.address),
			payments => payments.length >= 1,
			{ label: 'pending payment indexed', timeoutMs: 60_000 },
		);

		// On the dashboard, PlanStatusCard (via useStuckRequests + pendingEscrowCount) raises the
		// "Action Required" stuck-request panel. (The per-request *refund button* is gated on
		// Date.now() > createdAt + 1h — wall-clock, not EVM time — so asserting that needs Playwright
		// page.clock; tracked as a follow-up. Here we assert the auto-detection itself.)
		const dashboard = new DashboardPage(freshPage);
		await dashboard.goto();
		await expect(freshPage.getByText(/action required/i)).toBeVisible({ timeout: 30_000 });
		await expect(freshPage.getByText(/older than 1 hour can be refunded/i)).toBeVisible();
		await expect(freshPage.getByText(/request #/i).first()).toBeVisible();
	});
});

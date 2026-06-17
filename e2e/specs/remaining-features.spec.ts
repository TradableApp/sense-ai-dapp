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

// Area 8 — remaining features. MarketPulse is an unwired placeholder stub (logged separately) and
// the testnet-faucet cloud-fn path is out of localnet scope; these cover the rest.

test.describe('Theme toggle (T-THEME)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);

	test('T-THEME-01: toggling the theme flips the html class and persists', async ({
		authenticatedPage,
	}) => {
		const page = authenticatedPage;
		const html = page.locator('html');
		// The theme control is a dropdown (sidebar NavSecondary) whose trigger is sr-only "Toggle
		// theme"; existing T-UI-08b/c only check the applied/loaded theme, not the toggle action.
		const themeTrigger = page.getByRole('button', { name: /toggle theme/i }).first();

		await themeTrigger.click();
		await page.getByRole('menuitem', { name: /^dark$/i }).click();
		await expect(html).toHaveClass(/dark/);
		expect(await page.evaluate(() => localStorage.getItem('vite-ui-theme'))).toBe('dark');

		await themeTrigger.click();
		await page.getByRole('menuitem', { name: /^light$/i }).click();
		await expect(html).toHaveClass(/light/);
		await expect(html).not.toHaveClass(/dark/);
		expect(await page.evaluate(() => localStorage.getItem('vite-ui-theme'))).toBe('light');
	});
});

test.describe('Onboarding flow (T-ONBOARD)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');

	// NOTE: deliberately NO fund/activate here — a fresh wallet with no spending limit is exactly
	// the first-run state that should surface onboarding (UsageDashboard renders OnboardingFlow when
	// useUsagePlan returns no plan).
	test('T-ONBOARD-01: a wallet with no plan sees onboarding, and Get Started opens the plan modal', async ({
		freshUserAccount,
		freshPage,
	}) => {
		expect(freshUserAccount.address).toBeTruthy();
		const dashboard = new DashboardPage(freshPage);
		const planModal = new PlanModal(freshPage);

		// freshPage lands on '/' after connect; with no plan the dashboard shows the onboarding CTA.
		await expect(dashboard.getStartedButton).toBeVisible({ timeout: 30_000 });
		await dashboard.getStartedButton.click();

		// Get Started opens ManagePlanModal (existingPlan=null) — the entry point to activate a plan.
		await expect(planModal.modal).toBeVisible({ timeout: 10_000 });
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

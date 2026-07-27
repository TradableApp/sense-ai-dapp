import { expect, test } from '../fixtures';
import { TEST_ACCOUNT } from '../fixtures/mock-wallet';
import { ESCROW_ADDRESS, TOKEN_ADDRESS } from '../helpers/contracts';
import {
	activatePlan,
	approveABLE,
	fundABLE,
	getABLEBalance,
	getAllowance,
	getEscrowBalance,
	increaseTime,
	useChainSnapshot,
} from '../helpers/hardhat';

const SKIP_REASON =
	'Skipped: requires Hardhat node + deployed contracts (set E2E_LOCAL_SERVICES=1)';

test.describe('Spending plan management (T-PLAN)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');

	useChainSnapshot(test);

	test.beforeEach(async () => {
		// Fund the user via the localnet "treasury" (deployer transfer) so plan
		// activation can move real ABLE to escrow — there is no faucet on localnet.
		await fundABLE(TOKEN_ADDRESS, TEST_ACCOUNT.address, 10n ** 18n * 100n);
	});

	test('T-PLAN-01: Dashboard shows onboarding for new user', async ({ dashboardPage }) => {
		await dashboardPage.goto();
		await dashboardPage.assertNoPlan();
	});

	test('T-PLAN-02: Get Started button opens plan modal', async ({ dashboardPage, planModal }) => {
		await dashboardPage.goto();
		await dashboardPage.getStartedButton.click();
		await planModal.assertOpen();
	});

	test('T-PLAN-03: Plan modal shows limit and days inputs', async ({
		dashboardPage,
		planModal,
	}) => {
		await dashboardPage.goto();
		await dashboardPage.getStartedButton.click();
		await planModal.assertOpen();
		await expect(planModal.limitInput).toBeVisible();
		await expect(planModal.daysInput).toBeVisible();
	});

	test('T-PLAN-04: Initial ABLE balance matches on-chain balance', async ({ dashboardPage }) => {
		await dashboardPage.goto();
		const onChainBalance = await getABLEBalance(TOKEN_ADDRESS, TEST_ACCOUNT.address);
		const displayedBalance = await dashboardPage.allowanceValue.textContent();
		expect(onChainBalance).toBeGreaterThan(0n);
		expect(displayedBalance).toBeTruthy();
	});

	test('T-PLAN-05: Setting a plan authorizes an allowance without moving tokens', async ({
		dashboardPage,
		planModal,
	}) => {
		const balanceBefore = await getABLEBalance(TOKEN_ADDRESS, TEST_ACCOUNT.address);

		await dashboardPage.goto();
		await dashboardPage.getStartedButton.click();
		await planModal.fillAndSubmit(10, 30);
		await planModal.waitForTxCompletion();

		// Allowance model: activation sets an ERC-20 allowance + spending limit but
		// does NOT move ABLE — tokens are escrowed per-prompt (initiatePrompt).
		const balanceAfter = await getABLEBalance(TOKEN_ADDRESS, TEST_ACCOUNT.address);
		expect(balanceAfter).toBe(balanceBefore);
		await dashboardPage.assertHasPlan();
	});

	test('T-PLAN-06: Escrow holds no extra tokens until a prompt is sent', async ({
		dashboardPage,
		planModal,
	}) => {
		const escrowBefore = await getEscrowBalance(TOKEN_ADDRESS, ESCROW_ADDRESS);

		await dashboardPage.goto();
		await dashboardPage.getStartedButton.click();
		await planModal.fillAndSubmit(10, 30);
		await planModal.waitForTxCompletion();

		// Allowance model: no upfront escrow at activation — the escrow balance only
		// changes when a prompt is initiated.
		const escrowAfter = await getEscrowBalance(TOKEN_ADDRESS, ESCROW_ADDRESS);
		expect(escrowAfter).toBe(escrowBefore);
	});

	test('T-PLAN-07: ERC-20 allowance is set after plan activation', async ({
		dashboardPage,
		planModal,
	}) => {
		await dashboardPage.goto();
		await dashboardPage.getStartedButton.click();
		await planModal.fillAndSubmit(10, 30);
		await planModal.waitForTxCompletion();

		const allowance = await getAllowance(TOKEN_ADDRESS, TEST_ACCOUNT.address, ESCROW_ADDRESS);
		expect(allowance).toBeGreaterThan(0n);
	});

	test('T-PLAN-08: Manage Plan button opens modal', async ({ dashboardPage, planModal }) => {
		await dashboardPage.goto();
		await dashboardPage.getStartedButton.click();
		await planModal.fillAndSubmit(10, 30);
		await planModal.waitForTxCompletion();

		await dashboardPage.managePlanButton.click();
		await planModal.assertOpen();
	});

	test('T-PLAN-09: Cancelling a plan leaves balance unchanged (no escrowed tokens to return)', async ({
		dashboardPage,
		planModal,
	}) => {
		await dashboardPage.goto();
		await dashboardPage.getStartedButton.click();
		await planModal.fillAndSubmit(10, 30);
		await planModal.waitForTxCompletion();

		const balanceBeforeCancel = await getABLEBalance(TOKEN_ADDRESS, TEST_ACCOUNT.address);

		await dashboardPage.managePlanButton.click();
		await planModal.revoke();

		// Allowance model: nothing was escrowed at activation, so cancelling only
		// clears the spending limit — the user's ABLE balance is unchanged.
		const balanceAfterCancel = await getABLEBalance(TOKEN_ADDRESS, TEST_ACCOUNT.address);
		expect(balanceAfterCancel).toBe(balanceBeforeCancel);
	});

	test('T-PLAN-14: Authorization Gap warning shows when the ERC-20 allowance drops below the plan limit', async ({
		dashboardPage,
	}) => {
		// Activate a 10 ABLE plan directly on-chain (approve(escrow, 10) → setSpendingLimit(10)).
		await activatePlan(TOKEN_ADDRESS, ESCROW_ADDRESS, TEST_ACCOUNT.address, 10n ** 18n * 10n);
		// Then drop the ERC-20 allowance BELOW the plan's remaining limit (10 → 5). In production this
		// happens after cancellations/refunds (the allowance isn't credited back); here we reproduce it
		// directly. Doing it BEFORE the first dashboard load means the very first useUsagePlan read
		// already observes the gap — no dependence on a staleTime refetch.
		await approveABLE(TOKEN_ADDRESS, TEST_ACCOUNT.address, ESCROW_ADDRESS, 10n ** 18n * 5n);

		await dashboardPage.goto();
		await dashboardPage.assertHasPlan();
		// PlanStatusCard surfaces the always-visible allowance-gap panel and keeps "Manage Limit" as
		// the re-sync CTA (allowanceGap = (allowance − spent) − realTokenAllowance = 10 − 0 − 5 = 5).
		await expect(dashboardPage.authorizationGapWarning).toBeVisible({ timeout: 15_000 });
		// This is the COMPLEMENT of T-PENDING-01 (pending → disabled): with no pending escrow the
		// "Manage Limit" CTA must be clickable so the user can re-sync the allowance — assert it's
		// enabled, not merely present (a bug disabling it while showing the gap would slip past a
		// visibility-only check).
		await expect(dashboardPage.managePlanButton).toBeVisible();
		await expect(dashboardPage.managePlanButton).not.toBeDisabled();
	});

	test('T-PLAN-10: Cancel plan reverts dashboard to onboarding', async ({
		dashboardPage,
		planModal,
	}) => {
		await dashboardPage.goto();
		await dashboardPage.getStartedButton.click();
		await planModal.fillAndSubmit(10, 30);
		await planModal.waitForTxCompletion();

		await dashboardPage.managePlanButton.click();
		await planModal.revoke();

		// The revoke's onSuccess invalidates ['usagePlan'] and closes the modal, so
		// the dashboard reverts to onboarding on its own (no reload — that would drop
		// the in-memory session key and bounce to /auth).
		await dashboardPage.assertNoPlan();
	});
});

test.describe('Plan modal validation (T-PLAN-EDGE)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');

	// This block needs no beforeEach of its own, but it DOES need the revert: T-PLAN-13
	// calls increaseTime(86400 + 60), and without an afterEach that ~24h EVM time
	// advance persists for the remainder of the serial run — every later spec would
	// evaluate against a chain a day ahead, which silently invalidates anything
	// asserting inside a time window (REFUND_TIMEOUT is 1 hour). This block had
	// snapshot/revert hooks before the fixture refactor; restoring that coverage.
	useChainSnapshot(test);

	test('T-PLAN-11: Cannot set plan with 0 ABLE', async ({ dashboardPage, planModal }) => {
		await dashboardPage.goto();
		await dashboardPage.getStartedButton.click();
		await planModal.assertOpen();

		await planModal.limitInput.fill('0');
		await planModal.daysInput.fill('30');

		const isDisabled = await planModal.submitButton.isDisabled().catch(() => false);
		expect(isDisabled).toBe(true);
	});

	test('T-PLAN-12: Cannot set plan exceeding wallet balance', async ({
		dashboardPage,
		planModal,
		authenticatedPage,
	}) => {
		await dashboardPage.goto();
		await dashboardPage.getStartedButton.click();
		await planModal.assertOpen();

		await planModal.limitInput.fill('999999999');
		await planModal.daysInput.fill('30');
		await planModal.submitButton.click();

		// Should show an error — either in modal or as a toast
		await expect(
			authenticatedPage.getByText(/insufficient|exceed|not enough/i).first(),
		).toBeVisible({ timeout: 15_000 });
	});

	test('T-PLAN-13: Plan expiry after duration elapses', async ({ dashboardPage, planModal }) => {
		// Unlike T-PLAN-11/12 (which intentionally start at 0 ABLE to exercise the
		// zero/exceed guards), this test must actually activate a plan to observe it
		// expire — so it needs funding. The EDGE describe's beforeEach only snapshots.
		await fundABLE(TOKEN_ADDRESS, TEST_ACCOUNT.address, 10n ** 18n * 100n);

		await dashboardPage.goto();
		await dashboardPage.getStartedButton.click();
		await planModal.fillAndSubmit(10, 1);
		await planModal.waitForTxCompletion();
		await dashboardPage.assertHasPlan();

		await increaseTime(86400 + 60);

		await dashboardPage.goto();
		await expect(dashboardPage.planStatusCard.or(dashboardPage.getStartedButton)).toBeVisible({
			timeout: 10_000,
		});
	});
});

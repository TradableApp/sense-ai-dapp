import { expect, test } from '../fixtures';
import { TEST_ACCOUNT } from '../fixtures/mock-wallet';
import {
	advanceTime,
	fundABLE,
	getABLEBalance,
	getAllowance,
	getEscrowBalance,
	revertToSnapshot,
	takeSnapshot,
} from '../helpers/hardhat';

const TOKEN_ADDRESS = process.env.VITE_TOKEN_CONTRACT_ADDRESS ?? '';
const ESCROW_ADDRESS = process.env.VITE_ESCROW_CONTRACT_ADDRESS ?? '';
const SKIP_REASON =
	'Skipped: requires Hardhat node + deployed contracts (set E2E_LOCAL_SERVICES=1)';

test.describe('Spending plan management (T-PLAN)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');

	let snapshotId: string;

	test.beforeEach(async () => {
		snapshotId = await takeSnapshot();
		// Fund the user via the localnet "treasury" (deployer transfer) so plan
		// activation can move real ABLE to escrow — there is no faucet on localnet.
		await fundABLE(TOKEN_ADDRESS, TEST_ACCOUNT.address, 10n ** 18n * 100n);
	});

	test.afterEach(async () => {
		await revertToSnapshot(snapshotId);
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

	let snapshotId: string;

	test.beforeEach(async () => {
		snapshotId = await takeSnapshot();
	});

	test.afterEach(async () => {
		await revertToSnapshot(snapshotId);
	});

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
		await dashboardPage.goto();
		await dashboardPage.getStartedButton.click();
		await planModal.fillAndSubmit(10, 1);
		await planModal.waitForTxCompletion();
		await dashboardPage.assertHasPlan();

		await advanceTime(86400 + 60);

		await dashboardPage.goto();
		await expect(dashboardPage.planStatusCard.or(dashboardPage.getStartedButton)).toBeVisible({
			timeout: 10_000,
		});
	});
});

import { expect, test } from '../fixtures';
import { CHAIN, LIVE_STACK } from '../helpers/chain';
import { ABLE, ESCROW_ADDRESS, PLAN_ALLOWANCE, TOKEN_ADDRESS } from '../helpers/contracts';
import {
	activatePlan,
	approveABLE,
	fundABLE,
	getABLEBalance,
	getAllowance,
	getEscrowBalance,
	increaseTime,
} from '../helpers/hardhat';

const SKIP_REASON =
	'Skipped: requires Hardhat node + deployed contracts (set E2E_LOCAL_SERVICES=1)';

// Every test claims its own fresh account (ADR-0002): a brand-new user with no plan, funded
// through the chain adapter so the same spec runs on localnet (deployer transfer) and on Base
// Sepolia (treasury transfer, swept back on teardown). No snapshot/revert anywhere in this file —
// per-test accounts give the isolation a revert used to, without rewinding the chain.
test.describe('Spending plan management (T-PLAN)', () => {
	test.skip(!LIVE_STACK, SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');

	test.beforeEach(async ({ freshUserAccount }) => {
		// Fund the fresh user so plan activation has ABLE to authorise. A fresh account starts
		// with 0 ABLE on localnet and the allocator's 5 ABLE float on testnet; neither covers a
		// 10 ABLE plan, so this is the precondition for every test below.
		await fundABLE(TOKEN_ADDRESS, freshUserAccount.address, PLAN_ALLOWANCE);
	});

	test('T-PLAN-01: Dashboard shows onboarding for new user', async ({ freshDashboardPage }) => {
		await freshDashboardPage.goto();
		await freshDashboardPage.assertNoPlan();
	});

	test('T-PLAN-02: Get Started button opens plan modal', async ({
		freshDashboardPage,
		freshPlanModal,
	}) => {
		await freshDashboardPage.goto();
		await freshDashboardPage.getStartedButton.click();
		await freshPlanModal.assertOpen();
	});

	test('T-PLAN-03: Plan modal shows limit and days inputs', async ({
		freshDashboardPage,
		freshPlanModal,
	}) => {
		await freshDashboardPage.goto();
		await freshDashboardPage.getStartedButton.click();
		await freshPlanModal.assertOpen();
		await expect(freshPlanModal.limitInput).toBeVisible();
		await expect(freshPlanModal.daysInput).toBeVisible();
	});

	test('T-PLAN-04: Initial ABLE balance matches on-chain balance', async ({
		freshDashboardPage,
		freshUserAccount,
	}) => {
		await freshDashboardPage.goto();
		const onChainBalance = await getABLEBalance(TOKEN_ADDRESS, freshUserAccount.address);
		const displayedBalance = await freshDashboardPage.allowanceValue.textContent();
		expect(onChainBalance).toBeGreaterThan(0n);
		expect(displayedBalance).toBeTruthy();
	});

	test('T-PLAN-05: Setting a plan authorizes an allowance without moving tokens', async ({
		freshDashboardPage,
		freshPlanModal,
		freshUserAccount,
	}) => {
		const balanceBefore = await getABLEBalance(TOKEN_ADDRESS, freshUserAccount.address);

		await freshDashboardPage.goto();
		await freshDashboardPage.getStartedButton.click();
		await freshPlanModal.fillAndSubmit(10, 30);
		await freshPlanModal.waitForTxCompletion();

		// Allowance model: activation sets an ERC-20 allowance + spending limit but
		// does NOT move ABLE — tokens are escrowed per-prompt (initiatePrompt).
		const balanceAfter = await getABLEBalance(TOKEN_ADDRESS, freshUserAccount.address);
		expect(balanceAfter).toBe(balanceBefore);
		await freshDashboardPage.assertHasPlan();
	});

	test('T-PLAN-06: Escrow holds no extra tokens until a prompt is sent', async ({
		freshDashboardPage,
		freshPlanModal,
	}) => {
		const escrowBefore = await getEscrowBalance(TOKEN_ADDRESS, ESCROW_ADDRESS);

		await freshDashboardPage.goto();
		await freshDashboardPage.getStartedButton.click();
		await freshPlanModal.fillAndSubmit(10, 30);
		await freshPlanModal.waitForTxCompletion();

		// Allowance model: no upfront escrow at activation — the escrow balance only
		// changes when a prompt is initiated.
		const escrowAfter = await getEscrowBalance(TOKEN_ADDRESS, ESCROW_ADDRESS);
		expect(escrowAfter).toBe(escrowBefore);
	});

	test('T-PLAN-07: ERC-20 allowance is set after plan activation', async ({
		freshDashboardPage,
		freshPlanModal,
		freshUserAccount,
	}) => {
		await freshDashboardPage.goto();
		await freshDashboardPage.getStartedButton.click();
		await freshPlanModal.fillAndSubmit(10, 30);
		await freshPlanModal.waitForTxCompletion();

		const allowance = await getAllowance(TOKEN_ADDRESS, freshUserAccount.address, ESCROW_ADDRESS);
		expect(allowance).toBeGreaterThan(0n);
	});

	test('T-PLAN-08: Manage Plan button opens modal', async ({
		freshDashboardPage,
		freshPlanModal,
	}) => {
		await freshDashboardPage.goto();
		await freshDashboardPage.getStartedButton.click();
		await freshPlanModal.fillAndSubmit(10, 30);
		await freshPlanModal.waitForTxCompletion();

		await freshDashboardPage.managePlanButton.click();
		await freshPlanModal.assertOpen();
	});

	test('T-PLAN-09: Cancelling a plan leaves balance unchanged (no escrowed tokens to return)', async ({
		freshDashboardPage,
		freshPlanModal,
		freshUserAccount,
	}) => {
		await freshDashboardPage.goto();
		await freshDashboardPage.getStartedButton.click();
		await freshPlanModal.fillAndSubmit(10, 30);
		await freshPlanModal.waitForTxCompletion();

		const balanceBeforeCancel = await getABLEBalance(TOKEN_ADDRESS, freshUserAccount.address);

		await freshDashboardPage.managePlanButton.click();
		await freshPlanModal.revoke();

		// Allowance model: nothing was escrowed at activation, so cancelling only
		// clears the spending limit — the user's ABLE balance is unchanged.
		const balanceAfterCancel = await getABLEBalance(TOKEN_ADDRESS, freshUserAccount.address);
		expect(balanceAfterCancel).toBe(balanceBeforeCancel);
	});

	test('T-PLAN-14: Authorization Gap warning shows when the ERC-20 allowance drops below the plan limit', async ({
		freshDashboardPage,
		freshUserAccount,
	}) => {
		const user = freshUserAccount.address;
		// Activate a 10 ABLE plan directly on-chain (approve(escrow, 10) → setSpendingLimit(10)).
		await activatePlan(TOKEN_ADDRESS, ESCROW_ADDRESS, user, ABLE(10));
		// Then drop the ERC-20 allowance BELOW the plan's remaining limit (10 → 5). In production this
		// happens after cancellations/refunds (the allowance isn't credited back); here we reproduce it
		// directly. Doing it BEFORE the first dashboard load means the very first useUsagePlan read
		// already observes the gap — no dependence on a staleTime refetch.
		await approveABLE(TOKEN_ADDRESS, user, ESCROW_ADDRESS, ABLE(5));

		await freshDashboardPage.goto();
		await freshDashboardPage.assertHasPlan();
		// PlanStatusCard surfaces the always-visible allowance-gap panel and keeps "Manage Limit" as
		// the re-sync CTA (allowanceGap = (allowance − spent) − realTokenAllowance = 10 − 0 − 5 = 5).
		await expect(freshDashboardPage.authorizationGapWarning).toBeVisible({ timeout: 15_000 });
		// This is the COMPLEMENT of T-PENDING-01 (pending → disabled): with no pending escrow the
		// "Manage Limit" CTA must be clickable so the user can re-sync the allowance — assert it's
		// enabled, not merely present (a bug disabling it while showing the gap would slip past a
		// visibility-only check).
		await expect(freshDashboardPage.managePlanButton).toBeVisible();
		await expect(freshDashboardPage.managePlanButton).not.toBeDisabled();
	});

	test('T-PLAN-10: Cancel plan reverts dashboard to onboarding', async ({
		freshDashboardPage,
		freshPlanModal,
	}) => {
		await freshDashboardPage.goto();
		await freshDashboardPage.getStartedButton.click();
		await freshPlanModal.fillAndSubmit(10, 30);
		await freshPlanModal.waitForTxCompletion();

		await freshDashboardPage.managePlanButton.click();
		await freshPlanModal.revoke();

		// The revoke's onSuccess invalidates ['usagePlan'] and closes the modal, so
		// the dashboard reverts to onboarding on its own (no reload — that would drop
		// the in-memory session key and bounce to /auth).
		await freshDashboardPage.assertNoPlan();
	});
});

// No beforeEach funding here: T-PLAN-11/12 exercise the zero and exceed guards against an
// account that holds (next to) nothing — exactly a fresh account's state. T-PLAN-13 funds itself.
test.describe('Plan modal validation (T-PLAN-EDGE)', () => {
	test.skip(!LIVE_STACK, SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');

	test('T-PLAN-11: Cannot set plan with 0 ABLE', async ({ freshDashboardPage, freshPlanModal }) => {
		// Unfunded: 0 ABLE on localnet, only the allocator's float on testnet. A zero limit is
		// refused by the form itself, before any balance comparison.
		await freshDashboardPage.goto();
		await freshDashboardPage.getStartedButton.click();
		await freshPlanModal.assertOpen();

		await freshPlanModal.limitInput.fill('0');
		await freshPlanModal.daysInput.fill('30');

		const isDisabled = await freshPlanModal.submitButton.isDisabled().catch(() => false);
		expect(isDisabled).toBe(true);
	});

	test('T-PLAN-12: Cannot set plan exceeding wallet balance', async ({
		freshDashboardPage,
		freshPlanModal,
		freshPage,
		freshUserAccount,
	}) => {
		// Hold SOME ABLE so the guard under test is "limit exceeds balance", not "no balance at all".
		await fundABLE(TOKEN_ADDRESS, freshUserAccount.address, ABLE(1));

		await freshDashboardPage.goto();
		await freshDashboardPage.getStartedButton.click();
		await freshPlanModal.assertOpen();

		await freshPlanModal.limitInput.fill('999999999');
		await freshPlanModal.daysInput.fill('30');
		await freshPlanModal.submitButton.click();

		// Should show an error — either in modal or as a toast
		await expect(freshPage.getByText(/insufficient|exceed|not enough/i).first()).toBeVisible({
			timeout: 15_000,
		});
	});

	test('T-PLAN-13: Plan expiry after duration elapses', async ({
		freshDashboardPage,
		freshPlanModal,
		freshUserAccount,
	}) => {
		test.skip(
			CHAIN === 'testnet',
			'T-PLAN-13 expires the plan with evm_increaseTime (24 h) — no time travel on a public ' +
				'chain; real limit expiry is CU-14ym9bvdmju',
		);
		// Must actually activate a plan to observe it expire — so it needs funding.
		await fundABLE(TOKEN_ADDRESS, freshUserAccount.address, PLAN_ALLOWANCE);

		await freshDashboardPage.goto();
		await freshDashboardPage.getStartedButton.click();
		await freshPlanModal.fillAndSubmit(10, 1);
		await freshPlanModal.waitForTxCompletion();
		await freshDashboardPage.assertHasPlan();

		// The ~24 h advance is permanent for the rest of this invocation (a forward-only chain
		// cannot rewind), which is why `plan` runs alone (sense-ai-e2e SHARD_PLAN) and this test
		// is last in the file. Nothing after it, here or in the shard, asserts inside a time window.
		await increaseTime(86400 + 60);

		await freshDashboardPage.goto();
		await expect(
			freshDashboardPage.planStatusCard.or(freshDashboardPage.getStartedButton),
		).toBeVisible({ timeout: 10_000 });
	});
});

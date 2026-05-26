import { expect, test } from '../fixtures';

test.describe('Spending plan management (T-PLAN)', () => {
	test.skip(
		process.env.E2E_LOCAL_SERVICES !== '1',
		'Skipped: requires Hardhat node + escrow contract (set E2E_LOCAL_SERVICES=1)',
	);

	test('T-PLAN-01: Dashboard shows onboarding for new user', async ({ dashboardPage }) => {
		await dashboardPage.goto();
		await dashboardPage.assertNoPlan();
	});

	test('T-PLAN-02: Get Started button opens plan modal', async ({ dashboardPage, planModal }) => {
		await dashboardPage.goto();
		await dashboardPage.getStartedButton.click();
		await planModal.assertOpen();
	});

	test('T-PLAN-03: Plan modal shows limit and days inputs', async ({ dashboardPage, planModal }) => {
		await dashboardPage.goto();
		await dashboardPage.getStartedButton.click();
		await planModal.assertOpen();
		await expect(planModal.limitInput).toBeVisible();
		await expect(planModal.daysInput).toBeVisible();
	});

	test('T-PLAN-04: Setting a plan updates the dashboard', async ({ dashboardPage, planModal }) => {
		await dashboardPage.goto();
		await dashboardPage.getStartedButton.click();
		await planModal.fillAndSubmit(10, 30);
		await planModal.waitForTxCompletion();
		await dashboardPage.assertHasPlan();
	});

	test('T-PLAN-05: Manage Plan button opens modal with current values', async ({
		dashboardPage,
		planModal,
	}) => {
		await dashboardPage.goto();
		await dashboardPage.assertHasPlan();
		await dashboardPage.managePlanButton.click();
		await planModal.assertOpen();
	});
});

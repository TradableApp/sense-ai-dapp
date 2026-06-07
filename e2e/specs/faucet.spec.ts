import { expect, test } from '../fixtures';
import { TEST_ACCOUNT } from '../fixtures/mock-wallet';
import { getABLEBalance, revertToSnapshot, takeSnapshot } from '../helpers/hardhat';

const TOKEN_ADDRESS = process.env.VITE_TOKEN_CONTRACT_ADDRESS ?? '';
const ESCROW_ADDRESS = process.env.VITE_ESCROW_CONTRACT_ADDRESS ?? '';
const SKIP_REASON =
	'Skipped: requires Hardhat node + deployed contracts (set E2E_LOCAL_SERVICES=1)';

const ABLE = (n: bigint) => 10n ** 18n * n;

test.describe('Localnet faucet (T-FAUCET)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');

	let snapshotId: string;

	test.beforeEach(async () => {
		// No funding here on purpose: the faucet only appears when the entered limit
		// exceeds the wallet balance, so the user must start under-funded.
		snapshotId = await takeSnapshot();
	});

	test.afterEach(async () => {
		await revertToSnapshot(snapshotId);
	});

	test('T-FAUCET-01: faucet funds the user from the localnet treasury without hitting the cloud function', async ({
		dashboardPage,
		planModal,
		authenticatedPage,
	}) => {
		const balanceBefore = await getABLEBalance(TOKEN_ADDRESS, TEST_ACCOUNT.address);
		// This test asserts the faucet ADDS 100 ABLE, so require an under-funded start.
		expect(balanceBefore).toBeLessThan(ABLE(100n));

		// Reveal the faucet: open the plan modal and request a limit above balance.
		await dashboardPage.goto();
		await dashboardPage.getStartedButton.click();
		await planModal.assertOpen();
		await planModal.limitInput.fill('1000');
		await planModal.daysInput.fill('30');
		await expect(planModal.faucetButton).toBeVisible({ timeout: 10_000 });

		// Fail loudly if the dApp tries the testnet Firebase callable on localnet —
		// Option 1 must fund locally and never touch the cloud function.
		let cloudFnHit = false;
		const flagCloud = (route: import('@playwright/test').Route) => {
			cloudFnHit = true;
			return route.abort();
		};
		await authenticatedPage.route('**/requestTestTokens**', flagCloud);
		await authenticatedPage.route('**cloudfunctions.net/**', flagCloud);

		await planModal.faucetButton.click();

		// The component polls the receipt then shows "Tokens Received".
		await expect(authenticatedPage.getByText(/tokens received/i)).toBeVisible({
			timeout: 30_000,
		});

		const balanceAfter = await getABLEBalance(TOKEN_ADDRESS, TEST_ACCOUNT.address);
		expect(balanceAfter).toBe(balanceBefore + ABLE(100n));
		expect(cloudFnHit).toBe(false);
	});
});

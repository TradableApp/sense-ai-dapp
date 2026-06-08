import { expect, test } from '../fixtures';
import { TEST_ACCOUNT } from '../fixtures/mock-wallet';
import { getABLEBalance, revertToSnapshot, takeSnapshot } from '../helpers/hardhat';

const TOKEN_ADDRESS = process.env.VITE_TOKEN_CONTRACT_ADDRESS ?? '';
const SKIP_REASON =
	'Skipped: requires Hardhat node + deployed contracts (set E2E_LOCAL_SERVICES=1)';

const ABLE = (n: bigint) => 10n ** 18n * n;

test.describe('Localnet faucet (T-FAUCET)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);
	test.skip(!TOKEN_ADDRESS, 'Skipped: VITE_TOKEN_CONTRACT_ADDRESS not set');

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
		// The user must start unfunded so the faucet button appears and the delta below
		// reflects exactly what the faucet dispensed — independent of the (adjustable)
		// configured amount.
		expect(balanceBefore).toBe(0n);

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

		// The component polls the receipt then shows "Tokens Received" with the
		// dispensed amount in the description (adjustable via Firestore config, so we
		// read it rather than hardcoding it).
		await expect(authenticatedPage.getByText(/tokens received/i)).toBeVisible({
			timeout: 30_000,
		});
		const receivedText =
			(await authenticatedPage.getByText(/ABLE tokens have been added/i).textContent()) ?? '';
		const reported = BigInt(receivedText.match(/(\d+)\s+ABLE/i)?.[1] ?? '0');
		expect(reported).toBeGreaterThan(0n);

		// On-chain truth: the balance rose by exactly what the UI reported.
		const balanceAfter = await getABLEBalance(TOKEN_ADDRESS, TEST_ACCOUNT.address);
		expect(balanceAfter - balanceBefore).toBe(ABLE(reported));
		expect(cloudFnHit).toBe(false);
	});
});

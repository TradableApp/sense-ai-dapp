import { expect, test } from '../fixtures';
import { ABLE, TOKEN_ADDRESS } from '../helpers/contracts';
import { fundABLE, getABLEBalance } from '../helpers/hardhat';

const SKIP_REASON =
	'Skipped: requires Hardhat node + deployed contracts (set E2E_LOCAL_SERVICES=1)';

test.describe('Localnet faucet (T-FAUCET)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);
	test.skip(!TOKEN_ADDRESS, 'Skipped: VITE_TOKEN_CONTRACT_ADDRESS not set');

	// ADR-0002: a fresh account per test instead of snapshot/revert. `evm_revert` wedges
	// graph-node's block ingestor and freezes the subgraph for the REST of the invocation,
	// so even though this spec reads nothing indexed, its reverts previously broke the
	// cost/cancel/versions specs that run after it (CU-86d3uqgh7).
	//
	// No funding hook on purpose, and none needed: the faucet only appears when the entered
	// limit exceeds the wallet balance, so the user must start under-funded — and a freshly
	// claimed account holds 0 ABLE by construction (enableFreshAccount provisions ETH and
	// impersonation, never ABLE). That is exactly what the snapshot was resetting to.

	test('T-FAUCET-01: faucet funds the user from the localnet treasury without hitting the cloud function', async ({
		freshDashboardPage,
		freshPlanModal,
		freshPage,
		freshUserAccount,
	}) => {
		const balanceBefore = await getABLEBalance(TOKEN_ADDRESS, freshUserAccount.address);
		// The user must start unfunded so the faucet button appears and the delta below
		// reflects exactly what the faucet dispensed — independent of the (adjustable)
		// configured amount.
		expect(balanceBefore).toBe(0n);

		// Reveal the faucet: open the plan modal and request a limit above balance.
		await freshDashboardPage.goto();
		await freshDashboardPage.getStartedButton.click();
		await freshPlanModal.assertOpen();
		await freshPlanModal.limitInput.fill('1000');
		await freshPlanModal.daysInput.fill('30');
		await expect(freshPlanModal.faucetButton).toBeVisible({ timeout: 10_000 });

		// Fail loudly if the dApp tries the testnet Firebase callable on localnet —
		// Option 1 must fund locally and never touch the cloud function.
		let cloudFnHit = false;
		const flagCloud = (route: import('@playwright/test').Route) => {
			cloudFnHit = true;
			return route.abort();
		};
		await freshPage.route('**/requestTestTokens**', flagCloud);
		await freshPage.route('**cloudfunctions.net/**', flagCloud);

		await freshPlanModal.faucetButton.click();

		// The component polls the receipt then shows "Tokens Received" with the
		// dispensed amount in the description (adjustable via Firestore config, so we
		// read it rather than hardcoding it).
		await expect(freshPage.getByText(/tokens received/i)).toBeVisible({
			timeout: 30_000,
		});
		const receivedText =
			(await freshPage.getByText(/ABLE tokens have been added/i).textContent()) ?? '';
		const reported = BigInt(receivedText.match(/(\d+)\s+ABLE/i)?.[1] ?? '0');
		expect(reported).toBeGreaterThan(0n);

		// On-chain truth: the balance rose by exactly what the UI reported.
		const balanceAfter = await getABLEBalance(TOKEN_ADDRESS, freshUserAccount.address);
		expect(balanceAfter - balanceBefore).toBe(ABLE(reported));
		expect(cloudFnHit).toBe(false);
	});

	test('T-FAUCET-02: faucet tops up a user who already holds some ABLE', async ({
		freshDashboardPage,
		freshPlanModal,
		freshPage,
		freshUserAccount,
	}) => {
		// The faucet is gated on "requested limit > wallet balance", NOT "balance == 0".
		// Seed a non-zero balance below the requested limit so the faucet still appears
		// and tops the user up — the has-some-ABLE branch that T-FAUCET-01 doesn't cover.
		const seed = ABLE(50n);
		await fundABLE(TOKEN_ADDRESS, freshUserAccount.address, seed);
		const balanceBefore = await getABLEBalance(TOKEN_ADDRESS, freshUserAccount.address);
		expect(balanceBefore).toBe(seed);

		await freshDashboardPage.goto();
		await freshDashboardPage.getStartedButton.click();
		await freshPlanModal.assertOpen();
		await freshPlanModal.limitInput.fill('1000');
		await freshPlanModal.daysInput.fill('30');
		await expect(freshPlanModal.faucetButton).toBeVisible({ timeout: 10_000 });
		await freshPlanModal.faucetButton.click();

		await expect(freshPage.getByText(/tokens received/i)).toBeVisible({ timeout: 30_000 });
		// The seeded balance was topped up (not reset) — it strictly increased.
		const balanceAfter = await getABLEBalance(TOKEN_ADDRESS, freshUserAccount.address);
		expect(balanceAfter).toBeGreaterThan(balanceBefore);
	});
});

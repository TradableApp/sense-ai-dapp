import { expect, test } from '../fixtures';
import { TEST_ACCOUNT } from '../fixtures/mock-wallet';
import { getABLEBalance, increaseTime, revertToSnapshot, takeSnapshot } from '../helpers/hardhat';

const TOKEN_ADDRESS = process.env.VITE_TOKEN_CONTRACT_ADDRESS ?? '';
const REFUND_TIMEOUT_S = 3600; // 1 hour — matches EVMAIAgentEscrow constant
const SKIP_REASON =
	'Skipped: requires Hardhat node + escrow contract + oracle (set E2E_LOCAL_SERVICES=1)';

test.describe('Refunds — cancellation flow (T-REFUND)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);
	test.skip(!TOKEN_ADDRESS, 'Skipped: VITE_TOKEN_CONTRACT_ADDRESS not set');

	let snapshotId: string;

	test.beforeEach(async () => {
		snapshotId = await takeSnapshot();
	});

	test.afterEach(async () => {
		await revertToSnapshot(snapshotId);
	});

	test('T-REFUND-01: Cancel button appears during pending prompt', async ({ chatPage }) => {
		await chatPage.goto();
		await chatPage.sendPrompt('Test cancellation flow');
		await expect(chatPage.cancelButton).toBeVisible({ timeout: 10_000 });
	});

	test('T-REFUND-02: Clicking cancel marks prompt as cancelled', async ({
		chatPage,
		authenticatedPage,
	}) => {
		await chatPage.goto();
		await chatPage.sendPrompt('Test cancel action');
		await expect(chatPage.cancelButton).toBeVisible({ timeout: 10_000 });
		await chatPage.cancelButton.click();

		await expect(authenticatedPage.getByText(/cancelled|canceled/i).first()).toBeVisible({
			timeout: 15_000,
		});
	});

	test('T-REFUND-03: Refund button appears after 1hr timeout', async ({
		chatPage,
		authenticatedPage,
	}) => {
		await chatPage.goto();
		// A dropped prompt is never answered, so it stays genuinely pending past the refund
		// window — without it the oracle answers within seconds and finalises the job, making
		// the prompt no longer refundable (a race).
		await chatPage.sendDroppedPrompt('Test refund timeout');
		await expect(chatPage.cancelButton).toBeVisible({ timeout: 10_000 });

		// Advance EVM time past the refund timeout
		await increaseTime(REFUND_TIMEOUT_S + 60);

		// Reload to trigger stuck request detection
		await authenticatedPage.reload();
		await authenticatedPage.waitForLoadState('networkidle');

		await expect(
			authenticatedPage.getByRole('button', { name: /refund|claim/i }).first(),
		).toBeVisible({ timeout: 15_000 });
	});

	test('T-REFUND-04: Claiming refund returns ABLE tokens to wallet', async ({
		chatPage,
		authenticatedPage,
	}) => {
		const balanceBefore = await getABLEBalance(TOKEN_ADDRESS, TEST_ACCOUNT.address);

		await chatPage.goto();
		// Dropped → never answered → stays pending past the refund window (see T-REFUND-03).
		await chatPage.sendDroppedPrompt('Test refund claim');
		await expect(chatPage.cancelButton).toBeVisible({ timeout: 10_000 });

		await increaseTime(REFUND_TIMEOUT_S + 60);
		await authenticatedPage.reload();
		await authenticatedPage.waitForLoadState('networkidle');

		const refundButton = authenticatedPage.getByRole('button', { name: /refund|claim/i }).first();
		await expect(refundButton).toBeVisible({ timeout: 15_000 });
		await refundButton.click();

		// Wait for transaction to complete
		await expect(refundButton).not.toBeVisible({ timeout: 30_000 });

		const balanceAfter = await getABLEBalance(TOKEN_ADDRESS, TEST_ACCOUNT.address);
		expect(balanceAfter).toBeGreaterThan(balanceBefore);
	});

	test('T-REFUND-05: Already-answered prompts cannot be refunded', async ({
		chatPage,
		authenticatedPage,
	}) => {
		await chatPage.goto();
		await chatPage.sendPromptAndWaitForResponse('Test no-refund on answered');

		// Answered prompts should not show a refund button
		await expect(
			authenticatedPage.getByRole('button', { name: /refund|claim/i }).first(),
		).not.toBeVisible({ timeout: 5_000 });
	});

	test('T-REFUND-06: Already-refunded prompts show refunded status', async ({
		chatPage,
		authenticatedPage,
	}) => {
		await chatPage.goto();
		// Dropped → never answered → stays pending past the refund window (see T-REFUND-03).
		await chatPage.sendDroppedPrompt('Test refunded status display');
		await expect(chatPage.cancelButton).toBeVisible({ timeout: 10_000 });

		await increaseTime(REFUND_TIMEOUT_S + 60);
		await authenticatedPage.reload();
		await authenticatedPage.waitForLoadState('networkidle');

		const refundButton = authenticatedPage.getByRole('button', { name: /refund|claim/i }).first();
		await expect(refundButton).toBeVisible({ timeout: 15_000 });
		await refundButton.click();
		await expect(refundButton).not.toBeVisible({ timeout: 30_000 });

		// Should show refunded status indicator
		await expect(authenticatedPage.getByText(/refunded/i).first()).toBeVisible({ timeout: 10_000 });
	});
});

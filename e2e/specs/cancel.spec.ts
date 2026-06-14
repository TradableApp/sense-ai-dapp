import { expect, test } from '../fixtures';
import { getPromptRequests, waitForGraph } from '../helpers/graph';
import { activatePlan, fundABLE } from '../helpers/hardhat';

const TOKEN_ADDRESS = process.env.VITE_TOKEN_CONTRACT_ADDRESS ?? '';
const ESCROW_ADDRESS = process.env.VITE_ESCROW_CONTRACT_ADDRESS ?? '';
const SKIP_REASON =
	'Skipped: requires Hardhat node + oracle + Graph node (set E2E_LOCAL_SERVICES=1)';

const PLAN_ALLOWANCE = 10n ** 18n * 100n; // 100 ABLE
// Hold the answer pending well past the 3s cancel window so the cancel always wins the
// race with the oracle (the oracle's post-delay isJobFinalized re-check then drops the
// answer), and the pending state stays stable for assertions.
const HOLD_MS = 8000;

async function fundAndActivatePlan(address: string): Promise<void> {
	await fundABLE(TOKEN_ADDRESS, address, PLAN_ALLOWANCE);
	await activatePlan(TOKEN_ADDRESS, ESCROW_ADDRESS, address, PLAN_ALLOWANCE);
}

// Cancel a pending prompt + concurrency. Submitting a 2nd prompt while one is pending is
// PREVENTED by design (the composer swaps Send→Cancel while isAiThinking); cancelling is
// only allowed in the 3s CANCELLATION_TIMEOUT window. Uses the oracle's mock delay
// sentinel to hold the answer pending deterministically. Fresh per-test users; serial.
test.describe('Cancel — pending prompt + concurrency (T-CANCEL)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');

	test.beforeEach(async ({ freshUserAccount }) => {
		await fundAndActivatePlan(freshUserAccount.address);
	});

	test('T-CANCEL-01: cancelling a pending prompt marks it cancelled (index + dApp), no answer lands', async ({
		freshChatPage,
		freshUserAccount,
	}) => {
		const owner = freshUserAccount.address;
		await freshChatPage.goto();
		await freshChatPage.sendDelayedPrompt('Please hold this one', HOLD_MS);

		await freshChatPage.cancelPendingPrompt();

		// dApp: the prompt shows a cancelled status.
		await expect(freshChatPage.cancelledStatus).toBeVisible({ timeout: 15_000 });

		// Indexing: the prompt request is flagged cancelled on-chain → subgraph.
		await waitForGraph(
			() => getPromptRequests(owner),
			reqs => reqs.some(r => r.isCancelled),
			{ label: 'PromptRequest.isCancelled' },
		);

		// The held answer must NOT arrive — a cancelled answer has no content, so no
		// assistant bubble ever renders (well past the 8s hold).
		await freshChatPage.page.waitForTimeout(HOLD_MS);
		await expect(freshChatPage.assistantMessages).toHaveCount(0);
	});

	test('T-CANCEL-02: a second prompt cannot be submitted while one is pending', async ({
		freshChatPage,
	}) => {
		await freshChatPage.goto();
		await freshChatPage.sendDelayedPrompt('Keep me pending', HOLD_MS);

		// While pending the composer shows Cancel, not Send — there is no submit
		// affordance, so a concurrent prompt cannot be sent.
		await expect(freshChatPage.cancelButton).toBeVisible({ timeout: 30_000 });
		await expect(freshChatPage.submitButton).toHaveCount(0);

		// Cleanup: cancel so the test leaves no in-flight job.
		await freshChatPage.cancelPendingPrompt();
		await expect(freshChatPage.cancelledStatus).toBeVisible({ timeout: 15_000 });
	});

	test('T-CANCEL-03: after cancelling, the user can send a new prompt that is answered', async ({
		freshChatPage,
		freshUserAccount,
	}) => {
		const owner = freshUserAccount.address;
		await freshChatPage.goto();

		// Cancel the first prompt.
		await freshChatPage.sendDelayedPrompt('Cancel me first', HOLD_MS);
		await freshChatPage.cancelPendingPrompt();
		await expect(freshChatPage.cancelledStatus).toBeVisible({ timeout: 15_000 });

		// The composer re-enables (isAiThinking cleared) → Send returns.
		await expect(freshChatPage.submitButton).toBeVisible({ timeout: 15_000 });

		// A fresh prompt (no hold) completes the full round-trip.
		await freshChatPage.sendPromptAndWaitForResponse('Now please answer this');
		await expect(freshChatPage.assistantMessages).toHaveCount(1);

		// Indexing: exactly one cancelled and one answered prompt request.
		await waitForGraph(
			() => getPromptRequests(owner),
			reqs => reqs.some(r => r.isCancelled) && reqs.some(r => r.isAnswered),
			{ label: 'one cancelled + one answered PromptRequest' },
		);
	});

	test('T-CANCEL-04: cancel is offered only within the 3s CANCELLATION_TIMEOUT window', async ({
		freshChatPage,
	}) => {
		await freshChatPage.goto();
		await freshChatPage.sendDelayedPrompt('Watch the cancel window', HOLD_MS);

		// Enabled during the countdown ("Cancel (Ns)")…
		await expect(freshChatPage.cancelButton).toBeEnabled({ timeout: 30_000 });
		// …then disabled once the 3s window closes (the answer is still pending via the hold).
		await expect(freshChatPage.cancelButton).toBeDisabled({ timeout: 10_000 });
	});
});

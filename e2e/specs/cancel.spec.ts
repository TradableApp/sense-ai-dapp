import { expect, test } from '../fixtures';
import { getPromptRequests, waitForGraph } from '../helpers/graph';
import { activatePlan, fundABLE, increaseTime } from '../helpers/hardhat';

const TOKEN_ADDRESS = process.env.VITE_TOKEN_CONTRACT_ADDRESS ?? '';
const ESCROW_ADDRESS = process.env.VITE_ESCROW_CONTRACT_ADDRESS ?? '';
const SKIP_REASON =
	'Skipped: requires Hardhat node + oracle + Graph node (set E2E_LOCAL_SERVICES=1)';

const PLAN_ALLOWANCE = 10n ** 18n * 100n; // 100 ABLE
// Hold the answer pending well past the cancel window so the cancel always wins the race
// with the oracle (the oracle's post-delay isJobFinalized re-check then drops the answer).
const HOLD_MS = 8000;
// On-chain, cancelPrompt reverts (PromptNotCancellableYet) until `createdAt +
// CANCELLATION_TIMEOUT` (3s). On a real chain block time advances naturally between the
// submit and the cancel tx; on localnet (auto-mine, frozen between txs) we must advance
// EVM time past the window so the cancel can land — mirroring real-chain progression.
const CANCELLATION_TIMEOUT_S = 3;

async function fundAndActivatePlan(address: string): Promise<void> {
	await fundABLE(TOKEN_ADDRESS, address, PLAN_ALLOWANCE);
	await activatePlan(TOKEN_ADDRESS, ESCROW_ADDRESS, address, PLAN_ALLOWANCE);
}

// Cancel a pending prompt + concurrency. A 2nd prompt cannot be submitted while one is
// pending (the composer swaps Send→Cancel while isAiThinking). Cancelling debits a
// cancellation fee, refunds the prompt fee, flags PromptRequest.isCancelled, and the dApp
// drops the pending message so the composer frees up. Uses the oracle mock-delay sentinel
// to hold the answer pending deterministically. Fresh per-test users; serial.
test.describe('Cancel — pending prompt + concurrency (T-CANCEL)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');

	test.beforeEach(async ({ freshUserAccount }) => {
		await fundAndActivatePlan(freshUserAccount.address);
	});

	test('T-CANCEL-01: cancelling a pending prompt flags it cancelled (index + dApp), no answer lands', async ({
		freshChatPage,
		freshUserAccount,
	}) => {
		// FIXME(CU-86d3bawhh): blocked by a graph-node↔Hardhat infra bug — the subgraph's
		// handlePromptCancelled makes an eth_call to cancellationFee() and graph-node sends
		// both `input` and `data`, which the Hardhat RPC rejects ("duplicate field data"),
		// so the subgraph STALLS on any cancellation and PromptRequest.isCancelled never
		// indexes. The cancel itself works (oracle skips the answer, tokens refunded). Un-skip
		// once the subgraph reads cancellationFee from FeeConfig instead of an eth_call.
		test.fixme();
		const owner = freshUserAccount.address;
		await freshChatPage.goto();
		await freshChatPage.sendDelayedPrompt('Please hold this one', HOLD_MS);

		// Prompt is pending (createdAt now set on-chain) → cancel affordance appears…
		await expect(freshChatPage.cancelButton).toBeVisible({ timeout: 30_000 });
		// …advance past the on-chain cancellation window, then cancel within the UI window.
		await increaseTime(CANCELLATION_TIMEOUT_S + 1);
		await freshChatPage.cancelButton.click();

		// Indexing: the prompt request is flagged cancelled on-chain → subgraph.
		await waitForGraph(
			() => getPromptRequests(owner),
			reqs => reqs.some(r => r.isCancelled),
			{ label: 'PromptRequest.isCancelled' },
		);

		// dApp: the pending message is dropped → the composer frees up (Send returns).
		await expect(freshChatPage.submitButton).toBeVisible({ timeout: 15_000 });

		// The held answer must NOT arrive — the oracle's post-delay re-check drops it.
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
		await increaseTime(CANCELLATION_TIMEOUT_S + 1);
		await freshChatPage.cancelButton.click();
		await expect(freshChatPage.submitButton).toBeVisible({ timeout: 15_000 });
	});

	test('T-CANCEL-03: after cancelling, the user can send a new prompt that is answered', async ({
		freshChatPage,
		freshUserAccount,
	}) => {
		// FIXME(CU-86d3bawhh): same graph-node↔Hardhat stall as T-CANCEL-01 — once a cancel
		// halts the subgraph, the resend's answer is never indexed so it can't render. The
		// composer-frees-up part of this flow IS fixed/validated (see the dApp fixes in this
		// PR); un-skip once the subgraph cancellationFee eth_call is removed. (Also needs the
		// "tokens refunded" toast to clear before the resend click — minor.)
		test.fixme();
		const owner = freshUserAccount.address;
		await freshChatPage.goto();

		// Cancel the first prompt.
		await freshChatPage.sendDelayedPrompt('Hold then drop this one', HOLD_MS);
		await expect(freshChatPage.cancelButton).toBeVisible({ timeout: 30_000 });
		await increaseTime(CANCELLATION_TIMEOUT_S + 1);
		await freshChatPage.cancelButton.click();

		// The composer re-enables (isAiThinking cleared) → Send returns.
		await expect(freshChatPage.submitButton).toBeVisible({ timeout: 15_000 });

		// A fresh prompt (no hold) completes the full round-trip.
		await freshChatPage.sendPromptAndWaitForResponse('Now please answer this');
		await expect(freshChatPage.assistantMessages).toHaveCount(1);

		// Indexing: one cancelled and one answered prompt request.
		await waitForGraph(
			() => getPromptRequests(owner),
			reqs => reqs.some(r => r.isCancelled) && reqs.some(r => r.isAnswered),
			{ label: 'one cancelled + one answered PromptRequest' },
		);
	});

	test('T-CANCEL-04: the cancel affordance follows the 3s CANCELLATION_TIMEOUT countdown', async ({
		freshChatPage,
	}) => {
		await freshChatPage.goto();
		await freshChatPage.sendDelayedPrompt('Hold for the timeout check', HOLD_MS);

		// Enabled during the countdown ("Cancel (Ns)")…
		await expect(freshChatPage.cancelButton).toBeEnabled({ timeout: 30_000 });
		// …then disabled once the 3s countdown elapses (answer still held pending).
		await expect(freshChatPage.cancelButton).toBeDisabled({ timeout: 10_000 });
	});
});

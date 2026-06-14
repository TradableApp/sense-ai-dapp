import { expect, test } from '../fixtures';
import { getPromptRequests, waitForGraph } from '../helpers/graph';
import { activatePlan, fundABLE, getABLEBalance, increaseTime, processRefund } from '../helpers/hardhat';

const TOKEN_ADDRESS = process.env.VITE_TOKEN_CONTRACT_ADDRESS ?? '';
const ESCROW_ADDRESS = process.env.VITE_ESCROW_CONTRACT_ADDRESS ?? '';
const REFUND_TIMEOUT_S = 3600; // 1 hour — matches EVMAIAgentEscrow REFUND_TIMEOUT
const PLAN_ALLOWANCE = 10n ** 18n * 100n; // 100 ABLE
const SKIP_REASON =
	'Skipped: requires Hardhat node + escrow contract + oracle + Graph node (set E2E_LOCAL_SERVICES=1)';

const isPending = (r: { isAnswered: boolean; isCancelled: boolean; isRefunded: boolean }): boolean =>
	!r.isAnswered && !r.isCancelled && !r.isRefunded;

// Stuck-prompt refund (T-REFUND). A prompt the mock oracle never answers (via the
// __E2E_DROP__ sentinel) stays pending on-chain forever; after REFUND_TIMEOUT the user can
// reclaim the escrowed fee with processRefund. Full cross-layer: the dApp shows it pending,
// the escrow holds the fee, processRefund returns it, and the subgraph flips isRefunded.
//
// NOTE: the dApp's in-app refund affordance is wall-clock-gated (it compares Date.now() to the
// prompt's createdAt + REFUND_TIMEOUT), which evm_increaseTime can't move — testing that button
// needs Playwright's page.clock and is tracked separately. These tests drive the on-chain claim
// (the contract gate IS block-time based) and verify the indexed result.
//
// Fresh per-test users; serial (localnet shares one Hardhat node + global EVM time).
test.describe('Refunds — stuck-prompt refund (T-REFUND)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');

	test.beforeEach(async ({ freshUserAccount }) => {
		await fundABLE(TOKEN_ADDRESS, freshUserAccount.address, PLAN_ALLOWANCE);
		await activatePlan(TOKEN_ADDRESS, ESCROW_ADDRESS, freshUserAccount.address, PLAN_ALLOWANCE);
	});

	test('T-REFUND-01: a stuck prompt is refundable after the timeout — fee returned + indexed', async ({
		freshChatPage,
		freshUserAccount,
	}) => {
		const owner = freshUserAccount.address;
		await freshChatPage.goto();

		// Submit a prompt the oracle never answers → the escrow is debited and the job stays
		// pending on-chain. The cancel affordance confirms the dApp sees it pending.
		await freshChatPage.sendDroppedPrompt('This one gets stuck and refunded');
		await expect(freshChatPage.cancelButton).toBeVisible({ timeout: 30_000 });

		// Indexing: the stuck PromptRequest is pending (not answered/cancelled/refunded).
		const pendingReqs = await waitForGraph(
			() => getPromptRequests(owner),
			reqs => reqs.some(isPending),
			{ label: 'pending PromptRequest' },
		);
		const stuck = pendingReqs.find(isPending)!;

		// The escrow holds the prompt fee now (balance already debited at submission).
		const balanceWhileStuck = await getABLEBalance(TOKEN_ADDRESS, owner);

		// Advance EVM time past the 1h refund window, then claim on-chain (signed by the user).
		await increaseTime(REFUND_TIMEOUT_S + 1);
		await processRefund(ESCROW_ADDRESS, owner, stuck.id);

		// Indexing: the request flips to refunded (escrow → subgraph).
		await waitForGraph(
			() => getPromptRequests(owner),
			reqs => reqs.some(r => r.id === stuck.id && r.isRefunded),
			{ label: 'PromptRequest.isRefunded' },
		);

		// Contract: the escrowed fee is returned to the wallet.
		const balanceAfterRefund = await getABLEBalance(TOKEN_ADDRESS, owner);
		expect(balanceAfterRefund).toBeGreaterThan(balanceWhileStuck);
	});

	test('T-REFUND-02: an answered prompt cannot be refunded (job finalized)', async ({
		freshChatPage,
		freshUserAccount,
	}) => {
		const owner = freshUserAccount.address;
		await freshChatPage.goto();

		// A normal answered prompt finalizes the job, so its escrow is settled, not refundable.
		await freshChatPage.sendPromptAndWaitForResponse('Answer this one normally');
		const answeredReqs = await waitForGraph(
			() => getPromptRequests(owner),
			reqs => reqs.some(r => r.isAnswered),
			{ label: 'answered PromptRequest' },
		);
		const answered = answeredReqs.find(r => r.isAnswered)!;

		// Even past the refund window, claiming reverts (the job is finalized).
		await increaseTime(REFUND_TIMEOUT_S + 1);
		await expect(processRefund(ESCROW_ADDRESS, owner, answered.id)).rejects.toThrow();

		// And it stays answered, never refunded.
		const reqs = await getPromptRequests(owner);
		expect(reqs.find(r => r.id === answered.id)?.isRefunded).toBe(false);
	});
});

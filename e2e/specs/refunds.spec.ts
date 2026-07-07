import { expect, test } from '../fixtures';
import { getPromptRequests, waitForGraph } from '../helpers/graph';
import {
	activatePlan,
	fundABLE,
	getABLEBalance,
	getLatestBlockTimestamp,
	increaseTime,
	processRefund,
} from '../helpers/hardhat';
import { DashboardPage } from '../pages/DashboardPage';

const TOKEN_ADDRESS = process.env.VITE_TOKEN_CONTRACT_ADDRESS ?? '';
const ESCROW_ADDRESS = process.env.VITE_ESCROW_CONTRACT_ADDRESS ?? '';
const REFUND_TIMEOUT_S = 3600; // 1 hour — matches EVMAIAgentEscrow REFUND_TIMEOUT
const PLAN_ALLOWANCE = 10n ** 18n * 100n; // 100 ABLE
const SKIP_REASON =
	'Skipped: requires Hardhat node + escrow contract + oracle + Graph node (set E2E_LOCAL_SERVICES=1)';

const isPending = (r: {
	isAnswered: boolean;
	isCancelled: boolean;
	isRefunded: boolean;
}): boolean => !r.isAnswered && !r.isCancelled && !r.isRefunded;

// Stuck-prompt refund (T-REFUND). A prompt the mock oracle never answers (via the
// __E2E_DROP__ sentinel) stays pending on-chain forever; after REFUND_TIMEOUT the user can
// reclaim the escrowed fee with processRefund. Full cross-layer: the dApp shows it pending,
// the escrow holds the fee, processRefund returns it, and the subgraph flips isRefunded.
//
// The dApp's in-app refund affordance (the "Refund" button in PlanStatusCard's "Action Required"
// panel) is wall-clock-gated: useStuckRequests sets isRefundable = Date.now() > createdAt +
// REFUND_TIMEOUT_MS, which evm_increaseTime can't move. T-REFUND-01/02 drive the on-chain claim
// directly (the contract gate IS block-time based); T-REFUND-03 covers the *button* end-to-end by
// advancing the browser clock with Playwright's page.clock (UI gate) AND EVM time (contract gate).
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
			{ label: 'pending PromptRequest', timeoutMs: 60_000 },
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
			{ label: 'PromptRequest.isRefunded', timeoutMs: 60_000 },
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

		// The finalized job is untouched: still answered, never refunded. (Asserting
		// isAnswered too makes this a real subgraph check, not just "a reverted call didn't
		// flip a flag" — a regression where processRefund silently succeeds would change one.)
		const req = (await getPromptRequests(owner)).find(r => r.id === answered.id);
		expect(req?.isAnswered).toBe(true);
		expect(req?.isRefunded).toBe(false);
	});

	test('T-REFUND-03: the in-app Refund button unlocks past the wall-clock window and refunds on-chain', async ({
		freshChatPage,
		freshPage,
		freshUserAccount,
	}) => {
		const owner = freshUserAccount.address;
		await freshChatPage.goto();

		// Stuck prompt → escrow debited, job pending on-chain forever.
		await freshChatPage.sendDroppedPrompt('This one gets stuck and refunded via the button');
		await expect(freshChatPage.cancelButton).toBeVisible({ timeout: 30_000 });
		// Runs last in the serial refunds suite (after two round-trips + increaseTime jumps), so
		// graph-node indexing lags more than the 30s default — give the indexing waits headroom.
		const pendingReqs = await waitForGraph(
			() => getPromptRequests(owner),
			reqs => reqs.some(isPending),
			{ label: 'pending PromptRequest', timeoutMs: 60_000 },
		);
		const stuck = pendingReqs.find(isPending)!;
		const balanceWhileStuck = await getABLEBalance(TOKEN_ADDRESS, owner);

		// On the dashboard the stuck request is auto-detected, but the window hasn't elapsed, so the
		// UI shows "Wait 1h" — no Refund button yet. This is the wall-clock gate, closed.
		const dashboard = new DashboardPage(freshPage);
		await dashboard.goto();
		await expect(dashboard.stuckRequestRow.first()).toBeVisible({ timeout: 30_000 });
		await expect(dashboard.refundWaitLabel.first()).toBeVisible();
		await expect(dashboard.refundButton).toHaveCount(0);

		// Open BOTH gates: EVM time (so the contract permits processRefund) and the browser wall clock
		// (so useStuckRequests flips isRefundable). useStuckRequests compares Date.now() to the
		// prompt's on-chain createdAt (block time) + REFUND_TIMEOUT — and the serial suite's prior
		// increaseTime jumps have pushed EVM time well ahead of the real wall clock, so the browser
		// clock must be set relative to EVM time, not Date.now(). Pin it to the latest block timestamp
		// (already past createdAt + 1h after increaseTime). setFixedTime overrides Date.now() without
		// freezing timers, so the hook's 15s refetchInterval still fires and recomputes the gate.
		await increaseTime(REFUND_TIMEOUT_S + 60);
		const evmNowMs = (await getLatestBlockTimestamp()) * 1000;
		await freshPage.clock.setFixedTime(new Date(evmNowMs + 60_000));

		// The gate opens: "Wait 1h" is replaced by an enabled "Refund" button (on the next refetch).
		await expect(dashboard.refundButton.first()).toBeVisible({ timeout: 30_000 });
		await expect(dashboard.refundWaitLabel).toHaveCount(0);

		// Clicking it drives the real on-chain processRefund (signed by the mock wallet) …
		await dashboard.refundButton.first().click();

		// … and the request leaves the "Action Required" panel once refunded + refetched. This is a
		// fast, clear UI signal that the click actually triggered the refund — a no-op click would
		// fail here rather than sitting out the full subgraph-indexing timeout below. (We assert the
		// row removal, not the transient in-flight disabled state, which a fast localnet tx can clear
		// before the assertion even runs.)
		await expect(dashboard.stuckRequestRow).toHaveCount(0, { timeout: 45_000 });

		// … which the subgraph indexes as refunded, and the escrowed fee returns to the wallet.
		await waitForGraph(
			() => getPromptRequests(owner),
			reqs => reqs.some(r => r.id === stuck.id && r.isRefunded),
			{ label: 'PromptRequest.isRefunded (via button)', timeoutMs: 60_000 },
		);
		expect(await getABLEBalance(TOKEN_ADDRESS, owner)).toBeGreaterThan(balanceWhileStuck);
	});
});

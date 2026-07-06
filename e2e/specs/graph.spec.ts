import { expect, test } from '../fixtures';
import { TEST_ACCOUNT } from '../fixtures/mock-wallet';
import { fundAndActivatePlan } from '../helpers/contracts';
import { getConversations, getPayments, waitForIndexing } from '../helpers/graph';
import { getCurrentBlock, revertToSnapshot, takeSnapshot } from '../helpers/hardhat';

const SKIP_REASON = 'Skipped: requires local Graph node + Hardhat node (set E2E_LOCAL_SERVICES=1)';



test.describe('Graph — subgraph data layer (T-GRAPH)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);

	let snapshotId: string;


	// Same self-contained precondition as contract-cost.spec: the chat composer is
	// plan-gated ("Activate Your Agent" renders instead when the shared account has
	// no active plan), and these specs must not depend on an earlier project having
	// funded/activated the shared account — plan.spec's afterEach revert can even
	// UNDO a plan set earlier in the run. Snapshot FIRST so the revert also returns
	// the funded ABLE.
	test.beforeEach(async () => {
		snapshotId = await takeSnapshot();
		await fundAndActivatePlan(TEST_ACCOUNT.address);
	});

	test.afterEach(async () => {
		await revertToSnapshot(snapshotId);
	});

	test('T-GRAPH-01: Conversation appears in subgraph after prompt', async ({ chatPage }) => {
		// The subgraph does NOT roll back on evm_revert: entities from orphaned
		// blocks persist, re-created conversations reuse the same id (upsert), and
		// a post-revert replay is DETERMINISTIC — same id, same block cadence, same
		// timestamps — so neither count deltas, timestamps, nor id sets can detect
		// this test's round-trip. The conversation CID is content-derived, so a
		// unique prompt text guarantees an observable change even under replay.
		const before = await getConversations(TEST_ACCOUNT.address);
		const beforeCIDs = new Set(before.map(c => `${c.id}:${c.conversationCID}`));

		await chatPage.goto();
		await chatPage.sendPromptAndWaitForResponse(`Graph indexing test ${Date.now()}`);

		const block = await getCurrentBlock();
		await waitForIndexing(block);

		const after = await getConversations(TEST_ACCOUNT.address);
		expect(after.length).toBeGreaterThanOrEqual(1);
		const changed = after.some(c => !beforeCIDs.has(`${c.id}:${c.conversationCID}`));
		expect(changed, 'the prompt should have created or updated an indexed conversation').toBe(
			true,
		);
	});

	test('T-GRAPH-02: Payment entity matches escrow transaction', async ({ chatPage }) => {
		await chatPage.goto();
		await chatPage.sendPromptAndWaitForResponse('Payment entity test');

		const block = await getCurrentBlock();
		await waitForIndexing(block);

		// The payment is PENDING only until the (fast, mocked) oracle answers — by
		// this point it is normally SETTLED. The assertion is existence + lifecycle
		// validity, not a specific transient status.
		const payments = await getPayments(TEST_ACCOUNT.address);
		expect(payments.length).toBeGreaterThan(0);
		expect(['PENDING', 'COMPLETE']).toContain(payments[0].status);
	});

	test('T-GRAPH-03: Subgraph data matches UI conversation list', async ({
		chatPage,
		historyPage,
	}) => {
		await chatPage.goto();
		await chatPage.sendPromptAndWaitForResponse('Subgraph UI sync test');

		const block = await getCurrentBlock();
		await waitForIndexing(block);

		const subgraphConversations = await getConversations(TEST_ACCOUNT.address);

		await historyPage.goto();
		const uiCount = await historyPage.conversationItems.count();

		// UI should show at least as many conversations as the subgraph
		expect(uiCount).toBeGreaterThanOrEqual(subgraphConversations.length);
	});
});

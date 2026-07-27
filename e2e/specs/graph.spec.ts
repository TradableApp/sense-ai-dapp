import { expect, test } from '../fixtures';
import { fundAndActivatePlan } from '../helpers/contracts';
import { getConversations, getPayments, waitForIndexing } from '../helpers/graph';
import { getCurrentBlock } from '../helpers/hardhat';

const SKIP_REASON = 'Skipped: requires local Graph node + Hardhat node (set E2E_LOCAL_SERVICES=1)';

// ADR-0002: fresh account per test, never snapshot/revert. This spec asserts directly on
// the subgraph, so it is the clearest case of the rule — `evm_revert` wedges graph-node's
// block ingestor on a zero-hash block and the subgraph freezes for the rest of the
// invocation (CU-86d3uqgh7). A pristine per-test account gives the same isolation on a
// forward-only chain, and lets these assertions be EXACT rather than the ">= and
// content-derived-CID" workarounds the shared account previously forced.
test.describe('Graph — subgraph data layer (T-GRAPH)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);

	// Fund + activate BEFORE the body touches a fresh* page fixture, so the plan is live
	// when a protected route first loads (the composer is plan-gated). `freshUserAccount`
	// resolves to the same account the fresh page's wallet impersonates.
	test.beforeEach(async ({ freshUserAccount }) => {
		await fundAndActivatePlan(freshUserAccount.address);
	});

	test('T-GRAPH-01: Conversation appears in subgraph after prompt', async ({
		freshChatPage,
		freshUserAccount,
	}) => {
		// A pristine account has nothing indexed, so this is an exact before/after rather
		// than a delta hunt.
		expect(await getConversations(freshUserAccount.address)).toHaveLength(0);

		await freshChatPage.goto();
		await freshChatPage.sendPromptAndWaitForResponse('Graph indexing test');

		await waitForIndexing(await getCurrentBlock());

		const after = await getConversations(freshUserAccount.address);
		expect(after).toHaveLength(1);
		expect(
			after[0].conversationCID,
			'the indexed conversation must carry a content CID',
		).toBeTruthy();
	});

	test('T-GRAPH-02: Payment entity matches escrow transaction', async ({
		freshChatPage,
		freshUserAccount,
	}) => {
		await freshChatPage.goto();
		await freshChatPage.sendPromptAndWaitForResponse('Payment entity test');

		await waitForIndexing(await getCurrentBlock());

		// One prompt on a pristine account means exactly one payment — no need to tolerate
		// unordered results or older entities, which only mattered for the shared account.
		// The payment is PENDING only until the (fast, mocked) oracle answers, so assert the
		// lifecycle is valid rather than a specific transient status.
		const payments = await getPayments(freshUserAccount.address);
		expect(payments).toHaveLength(1);
		expect(['PENDING', 'COMPLETE']).toContain(payments[0].status);
	});

	test('T-GRAPH-03: Subgraph data matches UI conversation list', async ({
		freshChatPage,
		freshHistoryPage,
		freshUserAccount,
	}) => {
		await freshChatPage.goto();
		await freshChatPage.sendPromptAndWaitForResponse('Subgraph UI sync test');

		await waitForIndexing(await getCurrentBlock());

		const subgraphConversations = await getConversations(freshUserAccount.address);
		expect(subgraphConversations).toHaveLength(1);

		// freshHistoryPage shares the same page as freshChatPage, so this reads the SAME
		// authenticated session — the UI list must agree exactly with the subgraph now that
		// the account's history is entirely this test's doing.
		await freshHistoryPage.goto();
		await freshHistoryPage.assertConversationCount(subgraphConversations.length, {
			timeout: 30_000,
		});
	});
});

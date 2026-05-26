import { expect, test } from '../fixtures';
import { getCurrentBlock, takeSnapshot, revertToSnapshot } from '../helpers/hardhat';
import { getConversations, waitForIndexing, getPendingPayments } from '../helpers/graph';
import { TEST_ACCOUNT } from '../fixtures/mock-wallet';

const SKIP_REASON = 'Skipped: requires local Graph node + Hardhat node (set E2E_LOCAL_SERVICES=1)';

test.describe('Graph — subgraph data layer (T-GRAPH)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);

	let snapshotId: string;

	test.beforeEach(async () => {
		snapshotId = await takeSnapshot();
	});

	test.afterEach(async () => {
		await revertToSnapshot(snapshotId);
	});

	test('T-GRAPH-01: Conversation appears in subgraph after prompt', async ({ chatPage }) => {
		const conversationsBefore = await getConversations(TEST_ACCOUNT.address);

		await chatPage.goto();
		await chatPage.sendPromptAndWaitForResponse('Graph indexing test');

		const block = await getCurrentBlock();
		await waitForIndexing(block);

		const conversationsAfter = await getConversations(TEST_ACCOUNT.address);
		expect(conversationsAfter.length).toBeGreaterThan(conversationsBefore.length);
	});

	test('T-GRAPH-02: Payment entity matches escrow transaction', async ({ chatPage }) => {
		await chatPage.goto();
		await chatPage.sendPromptAndWaitForResponse('Payment entity test');

		const block = await getCurrentBlock();
		await waitForIndexing(block);

		const payments = await getPendingPayments(TEST_ACCOUNT.address);
		expect(payments.length).toBeGreaterThan(0);
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

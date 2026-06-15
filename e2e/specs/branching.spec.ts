import { expect, test } from '../fixtures';
import { getConversations, waitForGraph } from '../helpers/graph';
import { activatePlan, fundABLE } from '../helpers/hardhat';

const TOKEN_ADDRESS = process.env.VITE_TOKEN_CONTRACT_ADDRESS ?? '';
const ESCROW_ADDRESS = process.env.VITE_ESCROW_CONTRACT_ADDRESS ?? '';
const PLAN_ALLOWANCE = 10n ** 18n * 100n; // 100 ABLE
const SKIP_REASON =
	'Skipped: requires Hardhat node + oracle + Graph node for multi-turn conversations (set E2E_LOCAL_SERVICES=1)';

// Conversation branch/split. Fresh funded account per test — NOT evm_snapshot/revert (which
// corrupts graph-node; see docs/decisions/0002-e2e-isolation-fresh-account.md). Serial; fresh
// stack per run.
test.describe('Branching (T-BRANCH)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');

	test.beforeEach(async ({ freshUserAccount }) => {
		await fundABLE(TOKEN_ADDRESS, freshUserAccount.address, PLAN_ALLOWANCE);
		await activatePlan(TOKEN_ADDRESS, ESCROW_ADDRESS, freshUserAccount.address, PLAN_ALLOWANCE);
	});

	test('T-BRANCH-01: the branch button appears on an AI response', async ({ freshChatPage }) => {
		await freshChatPage.goto();
		await freshChatPage.sendPromptAndWaitForResponse('Test branch button visibility');
		await expect(freshChatPage.branchTrigger).toBeVisible({ timeout: 10_000 });
	});

	test('T-BRANCH-02: clicking branch creates a new conversation', async ({ freshChatPage }) => {
		await freshChatPage.goto();
		await freshChatPage.sendPromptAndWaitForResponse('Original conversation for branching');

		await freshChatPage.branchInNewChat();

		// The branched conversation opens with a usable composer.
		await freshChatPage.assertPromptInputVisible();
	});

	test('T-BRANCH-03: the branched conversation carries the original message history', async ({
		freshChatPage,
	}) => {
		await freshChatPage.goto();
		await freshChatPage.sendPromptAndWaitForResponse('Branch source message');

		await freshChatPage.branchInNewChat();

		// The branch copies the prior context, so at least the original user message is present.
		await expect(freshChatPage.userMessages.first()).toBeVisible({ timeout: 15_000 });
		expect(await freshChatPage.userMessages.count()).toBeGreaterThanOrEqual(1);
	});

	test('T-BRANCH-04: the original conversation is unaffected by branching', async ({
		freshChatPage,
		freshHistoryPage,
		freshUserAccount,
	}) => {
		await freshChatPage.goto();
		await freshChatPage.sendPromptAndWaitForResponse('Original message before branch');
		const originalMsgCount = await freshChatPage.userMessages.count();

		await freshChatPage.branchInNewChat();
		await freshChatPage.sendPromptAndWaitForResponse('Message in branched conversation');

		// Wait for the branch to index (ConversationBranched → subgraph) — localnet live events
		// are unreliable, so the dApp's history only reflects it after a sync (a /history mount).
		await waitForGraph(
			() => getConversations(freshUserAccount.address),
			convs => convs.length === 2,
			{ label: 'branched conversation indexed' },
		);

		// Reopen the original conversation from history (the branch is most recent at index 0,
		// the original is at index 1) and verify its message count is unchanged.
		await freshHistoryPage.goto();
		await freshHistoryPage.assertConversationCount(2);
		await freshHistoryPage.clickConversation(1);
		await expect(freshChatPage.userMessages.first()).toBeVisible({ timeout: 15_000 });
		expect(await freshChatPage.userMessages.count()).toBe(originalMsgCount);
	});

	test('T-BRANCH-05: the branched conversation appears in history', async ({
		freshChatPage,
		freshHistoryPage,
		freshUserAccount,
	}) => {
		await freshChatPage.goto();
		await freshChatPage.sendPromptAndWaitForResponse('Pre-branch message');
		await freshChatPage.branchInNewChat();

		// Indexing: the branch creates a second conversation (ConversationBranched → subgraph).
		await waitForGraph(
			() => getConversations(freshUserAccount.address),
			convs => convs.length === 2,
			{ label: 'branched conversation indexed' },
		);

		// dApp: after a /history mount syncs it, both the original + the branch are listed.
		await freshHistoryPage.goto();
		await freshHistoryPage.assertConversationCount(2);
	});
});

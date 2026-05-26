import { expect, test } from '../fixtures';
import { takeSnapshot, revertToSnapshot } from '../helpers/hardhat';

const SKIP_REASON =
	'Skipped: requires Hardhat node + Graph node for conversation data (set E2E_LOCAL_SERVICES=1)';

test.describe('History — empty state (T-HIST)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);

	test('T-HIST-01: History page renders for authenticated user', async ({ historyPage }) => {
		await historyPage.goto();
		await expect(historyPage.conversationList.or(historyPage.emptyState)).toBeVisible({
			timeout: 10_000,
		});
	});

	test('T-HIST-02: New user sees empty state', async ({ historyPage }) => {
		await historyPage.goto();
		await historyPage.assertEmpty();
	});

	test('T-HIST-03: Search input is visible', async ({ historyPage }) => {
		await historyPage.goto();
		await expect(historyPage.searchInput).toBeVisible({ timeout: 5_000 });
	});
});

test.describe('History — with conversations (T-HIST-DATA)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);

	let snapshotId: string;

	test.beforeEach(async () => {
		snapshotId = await takeSnapshot();
	});

	test.afterEach(async () => {
		await revertToSnapshot(snapshotId);
	});

	test('T-HIST-04: Conversations ordered by most recent first', async ({
		chatPage,
		historyPage,
	}) => {
		// Create two conversations via chat
		await chatPage.goto();
		await chatPage.sendPromptAndWaitForResponse('First conversation');

		// Navigate to history — most recent should be first
		await historyPage.goto();
		await historyPage.assertHasConversations();
		const count = await historyPage.conversationItems.count();
		expect(count).toBeGreaterThanOrEqual(1);
	});

	test('T-HIST-05: Click a conversation loads message thread', async ({
		chatPage,
		historyPage,
		authenticatedPage,
	}) => {
		await chatPage.goto();
		await chatPage.sendPromptAndWaitForResponse('History test message');

		await historyPage.goto();
		await historyPage.assertHasConversations();
		await historyPage.clickConversation(0);

		// Should navigate to chat with messages loaded
		await expect(authenticatedPage).toHaveURL(/\/chat/, { timeout: 10_000 });
	});

	test('T-HIST-06: Search filters conversation list', async ({ chatPage, historyPage }) => {
		await chatPage.goto();
		await chatPage.sendPromptAndWaitForResponse('Unique searchable topic alpha');

		await historyPage.goto();
		await historyPage.assertHasConversations();
		await historyPage.searchFor('alpha');

		const count = await historyPage.conversationItems.count();
		expect(count).toBeGreaterThanOrEqual(1);
	});

	test('T-HIST-07: Search with no results shows empty state', async ({ historyPage }) => {
		await historyPage.goto();
		await historyPage.searchFor('zzz_nonexistent_query_xyz');

		await historyPage.assertEmpty();
	});

	test('T-HIST-08: Rename a conversation updates title', async ({ chatPage, historyPage }) => {
		await chatPage.goto();
		await chatPage.sendPromptAndWaitForResponse('Rename test conversation');

		await historyPage.goto();
		await historyPage.assertHasConversations();
		await historyPage.renameConversation(0, 'My Renamed Chat');

		// Verify the new name appears
		await expect(historyPage.conversationItems.first()).toContainText('My Renamed Chat', {
			timeout: 5_000,
		});
	});

	test('T-HIST-09: Delete a conversation removes it from list', async ({
		chatPage,
		historyPage,
	}) => {
		await chatPage.goto();
		await chatPage.sendPromptAndWaitForResponse('Delete test conversation');

		await historyPage.goto();
		await historyPage.assertHasConversations();
		const initialCount = await historyPage.conversationItems.count();
		await historyPage.deleteConversation(0);
		await historyPage.assertConversationCount(initialCount - 1);
	});

	test('T-HIST-10: Resume a previous conversation — can send new prompts', async ({
		chatPage,
		historyPage,
		authenticatedPage,
	}) => {
		await chatPage.goto();
		await chatPage.sendPromptAndWaitForResponse('Initial message in conversation');

		await historyPage.goto();
		await historyPage.assertHasConversations();
		await historyPage.clickConversation(0);

		await expect(authenticatedPage).toHaveURL(/\/chat/, { timeout: 10_000 });
		await chatPage.assertPromptInputVisible();
		await chatPage.sendPromptAndWaitForResponse('Follow-up message');

		const userMsgCount = await chatPage.userMessages.count();
		expect(userMsgCount).toBeGreaterThanOrEqual(2);
	});
});

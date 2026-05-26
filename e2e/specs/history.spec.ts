import { expect, test } from '../fixtures';

test.describe('History — conversation list (T-HIST)', () => {
	test.skip(
		process.env.E2E_LOCAL_SERVICES !== '1',
		'Skipped: requires Hardhat node + Graph node for conversation data (set E2E_LOCAL_SERVICES=1)',
	);

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

	test('T-HIST-04: Conversation can be renamed', async ({ historyPage }) => {
		await historyPage.goto();
		await historyPage.assertHasConversations();
		await historyPage.renameConversation(0, 'Renamed Test');
	});

	test('T-HIST-05: Conversation can be deleted', async ({ historyPage }) => {
		await historyPage.goto();
		await historyPage.assertHasConversations();
		const initialCount = await historyPage.conversationItems.count();
		await historyPage.deleteConversation(0);
		await historyPage.assertConversationCount(initialCount - 1);
	});
});

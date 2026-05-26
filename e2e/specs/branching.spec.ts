import { expect, test } from '../fixtures';
import { revertToSnapshot, takeSnapshot } from '../helpers/hardhat';

const SKIP_REASON =
	'Skipped: requires Hardhat node + oracle for multi-turn conversations (set E2E_LOCAL_SERVICES=1)';

test.describe('Branching — conversation branch/split (T-BRANCH)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);

	let snapshotId: string;

	test.beforeEach(async () => {
		snapshotId = await takeSnapshot();
	});

	test.afterEach(async () => {
		await revertToSnapshot(snapshotId);
	});

	test('T-BRANCH-01: Branch button appears on AI response messages', async ({ chatPage }) => {
		await chatPage.goto();
		await chatPage.sendPromptAndWaitForResponse('Test branch button visibility');
		await expect(chatPage.branchButton).toBeVisible({ timeout: 5_000 });
	});

	test('T-BRANCH-02: Clicking branch creates a new conversation', async ({ chatPage }) => {
		await chatPage.goto();
		await chatPage.sendPromptAndWaitForResponse('Original conversation for branching');

		await chatPage.branchButton.click();

		// Should navigate to or create a new conversation
		await chatPage.assertPromptInputVisible();
	});

	test('T-BRANCH-03: Branched conversation has correct message history', async ({ chatPage }) => {
		await chatPage.goto();
		await chatPage.sendPromptAndWaitForResponse('Branch source message');
		await chatPage.branchButton.click();

		// The branched conversation should include the original message context
		const userMsgCount = await chatPage.userMessages.count();
		expect(userMsgCount).toBeGreaterThanOrEqual(1);
	});

	test('T-BRANCH-04: Original conversation is unaffected by branch', async ({
		chatPage,
		historyPage,
	}) => {
		await chatPage.goto();
		await chatPage.sendPromptAndWaitForResponse('Original message before branch');
		const originalMsgCount = await chatPage.userMessages.count();

		await chatPage.branchButton.click();
		await chatPage.sendPromptAndWaitForResponse('Message in branched conversation');

		// Reopen the original conversation from history and verify message count unchanged
		await historyPage.goto();
		await historyPage.assertHasConversations();
		// The original conversation should be at index 1 (branched is most recent at 0)
		await historyPage.clickConversation(1);
		const reopenedMsgCount = await chatPage.userMessages.count();
		expect(reopenedMsgCount).toBe(originalMsgCount);
	});

	test('T-BRANCH-05: Branched conversation appears in history', async ({
		chatPage,
		historyPage,
	}) => {
		await historyPage.goto();
		const countBefore = await historyPage.conversationItems.count();

		await chatPage.goto();
		await chatPage.sendPromptAndWaitForResponse('Pre-branch message');
		await chatPage.branchButton.click();

		await historyPage.goto();
		const countAfter = await historyPage.conversationItems.count();
		expect(countAfter).toBeGreaterThan(countBefore);
	});
});

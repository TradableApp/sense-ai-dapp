import { expect, test } from '../fixtures';
import { activatePlan, fundABLE } from '../helpers/hardhat';

const TOKEN_ADDRESS = process.env.VITE_TOKEN_CONTRACT_ADDRESS ?? '';
const ESCROW_ADDRESS = process.env.VITE_ESCROW_CONTRACT_ADDRESS ?? '';
const PLAN_ALLOWANCE = 10n ** 18n * 100n; // 100 ABLE
const SKIP_REASON =
	'Skipped: requires Hardhat node + oracle + Graph node for conversation data (set E2E_LOCAL_SERVICES=1)';

// History list. Fresh funded account per test — NOT evm_snapshot/revert (which corrupts
// graph-node; see docs/decisions/0002-e2e-isolation-fresh-account.md). Each test is a brand-new
// user, so the empty-state cases are genuinely empty and the data cases create their own
// conversations with no cross-test pollution. Serial; fresh stack per run.
test.describe('History (T-HIST)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');

	test.beforeEach(async ({ freshUserAccount }) => {
		await fundABLE(TOKEN_ADDRESS, freshUserAccount.address, PLAN_ALLOWANCE);
		await activatePlan(TOKEN_ADDRESS, ESCROW_ADDRESS, freshUserAccount.address, PLAN_ALLOWANCE);
	});

	test('T-HIST-01: the history page renders for a new user', async ({ freshHistoryPage }) => {
		await freshHistoryPage.goto();
		// The page chrome (the search control) is always present once History mounts.
		await expect(freshHistoryPage.searchInput).toBeVisible({ timeout: 15_000 });
	});

	test('T-HIST-02: a new user sees the empty state', async ({ freshHistoryPage }) => {
		await freshHistoryPage.goto();
		await freshHistoryPage.assertEmpty();
	});

	test('T-HIST-03: the search input is visible', async ({ freshHistoryPage }) => {
		await freshHistoryPage.goto();
		await expect(freshHistoryPage.searchInput).toBeVisible({ timeout: 10_000 });
	});

	test('T-HIST-04: a conversation created in chat appears in history', async ({
		freshChatPage,
		freshHistoryPage,
	}) => {
		await freshChatPage.goto();
		await freshChatPage.sendPromptAndWaitForResponse('First conversation');

		await freshHistoryPage.goto();
		await freshHistoryPage.assertHasConversations();
		await freshHistoryPage.assertConversationCount(1);
	});

	test('T-HIST-05: clicking a conversation loads its thread in chat', async ({
		freshChatPage,
		freshHistoryPage,
		freshPage,
	}) => {
		await freshChatPage.goto();
		await freshChatPage.sendPromptAndWaitForResponse('History test message');

		await freshHistoryPage.goto();
		await freshHistoryPage.assertHasConversations();
		await freshHistoryPage.clickConversation(0);

		await expect(freshPage).toHaveURL(/\/chat/, { timeout: 10_000 });
		await expect(freshChatPage.assistantMessages.first()).toBeVisible({ timeout: 15_000 });
	});

	test('T-HIST-06: search filters the conversation list', async ({
		freshChatPage,
		freshHistoryPage,
	}) => {
		await freshChatPage.goto();
		await freshChatPage.sendPromptAndWaitForResponse('Unique searchable topic alpha');

		await freshHistoryPage.goto();
		await freshHistoryPage.assertHasConversations();
		await freshHistoryPage.searchFor('alpha');
		await freshHistoryPage.assertConversationCount(1);
	});

	test('T-HIST-07: a search with no match shows the no-results state', async ({
		freshChatPage,
		freshHistoryPage,
	}) => {
		await freshChatPage.goto();
		await freshChatPage.sendPromptAndWaitForResponse('Some conversation to search against');

		await freshHistoryPage.goto();
		await freshHistoryPage.assertHasConversations();
		await freshHistoryPage.searchFor('zzz_nonexistent_query_xyz');
		await expect(freshHistoryPage.noResults).toBeVisible({ timeout: 10_000 });
	});

	test('T-HIST-08: renaming a conversation updates its title', async ({
		freshChatPage,
		freshHistoryPage,
	}) => {
		await freshChatPage.goto();
		await freshChatPage.sendPromptAndWaitForResponse('Rename test conversation');

		await freshHistoryPage.goto();
		await freshHistoryPage.assertHasConversations();
		await freshHistoryPage.renameConversation(0, 'My Renamed Chat');

		await expect(freshHistoryPage.conversationItems.first()).toContainText('My Renamed Chat', {
			timeout: 15_000,
		});
	});

	test('T-HIST-09: deleting a conversation removes it from the list', async ({
		freshChatPage,
		freshHistoryPage,
	}) => {
		await freshChatPage.goto();
		await freshChatPage.sendPromptAndWaitForResponse('Delete test conversation');

		await freshHistoryPage.goto();
		await freshHistoryPage.assertConversationCount(1);
		await freshHistoryPage.deleteConversation(0);
		// Delete is NOT optimistic — confirmDelete goes through metadataUpdateMutation (an
		// on-chain isDeleted write) and only removes from the list in onSuccess, so allow more
		// than the 10s default for the tx to confirm on a loaded localnet.
		await freshHistoryPage.assertConversationCount(0, { timeout: 30_000 });
	});

	test('T-HIST-10: resuming a conversation allows sending a follow-up', async ({
		freshChatPage,
		freshHistoryPage,
		freshPage,
	}) => {
		await freshChatPage.goto();
		await freshChatPage.sendPromptAndWaitForResponse('Initial message in conversation');

		await freshHistoryPage.goto();
		await freshHistoryPage.assertHasConversations();
		await freshHistoryPage.clickConversation(0);

		await expect(freshPage).toHaveURL(/\/chat/, { timeout: 10_000 });
		await freshChatPage.assertPromptInputVisible();
		await freshChatPage.sendPromptAndWaitForResponse('Follow-up message');

		expect(await freshChatPage.userMessages.count()).toBeGreaterThanOrEqual(2);
	});
});

import { expect, test } from '../fixtures';
import { CHAIN, LIVE_STACK } from '../helpers/chain';
import { ESCROW_ADDRESS, fundAndActivatePlan, TOKEN_ADDRESS } from '../helpers/contracts';

const SKIP_REASON =
	'Skipped: requires Hardhat node + oracle + Graph node for conversation data (set E2E_LOCAL_SERVICES=1)';

// History list. Fresh funded account per test — NOT evm_snapshot/revert (which corrupts
// graph-node; see docs/decisions/0002-e2e-isolation-fresh-account.md). Each test is a brand-new
// user, so the empty-state cases are genuinely empty and the data cases create their own
// conversations with no cross-test pollution. Serial; fresh stack per run.
test.describe('History (T-HIST)', () => {
	test.skip(!LIVE_STACK, SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');

	test.beforeEach(async ({ freshUserAccount }) => {
		await fundAndActivatePlan(freshUserAccount.address);
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

		// The follow-up's own round-trip is already confirmed above; the PRIOR
		// message hydrates asynchronously from history — poll instead of a
		// single-instant count so hydration timing can't race the assertion.
		await expect
			.poll(async () => freshChatPage.userMessages.count(), { timeout: 15_000 })
			.toBeGreaterThanOrEqual(2);
	});

	test('T-HIST-11: every conversation still shows its messages after seven, on a reloaded page', async ({
		freshChatPage,
		freshHistoryPage,
		freshPage,
	}) => {
		// The local message cache keeps a handful of conversations. Whatever it drops must come
		// back from the index and storage when the conversation is opened: what the user sees
		// must be what is stored, at any time.
		// The cache and its rebuild are the same code on every chain, so the seven paid prompts
		// are spent on the localnet only.
		test.skip(CHAIN === 'testnet', 'cache behaviour is chain-independent; covered on localnet');
		// Seven prompts at up to one answer budget each, plus navigation.
		test.setTimeout(480_000);
		await freshChatPage.goto();
		await freshChatPage.sendPromptAndWaitForResponse('Conversation 1 of seven');
		for (let n = 2; n <= 7; n++) {
			await freshChatPage.startNewConversation();
			await freshChatPage.sendPromptAndWaitForResponse(`Conversation ${n} of seven`);
		}

		// A reload empties everything held in memory, so what shows next comes from the browser's
		// store or from the index and storage, never from the page that created it.
		await freshPage.reload();
		for (let index = 0; index < 7; index++) {
			await freshHistoryPage.goto();
			await freshHistoryPage.assertConversationCount(7);
			await freshHistoryPage.clickConversation(index);

			await expect(freshPage).toHaveURL(/\/chat/, { timeout: 10_000 });
			// Newest first: index 0 is conversation 7.
			await expect(
				freshChatPage.userMessages,
				`conversation ${7 - index} shows its prompt`,
			).toHaveCount(1, { timeout: 30_000 });
			await expect(freshChatPage.userMessages.first()).toContainText(
				`Conversation ${7 - index} of seven`,
			);
			await expect(freshChatPage.assistantMessages).toHaveCount(1);
		}
	});
});

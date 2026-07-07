import { expect, test } from '../fixtures';
import { ESCROW_ADDRESS, fundAndActivatePlan, TOKEN_ADDRESS } from '../helpers/contracts';

const SKIP_REASON =
	'Skipped: requires Hardhat node + oracle + Graph node for conversation/search data (set E2E_LOCAL_SERVICES=1)';

// Content-aware history search. Search is Fuse.js over `titleKeywords` (weight 0.7) +
// `contentKeywords` (weight 0.3) (see searchService.ts). `contentKeywords` are generated from the
// WHOLE prompt, while the conversation title is only the first 40 chars of the prompt — so a
// distinctive marker placed past char 40 is searchable by content yet absent from the title.
// Fresh funded account per test (docs/decisions/0002); serial; fresh stack per run.
test.describe('Search relevance (T-SEARCH)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');

	test.beforeEach(async ({ freshUserAccount }) => {
		await fundAndActivatePlan(freshUserAccount.address);
	});

	test('T-SEARCH-01: a term in the conversation title matches', async ({
		freshChatPage,
		freshHistoryPage,
	}) => {
		await freshChatPage.goto();
		await freshChatPage.sendPromptAndWaitForResponse('Falcon quarterly report');

		await freshHistoryPage.goto();
		await freshHistoryPage.assertConversationCount(1);
		await freshHistoryPage.searchFor('falcon');
		await freshHistoryPage.assertConversationCount(1);
	});

	test('T-SEARCH-02: a term only in the message body (past the 40-char title) still matches', async ({
		freshChatPage,
		freshHistoryPage,
	}) => {
		// A prefix longer than the 40-char title cutoff, then the distinctive marker. The title
		// and the answer preview (which echoes the first 40 chars) therefore never show
		// "zephyrium" — so matching it can only come from the content keywords of the full prompt.
		const prefix = 'Intro filler text long enough to fill the title bar';
		expect(prefix.length).toBeGreaterThan(40); // self-enforcing: marker must fall past the title
		await freshChatPage.goto();
		await freshChatPage.sendPromptAndWaitForResponse(`${prefix} zephyrium`);

		await freshHistoryPage.goto();
		await freshHistoryPage.assertConversationCount(1);
		// The marker is not visible in the row (title + preview are both truncated before it).
		await expect(freshHistoryPage.conversationItems.first()).not.toContainText(/zephyrium/i);

		await freshHistoryPage.searchFor('zephyrium');
		await freshHistoryPage.assertConversationCount(1);
	});

	test('T-SEARCH-03: search is precise — a term unique to one conversation does not return another', async ({
		freshChatPage,
		freshHistoryPage,
	}) => {
		await freshChatPage.goto();
		await freshChatPage.sendPromptAndWaitForResponse('Notes on zephyrium rollout');

		// Start a second, separate conversation (Reset Chat clears the active one).
		await freshChatPage.startNewConversation();
		await freshChatPage.sendPromptAndWaitForResponse('Notes on quokkawump rollout');

		await freshHistoryPage.goto();
		await freshHistoryPage.assertConversationCount(2);

		// "zephyrium" is unique to the first conversation; the dissimilar "quokkawump" one must
		// NOT fuzzy-match it.
		await freshHistoryPage.searchFor('zephyrium');
		await freshHistoryPage.assertConversationCount(1);
		// Assert the RIGHT conversation came back — both prompts start "Notes on … rollout", so a
		// /notes/ branch would pass for either; only "zephyrium" proves it's the matching one.
		await expect(freshHistoryPage.conversationItems.first()).toContainText(/zephyrium/i);
	});
});

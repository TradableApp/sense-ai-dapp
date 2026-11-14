import { type BrowserContext } from '@playwright/test';

import { expect, test } from '../fixtures';
import { BUDGET } from '../helpers/budgets';
import { LIVE_STACK } from '../helpers/chain';
import { ESCROW_ADDRESS, fundAndActivatePlan, TOKEN_ADDRESS } from '../helpers/contracts';
import { openDevice } from '../helpers/devices';
import {
	getConversations,
	getConversationsWithLineage,
	getMessages,
	getPayments,
	getPromptRequests,
	getRegenerationRequests,
	waitForGraph,
} from '../helpers/graph';
import { getPromptFee, getSpendingLimit } from '../helpers/hardhat';

const SKIP_REASON =
	'Skipped: requires Hardhat node + oracle + Graph node for multi-turn conversations (set E2E_LOCAL_SERVICES=1)';

// A branched conversation is only created — with branchedFrom populated — once the oracle
// completes the branch and emits ConversationBranched (handleConversationBranched). The subgraph
// is the observable surface for that parentage; getConversationsWithLineage (helpers/graph.ts)
// reads it for an owner in a single query.

// Conversation branch/split. Fresh funded account per test — NOT evm_snapshot/revert (which
// corrupts graph-node; see docs/decisions/0002-e2e-isolation-fresh-account.md). Serial; fresh
// stack per run.
test.describe('Branching (T-BRANCH)', () => {
	test.skip(!LIVE_STACK, SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');

	test.beforeEach(async ({ freshUserAccount }) => {
		await fundAndActivatePlan(freshUserAccount.address);
	});

	// A second device opened in a test is closed here even if the test failed mid-body.
	const openContexts: BrowserContext[] = [];
	test.afterEach(async () => {
		await Promise.all(openContexts.splice(0).map(c => c.close().catch(() => {})));
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

		// NOTE: sending a follow-up INSIDE the branched conversation is covered by T-BRANCH-06
		// (audit Area 5 "branched conversation is fully live") — it exercises a distinct
		// answer-render path. This test only asserts the ORIGINAL is unaffected by the branch.

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

	// ── Area 5: a branched conversation is FULLY LIVE ───────────────────────────
	// T-BRANCH-01..05 only prove the branch is created and carries copied history. These two
	// close the audit gap: a branch must be a real, continuable conversation — you can send a
	// NEW prompt inside it and get it answered, and you can branch a branch (nested lineage).

	test('T-BRANCH-06: a follow-up prompt inside a branched conversation is answered and indexed under the branch', async ({
		freshChatPage,
		freshUserAccount,
	}) => {
		await freshChatPage.goto();
		await freshChatPage.sendPromptAndWaitForResponse(
			'Source conversation for an in-branch follow-up',
		);

		await freshChatPage.branchInNewChat();

		// The branch opens carrying the copied history (user prompt + AI answer). Wait for the
		// copied context to render before continuing, so the follow-up appends to a real thread.
		await expect(freshChatPage.userMessages.first()).toBeVisible({ timeout: 15_000 });
		const copiedUserCount = await freshChatPage.userMessages.count();
		expect(copiedUserCount).toBeGreaterThanOrEqual(1);

		// The branch conversation is created — with branchedFrom set to the original — only once
		// the oracle emits ConversationBranched. Wait for that, and capture the branch's id.
		const lineage = await waitForGraph(
			() => getConversationsWithLineage(freshUserAccount.address),
			list => list.length === 2 && list.some(c => c.branchedFrom !== null),
			{ label: 'branch lineage indexed' },
		);
		const original = lineage.find(c => c.branchedFrom === null);
		const branch = lineage.find(c => c.branchedFrom !== null);
		expect(original, 'an un-branched original conversation should exist').toBeTruthy();
		expect(branch, 'a branched conversation should exist').toBeTruthy();
		expect(branch!.branchedFrom!.id).toBe(original!.id);

		// The key assertion: send a brand-new prompt INSIDE the branch and get a live answer.
		await freshChatPage.sendPromptAndWaitForResponse('A new question asked inside the branch');

		// dApp: the follow-up appended exactly one user message on top of the copied history,
		// and its answer rendered (assistant bubble count incremented in sendPrompt… above).
		expect(await freshChatPage.userMessages.count()).toBe(copiedUserCount + 1);

		// Cross-layer: the copied history lives only in the conversation CID — it is NOT indexed
		// as Message rows. So the branch conversation's ONLY indexed messages are the follow-up's
		// new prompt + answer. This cleanly proves the in-branch round-trip landed on-chain and
		// indexed under the BRANCH (not the original).
		const branchMessages = await waitForGraph(
			() => getMessages(branch!.id),
			msgs => msgs.length === 2 && msgs.some(m => m.role === 'assistant'),
			{ label: 'in-branch follow-up messages indexed' },
		);
		expect(branchMessages.map(m => m.role)).toEqual(['user', 'assistant']);
		const answer = branchMessages.find(m => m.role === 'assistant')!;
		expect(answer.messageCID).not.toBe('');

		// And the prompt request for that answer is marked answered (PromptRequest.id =
		// answerMessageId = the answer Message's messageId — the universal cross-layer key).
		// Wrapped in waitForGraph for consistency with the rest of the spec: handleAnswerMessageAdded
		// sets isAnswered=true in the same block it creates the assistant Message above, so this is
		// already satisfied — but the retry keeps the test resilient if that invariant ever changes.
		const answeredRequest = await waitForGraph(
			async () =>
				(await getPromptRequests(freshUserAccount.address)).find(r => r.id === answer.messageId),
			r => r?.isAnswered === true,
			{ label: 'in-branch PromptRequest marked answered', timeoutMs: 15_000 },
		);
		expect(answeredRequest, 'a PromptRequest should exist for the in-branch answer').toBeTruthy();
		expect(answeredRequest!.isCancelled).toBe(false);
	});

	test('T-BRANCH-07: branching a branch produces a nested lineage (A ← B ← C)', async ({
		freshChatPage,
		freshUserAccount,
	}) => {
		// A: the root conversation.
		await freshChatPage.goto();
		await freshChatPage.sendPromptAndWaitForResponse('Root conversation A for nested branching');

		// A → B.
		await freshChatPage.branchInNewChat();
		// The copied AI answer must render in B before we can branch it again — branching targets
		// the "More actions" menu on an AI message (see ChatPage.branchTrigger).
		await expect(freshChatPage.assistantMessages.first()).toBeVisible({ timeout: 20_000 });
		await waitForGraph(
			() => getConversations(freshUserAccount.address),
			convs => convs.length === 2,
			{ label: 'first branch (B) indexed' },
		);

		// B → C: branch the branch.
		await freshChatPage.branchInNewChat();

		// All three conversations are indexed, two of them carrying a branch parent.
		const lineage = await waitForGraph(
			() => getConversationsWithLineage(freshUserAccount.address),
			list => list.length === 3 && list.filter(c => c.branchedFrom !== null).length === 2,
			{ label: 'nested branch lineage indexed', timeoutMs: 90_000 },
		);

		// Resolve the chain by parentage rather than insertion order: A has no parent, B branched
		// from A, C branched from B.
		const root = lineage.find(c => c.branchedFrom === null); // A
		const mid = root ? lineage.find(c => c.branchedFrom?.id === root.id) : undefined; // B
		const leaf = mid ? lineage.find(c => c.branchedFrom?.id === mid.id) : undefined; // C

		expect(root, 'root conversation A (no parent) should exist').toBeTruthy();
		expect(mid, 'branch B (parent = A) should exist').toBeTruthy();
		expect(leaf, 'branch-of-branch C (parent = B) should exist').toBeTruthy();
		// Three distinct conversations forming a single chain A ← B ← C.
		expect(new Set([root!.id, mid!.id, leaf!.id]).size).toBe(3);
	});

	// A branch reuses the message ids it inherited, so regenerating an inherited answer inside
	// the branch names the BRANCH and a prompt that was asked in the original. The new answer
	// belongs to the conversation the user is looking at: it must render in the branch, be
	// indexed under the branch, and leave the original conversation exactly as it was.
	test('T-BRANCH-08: regenerating an inherited answer inside a branch lands in the branch, not the original', async ({
		browser,
		freshChatPage,
		freshUserAccount,
	}) => {
		const owner = freshUserAccount.address;
		await freshChatPage.goto();
		await freshChatPage.sendPromptAndWaitForResponse(
			'Source conversation for a branch regeneration',
		);

		const [originalConv] = await waitForGraph(
			() => getConversations(owner),
			c => c.length === 1,
			{ label: 'original conversation indexed' },
		);
		const originalIndexed = await waitForGraph(
			() => getMessages(originalConv.id),
			msgs => msgs.length === 2 && msgs.some(m => m.role === 'assistant'),
			{ label: 'original prompt and answer indexed' },
		);
		const inheritedPrompt = originalIndexed.find(m => m.role === 'user')!;
		const inheritedAnswer = originalIndexed.find(m => m.role === 'assistant')!;

		await freshChatPage.branchInNewChat();
		// The copied answer must be on screen before it can be regenerated.
		await expect(freshChatPage.assistantMessages.first()).toBeVisible({ timeout: 20_000 });
		const lineage = await waitForGraph(
			() => getConversationsWithLineage(owner),
			list => list.length === 2 && list.some(c => c.branchedFrom !== null),
			{ label: 'branch lineage indexed' },
		);
		const branch = lineage.find(c => c.branchedFrom !== null)!;
		expect(branch.branchedFrom!.id).toBe(originalConv.id);

		const spendBefore = (await getSpendingLimit(ESCROW_ADDRESS, owner)).spentAmount;
		const promptFee = await getPromptFee(ESCROW_ADDRESS);

		// dApp: the inherited answer becomes version 2 of 2 inside the branch and hydrates.
		await freshChatPage.regenerateAndWaitForNewVersion('default', 2);

		// Indexing: the regeneration names the inherited answer and produces a new one.
		const [regen] = await waitForGraph(
			() => getRegenerationRequests(owner),
			r => r.length === 1,
			{ label: 'RegenerationRequest indexed' },
		);
		// It was asked in the branch, about the prompt and answer the branch inherited.
		expect(regen.conversationId).toBe(branch.id);
		expect(regen.promptMessageId).toBe(inheritedPrompt.messageId);
		expect(regen.originalAnswerMessageId).toBe(inheritedAnswer.messageId);
		expect(regen.answerMessageId).not.toBe(inheritedAnswer.messageId);

		// The copied history is not indexed as Message rows, so the branch's ONLY indexed message
		// is the regenerated answer — under the branch.
		const branchMessages = await waitForGraph(
			() => getMessages(branch.id),
			msgs => msgs.some(m => m.messageId === regen.answerMessageId),
			{ label: 'regenerated answer indexed under the branch' },
		);
		expect(branchMessages.map(m => m.role)).toEqual(['assistant']);
		expect(branchMessages[0].messageCID).not.toBe('');

		// And the original still holds its one prompt and one answer, nothing more.
		// No wait needed: the wait above saw the block that carries the regenerated answer, so a
		// misfiled answer would already be indexed here.
		const originalMessages = await getMessages(originalConv.id);
		expect(originalMessages.map(m => m.role).sort()).toEqual(['assistant', 'user']);
		expect(originalMessages.some(m => m.messageId === regen.answerMessageId)).toBe(false);

		// The request is settled: the regeneration's escrow payment (its id is the new answer's
		// id; a regeneration has no PromptRequest row) is indexed as COMPLETE, and exactly one
		// promptFee was spent.
		await waitForGraph(
			() => getPayments(owner),
			payments => payments.some(p => p.id === regen.answerMessageId && p.status === 'COMPLETE'),
			{ label: 'branch regeneration payment complete' },
		);
		const spendAfter = (await getSpendingLimit(ESCROW_ADDRESS, owner)).spentAmount;
		expect(spendAfter - spendBefore).toBe(promptFee);

		// A second device: a pristine browser context (empty IndexedDB) on the same wallet. Nothing
		// the first device wrote locally exists here, so what it shows is rebuilt from the subgraph
		// and decentralised storage alone — the stored state, not the first device's optimistic one.
		const deviceB = await openDevice(browser, freshUserAccount, openContexts);
		await deviceB.history.goto();
		await deviceB.history.assertConversationCount(2, { timeout: BUDGET.indexMs * 3 });
		// A branch is always titled "Branch of <original title>"; select by title, not by position.
		const branchItem = deviceB.history.conversationItems.filter({ hasText: /Branch of/ });
		const originalItem = deviceB.history.conversationItems.filter({ hasNotText: /Branch of/ });
		await expect(branchItem).toHaveCount(1);
		await expect(originalItem).toHaveCount(1);

		// The original, from stored state: its prompt, one answer and no version pager — the
		// regeneration did not reach it.
		await originalItem.click();
		await expect(deviceB.chat.userMessages.first()).toBeVisible({ timeout: BUDGET.answerMs });
		await expect(deviceB.chat.assistantMessages).toHaveCount(1);
		await expect(deviceB.chat.versionIndicator).toHaveCount(0);

		// The branch, from stored state: the regenerated answer is there. (The history the branch
		// inherited is a separate matter — see the fixme below.)
		await deviceB.history.goto();
		await branchItem.click();
		await expect(deviceB.chat.assistantMessages.first()).toBeVisible({
			timeout: BUDGET.answerMs,
		});
		await expect(deviceB.chat.assistantMessages).toHaveCount(1);
	});

	// KNOWN GAP, kept as an executable statement of the expected behaviour. The messages a branch
	// inherits are copied into the branching device's IndexedDB only; they are not indexed under
	// the branch, and the sync does not rebuild them from the branch's lineage. A second device
	// (or the same one after its site data is cleared) therefore opens a branch without its
	// inherited prompt and answer, and a regenerated inherited answer shows as a lone answer with
	// no version pager. Remove `fixme` when the sync rebuilds inherited history.
	test.fixme(
		'T-BRANCH-09: a second device rebuilds the history a branch inherited, with its answer versions',
		async ({ browser, freshChatPage, freshUserAccount }) => {
			const owner = freshUserAccount.address;
			const marker = 'Zibblefrond inherited prompt marker';
			await freshChatPage.goto();
			await freshChatPage.sendPromptAndWaitForResponse(marker);
			await freshChatPage.branchInNewChat();
			await expect(freshChatPage.assistantMessages.first()).toBeVisible({ timeout: 20_000 });
			await waitForGraph(
				() => getConversationsWithLineage(owner),
				list => list.length === 2 && list.some(c => c.branchedFrom !== null),
				{ label: 'branch lineage indexed' },
			);
			await freshChatPage.regenerateAndWaitForNewVersion('default', 2);
			const [regen] = await waitForGraph(
				() => getRegenerationRequests(owner),
				r => r.length === 1,
				{ label: 'RegenerationRequest indexed' },
			);
			await waitForGraph(
				() => getPayments(owner),
				payments => payments.some(p => p.id === regen.answerMessageId && p.status === 'COMPLETE'),
				{ label: 'branch regeneration payment complete' },
			);

			const deviceB = await openDevice(browser, freshUserAccount, openContexts);
			await deviceB.history.goto();
			await deviceB.history.assertConversationCount(2, { timeout: BUDGET.indexMs * 3 });
			await deviceB.history.conversationItems.filter({ hasText: /Branch of/ }).click();

			// The inherited prompt is back, and its answer carries both versions.
			await expect(deviceB.chat.userMessages.first()).toContainText(marker, {
				timeout: BUDGET.answerMs,
			});
			await expect(deviceB.chat.versionIndicator).toHaveText(/^\s*2\s*\/\s*2\s*$/, {
				timeout: BUDGET.answerMs,
			});
			await expect(deviceB.chat.assistantMessages).toHaveCount(1);
		},
	);
});

import { expect, test } from '../fixtures';
import {
	getConversations,
	getMessages,
	getRegenerationRequests,
	waitForGraph,
} from '../helpers/graph';
import { activatePlan, fundABLE, getPromptFee, getSpendingLimit } from '../helpers/hardhat';

const TOKEN_ADDRESS = process.env.VITE_TOKEN_CONTRACT_ADDRESS ?? '';
const ESCROW_ADDRESS = process.env.VITE_ESCROW_CONTRACT_ADDRESS ?? '';
const SKIP_REASON =
	'Skipped: requires Hardhat node + oracle + Graph node (set E2E_LOCAL_SERVICES=1)';

const PLAN_ALLOWANCE = 10n ** 18n * 100n; // 100 ABLE

async function fundAndActivatePlan(address: string): Promise<void> {
	await fundABLE(TOKEN_ADDRESS, address, PLAN_ALLOWANCE);
	await activatePlan(TOKEN_ADDRESS, ESCROW_ADDRESS, address, PLAN_ALLOWANCE);
}

/** Assistant messages indexed for a conversation, oldest first. */
async function indexedAnswers(conversationId: string) {
	const messages = await getMessages(conversationId);
	return messages.filter(m => m.role === 'assistant');
}

// Regeneration re-rolls an existing answer: initiateRegeneration debits promptFee,
// reserves a NEW answer message id, and the oracle delivers a fresh answer that the
// dApp appends. These specs upgrade the prior button-only coverage (T-CHAT-10) to the
// FULL round-trip — contract (escrow debit) → oracle → subgraph (RegenerationRequest +
// new Message) → dApp render — across all three UI modes. Fresh per-test users on a
// pristine chain (forward-only, like the answer-flow specs); serial run.
test.describe('Regenerate — answer round-trip (T-REGEN)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');
	test.describe.configure({ timeout: 180_000 });

	test.beforeEach(async ({ freshUserAccount }) => {
		await fundAndActivatePlan(freshUserAccount.address);
	});

	test('T-REGEN-01: default regenerate delivers a new answer (contract + index + dApp)', async ({
		freshChatPage,
		freshUserAccount,
	}) => {
		const owner = freshUserAccount.address;
		await freshChatPage.goto();

		// First answer must land before we can regenerate it.
		await freshChatPage.sendPromptAndWaitForResponse('What is the current market sentiment?');
		await expect(freshChatPage.assistantMessages).toHaveCount(1);

		// Resolve the (single) conversation and capture the original answer + spend.
		const [conv] = await waitForGraph(
			() => getConversations(owner),
			convs => convs.length === 1,
			{ label: 'conversation indexed' },
		);
		const originalAnswers = await waitForGraph(
			() => indexedAnswers(conv.id),
			answers => answers.length === 1,
			{ label: 'first answer indexed' },
		);
		const originalAnswerId = originalAnswers[0].messageId;
		const spendBefore = (await getSpendingLimit(ESCROW_ADDRESS, owner)).spentAmount;
		const promptFee = await getPromptFee(ESCROW_ADDRESS);

		// dApp: regenerate (default) → a NEW assistant bubble renders.
		await freshChatPage.regenerateAndWaitForResponse('default');
		await expect(freshChatPage.assistantMessages).toHaveCount(2);

		// Indexing: a RegenerationRequest links the original answer → a new answer id,
		// and a second assistant Message is indexed (oracle delivered + indexed).
		const [regen] = await waitForGraph(
			() => getRegenerationRequests(owner),
			reqs => reqs.length === 1,
			{ label: 'RegenerationRequest indexed' },
		);
		expect(regen.originalAnswerMessageId).toBe(originalAnswerId);
		expect(regen.answerMessageId).not.toBe(originalAnswerId);

		await waitForGraph(() => indexedAnswers(conv.id), answers => answers.length === 2, {
			label: 'regenerated answer indexed',
		});

		// Contract: the escrow debited exactly one promptFee for the regeneration.
		const spendAfter = (await getSpendingLimit(ESCROW_ADDRESS, owner)).spentAmount;
		expect(spendAfter - spendBefore).toBe(promptFee);
	});

	test('T-REGEN-02: "Add details" mode regenerates and indexes the request', async ({
		freshChatPage,
		freshUserAccount,
	}) => {
		const owner = freshUserAccount.address;
		await freshChatPage.goto();
		await freshChatPage.sendPromptAndWaitForResponse('Summarise BTC fundamentals.');

		await freshChatPage.regenerateAndWaitForResponse('detailed');
		await expect(freshChatPage.assistantMessages).toHaveCount(2);

		await waitForGraph(() => getRegenerationRequests(owner), reqs => reqs.length === 1, {
			label: 'detailed RegenerationRequest indexed',
		});
	});

	test('T-REGEN-03: "More concise" mode regenerates and indexes the request', async ({
		freshChatPage,
		freshUserAccount,
	}) => {
		const owner = freshUserAccount.address;
		await freshChatPage.goto();
		await freshChatPage.sendPromptAndWaitForResponse('Give me a detailed ETH outlook.');

		await freshChatPage.regenerateAndWaitForResponse('concise');
		await expect(freshChatPage.assistantMessages).toHaveCount(2);

		await waitForGraph(() => getRegenerationRequests(owner), reqs => reqs.length === 1, {
			label: 'concise RegenerationRequest indexed',
		});
	});
});

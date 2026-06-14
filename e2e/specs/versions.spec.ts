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

/** Indexed assistant messages for a conversation, oldest first. */
async function indexedAnswers(conversationId: string) {
	return (await getMessages(conversationId)).filter(m => m.role === 'assistant');
}

// Answer VERSIONS — regenerating an answer or editing a prompt re-rolls the response
// as a sibling, shown one version at a time with a "‹ i / n ›" pager. These specs
// verify the FULL round-trip (contract escrow debit → oracle → subgraph index →
// dApp render) AND the version-switching UI, upgrading the prior button-only coverage
// (T-CHAT-10). Fresh per-test users on a pristine chain (forward-only); serial run.
test.describe('Answer versions — regenerate (T-REGEN)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');
	test.describe.configure({ timeout: 240_000 });

	test.beforeEach(async ({ freshUserAccount }) => {
		await fundAndActivatePlan(freshUserAccount.address);
	});

	test('T-REGEN-01: default regenerate switches to a new answer version (contract + index + dApp + version nav)', async ({
		freshChatPage,
		freshUserAccount,
	}) => {
		const owner = freshUserAccount.address;
		await freshChatPage.goto();
		await freshChatPage.sendPromptAndWaitForResponse('What is the current market sentiment?');

		const [conv] = await waitForGraph(
			() => getConversations(owner),
			c => c.length === 1,
			{
				label: 'conversation indexed',
			},
		);
		const [firstAnswer] = await waitForGraph(
			() => indexedAnswers(conv.id),
			a => a.length === 1,
			{
				label: 'first answer indexed',
			},
		);
		const spendBefore = (await getSpendingLimit(ESCROW_ADDRESS, owner)).spentAmount;
		const promptFee = await getPromptFee(ESCROW_ADDRESS);

		// dApp: regenerate (default) → the answer switches to version 2 of 2 and re-hydrates.
		await freshChatPage.regenerateAndWaitForNewVersion('default', 2);

		// Indexing: a RegenerationRequest links the original answer → a new answer id, and a
		// second assistant Message is indexed (oracle delivered + the subgraph indexed it).
		const [regen] = await waitForGraph(
			() => getRegenerationRequests(owner),
			r => r.length === 1,
			{
				label: 'RegenerationRequest indexed',
			},
		);
		expect(regen.originalAnswerMessageId).toBe(firstAnswer.messageId);
		expect(regen.answerMessageId).not.toBe(firstAnswer.messageId);
		await waitForGraph(
			() => indexedAnswers(conv.id),
			a => a.length === 2,
			{
				label: 'regenerated answer indexed',
			},
		);

		// Contract: the escrow debited exactly one promptFee for the regeneration.
		const spendAfter = (await getSpendingLimit(ESCROW_ADDRESS, owner)).spentAmount;
		expect(spendAfter - spendBefore).toBe(promptFee);

		// dApp version nav: on the newest, switch back to v1 and forward to v2.
		await expect(freshChatPage.nextVersionButton).toBeDisabled();
		await freshChatPage.prevVersionButton.click();
		await expect(freshChatPage.versionIndicator).toHaveText(/^\s*1\s*\/\s*2\s*$/);
		await expect(freshChatPage.prevVersionButton).toBeDisabled();
		await freshChatPage.nextVersionButton.click();
		await expect(freshChatPage.versionIndicator).toHaveText(/^\s*2\s*\/\s*2\s*$/);
	});

	test('T-REGEN-02: "Add details" mode regenerates to a new version', async ({
		freshChatPage,
		freshUserAccount,
	}) => {
		const owner = freshUserAccount.address;
		await freshChatPage.goto();
		await freshChatPage.sendPromptAndWaitForResponse('Summarise BTC fundamentals.');

		await freshChatPage.regenerateAndWaitForNewVersion('detailed', 2);

		await waitForGraph(
			() => getRegenerationRequests(owner),
			r => r.length === 1,
			{
				label: 'detailed RegenerationRequest indexed',
			},
		);
	});

	test('T-REGEN-03: "More concise" mode regenerates to a new version', async ({
		freshChatPage,
		freshUserAccount,
	}) => {
		const owner = freshUserAccount.address;
		await freshChatPage.goto();
		await freshChatPage.sendPromptAndWaitForResponse('Give me a detailed ETH outlook.');

		await freshChatPage.regenerateAndWaitForNewVersion('concise', 2);

		await waitForGraph(
			() => getRegenerationRequests(owner),
			r => r.length === 1,
			{
				label: 'concise RegenerationRequest indexed',
			},
		);
	});
});

test.describe('Answer versions — edit prompt (T-EDIT)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');
	test.describe.configure({ timeout: 240_000 });

	test.beforeEach(async ({ freshUserAccount }) => {
		await fundAndActivatePlan(freshUserAccount.address);
	});

	test('T-EDIT-01: editing a user message creates a new answer version (contract + index + dApp + version nav)', async ({
		freshChatPage,
		freshUserAccount,
	}) => {
		const owner = freshUserAccount.address;
		await freshChatPage.goto();
		await freshChatPage.sendPromptAndWaitForResponse('What is the market sentiment?');

		const [conv] = await waitForGraph(
			() => getConversations(owner),
			c => c.length === 1,
			{
				label: 'conversation indexed',
			},
		);
		const spendBefore = (await getSpendingLimit(ESCROW_ADDRESS, owner)).spentAmount;
		const promptFee = await getPromptFee(ESCROW_ADDRESS);

		// dApp: edit the prompt → a new prompt+answer version; the display switches to the
		// latest. The edited prompt is version 2 of 2 (sibling prompts) and its answer hydrates.
		await freshChatPage.editLatestUserMessage('Actually, what is the ETH outlook?');
		await expect(freshChatPage.versionIndicator).toHaveText(/^\s*2\s*\/\s*2\s*$/, {
			timeout: 90_000,
		});
		await expect(freshChatPage.thinkingIndicator).toBeHidden({ timeout: 90_000 });
		await expect(freshChatPage.assistantMessages).toHaveCount(1);

		// Indexing: a second prompt AND a second answer were indexed.
		await waitForGraph(
			() => getMessages(conv.id),
			msgs =>
				msgs.filter(m => m.role === 'user').length === 2 &&
				msgs.filter(m => m.role === 'assistant').length === 2,
			{ label: 'edited prompt + answer indexed' },
		);

		// Contract: the edit submitted a new prompt → escrow debited one promptFee.
		const spendAfter = (await getSpendingLimit(ESCROW_ADDRESS, owner)).spentAmount;
		expect(spendAfter - spendBefore).toBe(promptFee);

		// dApp version nav (on the user message): switch back to the original prompt and forward.
		await expect(freshChatPage.nextVersionButton).toBeDisabled();
		await freshChatPage.prevVersionButton.click();
		await expect(freshChatPage.versionIndicator).toHaveText(/^\s*1\s*\/\s*2\s*$/);
		await expect(freshChatPage.prevVersionButton).toBeDisabled();
		await freshChatPage.nextVersionButton.click();
		await expect(freshChatPage.versionIndicator).toHaveText(/^\s*2\s*\/\s*2\s*$/);
	});
});

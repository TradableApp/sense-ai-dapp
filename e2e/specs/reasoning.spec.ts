import { expect, test } from '../fixtures';
import { CHAIN, LIVE_STACK } from '../helpers/chain';
import { ESCROW_ADDRESS, fundAndActivatePlan, TOKEN_ADDRESS } from '../helpers/contracts';

const SKIP_REASON =
	'Skipped: requires Hardhat node + oracle + Graph node for the answer round-trip (set E2E_LOCAL_SERVICES=1)';

// Reasoning / sources rendering (audit Area 6).
//
// Localnet: the mock oracle's `__E2E_REASONING__` sentinel (see tokenized-ai-agent
// hasMockReasoningSentinel) attaches deterministic reasoning + sources to the answer MessageFile,
// so the render path is exercised end-to-end with KNOWN content: oracle → storage → dApp
// syncService hydrate → UI.
//
// Testnet: the real oracle emits real reasoning and real sources, whose text and links are not
// knowable in advance (the sentinel is inert on a real oracle). The assertion becomes structural:
// a reasoning disclosure with at least one step, a sources disclosure with at least one http(s)
// link. Fresh funded account per test; serial; live stack.
test.describe('Reasoning & sources rendering (T-REASON)', () => {
	test.skip(!LIVE_STACK, SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');

	test.beforeEach(async ({ freshUserAccount }) => {
		await fundAndActivatePlan(freshUserAccount.address);
	});

	test('T-REASON-01: an answer renders its reasoning steps and sources', async ({
		freshChatPage,
	}) => {
		await freshChatPage.goto();

		if (CHAIN === 'testnet') {
			// A real question a real oracle will research; its reasoning and sources are its own.
			await freshChatPage.sendPromptAndWaitForResponse(
				'What drove Bitcoin price momentum this week? Cite your sources.',
				240_000,
			);
			await expect(freshChatPage.reasoningTrigger).toBeVisible({ timeout: 15_000 });
			await freshChatPage.reasoningTrigger.click();
			await expect(freshChatPage.reasoningSteps.first()).toBeVisible();

			await expect(freshChatPage.sourcesTrigger).toBeVisible();
			await freshChatPage.sourcesTrigger.click();
			const firstSource = freshChatPage.sourceLinks.first();
			await expect(firstSource).toBeVisible();
			await expect(firstSource).toHaveAttribute('href', /^https?:\/\//);
			return;
		}

		// The sentinel makes the mock oracle attach the deterministic reasoning + sources.
		await freshChatPage.sendReasoningPrompt('Explain recent BTC momentum');

		// The reasoning disclosure appears on the answer — a reasoningDuration renders it as
		// "Thought for N seconds". Its presence proves the data survived oracle → storage →
		// syncService hydration → UI (it is NOT optimistic; only a delivered answer has it).
		await expect(freshChatPage.reasoningTrigger).toBeVisible({ timeout: 15_000 });
		await freshChatPage.reasoningTrigger.click();

		// Expanded: the two deterministic reasoning steps render (their titles are <h4> headings).
		await expect(freshChatPage.reasoningStep('Interpreting the request')).toBeVisible();
		await expect(freshChatPage.reasoningStep('Synthesising the answer')).toBeVisible();

		// And the nested sources disclosure (2 sources) — expand it and assert a real link.
		await expect(freshChatPage.sourcesTrigger).toBeVisible();
		await freshChatPage.sourcesTrigger.click();

		// Assert BOTH sources' hrefs — proving each entry round-tripped intact (a hydration
		// off-by-one would otherwise pass on visibility alone).
		const docsLink = freshChatPage.sourceLink('Tradable Documentation');
		await expect(docsLink).toBeVisible();
		await expect(docsLink).toHaveAttribute('href', 'https://tradable.app/docs');
		const refLink = freshChatPage.sourceLink('SenseAI Reference');
		await expect(refLink).toBeVisible();
		await expect(refLink).toHaveAttribute('href', 'https://senseai.tradable.app');
	});

	test('T-REASON-02: a normal answer renders no reasoning disclosure', async ({
		freshChatPage,
	}) => {
		// Only the mock oracle can be told to omit reasoning; a real one decides for itself.
		test.skip(
			CHAIN === 'testnet',
			'Skipped on testnet: a real oracle attaches reasoning as it sees fit',
		);
		await freshChatPage.goto();
		// No sentinel → the oracle attaches no reasoning/sources → the disclosure must not appear.
		await freshChatPage.sendPromptAndWaitForResponse('A plain question with no reasoning');

		await expect(freshChatPage.assistantMessages).toHaveCount(1);
		await expect(freshChatPage.reasoningTrigger).toHaveCount(0);
		await expect(freshChatPage.sourcesTrigger).toHaveCount(0);
	});
});

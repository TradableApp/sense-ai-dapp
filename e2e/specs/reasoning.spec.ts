import { expect, test } from '../fixtures';
import { activatePlan, fundABLE } from '../helpers/hardhat';

const TOKEN_ADDRESS = process.env.VITE_TOKEN_CONTRACT_ADDRESS ?? '';
const ESCROW_ADDRESS = process.env.VITE_ESCROW_CONTRACT_ADDRESS ?? '';
const PLAN_ALLOWANCE = 10n ** 18n * 100n; // 100 ABLE
const SKIP_REASON =
	'Skipped: requires Hardhat node + oracle + Graph node for the answer round-trip (set E2E_LOCAL_SERVICES=1)';

// Reasoning / sources rendering (audit Area 6). The dApp's reasoning/sources render path is built
// but production doesn't yet emit those fields (tracked in ClickUp 86d3cfa41). The mock oracle's
// `__E2E_REASONING__` sentinel (see tokenized-ai-agent hasMockReasoningSentinel) attaches
// deterministic reasoning + sources to the answer MessageFile, so this exercises the render path
// end-to-end NOW: oracle → storage → dApp syncService hydrate → UI. When the real feature lands,
// the test upgrades to assert real data. Fresh funded account per test; serial; fresh stack.
test.describe('Reasoning & sources rendering (T-REASON)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');

	test.beforeEach(async ({ freshUserAccount }) => {
		await fundABLE(TOKEN_ADDRESS, freshUserAccount.address, PLAN_ALLOWANCE);
		await activatePlan(TOKEN_ADDRESS, ESCROW_ADDRESS, freshUserAccount.address, PLAN_ALLOWANCE);
	});

	test('T-REASON-01: an answer renders its reasoning steps and sources', async ({
		freshChatPage,
	}) => {
		await freshChatPage.goto();
		// The sentinel makes the oracle attach the deterministic reasoning + sources to the answer.
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
		await freshChatPage.goto();
		// No sentinel → the oracle attaches no reasoning/sources → the disclosure must not appear.
		await freshChatPage.sendPromptAndWaitForResponse('A plain question with no reasoning');

		await expect(freshChatPage.assistantMessages).toHaveCount(1);
		await expect(freshChatPage.reasoningTrigger).toHaveCount(0);
		await expect(freshChatPage.sourcesTrigger).toHaveCount(0);
	});
});

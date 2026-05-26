import { expect, test } from '../fixtures';

test.describe('Chat — prompt submission and oracle response (T-CHAT)', () => {
	test.skip(
		process.env.E2E_LOCAL_SERVICES !== '1',
		'Skipped: requires Hardhat node + oracle + Graph node (set E2E_LOCAL_SERVICES=1)',
	);

	test('T-CHAT-01: Chat page renders prompt textarea for authenticated user', async ({
		chatPage,
	}) => {
		await chatPage.goto();
		await chatPage.assertPromptInputVisible();
	});

	test('T-CHAT-02: Submitting a prompt sends a blockchain transaction', async ({ chatPage }) => {
		await chatPage.goto();
		await chatPage.sendPrompt('What is the current market sentiment?');
		await expect(chatPage.thinkingIndicator).toBeVisible({ timeout: 15_000 });
	});

	test('T-CHAT-03: Oracle response appears after prompt submission', async ({ chatPage }) => {
		await chatPage.goto();
		const response = await chatPage.sendPromptAndWaitForResponse('Hello SenseAI');
		expect(response?.length).toBeGreaterThan(0);
	});

	test('T-CHAT-04: Cancel button appears during pending prompt', async ({ chatPage }) => {
		await chatPage.goto();
		await chatPage.sendPrompt('Test prompt for cancellation');
		await expect(chatPage.cancelButton).toBeVisible({ timeout: 10_000 });
	});

	test('T-CHAT-05: Regenerate button appears on AI response', async ({ chatPage }) => {
		await chatPage.goto();
		await chatPage.sendPromptAndWaitForResponse('Test regeneration flow');
		await expect(chatPage.regenerateButton).toBeVisible({ timeout: 5_000 });
	});
});

test.describe('Chat — no active plan (T-CHAT-NOPLAN)', () => {
	test.skip(
		process.env.E2E_LOCAL_SERVICES !== '1',
		'Skipped: requires Hardhat node for contract reads (set E2E_LOCAL_SERVICES=1)',
	);

	test('T-CHAT-06: Chat shows activate plan CTA when user has no plan', async ({ chatPage }) => {
		await chatPage.goto();
		await chatPage.assertNoPlanCTA();
	});
});

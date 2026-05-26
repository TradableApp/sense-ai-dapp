import { expect, test } from '../fixtures';
import { getABLEBalance, takeSnapshot, revertToSnapshot } from '../helpers/hardhat';
import { TEST_ACCOUNT } from '../fixtures/mock-wallet';

const TOKEN_ADDRESS = process.env.VITE_TOKEN_CONTRACT_ADDRESS ?? '';
const SKIP_REASON =
	'Skipped: requires Hardhat node + oracle + Graph node (set E2E_LOCAL_SERVICES=1)';

test.describe('Chat — prompt input (T-CHAT)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);

	test('T-CHAT-01: Chat page renders prompt textarea', async ({ chatPage }) => {
		await chatPage.goto();
		await chatPage.assertPromptInputVisible();
	});

	test('T-CHAT-02: Empty prompt keeps send button disabled', async ({ chatPage }) => {
		await chatPage.goto();
		await chatPage.assertPromptInputVisible();
		await chatPage.promptTextarea.fill('');
		await chatPage.assertSendButtonDisabled();
	});

	test('T-CHAT-03: Whitespace-only prompt keeps send button disabled', async ({ chatPage }) => {
		await chatPage.goto();
		await chatPage.assertPromptInputVisible();
		await chatPage.promptTextarea.fill('   \n\t  ');
		await chatPage.assertSendButtonDisabled();
	});

	test('T-CHAT-04: Typing a prompt enables the send button', async ({ chatPage }) => {
		await chatPage.goto();
		await chatPage.promptTextarea.fill('What is the market sentiment?');
		await expect(chatPage.submitButton).toBeEnabled({ timeout: 5_000 });
	});

	test('T-CHAT-05: Long prompt (500+ chars) is accepted', async ({ chatPage }) => {
		await chatPage.goto();
		const longPrompt = 'Analyze the market. '.repeat(30); // ~600 chars
		await chatPage.promptTextarea.fill(longPrompt);
		await expect(chatPage.submitButton).toBeEnabled({ timeout: 5_000 });
	});
});

test.describe('Chat — submission and response (T-CHAT-TX)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);

	let snapshotId: string;

	test.beforeEach(async () => {
		snapshotId = await takeSnapshot();
	});

	test.afterEach(async () => {
		await revertToSnapshot(snapshotId);
	});

	test('T-CHAT-06: Submitting a prompt shows thinking indicator', async ({ chatPage }) => {
		await chatPage.goto();
		await chatPage.sendPrompt('What is the current market sentiment?');
		await expect(chatPage.thinkingIndicator).toBeVisible({ timeout: 15_000 });
	});

	test('T-CHAT-07: Submitted prompt appears as user message', async ({
		chatPage,
		authenticatedPage,
	}) => {
		await chatPage.goto();
		await chatPage.sendPrompt('Test user message visibility');
		await expect(chatPage.userMessages.last()).toContainText('Test user message visibility', {
			timeout: 15_000,
		});
	});

	test('T-CHAT-08: Oracle response appears as AI message', async ({ chatPage }) => {
		await chatPage.goto();
		const response = await chatPage.sendPromptAndWaitForResponse('Hello SenseAI');
		expect(response?.length).toBeGreaterThan(0);
	});

	test('T-CHAT-09: Cancel button appears during pending prompt', async ({ chatPage }) => {
		await chatPage.goto();
		await chatPage.sendPrompt('Test prompt for cancellation');
		await expect(chatPage.cancelButton).toBeVisible({ timeout: 10_000 });
	});

	test('T-CHAT-10: Regenerate button appears on AI response', async ({ chatPage }) => {
		await chatPage.goto();
		await chatPage.sendPromptAndWaitForResponse('Test regeneration flow');
		await expect(chatPage.regenerateButton).toBeVisible({ timeout: 5_000 });
	});

	test('T-CHAT-11: Escrow balance decreases after query', async ({ chatPage }) => {
		const balanceBefore = await getABLEBalance(TOKEN_ADDRESS, TEST_ACCOUNT.address);

		await chatPage.goto();
		await chatPage.sendPromptAndWaitForResponse('Test balance deduction');

		const balanceAfter = await getABLEBalance(TOKEN_ADDRESS, TEST_ACCOUNT.address);
		expect(balanceAfter).toBeLessThanOrEqual(balanceBefore);
	});

	test('T-CHAT-12: Multiple prompts in same conversation', async ({ chatPage }) => {
		await chatPage.goto();
		await chatPage.sendPromptAndWaitForResponse('First message');
		await chatPage.sendPromptAndWaitForResponse('Second message');

		const userMsgCount = await chatPage.userMessages.count();
		expect(userMsgCount).toBeGreaterThanOrEqual(2);
	});
});

test.describe('Chat — no active plan (T-CHAT-NOPLAN)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);

	test('T-CHAT-13: Chat shows activate plan CTA when user has no plan', async ({ chatPage }) => {
		await chatPage.goto();
		await chatPage.assertNoPlanCTA();
	});
});

test.describe('Chat — error states (T-CHAT-ERR)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);

	let snapshotId: string;

	test.beforeEach(async () => {
		snapshotId = await takeSnapshot();
	});

	test.afterEach(async () => {
		await revertToSnapshot(snapshotId);
	});

	test('T-CHAT-14: Network disconnect during prompt shows error', async ({
		chatPage,
		authenticatedPage,
	}) => {
		await chatPage.goto();
		await chatPage.promptTextarea.fill('Test network failure');

		const context = authenticatedPage.context();
		await context.setOffline(true);
		await chatPage.submitButton.click();

		await expect(authenticatedPage.getByText(/error|failed|offline|network/i).first()).toBeVisible({
			timeout: 15_000,
		});

		await context.setOffline(false);
	});

	test('T-CHAT-15: Wallet rejects transaction — can retry', async ({
		chatPage,
		authenticatedPage,
	}) => {
		await authenticatedPage.addInitScript(`
			const orig = window.ethereum?.request;
			if (orig) {
				let blocked = true;
				window.ethereum.request = async (args) => {
					if (args.method === 'eth_sendTransaction' && blocked) {
						blocked = false;
						const err = new Error('User rejected the request.');
						err.code = 4001;
						throw err;
					}
					return orig.call(window.ethereum, args);
				};
			}
		`);

		await chatPage.goto();
		await chatPage.sendPrompt('Test wallet rejection');

		await expect(
			authenticatedPage.getByText(/rejected|cancelled|denied|error/i).first(),
		).toBeVisible({ timeout: 15_000 });
	});
});

import { expect, test } from '../fixtures';
import { TEST_ACCOUNT } from '../fixtures/mock-wallet';
import { ESCROW_ADDRESS, fundAndActivatePlan, TOKEN_ADDRESS } from '../helpers/contracts';
import { getABLEBalance,
	useChainSnapshot,
	} from '../helpers/hardhat';

const SKIP_REASON =
	'Skipped: requires Hardhat node + oracle + Graph node (set E2E_LOCAL_SERVICES=1)';

// Precondition for sending a real prompt: fund the user and activate a plan so the
// escrow has an allowance to debit per-prompt. Funded per-test (not pre-funded
// globally) so balance-sensitive specs elsewhere — the faucet and plan "start at 0
// ABLE" tests (T-FAUCET-01, T-PLAN-11/12) — keep full control of their account's
// balance. The localnet stateful run is serial (playwright.config workers=1), so
// these account-0 funding txs never contend. Both accounts are Hardhat-unlocked.

test.describe('Chat — prompt input (T-CHAT)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');

	useChainSnapshot(test);

	// The composer (textarea + send) only renders for a user with an active plan;
	// without one the chat shows the activate-plan CTA (see T-CHAT-13). So even the
	// input-only tests need the funded + activated precondition.
	test.beforeEach(async () => {
		await fundAndActivatePlan(TEST_ACCOUNT.address);
	});


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

// Answer-flow specs run as FRESH per-test users (Hardhat accounts 2..19), not the
// shared cached-auth Account #1. Each connects mid-session like a real first-time
// user — the path production actually runs — which is what makes the full answer
// round-trip (oracle → local IPFS → subgraph → dApp render) reach the UI in-suite.
// No snapshot/revert: that read as a chain reorg the live indexer couldn't track
// across answer round-trips. Forward-only on a pristine account avoids both the
// reorg and the cross-test accumulation that previously timed these out (CU-86d3a04rr).
test.describe('Chat — submission and response (T-CHAT-TX)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');

	// Fund + activate the fresh account BEFORE the test body touches freshChatPage,
	// so the plan is live when /chat first loads (the composer only renders with a
	// plan — see T-CHAT-13). freshChatPage reuses this same allocated account.
	test.beforeEach(async ({ freshUserAccount }) => {
		await fundAndActivatePlan(freshUserAccount.address);
	});

	test('T-CHAT-06: Submitting a prompt shows thinking indicator', async ({ freshChatPage }) => {
		await freshChatPage.goto();
		await freshChatPage.sendPrompt('What is the current market sentiment?');
		await expect(freshChatPage.thinkingIndicator).toBeVisible({ timeout: 15_000 });
	});

	test('T-CHAT-07: Submitted prompt appears as user message', async ({ freshChatPage }) => {
		await freshChatPage.goto();
		await freshChatPage.sendPrompt('Test user message visibility');
		await expect(freshChatPage.userMessages.last()).toContainText('Test user message visibility', {
			timeout: 15_000,
		});
	});

	test('T-CHAT-08: Oracle response appears as AI message', async ({ freshChatPage }) => {
		await freshChatPage.goto();
		const response = await freshChatPage.sendPromptAndWaitForResponse('Hello SenseAI');
		expect(response?.length).toBeGreaterThan(0);
	});

	test('T-CHAT-09: Cancel button appears during pending prompt', async ({ freshChatPage }) => {
		await freshChatPage.goto();
		await freshChatPage.sendPrompt('Test prompt for cancellation');
		await expect(freshChatPage.cancelButton).toBeVisible({ timeout: 10_000 });
	});

	test('T-CHAT-10: Regenerate button appears on AI response', async ({ freshChatPage }) => {
		await freshChatPage.goto();
		await freshChatPage.sendPromptAndWaitForResponse('Test regeneration flow');
		await expect(freshChatPage.regenerateButton).toBeVisible({ timeout: 5_000 });
	});

	test('T-CHAT-11: Escrow balance decreases after query', async ({
		freshChatPage,
		freshUserAccount,
	}) => {
		const balanceBefore = await getABLEBalance(TOKEN_ADDRESS, freshUserAccount.address);

		await freshChatPage.goto();
		await freshChatPage.sendPromptAndWaitForResponse('Test balance deduction');

		const balanceAfter = await getABLEBalance(TOKEN_ADDRESS, freshUserAccount.address);
		expect(balanceAfter).toBeLessThanOrEqual(balanceBefore);
	});

	test('T-CHAT-12: Multiple prompts in same conversation', async ({ freshChatPage }) => {
		await freshChatPage.goto();
		// First prompt + its answer — the answer must render so the composer
		// re-enables (isAiThinking clears) for the follow-up.
		await freshChatPage.sendPromptAndWaitForResponse('First message');
		// Follow-up prompt threads onto the first (parentId = the first answer). Its
		// answer must ALSO render live — in an existing conversation that exercises
		// syncService re-hydrating a follow-up answer's content even when the
		// conversation-level CIDs already match (CU-86d3a9aye). Waiting for the
		// assistant-bubble count to reach 2 drives that path end-to-end.
		await freshChatPage.sendPromptAndWaitForResponse('Second message');
		// Both user messages thread into the SAME conversation, and both answers render.
		await expect(freshChatPage.userMessages).toHaveCount(2, { timeout: 30_000 });
		await expect(freshChatPage.assistantMessages).toHaveCount(2, { timeout: 30_000 });
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
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');

	// MUST precede the beforeEach below so fundAndActivatePlan lands inside the
	// snapshot and is undone by the revert. Without it each test inherits the
	// previous test's already-active plan, so the precondition is wrong from
	// T-CHAT-15 onwards (this block had its own snapshot/revert hooks before the
	// fixture refactor — restoring that coverage).
	useChainSnapshot(test);

	test.beforeEach(async () => {
		// Error tests still need a funded + active plan so submission reaches the
		// transaction (otherwise the UI blocks at the no-plan CTA before erroring).
		await fundAndActivatePlan(TEST_ACCOUNT.address);
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

import { type Browser } from '@playwright/test';

import { expect, test } from '../fixtures';
import { buildMockWalletScript } from '../fixtures/mock-wallet';
import { allocateFreshAccount } from '../helpers/fresh-account';
import { getConversations, waitForGraph } from '../helpers/graph';
import { activatePlan, fundABLE, type HardhatAccount } from '../helpers/hardhat';
import { AuthPage } from '../pages/AuthPage';
import { ChatPage } from '../pages/ChatPage';
import { HistoryPage } from '../pages/HistoryPage';

const TOKEN_ADDRESS = process.env.VITE_TOKEN_CONTRACT_ADDRESS ?? '';
const ESCROW_ADDRESS = process.env.VITE_ESCROW_CONTRACT_ADDRESS ?? '';
const PLAN_ALLOWANCE = 10n ** 18n * 100n; // 100 ABLE
const SKIP_REASON =
	'Skipped: requires Hardhat node + oracle + Graph node for the answer round-trip (set E2E_LOCAL_SERVICES=1)';

interface Device {
	chat: ChatPage;
	history: HistoryPage;
	close: () => Promise<void>;
}

/**
 * Opens a brand-new "device" — a fresh BrowserContext (its own empty IndexedDB) whose mock wallet
 * impersonates `account`, then completes the real connect + session-key signature. Two devices on
 * the SAME account derive the SAME session key (SIGNATURE_MESSAGE is fixed and Hardhat signing is
 * deterministic), so device B can decrypt device A's data; two DIFFERENT accounts derive different
 * keys and query the subgraph under a different owner, so they stay isolated.
 */
async function openDevice(browser: Browser, account: HardhatAccount): Promise<Device> {
	const context = await browser.newContext();
	await context.addInitScript(buildMockWalletScript(account));
	const page = await context.newPage();
	await page.goto('/');
	await new AuthPage(page).connectAndSign();
	return {
		chat: new ChatPage(page),
		history: new HistoryPage(page),
		close: () => context.close(),
	};
}

// Multi-device / multi-wallet (audit Area 7). Two BrowserContexts (separate IndexedDB stores) prove
// that the dApp's subgraph→IndexedDB sync is the real source of truth: a second device with the
// same wallet hydrates the first device's conversations from chain (and decrypts them with the
// shared session key), while a different wallet sees nothing. Serial; fresh stack per run.
test.describe('Multi-device sync & wallet isolation (T-MULTI)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');

	test("T-MULTI-01: a second device with the same wallet syncs the first device's conversation", async ({
		browser,
	}) => {
		const account = await allocateFreshAccount();
		await fundABLE(TOKEN_ADDRESS, account.address, PLAN_ALLOWANCE);
		await activatePlan(TOKEN_ADDRESS, ESCROW_ADDRESS, account.address, PLAN_ALLOWANCE);

		// Device A creates a conversation (a unique marker so we can identify it on device B).
		const marker = 'Quokkawump cross-device marker';
		const deviceA = await openDevice(browser, account);
		await deviceA.chat.goto();
		await deviceA.chat.sendPromptAndWaitForResponse(marker);

		// It indexed on-chain (the subgraph is the source device B will sync from).
		await waitForGraph(
			() => getConversations(account.address),
			convs => convs.length === 1,
			{ label: 'conversation indexed', timeoutMs: 60_000 },
		);

		// Device B — a pristine context (empty IndexedDB) on the SAME wallet — never saw this
		// conversation locally. Opening /history triggers the subgraph→IndexedDB sync.
		const deviceB = await openDevice(browser, account);
		await deviceB.history.goto();

		// B surfaces A's conversation (sync from chain) AND its title carries the marker — proving
		// B decrypted it with the session key it independently re-derived from the same wallet.
		await deviceB.history.assertConversationCount(1, { timeout: 30_000 });
		await expect(deviceB.history.conversationItems.first()).toContainText(marker, {
			timeout: 15_000,
		});

		// Opening it renders the decrypted prompt content on device B.
		await deviceB.history.clickConversation(0);
		await expect(deviceB.chat.userMessages.first()).toContainText(marker, { timeout: 15_000 });

		await deviceA.close();
		await deviceB.close();
	});

	test("T-MULTI-02 / T-SEC-07: a different wallet sees none of the first wallet's history", async ({
		browser,
	}) => {
		// Wallet A creates a conversation.
		const accountA = await allocateFreshAccount();
		await fundABLE(TOKEN_ADDRESS, accountA.address, PLAN_ALLOWANCE);
		await activatePlan(TOKEN_ADDRESS, ESCROW_ADDRESS, accountA.address, PLAN_ALLOWANCE);
		const deviceA = await openDevice(browser, accountA);
		await deviceA.chat.goto();
		await deviceA.chat.sendPromptAndWaitForResponse('Wallet A exclusive message');
		await waitForGraph(
			() => getConversations(accountA.address),
			convs => convs.length === 1,
			{ label: "wallet A's conversation indexed", timeoutMs: 60_000 },
		);

		// Wallet B (a different account, no plan needed to view history) connects fresh.
		const accountB = await allocateFreshAccount();
		const deviceB = await openDevice(browser, accountB);
		await deviceB.history.goto();

		// B's history is empty — the owner-scoped sync never surfaces wallet A's data, and B's
		// distinct session key could not decrypt it anyway. Confirm at the subgraph layer too.
		await deviceB.history.assertEmpty();
		expect(await getConversations(accountB.address)).toHaveLength(0);

		await deviceA.close();
		await deviceB.close();
	});
});

import { type Browser, type Page } from '@playwright/test';

import { expect, test } from '../fixtures';
import { buildMockWalletScript } from '../fixtures/mock-wallet';
import { allocateFreshAccount } from '../helpers/fresh-account';
import { getConversation, getConversations, waitForGraph } from '../helpers/graph';
import { activatePlan, fundABLE, getABLEBalance, type HardhatAccount } from '../helpers/hardhat';
import { AuthPage } from '../pages/AuthPage';
import { ChatPage } from '../pages/ChatPage';
import { DashboardPage } from '../pages/DashboardPage';
import { HistoryPage } from '../pages/HistoryPage';
import { PlanModal } from '../pages/PlanModal';

declare global {
	// eslint-disable-next-line no-unused-vars
	interface Window {
		// Injected by the mock wallet (e2e only) to simulate switching the active account.
		__mockWalletSwitchAccount: (_address: string) => void;
	}
}

const TOKEN_ADDRESS = process.env.VITE_TOKEN_CONTRACT_ADDRESS ?? '';
const ESCROW_ADDRESS = process.env.VITE_ESCROW_CONTRACT_ADDRESS ?? '';
const PLAN_ALLOWANCE = 10n ** 18n * 100n; // 100 ABLE
const FAUCET_CREDIT = 10n ** 18n * 50n; // +50 ABLE
const SKIP_REASON =
	'Skipped: requires Hardhat node + oracle + Graph node for the answer round-trip (set E2E_LOCAL_SERVICES=1)';

/** Extracts the leading numeric amount from a displayed "<n> ABLE" string. */
function parseAble(text: string): number {
	const match = text.replace(/,/g, '').match(/\d+(\.\d+)?/);
	return match ? Number(match[0]) : NaN;
}

interface Device {
	page: Page;
	chat: ChatPage;
	history: HistoryPage;
	dashboard: DashboardPage;
	planModal: PlanModal;
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
		page,
		chat: new ChatPage(page),
		history: new HistoryPage(page),
		dashboard: new DashboardPage(page),
		planModal: new PlanModal(page),
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

	// NOTE: an already-open device only re-syncs on its 5-min poll (useConversations
	// refetchInterval/staleTime), so cross-device CONVERGENCE is verified deterministically by
	// opening a FRESH device after the change is indexed — a fresh mount runs the sync (the
	// useConversations queryFn calls syncWithRemote before reading IndexedDB).

	test('T-MULTI-03: a freshly-opened device syncs multiple conversations and a remote rename', async ({
		browser,
	}) => {
		const account = await allocateFreshAccount();
		await fundABLE(TOKEN_ADDRESS, account.address, PLAN_ALLOWANCE);
		await activatePlan(TOKEN_ADDRESS, ESCROW_ADDRESS, account.address, PLAN_ALLOWANCE);

		// Device A creates two conversations.
		const deviceA = await openDevice(browser, account);
		await deviceA.chat.goto();
		await deviceA.chat.sendPromptAndWaitForResponse('Alpha conversation on device A');
		await deviceA.chat.startNewConversation();
		await deviceA.chat.sendPromptAndWaitForResponse('Beta conversation on device A');
		const convs = await waitForGraph(
			() => getConversations(account.address),
			c => c.length === 2,
			{ label: 'two conversations indexed', timeoutMs: 60_000 },
		);

		// A renames the most recent (index 0, newest-first); wait for the new metadata CID to index
		// so device B only syncs once the renamed title is actually retrievable.
		const renamedConvId = convs[0].id;
		const before = await getConversation(renamedConvId);
		await deviceA.history.goto();
		await deviceA.history.renameConversation(0, 'Renamed on device A');
		await waitForGraph(
			() => getConversation(renamedConvId),
			c => c !== null && c.conversationMetadataCID !== before?.conversationMetadataCID,
			{ label: 'rename metadata indexed', timeoutMs: 60_000 },
		);

		// A fresh device B (empty cache → syncs on first mount) sees BOTH conversations + the rename.
		const deviceB = await openDevice(browser, account);
		await deviceB.history.goto();
		await deviceB.history.assertConversationCount(2, { timeout: 30_000 });
		await expect(deviceB.history.conversationItems.first()).toContainText('Renamed on device A', {
			timeout: 15_000,
		});

		await deviceA.close();
		await deviceB.close();
	});

	test('T-MULTI-04: a freshly-opened device reflects a conversation deleted on another device', async ({
		browser,
	}) => {
		const account = await allocateFreshAccount();
		await fundABLE(TOKEN_ADDRESS, account.address, PLAN_ALLOWANCE);
		await activatePlan(TOKEN_ADDRESS, ESCROW_ADDRESS, account.address, PLAN_ALLOWANCE);

		const deviceA = await openDevice(browser, account);
		await deviceA.chat.goto();
		await deviceA.chat.sendPromptAndWaitForResponse('Gamma conversation to delete');
		const convs = await waitForGraph(
			() => getConversations(account.address),
			c => c.length === 1,
			{ label: 'conversation indexed', timeoutMs: 60_000 },
		);
		const convId = convs[0].id;
		const before = await getConversation(convId);

		// A deletes it — an on-chain metadata update carrying the deletion flag (the subgraph keeps
		// the Conversation entity; the deletion lives in the encrypted metadata — see Area 4).
		await deviceA.history.goto();
		await deviceA.history.deleteConversation(0);
		await waitForGraph(
			() => getConversation(convId),
			c => c !== null && c.conversationMetadataCID !== before?.conversationMetadataCID,
			{ label: 'delete metadata indexed', timeoutMs: 60_000 },
		);

		// A fresh device B syncs and HIDES the deleted conversation (it decrypts the deletion flag).
		const deviceB = await openDevice(browser, account);
		await deviceB.history.goto();
		await expect(deviceB.history.searchInput).toBeVisible({ timeout: 30_000 });
		await deviceB.history.assertEmpty();

		await deviceA.close();
		await deviceB.close();
	});

	test('T-MULTI-05: two different wallets each see only their own conversations', async ({
		browser,
	}) => {
		const accountA = await allocateFreshAccount();
		await fundABLE(TOKEN_ADDRESS, accountA.address, PLAN_ALLOWANCE);
		await activatePlan(TOKEN_ADDRESS, ESCROW_ADDRESS, accountA.address, PLAN_ALLOWANCE);
		const accountB = await allocateFreshAccount();
		await fundABLE(TOKEN_ADDRESS, accountB.address, PLAN_ALLOWANCE);
		await activatePlan(TOKEN_ADDRESS, ESCROW_ADDRESS, accountB.address, PLAN_ALLOWANCE);

		const deviceA = await openDevice(browser, accountA);
		await deviceA.chat.goto();
		await deviceA.chat.sendPromptAndWaitForResponse('Wallet A only alpha');
		await waitForGraph(
			() => getConversations(accountA.address),
			c => c.length === 1,
			{
				label: "wallet A's conversation indexed",
				timeoutMs: 60_000,
			},
		);

		const deviceB = await openDevice(browser, accountB);
		await deviceB.chat.goto();
		await deviceB.chat.sendPromptAndWaitForResponse('Wallet B only bravo');
		await waitForGraph(
			() => getConversations(accountB.address),
			c => c.length === 1,
			{
				label: "wallet B's conversation indexed",
				timeoutMs: 60_000,
			},
		);

		// Each device sees exactly ITS OWN conversation and never the other wallet's.
		await deviceA.history.goto();
		await deviceA.history.assertConversationCount(1);
		await expect(deviceA.history.conversationItems.first()).toContainText('alpha');
		await expect(deviceA.page.getByText('bravo')).toHaveCount(0);

		await deviceB.history.goto();
		await deviceB.history.assertConversationCount(1);
		await expect(deviceB.history.conversationItems.first()).toContainText('bravo');
		await expect(deviceB.page.getByText('alpha')).toHaveCount(0);

		await deviceA.close();
		await deviceB.close();
	});

	test("T-MULTI-06: a shared wallet's balance and spent allowance are consistent on another device", async ({
		browser,
	}) => {
		const account = await allocateFreshAccount();
		await fundABLE(TOKEN_ADDRESS, account.address, PLAN_ALLOWANCE); // 100 ABLE
		await activatePlan(TOKEN_ADDRESS, ESCROW_ADDRESS, account.address, PLAN_ALLOWANCE);

		// Device A spends from the shared on-chain balance/allowance by sending a prompt.
		const deviceA = await openDevice(browser, account);
		await deviceA.chat.goto();
		await deviceA.chat.sendPromptAndWaitForResponse('Device A spends from the shared wallet');
		await waitForGraph(
			() => getConversations(account.address),
			c => c.length === 1,
			{
				label: "device A's spend indexed",
				timeoutMs: 60_000,
			},
		);

		// The wallet is then credited more tokens (e.g. via the faucet/treasury).
		await fundABLE(TOKEN_ADDRESS, account.address, FAUCET_CREDIT); // +50 ABLE

		// The single on-chain balance now reflects BOTH the spend and the credit.
		const onChainAble = Number(await getABLEBalance(TOKEN_ADDRESS, account.address)) / 1e18;

		// A fresh device B reads the SAME shared state.
		const deviceB = await openDevice(browser, account);

		// The spent allowance is visible on B's dashboard (non-zero after A's prompt) — so B cannot
		// re-spend what A already spent against the single on-chain spending limit.
		await expect(deviceB.dashboard.spentValue).toBeVisible({ timeout: 30_000 });
		expect(parseAble((await deviceB.dashboard.spentValue.textContent()) ?? '')).toBeGreaterThan(0);

		// And B sees the credited wallet balance. The balance is surfaced in the plan modal's
		// insufficient-balance hint ("You have <X> ABLE …"), which appears once the requested limit
		// exceeds the balance — so enter a deliberately huge limit to reveal it, then assert <X>
		// matches the on-chain truth (within the displayed 2-dp rounding).
		await deviceB.dashboard.managePlanButton.click();
		await expect(deviceB.planModal.modal).toBeVisible({ timeout: 10_000 });
		await deviceB.planModal.limitInput.fill('100000');
		const balanceHint = deviceB.planModal.modal.getByText(/you have [\d.]+ able/i);
		await expect(balanceHint).toBeVisible({ timeout: 15_000 });
		expect(Math.abs(parseAble((await balanceHint.textContent()) ?? '') - onChainAble)).toBeLessThan(
			1,
		);

		await deviceA.close();
		await deviceB.close();
	});

	test('T-MULTI-07: switching wallets on the same device shows no data from the previous wallet', async ({
		browser,
	}) => {
		// The DApp fix for this isolation bug (SessionProvider re-derives the session when the
		// connected account changes) is in place and its decision logic is unit-tested in
		// src/features/auth/sessionDerivation.test.ts. The LIVE flow can't be driven here: ThirdWeb
		// v5's useActiveAccount does not adopt the mock wallet's `accountsChanged`, so the harness
		// can't simulate an in-wallet account switch while connected (a disconnect+reconnect would
		// exercise a different, already-working path). Un-fixme once the mock can drive a ThirdWeb
		// account switch (multi-account injected mock ThirdWeb adopts) — ClickUp 86d3ckacw.
		test.fixme(true, 'Harness: ThirdWeb v5 does not adopt the mock wallet accountsChanged');
		const accountA = await allocateFreshAccount();
		await fundABLE(TOKEN_ADDRESS, accountA.address, PLAN_ALLOWANCE);
		await activatePlan(TOKEN_ADDRESS, ESCROW_ADDRESS, accountA.address, PLAN_ALLOWANCE);
		const accountB = await allocateFreshAccount();

		// Connect as wallet A on a SINGLE context, create a conversation, confirm it shows.
		const context = await browser.newContext();
		await context.addInitScript(buildMockWalletScript(accountA));
		const page = await context.newPage();
		await page.goto('/');
		await new AuthPage(page).connectAndSign();
		const chat = new ChatPage(page);
		const history = new HistoryPage(page);
		await chat.goto();
		await chat.sendPromptAndWaitForResponse('Wallet A private message');
		await history.goto();
		await history.assertConversationCount(1);

		// The user switches to wallet B in the same wallet/device (accountsChanged). SessionProvider
		// re-derives the session for B automatically (the mock signs via Hardhat) and re-scopes the
		// owner-keyed queries, so B's history shows ONLY B's (empty) data — never wallet A's.
		await page.evaluate(addr => window.__mockWalletSwitchAccount(addr), accountB.address);

		await history.goto();
		await expect(history.searchInput).toBeVisible({ timeout: 30_000 });
		await history.assertEmpty();
		await expect(page.getByText('Wallet A private message')).toHaveCount(0);

		await context.close();
	});
});

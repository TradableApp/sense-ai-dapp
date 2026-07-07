import { type BrowserContext } from '@playwright/test';

import { expect, test } from '../fixtures';
import { openDevice, parseAble } from '../helpers/devices';
import { allocateFreshAccount } from '../helpers/fresh-account';
import { getConversations, waitForGraph } from '../helpers/graph';
import { activatePlan, fundABLE } from '../helpers/hardhat';

const TOKEN_ADDRESS = process.env.VITE_TOKEN_CONTRACT_ADDRESS ?? '';
const ESCROW_ADDRESS = process.env.VITE_ESCROW_CONTRACT_ADDRESS ?? '';
const PLAN_ALLOWANCE = 10n ** 18n * 100n; // 100 ABLE
const SKIP_REASON =
	'Skipped: requires Hardhat node + oracle + Graph node for the answer round-trip (set E2E_LOCAL_SERVICES=1)';

// How long device A is allowed to converge after device B's action. The proof rests on this being
// well under each query's poll/stale window so the update can ONLY be event-driven (useLiveResponse
// invalidation), not a scheduled refetch: usagePlan has no refetchInterval (60s staleTime +
// refetch-on-focus only — an idle headless page never refocuses) and useConversations polls every
// 5 min. 25s comfortably beats both while leaving headroom for the event listener's retry/backoff.
const LIVE_CONVERGENCE_MS = 25_000;

// Area 11 — live cross-device sync. These encode the DESIRED behavior: an already-open, idle device
// A reflects an action taken on a second device B of the SAME wallet WITHOUT any manual refresh, and
// faster than its scheduled poll — i.e. provably event-driven.
//
// KNOWN LIMITATION — both are test.fixme (finding logged 2026-06-21, ClickUp CU-86d3dvxdy, ties
// ADR-0005). The app does NOT reliably deliver this today. useLiveResponse (MainLayout, all routes)
// DOES invalidate owner-keyed queries on a same-wallet event (gate: args.user === ownerAddress), so
// device B's events are eligible to update device A. BUT live delivery rides useContractEvents
// ({ watch:true, useIndexer:false }) whose RPC event filters "intermittently miss events"
// (wevm/wagmi#3883, per useLiveResponse's own comment), and the ONLY backstop — the effect-6 fallback
// poll — is gated on `activeConversationId && pendingAnswerRef.current`, so it helps ONLY a device
// awaiting its OWN answer in the open conversation. An idle device (dashboard/history, no pending work
// of its own) therefore has no reliable backstop: `conversations` reconverges only on its 5-min
// refetchInterval, and `usagePlan` has NO refetchInterval at all (stale until window-focus/remount).
// Empirically, idle device A did not converge within 25s on a fresh stack. Reliable convergence today
// is fresh-mount/navigation (covered by T-MULTI) or refocus. Un-fixme once the ADR-0005 realtime plane
// makes passive devices converge (robust event delivery, or a bounded background poll for
// usagePlan/conversations independent of active-conversation pending state).
//
// ADR-0002: fresh account per test; serial; fresh stack per run.
test.describe('Live cross-device sync (T-LIVE)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');

	const openContexts: BrowserContext[] = [];
	test.afterEach(async () => {
		await Promise.all(openContexts.splice(0).map(c => c.close().catch(() => {})));
	});

	test("T-LIVE-01: a prompt on device B updates device A's idle dashboard usage live (not via poll)", async ({
		browser,
	}) => {
		test.fixme(
			true,
			'Idle cross-device live sync not guaranteed — usagePlan has no poll backstop; see file header + CU-86d3dvxdy / ADR-0005.',
		);
		const account = await allocateFreshAccount();
		await fundABLE(TOKEN_ADDRESS, account.address, PLAN_ALLOWANCE);
		await activatePlan(TOKEN_ADDRESS, ESCROW_ADDRESS, account.address, PLAN_ALLOWANCE);

		// Device A sits idle on the dashboard with a fresh plan — spent is 0 ABLE and never touched
		// here (A never navigates, clicks, or refocuses after this point).
		const deviceA = await openDevice(browser, account, openContexts);
		await deviceA.dashboard.goto();
		await deviceA.dashboard.assertHasPlan(30_000);
		await expect(deviceA.dashboard.spentValue).toBeVisible({ timeout: 30_000 });
		expect(parseAble((await deviceA.dashboard.spentValue.textContent()) ?? '')).toBe(0);

		// Device B (same wallet) sends a prompt, which escrows a per-prompt fee against the SHARED
		// spending limit → spentAmount rises on-chain.
		const deviceB = await openDevice(browser, account, openContexts);
		await deviceB.chat.goto();
		await deviceB.chat.sendPromptAndWaitForResponse("Device B spends while A's dashboard watches");

		// Device A's spent value rises on its own. usagePlan has no refetchInterval and A never
		// refocused, so a scheduled refetch can't explain this within LIVE_CONVERGENCE_MS — only
		// useLiveResponse invalidating ['usagePlan'] on B's PromptSubmitted/PaymentEscrowed events.
		await expect
			.poll(async () => parseAble((await deviceA.dashboard.spentValue.textContent()) ?? ''), {
				timeout: LIVE_CONVERGENCE_MS,
				intervals: [1_000],
			})
			.toBeGreaterThan(0);
	});

	test("T-LIVE-02: a conversation created on device B appears on device A's idle history live (not via poll)", async ({
		browser,
	}) => {
		test.fixme(
			true,
			'Idle cross-device live sync not guaranteed — conversations only reconverge on the 5-min poll; see file header + CU-86d3dvxdy / ADR-0005.',
		);
		const account = await allocateFreshAccount();
		await fundABLE(TOKEN_ADDRESS, account.address, PLAN_ALLOWANCE);
		await activatePlan(TOKEN_ADDRESS, ESCROW_ADDRESS, account.address, PLAN_ALLOWANCE);

		// Device A sits idle on /history with no conversations (and never re-navigates after this).
		const deviceA = await openDevice(browser, account, openContexts);
		await deviceA.history.goto();
		await expect(deviceA.history.searchInput).toBeVisible({ timeout: 30_000 });
		await deviceA.history.assertEmpty();

		// Device B (same wallet) creates a conversation; its answer triggers ConversationAdded so the
		// conversation is indexed and the title (a unique marker) is retrievable + decryptable by A.
		const marker = 'Zephyrium live-sync history marker';
		const deviceB = await openDevice(browser, account, openContexts);
		await deviceB.chat.goto();
		await deviceB.chat.sendPromptAndWaitForResponse(marker);
		await waitForGraph(
			() => getConversations(account.address),
			convs => convs.length === 1,
			{ label: "device B's conversation indexed" },
		);

		// Device A's history populates on its own. useConversations polls only every 5 min, so an
		// appearance within LIVE_CONVERGENCE_MS proves useLiveResponse invalidated ['conversations']
		// on B's event — A then re-synced from the subgraph and decrypted the title with its shared key.
		await expect(deviceA.history.conversationItems).toHaveCount(1, {
			timeout: LIVE_CONVERGENCE_MS,
		});
		await expect(deviceA.history.conversationItems.first()).toContainText(marker, {
			timeout: 15_000,
		});
	});
});

import { expect, test } from '../fixtures';
import { getActivities, waitForGraph } from '../helpers/graph';
import { activatePlan, fundABLE } from '../helpers/hardhat';
import { DashboardPage } from '../pages/DashboardPage';

const TOKEN_ADDRESS = process.env.VITE_TOKEN_CONTRACT_ADDRESS ?? '';
const ESCROW_ADDRESS = process.env.VITE_ESCROW_CONTRACT_ADDRESS ?? '';
const PLAN_ALLOWANCE = 10n ** 18n * 100n; // 100 ABLE
const SKIP_REASON =
	'Skipped: requires Hardhat node + oracle + Graph node (set E2E_LOCAL_SERVICES=1)';

// Area 10 — Recent Activity feed. The dApp's RecentActivityCard (on the dashboard, only once a plan
// exists) reads the subgraph `Activity` log via GET_RECENT_ACTIVITY and maps each Activity.type to a
// human label (useRecentActivity). These prove the whole READ path end-to-end: an on-chain action →
// an indexed Activity row → the dashboard renders the correctly-labelled entry. ADR-0002: each test
// claims a fresh funded account; the beforeEach activation itself emits a PLAN_UPDATE Activity.

test.describe('Recent activity feed (T-ACTIVITY)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');

	test.beforeEach(async ({ freshUserAccount }) => {
		await fundABLE(TOKEN_ADDRESS, freshUserAccount.address, PLAN_ALLOWANCE);
		// Activating a plan calls setSpendingLimit → emits SpendingLimitSet → the subgraph's
		// handleSpendingLimitSet writes a PLAN_UPDATE Activity. So a plan-bearing dashboard always
		// has at least this one activity to surface.
		await activatePlan(TOKEN_ADDRESS, ESCROW_ADDRESS, freshUserAccount.address, PLAN_ALLOWANCE);
	});

	test('T-ACTIVITY-01: activating a plan indexes a PLAN_UPDATE activity the dashboard shows as "Spending Limit Updated"', async ({
		freshUserAccount,
		freshPage,
	}) => {
		await waitForGraph(
			() => getActivities(freshUserAccount.address),
			acts => acts.some(a => a.type === 'PLAN_UPDATE'),
			{ label: 'PLAN_UPDATE activity indexed', timeoutMs: 60_000 },
		);

		const dashboard = new DashboardPage(freshPage);
		await dashboard.goto();
		await expect(dashboard.activityCard).toBeVisible({ timeout: 30_000 });
		// useRecentActivity maps PLAN_UPDATE → "Spending Limit Updated".
		await expect(freshPage.getByText('Spending Limit Updated').first()).toBeVisible({
			timeout: 30_000,
		});
	});

	test('T-ACTIVITY-02: sending a prompt indexes a CONVERSATION activity the dashboard shows as "AI Conversation"', async ({
		freshUserAccount,
		freshChatPage,
		freshPage,
	}) => {
		await freshChatPage.goto();
		await freshChatPage.sendPromptAndWaitForResponse('What is the sentiment on ABLE right now?');

		await waitForGraph(
			() => getActivities(freshUserAccount.address),
			acts => acts.some(a => a.type === 'CONVERSATION'),
			{ label: 'CONVERSATION activity indexed', timeoutMs: 60_000 },
		);

		const dashboard = new DashboardPage(freshPage);
		await dashboard.goto();
		await expect(dashboard.activityCard).toBeVisible({ timeout: 30_000 });
		// useRecentActivity maps CONVERSATION → "AI Conversation".
		await expect(freshPage.getByText('AI Conversation').first()).toBeVisible({ timeout: 30_000 });
	});

	test('T-ACTIVITY-03: the activity log is ordered newest-first (a prompt after activation sorts ahead of it)', async ({
		freshUserAccount,
		freshChatPage,
	}) => {
		// The beforeEach already activated the plan (PLAN_UPDATE). A subsequent prompt escrows payment
		// (PaymentEscrowed → CONVERSATION), and being the later action must sort ahead of the older
		// PLAN_UPDATE when the feed is ordered by timestamp desc.
		await freshChatPage.goto();
		await freshChatPage.sendPromptAndWaitForResponse('Newest-activity ordering check');

		const acts = await waitForGraph(
			() => getActivities(freshUserAccount.address),
			a => a.some(x => x.type === 'CONVERSATION') && a.some(x => x.type === 'PLAN_UPDATE'),
			{ label: 'both CONVERSATION + PLAN_UPDATE indexed', timeoutMs: 60_000 },
		);

		// getActivities is orderBy timestamp desc — the prompt (CONVERSATION) is the most recent.
		expect(acts[0].type).toBe('CONVERSATION');
		// And the whole list is non-increasing in timestamp (newest-first).
		const timestamps = acts.map(a => Number(a.timestamp));
		expect(timestamps).toEqual([...timestamps].sort((x, y) => y - x));
	});
});

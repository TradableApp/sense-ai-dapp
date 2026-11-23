import formatTokenAmount from '@/lib/tokenAmount';

import { expect, test } from '../fixtures';
import { advanceTime, LIVE_STACK } from '../helpers/chain';
import { ESCROW_ADDRESS, fundAndActivatePlan, TOKEN_ADDRESS } from '../helpers/contracts';
import { getActivities, subgraphHasType, waitForGraph } from '../helpers/graph';
import { DashboardPage } from '../pages/DashboardPage';

const SKIP_REASON =
	'Skipped: requires Hardhat node + oracle + Graph node (set E2E_LOCAL_SERVICES=1)';

// Cancel timing, as in cancel.spec.ts: the mock oracle holds the answer past the cancel window on
// localnet; on testnet the real oracle's round trip keeps the prompt pending. The escrow refuses a
// cancel until 3 s after the prompt, so time is advanced past that before the click.
const HOLD_MS = 8000;
const CANCELLATION_TIMEOUT_S = 3;

// The type the subgraph adds in the version that records a cancel's returned amount. Its presence
// in the deployed schema is what says a CANCEL_RETURN row must exist; the row's own presence
// cannot say so, or a regression that stops writing it would pass. The type itself pairs paid
// actions with their fees and has nothing to do with a cancel: it stands in only because both
// arrive in the same subgraph version, so a subgraph that ships one without the other (or drops
// or renames the type) needs this constant changed with it.
const RETURN_RECORDING_TYPE = 'PendingDirectPayment';

// Decimal places of the fee token. Both fee token profiles use 18, as do the amounts this suite
// funds with (helpers/contracts ABLE()). The card formats with the profile's decimals, which this
// spec cannot read from Node (the profile comes from the build's import.meta.env).
const FEE_TOKEN_DECIMALS = 18;

/** The amount cell's text as the card shows it, matched at the end of the row's text: the exact
 *  amount, a space and the symbol, not preceded by a digit, point or sign. */
function shownAmount(raw: string): RegExp {
	// Every regex metacharacter is escaped, the backslash included, so the amount is matched as text.
	const exact = formatTokenAmount(BigInt(raw), FEE_TOKEN_DECIMALS).replace(
		/[.*+?^${}()|[\]\\]/g,
		'\\$&',
	);
	return new RegExp(`(?:^|[^0-9.-])${exact} \\S+$`);
}

// Area 10 — Recent Activity feed. The dApp's RecentActivityCard (on the dashboard, only once a plan
// exists) reads the subgraph `Activity` log via GET_RECENT_ACTIVITY and maps each Activity.type to a
// human label (useRecentActivity). These prove the whole READ path end-to-end: an on-chain action →
// an indexed Activity row → the dashboard renders the correctly-labelled entry. ADR-0002: each test
// claims a fresh funded account; the beforeEach activation itself emits a PLAN_UPDATE Activity.

test.describe('Recent activity feed (T-ACTIVITY)', () => {
	test.skip(!LIVE_STACK, SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');

	test.beforeEach(async ({ freshUserAccount }) => {
		// Activating a plan calls setSpendingLimit → emits SpendingLimitSet → the subgraph's
		// handleSpendingLimitSet writes a PLAN_UPDATE Activity. So a plan-bearing dashboard always
		// has at least this one activity to surface.
		await fundAndActivatePlan(freshUserAccount.address);
	});

	test('T-ACTIVITY-01: activating a plan indexes a PLAN_UPDATE activity the dashboard shows as "Spending Limit Updated"', async ({
		freshUserAccount,
		freshPage,
	}) => {
		await waitForGraph(
			() => getActivities(freshUserAccount.address),
			acts => acts.some(a => a.type === 'PLAN_UPDATE'),
			{ label: 'PLAN_UPDATE activity indexed' },
		);

		const dashboard = new DashboardPage(freshPage);
		await dashboard.goto();
		await expect(dashboard.activityCard).toBeVisible({ timeout: 30_000 });
		// useRecentActivity maps PLAN_UPDATE → "Spending Limit Updated". Scope to the card so the match
		// is proven to be a feed row, not the same string somewhere else in the layout.
		await expect(dashboard.activityCard.getByText('Spending Limit Updated').first()).toBeVisible({
			timeout: 30_000,
		});
	});

	test('T-ACTIVITY-02: sending a prompt indexes a CONVERSATION activity the dashboard shows as "AI Conversation"', async ({
		freshUserAccount,
		freshChatPage,
		freshPage,
	}) => {
		await freshChatPage.goto();
		await freshChatPage.sendPromptAndWaitForResponse('What is the sentiment on BTC right now?');

		await waitForGraph(
			() => getActivities(freshUserAccount.address),
			acts => acts.some(a => a.type === 'CONVERSATION'),
			{ label: 'CONVERSATION activity indexed' },
		);

		const dashboard = new DashboardPage(freshPage);
		await dashboard.goto();
		await expect(dashboard.activityCard).toBeVisible({ timeout: 30_000 });
		// useRecentActivity maps CONVERSATION → "AI Conversation". Scoped to the card (see T-ACTIVITY-01).
		await expect(dashboard.activityCard.getByText('AI Conversation').first()).toBeVisible({
			timeout: 30_000,
		});
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
			{ label: 'both CONVERSATION + PLAN_UPDATE indexed' },
		);

		// getActivities is orderBy timestamp desc — the prompt (CONVERSATION) is the most recent.
		expect(acts[0].type).toBe('CONVERSATION');
		// And the whole list is non-increasing in timestamp (newest-first).
		const timestamps = acts.map(a => Number(a.timestamp));
		expect(timestamps).toEqual([...timestamps].sort((x, y) => y - x));
	});

	test('T-ACTIVITY-04: a cancelled prompt shows the amount paid, the fee and the amount returned', async ({
		freshUserAccount,
		freshChatPage,
		freshPage,
	}) => {
		const owner = freshUserAccount.address;
		await freshChatPage.goto();
		await freshChatPage.sendDelayedPrompt('Hold this one so it can be cancelled', HOLD_MS);
		await expect(freshChatPage.cancelButton).toBeVisible({ timeout: 30_000 });
		await advanceTime(CANCELLATION_TIMEOUT_S + 1);
		await freshChatPage.cancelButton.click();

		const acts = await waitForGraph(
			() => getActivities(owner),
			a => a.some(x => x.type === 'CONVERSATION') && a.some(x => x.type === 'CANCEL'),
			{ label: 'CONVERSATION + CANCEL activities indexed' },
		);
		const paid = acts.find(a => a.type === 'CONVERSATION');
		const fee = acts.find(a => a.type === 'CANCEL');
		if (!paid || !fee) throw new Error('waitForGraph returned without the rows it waited for');
		// The payment and the fee are both money going out.
		expect(BigInt(paid.amount)).toBeLessThan(0n);
		expect(BigInt(fee.amount)).toBeLessThan(0n);

		// Decided from the stack: a subgraph whose schema declares the return-recording type writes
		// CANCEL_RETURN in the same handler as CANCEL, so once CANCEL is indexed the return row must
		// be there too. Only a subgraph without that type (an older build) leaves it out.
		const recordsReturn = await subgraphHasType(RETURN_RECORDING_TYPE);
		const returned = acts.find(
			a => a.type === 'CANCEL_RETURN' && a.transactionHash === fee.transactionHash,
		);
		if (recordsReturn) {
			expect(
				returned,
				`the subgraph declares ${RETURN_RECORDING_TYPE}, so this cancel must have a CANCEL_RETURN row`,
			).toBeDefined();
			if (!returned) throw new Error('unreachable: asserted above');
			expect(returned.id).toBe(`${fee.id}-return`);
			// The whole payment comes back; the fee is what the cancel cost.
			expect(BigInt(returned.amount)).toBe(-BigInt(paid.amount));
		} else {
			expect(returned, 'a subgraph without the type writes no return row').toBeUndefined();
			const reason =
				`Returned amount not asserted: the subgraph schema has no ${RETURN_RECORDING_TYPE} ` +
				'(it predates the CANCEL_RETURN row). The paid and fee rows were checked.';
			test.info().annotations.push({ type: 'not asserted', description: reason });
			console.warn(`[T-ACTIVITY-04] ${reason}`);
		}

		const dashboard = new DashboardPage(freshPage);
		await dashboard.goto();
		await expect(dashboard.activityCard).toBeVisible({ timeout: 30_000 });
		await expect(dashboard.activityCard.getByText('AI Conversation').first()).toBeVisible({
			timeout: 30_000,
		});
		await expect(dashboard.activityRow('Prompt Cancelled')).toHaveText(shownAmount(fee.amount), {
			timeout: 30_000,
		});
		if (returned) {
			// The exact label and the exact amount handed back, as the chain moved it.
			await expect(dashboard.activityRow('Prompt Amount Returned')).toHaveText(
				shownAmount(returned.amount),
				{ timeout: 30_000 },
			);
		}
		await expect(dashboard.activityCard.getByText('Unknown Action')).toHaveCount(0);
	});
});

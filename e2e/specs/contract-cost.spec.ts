import { expect, test } from '../fixtures';
import { TEST_ACCOUNT } from '../fixtures/mock-wallet';
import {
	activatePlan,
	fundABLE,
	getABLEBalance,
	getPromptFee,
	getSpendingLimit,
	revertToSnapshot,
	setPromptFee,
	takeSnapshot,
} from '../helpers/hardhat';

// Proves the contract→dApp cost continuity: changing the on-chain per-prompt fee
// (EVMAIAgentEscrow.promptFee, owner-only) is debited per prompt and surfaced in
// the dApp's usage. The escrow debits `promptFee` at initiatePrompt (submission),
// so these tests only need the prompt SUBMITTED, not answered — they wait on the
// thinking indicator, which keeps them independent of the localnet answer-content
// retrieval gap (follow-up #27).
//
// FINDING (per the agreed scope): the dApp surfaces the per-prompt cost only
// INDIRECTLY — as the debited "Spent" amount / balance delta. It reads
// `promptFee` nowhere (not via contract, not via the subgraph `FeeConfig`
// entity), so there is no explicit "price per prompt" label shown to the user
// before sending. Tracked as a product follow-up.

const TOKEN_ADDRESS = process.env.VITE_TOKEN_CONTRACT_ADDRESS ?? '';
const ESCROW_ADDRESS = process.env.VITE_ESCROW_CONTRACT_ADDRESS ?? '';
const SKIP_REASON =
	'Skipped: requires Hardhat node + oracle + Graph node (set E2E_LOCAL_SERVICES=1)';

const ABLE = (whole: number): bigint => 10n ** 18n * BigInt(whole);
const PLAN_ALLOWANCE = ABLE(100);

test.describe('Contract cost change → dApp/usage (T-COST)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');

	let snapshotId: string;

	test.beforeEach(async () => {
		snapshotId = await takeSnapshot();
		await fundABLE(TOKEN_ADDRESS, TEST_ACCOUNT.address, PLAN_ALLOWANCE);
		await activatePlan(TOKEN_ADDRESS, ESCROW_ADDRESS, TEST_ACCOUNT.address, PLAN_ALLOWANCE);
	});

	test.afterEach(async () => {
		await revertToSnapshot(snapshotId);
	});

	test('T-COST-01: a changed promptFee is the amount debited per prompt (on-chain)', async ({
		chatPage,
	}) => {
		const newFee = ABLE(5);
		const defaultFee = await getPromptFee(ESCROW_ADDRESS);
		expect(newFee).not.toBe(defaultFee); // the change must be observable

		await setPromptFee(ESCROW_ADDRESS, newFee);
		expect(await getPromptFee(ESCROW_ADDRESS)).toBe(newFee);

		const balanceBefore = await getABLEBalance(TOKEN_ADDRESS, TEST_ACCOUNT.address);

		await chatPage.goto();
		await chatPage.sendPrompt('What is the current market sentiment?');
		// Thinking indicator ⇒ the initiatePrompt tx mined and escrowed the fee.
		await expect(chatPage.thinkingIndicator).toBeVisible({ timeout: 20_000 });

		const balanceAfter = await getABLEBalance(TOKEN_ADDRESS, TEST_ACCOUNT.address);
		const { spentAmount } = await getSpendingLimit(ESCROW_ADDRESS, TEST_ACCOUNT.address);

		// The user is debited exactly the new fee, and the spending-limit "spent"
		// (what the dApp reads for usage) reflects it.
		expect(balanceBefore - balanceAfter).toBe(newFee);
		expect(spentAmount).toBe(newFee);
	});

	test('T-COST-02: the dApp usage dashboard reflects the changed per-prompt cost', async ({
		chatPage,
		dashboardPage,
	}) => {
		const newFee = ABLE(7);
		await setPromptFee(ESCROW_ADDRESS, newFee);

		await chatPage.goto();
		await chatPage.sendPrompt('Reflect the new cost in my usage');
		await expect(chatPage.thinkingIndicator).toBeVisible({ timeout: 20_000 });

		// useLiveResponse invalidates ['usagePlan'] for any token-costing action, so
		// the dashboard re-reads spendingLimits.spentAmount without a reload. After
		// one prompt at the new fee, "Spent" shows 7 ABLE.
		await dashboardPage.goto();
		await dashboardPage.assertHasPlan();
		await expect(dashboardPage.spentValue).toHaveText(/\b7\b.*ABLE/, { timeout: 20_000 });
	});
});

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

		// useLiveResponse invalidates ['usagePlan'] on any token-costing action;
		// invalidateQueries refetches the active observer, so the mounted dashboard
		// re-reads spendingLimits.spentAmount within the assertion window (the stale
		// mark also survives the chat→dashboard unmount, covering a mount-time
		// refetch — useUsagePlan's 60s staleTime is bypassed by the invalidation, not
		// relied upon). No reload needed. After one prompt at the new fee, Spent = 7.
		await dashboardPage.goto();
		await dashboardPage.assertHasPlan();
		await expect(dashboardPage.spentValue).toHaveText(/\b7\b.*ABLE/, { timeout: 20_000 });
	});

	test('T-COST-03: two different fees debit their respective amounts across prompts', async ({
		chatPage,
	}) => {
		// Sending a SECOND prompt requires the first to finish (isAiThinking clears
		// when the answer content arrives). On localnet that's blocked by the
		// answer-content retrieval gap (#27) — the assistant message never gets
		// content, so the composer stays disabled. Un-fixme this together with the
		// chat T-CHAT-08/10/11/12 specs once #27 lands; it proves the fee change is
		// dynamic across sequential prompts, not just a one-shot.
		test.fixme(true, 'Blocked on localnet answer-content retrieval (#27) — see chat.spec fixmes.');

		const feeA = ABLE(3);
		const feeB = ABLE(8);

		await setPromptFee(ESCROW_ADDRESS, feeA);
		const before1 = await getABLEBalance(TOKEN_ADDRESS, TEST_ACCOUNT.address);
		await chatPage.goto();
		await chatPage.sendPrompt('First prompt at fee A');
		await expect(chatPage.thinkingIndicator).toBeVisible({ timeout: 20_000 });
		const after1 = await getABLEBalance(TOKEN_ADDRESS, TEST_ACCOUNT.address);
		expect(before1 - after1).toBe(feeA);

		await setPromptFee(ESCROW_ADDRESS, feeB);
		// Once #27 is fixed the answer arrives and thinking clears, re-enabling the
		// composer for the second prompt.
		await expect(chatPage.thinkingIndicator).toBeHidden({ timeout: 90_000 });
		const before2 = await getABLEBalance(TOKEN_ADDRESS, TEST_ACCOUNT.address);
		await chatPage.sendPrompt('Second prompt at fee B');
		await expect(chatPage.thinkingIndicator).toBeVisible({ timeout: 20_000 });
		const after2 = await getABLEBalance(TOKEN_ADDRESS, TEST_ACCOUNT.address);
		expect(before2 - after2).toBe(feeB);
	});
});

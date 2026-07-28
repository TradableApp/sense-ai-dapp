import { expect, test } from '../fixtures';
import { ABLE, ESCROW_ADDRESS, PLAN_ALLOWANCE, TOKEN_ADDRESS } from '../helpers/contracts';
import {
	activatePlan,
	fundABLE,
	getABLEBalance,
	getPromptFee,
	getSpendingLimit,
	setPromptFee,
	usePromptFeeRestore,
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

const SKIP_REASON =
	'Skipped: requires Hardhat node + oracle + Graph node (set E2E_LOCAL_SERVICES=1)';

test.describe('Contract cost change → dApp/usage (T-COST)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');

	// ADR-0002: fresh account per test, no snapshot/revert — `evm_revert` wedges
	// graph-node's ingestor and freezes the subgraph for the rest of the invocation
	// (CU-86d3uqgh7). promptFee is GLOBAL on the escrow, so it is captured and restored
	// forward-only, exactly as T-COST-MULTI and T-COST-REGEN below already do.
	usePromptFeeRestore(test, ESCROW_ADDRESS);

	test.beforeEach(async ({ freshUserAccount }) => {
		await fundABLE(TOKEN_ADDRESS, freshUserAccount.address, PLAN_ALLOWANCE);
		await activatePlan(TOKEN_ADDRESS, ESCROW_ADDRESS, freshUserAccount.address, PLAN_ALLOWANCE);
	});

	test('T-COST-01: a changed promptFee is the amount debited per prompt (on-chain)', async ({
		freshChatPage,
		freshUserAccount,
	}) => {
		const newFee = ABLE(5);
		const defaultFee = await getPromptFee(ESCROW_ADDRESS);
		expect(newFee).not.toBe(defaultFee); // the change must be observable

		await setPromptFee(ESCROW_ADDRESS, newFee);
		expect(await getPromptFee(ESCROW_ADDRESS)).toBe(newFee);

		const balanceBefore = await getABLEBalance(TOKEN_ADDRESS, freshUserAccount.address);

		await freshChatPage.goto();
		await freshChatPage.sendPrompt('What is the current market sentiment?');
		// Thinking indicator ⇒ the initiatePrompt tx mined and escrowed the fee.
		await expect(freshChatPage.thinkingIndicator).toBeVisible({ timeout: 20_000 });

		const balanceAfter = await getABLEBalance(TOKEN_ADDRESS, freshUserAccount.address);
		const { spentAmount } = await getSpendingLimit(ESCROW_ADDRESS, freshUserAccount.address);

		// The user is debited exactly the new fee, and the spending-limit "spent"
		// (what the dApp reads for usage) reflects it.
		expect(balanceBefore - balanceAfter).toBe(newFee);
		expect(spentAmount).toBe(newFee);
	});

	test('T-COST-02: the dApp usage dashboard reflects the changed per-prompt cost', async ({
		freshChatPage,
		freshDashboardPage,
	}) => {
		const newFee = ABLE(7);
		await setPromptFee(ESCROW_ADDRESS, newFee);

		await freshChatPage.goto();
		await freshChatPage.sendPrompt('Reflect the new cost in my usage');
		await expect(freshChatPage.thinkingIndicator).toBeVisible({ timeout: 20_000 });

		// useLiveResponse invalidates ['usagePlan'] on any token-costing action;
		// invalidateQueries refetches the active observer, so the mounted dashboard
		// re-reads spendingLimits.spentAmount within the assertion window (the stale
		// mark also survives the chat→dashboard unmount, covering a mount-time
		// refetch — useUsagePlan's 60s staleTime is bypassed by the invalidation, not
		// relied upon). No reload needed. After one prompt at the new fee, Spent = 7.
		await freshDashboardPage.goto();
		await freshDashboardPage.assertHasPlan();
		await expect(freshDashboardPage.spentValue).toHaveText(/\b7\b.*ABLE/, { timeout: 20_000 });
	});
});

// T-COST-03 needs the FIRST answer to render before the second prompt (the
// composer re-enables only when isAiThinking clears), so it depends on the full
// answer pipeline. Like the T-CHAT answer specs it therefore runs as a FRESH
// per-test user (accounts 2..19) over a real mid-session connect, forward-only —
// no snapshot/revert (CU-86d3a04rr).
test.describe('Contract cost change across prompts (T-COST-MULTI)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');

	// promptFee is GLOBAL on the escrow, so capture and restore it forward-only (no
	// chain revert) — otherwise the fee this test sets leaks into any later project
	// that assumes the default.
	usePromptFeeRestore(test, ESCROW_ADDRESS);

	test.beforeEach(async ({ freshUserAccount }) => {
		await fundABLE(TOKEN_ADDRESS, freshUserAccount.address, PLAN_ALLOWANCE);
		await activatePlan(TOKEN_ADDRESS, ESCROW_ADDRESS, freshUserAccount.address, PLAN_ALLOWANCE);
	});

	test('T-COST-03: two different fees debit their respective amounts across prompts', async ({
		freshChatPage,
		freshUserAccount,
	}) => {
		const feeA = ABLE(3);
		const feeB = ABLE(8);

		await setPromptFee(ESCROW_ADDRESS, feeA);
		const before1 = await getABLEBalance(TOKEN_ADDRESS, freshUserAccount.address);
		await freshChatPage.goto();
		await freshChatPage.sendPrompt('First prompt at fee A');
		await expect(freshChatPage.thinkingIndicator).toBeVisible({ timeout: 20_000 });
		const after1 = await getABLEBalance(TOKEN_ADDRESS, freshUserAccount.address);
		expect(before1 - after1).toBe(feeA);

		await setPromptFee(ESCROW_ADDRESS, feeB);
		// The answer arrives (local IPFS) and thinking clears, re-enabling the
		// composer for the second prompt.
		await expect(freshChatPage.thinkingIndicator).toBeHidden({ timeout: 90_000 });
		const before2 = await getABLEBalance(TOKEN_ADDRESS, freshUserAccount.address);
		await freshChatPage.sendPrompt('Second prompt at fee B');
		await expect(freshChatPage.thinkingIndicator).toBeVisible({ timeout: 20_000 });
		const after2 = await getABLEBalance(TOKEN_ADDRESS, freshUserAccount.address);
		expect(before2 - after2).toBe(feeB);
	});
});

// Insufficient-balance boundary. The escrow guards EVERY token-costing action
// (prompt/regenerate/branch/metadata) with the same allowance + balance check, so
// per-function revert coverage lives in the contract unit tests (tokenized-ai-agent).
// The e2e covers the user-facing surface ONCE on the representative action (prompt):
// the dApp shows the right failure when the wallet can't cover the next fee.
test.describe('Insufficient balance blocks an action (T-COST-INSUFFICIENT)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');

	// No funding hook — this spec intentionally controls the wallet's balance itself, and a
	// freshly claimed account holds 0 ABLE, which is the state the snapshot used to restore.
	// The revert also used to undo the promptFee set below; that is now an explicit
	// forward-only restore, since promptFee is GLOBAL on the escrow (ADR-0002,
	// CU-86d3uqgh7).
	usePromptFeeRestore(test, ESCROW_ADDRESS);

	test('T-COST-04: a prompt fails when the wallet holds less ABLE than the fee', async ({
		freshChatPage,
		freshUserAccount,
	}) => {
		const fee = ABLE(10);
		await setPromptFee(ESCROW_ADDRESS, fee);
		// The plan activates fine (approve + setSpendingLimit move no tokens), but the
		// wallet holds LESS than one fee — so initiatePrompt's transferFrom(user, escrow,
		// fee) reverts ERC20InsufficientBalance, which the dApp surfaces as a toast (with
		// the localnet faucet). This is the "ran out of ABLE" boundary.
		await fundABLE(TOKEN_ADDRESS, freshUserAccount.address, ABLE(3));
		await activatePlan(TOKEN_ADDRESS, ESCROW_ADDRESS, freshUserAccount.address, PLAN_ALLOWANCE);

		await freshChatPage.goto();
		await freshChatPage.sendPrompt('Not enough ABLE to cover the fee');

		await expect(freshChatPage.insufficientBalanceToast).toBeVisible({ timeout: 15_000 });
		// The prompt was rejected, not accepted — no thinking indicator appears.
		await expect(freshChatPage.thinkingIndicator).toBeHidden();
	});
});

// Spot-check that the SAME escrow guard applies to a second costing action
// (regenerate), not just the initial prompt — confirming the shared guard rather
// than re-testing every action through the UI (which the contract unit tests own).
// Fresh per-test user, forward-only (no snapshot/revert) so the answer renders.
test.describe('Insufficient balance blocks regenerate (T-COST-REGEN)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');

	usePromptFeeRestore(test, ESCROW_ADDRESS);

	test('T-COST-05: regenerate fails once the wallet can no longer cover the fee', async ({
		freshChatPage,
		freshUserAccount,
	}) => {
		const fee = ABLE(10);
		await setPromptFee(ESCROW_ADDRESS, fee);
		// Fund EXACTLY one fee: the first prompt succeeds and drains the wallet to 0, so
		// the follow-up regenerate (another fee) hits ERC20InsufficientBalance — proving
		// the guard covers regenerate too, not just the initial prompt (T-COST-04).
		await fundABLE(TOKEN_ADDRESS, freshUserAccount.address, fee);
		await activatePlan(TOKEN_ADDRESS, ESCROW_ADDRESS, freshUserAccount.address, PLAN_ALLOWANCE);

		await freshChatPage.goto();
		await freshChatPage.sendPromptAndWaitForResponse('Spend my last ABLE'); // debits the only fee

		await freshChatPage.regenerate();
		await expect(freshChatPage.insufficientBalanceToast).toBeVisible({ timeout: 15_000 });
	});
});

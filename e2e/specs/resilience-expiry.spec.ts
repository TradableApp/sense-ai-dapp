import { expect, test } from '../fixtures';
import { BUDGET, RESILIENCE_BUDGET } from '../helpers/budgets';
import { CHAIN, LIVE_STACK, LIVE_STACK_SKIP_REASON, sendFrom } from '../helpers/chain';
import { ABLE, ESCROW_ADDRESS, PLAN_ALLOWANCE, TOKEN_ADDRESS } from '../helpers/contracts';
import { waitForGraph } from '../helpers/graph';
import { fundABLE } from '../helpers/hardhat';
import {
	approveCalldata,
	evidenceDirFrom,
	EXPIRY_TTL_S,
	expiryTarget,
	setSpendingLimitCalldata,
	waitForChainTime,
	writeResilienceEvidence,
} from '../helpers/resilience';
import {
	blockTimestampS,
	getSpendingLimitEntity,
	latestChainTimeS,
	pendingEscrowCount,
	receiptOf,
	registeredSecrets,
	sleepMs,
} from '../helpers/resilience-chain';

// R-EXPIRY-01 — a spending limit that expires is rejected in the dApp (testnet-resilience only).
//
// The dApp form offers whole days only, so the limit is set Node-side with an ABSOLUTE expiry
// ~120 s ahead of the latest block. The check then waits for CHAIN time to pass that expiry,
// because the contract compares block.timestamp, and asserts the dApp's rejection, the on-chain
// pending count and the subgraph's copy of the expiry. No oracle is involved.
//
// Run from the sense-ai-e2e runner with E2E_TESTNET=1; never in CI.
const SKIP_TESTNET_ONLY =
	'Skipped: resilience specs run only on testnet (testnet-resilience project)';

test.describe('Resilience — spending-limit expiry on testnet (R-EXPIRY-01)', () => {
	test.skip(!LIVE_STACK, LIVE_STACK_SKIP_REASON);
	test.skip(CHAIN !== 'testnet', SKIP_TESTNET_ONLY);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');

	test('R-EXPIRY-01: a spending limit that expires is rejected in the dApp', async ({
		freshUserAccount,
		freshPage,
		freshDashboardPage,
		freshChatPage,
	}) => {
		test.setTimeout(RESILIENCE_BUDGET.expiryTestTimeoutMs);
		const owner = freshUserAccount.address;
		const evidence: Record<string, unknown> = {
			check: 'R-EXPIRY-01',
			chain: CHAIN,
			account: owner,
		};

		try {
			// 1. Fund, approve and set a limit that expires EXPIRY_TTL_S past the latest block.
			await fundABLE(TOKEN_ADDRESS, owner, ABLE(20));
			const approveHash = await sendFrom({
				from: owner,
				to: TOKEN_ADDRESS,
				data: approveCalldata(ESCROW_ADDRESS, PLAN_ALLOWANCE),
			});
			const expiresAt = expiryTarget(BigInt(await latestChainTimeS()), EXPIRY_TTL_S);
			const setHash = await sendFrom({
				from: owner,
				to: ESCROW_ADDRESS,
				data: setSpendingLimitCalldata(PLAN_ALLOWANCE, expiresAt),
			});
			const setReceipt = await receiptOf(setHash);
			evidence.approve = { txHash: approveHash };
			evidence.setSpendingLimit = {
				txHash: setHash,
				blockNumber: setReceipt.blockNumber,
				blockTimestampS: await blockTimestampS(setReceipt.blockNumber),
				allowance: PLAN_ALLOWANCE,
				expiresAt,
			};

			// 2. The plan reads as active in the dashboard before the expiry.
			await freshDashboardPage.goto();
			await freshDashboardPage.assertHasPlan();
			await expect(freshPage.getByText('Limit has expired')).toHaveCount(0);

			// 3. Wait for CHAIN time to pass the expiry (plus a margin), not the wall clock.
			const chainTimeAtWait = await waitForChainTime({
				targetS: Number(expiresAt) + RESILIENCE_BUDGET.expiryMarginS,
				readChainTimeS: latestChainTimeS,
				sleep: sleepMs,
				now: Date.now,
				pollMs: RESILIENCE_BUDGET.chainTimePollMs,
				timeoutMs: RESILIENCE_BUDGET.expiryTestTimeoutMs,
			});
			evidence.chainTimeAtExpiryWaitS = chainTimeAtWait;

			// 4. The dashboard now says the limit has expired.
			await freshDashboardPage.goto();
			await expect(freshPage.getByText('Limit has expired').first()).toBeVisible({
				timeout: BUDGET.indexMs,
			});

			// 5. A prompt is rejected by the contract's SpendingLimitExpired revert, shown as a toast.
			await freshChatPage.goto();
			await freshChatPage.sendPrompt('R-EXPIRY-01 prompt after the limit expired');
			await expect(freshPage.getByText('Plan Expired').first()).toBeVisible({
				timeout: BUDGET.ownMessageVisibleMs,
			});
			await expect(
				freshPage
					.getByText('Your spending limit has expired. Please renew it in the dashboard.')
					.first(),
			).toBeVisible();

			// 6. No escrow was created: the chain reports zero pending escrows for this user.
			const pending = await pendingEscrowCount(ESCROW_ADDRESS, owner);
			evidence.pendingEscrowCount = pending;
			expect(pending, 'no escrow may be created for an expired limit').toBe(0n);

			// 7. The subgraph's SpendingLimit carries the expiry we set.
			const indexed = await waitForGraph(
				() => getSpendingLimitEntity(owner),
				entity => entity?.expiresAt === expiresAt.toString(),
				{ label: 'SpendingLimit.expiresAt', timeoutMs: RESILIENCE_BUDGET.indexWaitMs },
			);
			evidence.subgraphSpendingLimit = indexed;
			expect(indexed?.expiresAt).toBe(expiresAt.toString());
		} finally {
			writeResilienceEvidence({
				dir: evidenceDirFrom(process.env),
				name: 'expiry',
				evidence,
				secrets: registeredSecrets(),
			});
		}
	});
});

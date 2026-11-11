import { REFUND_TIMEOUT_MS } from '@/lib/constants';

import { expect, test } from '../fixtures';
import { BUDGET, RESILIENCE_BUDGET } from '../helpers/budgets';
import { CHAIN, LIVE_STACK, LIVE_STACK_SKIP_REASON, sendFrom } from '../helpers/chain';
import { ESCROW_ADDRESS, fundAndActivatePlan, TOKEN_ADDRESS } from '../helpers/contracts';
import {
	getActivities,
	getPromptRequests,
	type IndexedPromptRequest,
	waitForGraph,
} from '../helpers/graph';
import { getABLEBalance } from '../helpers/hardhat';
import {
	evidenceDirFrom,
	oracleDownSkipReason,
	processRefundCalldata,
	refundReadiness,
	waitForChainTime,
	writeResilienceEvidence,
} from '../helpers/resilience';
import {
	blockTimestampS,
	getPaymentRecords,
	latestChainTimeS,
	type PaymentRecord,
	pendingEscrowCount,
	receiptOf,
	refundTimeoutSeconds,
	registeredSecrets,
	sleepMs,
	waitForRefundLog,
} from '../helpers/resilience-chain';
import { DashboardPage } from '../pages/DashboardPage';

// R-REFUND-01 — the real 1 h timeout refund through the dApp's own button (testnet-resilience).
//
// Precondition: the oracle is DOWN, so the prompt is never answered and its escrow stays pending.
// The runner declares that with E2E_RESILIENCE_ORACLE_DOWN=1; without it the check is skipped.
//
// The dApp refund button needs two gates open: the contract's (chain time >= createdAt + 1 h) and
// the dApp's (wall clock > createdAt + REFUND_TIMEOUT_MS). Both are waited out for real, gently,
// with the page left open so the dashboard's own refetch flips the button on.
//
// Fallback: if the UI path fails after the hour, processRefund is sent Node-side so the window is
// not lost, and the path is recorded as `script-fallback`. The chain assertions still run, and the
// final assertion fails the test, because a fallback is a finding about the UI.
type RefundPath = 'ui' | 'script-fallback';

const SKIP_TESTNET_ONLY =
	'Skipped: resilience specs run only on testnet (testnet-resilience project)';
const isPending = (r: IndexedPromptRequest): boolean =>
	!r.isAnswered && !r.isCancelled && !r.isRefunded;

test.describe('Resilience — real 1 h refund through the dApp (R-REFUND-01)', () => {
	const oracleSkip = oracleDownSkipReason(process.env);
	test.skip(!LIVE_STACK, LIVE_STACK_SKIP_REASON);
	test.skip(CHAIN !== 'testnet', SKIP_TESTNET_ONLY);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');
	test.skip(oracleSkip !== undefined, oracleSkip ?? '');

	test.beforeEach(async ({ freshUserAccount }) => {
		await fundAndActivatePlan(freshUserAccount.address);
	});

	test('R-REFUND-01: the stuck prompt is refunded by the dApp button after the timeout', async ({
		freshChatPage,
		freshPage,
		freshUserAccount,
	}) => {
		test.setTimeout(RESILIENCE_BUDGET.refundTestTimeoutMs);
		const owner = freshUserAccount.address;
		const dashboard = new DashboardPage(freshPage);
		const evidence: Record<string, unknown> = {
			check: 'R-REFUND-01',
			chain: CHAIN,
			account: owner,
		};
		let refundPath: RefundPath | undefined;

		try {
			// 1. Record the balance before the prompt; the window is read from the contract.
			const balanceBefore = await getABLEBalance(TOKEN_ADDRESS, owner);
			const refundTimeoutS = await refundTimeoutSeconds(ESCROW_ADDRESS);
			evidence.tokenBalance = { beforePrompt: balanceBefore };
			evidence.refundTimeoutS = refundTimeoutS;

			// 2. Submit a prompt the oracle will not answer, and confirm the escrow is pending.
			await freshChatPage.goto();
			await freshChatPage.sendPrompt('R-REFUND-01 prompt the oracle will not answer');
			await expect(freshChatPage.cancelButton).toBeVisible({ timeout: BUDGET.ownMessageVisibleMs });

			const payments = await waitForGraph(
				() => getPaymentRecords(owner),
				records => records.some(r => r.status === 'PENDING'),
				{ label: 'pending Payment indexed', timeoutMs: RESILIENCE_BUDGET.indexWaitMs },
			);
			const payment = payments.find((r: PaymentRecord) => r.status === 'PENDING')!;
			const escrowId = BigInt(payment.id);
			const promptReceipt = await receiptOf(payment.txHash);
			const createdAtS = await blockTimestampS(promptReceipt.blockNumber);
			evidence.prompt = {
				txHash: payment.txHash,
				blockNumber: promptReceipt.blockNumber,
				blockTimestampS: createdAtS,
				escrowId,
			};

			const stuckRequests = await waitForGraph(
				() => getPromptRequests(owner),
				requests => requests.some(isPending),
				{ label: 'pending PromptRequest', timeoutMs: RESILIENCE_BUDGET.indexWaitMs },
			);
			const stuck = stuckRequests.find(isPending)!;
			// PromptRequest.id is the answerMessageId (see IndexedPromptRequest in graph.ts); the
			// script fallback passes it to processRefund.
			const answerMessageId = BigInt(stuck.id);
			evidence.promptRequest = { answerMessageId };
			expect(
				await pendingEscrowCount(ESCROW_ADDRESS, owner),
				'escrow pending on chain',
			).toBeGreaterThan(0n);

			// 3. The dashboard raises the stuck-request panel and shows the wait, not the button.
			await dashboard.goto();
			await expect(dashboard.actionRequiredPanel).toBeVisible({
				timeout: RESILIENCE_BUDGET.indexWaitMs,
			});
			await expect(dashboard.stuckRequestRow.first()).toBeVisible();
			await expect(dashboard.refundWaitLabel.first()).toBeVisible();
			await expect(dashboard.refundButton).toHaveCount(0);

			// 4. Wait for the contract's gate (chain time), then the dApp's gate (wall clock).
			const chainTargetS = createdAtS + Number(refundTimeoutS);
			await waitForChainTime({
				targetS: chainTargetS,
				readChainTimeS: latestChainTimeS,
				sleep: sleepMs,
				now: Date.now,
				pollMs: RESILIENCE_BUDGET.refundPollMs,
				timeoutMs: RESILIENCE_BUDGET.refundTestTimeoutMs,
			});
			let readiness = refundReadiness({
				chainTimeS: await latestChainTimeS(),
				createdAtS,
				refundTimeoutS: Number(refundTimeoutS),
				nowMs: Date.now(),
				uiTimeoutMs: REFUND_TIMEOUT_MS,
			});
			while (!readiness.uiReady) {
				await sleepMs(RESILIENCE_BUDGET.refundPollMs);
				readiness = refundReadiness({
					chainTimeS: await latestChainTimeS(),
					createdAtS,
					refundTimeoutS: Number(refundTimeoutS),
					nowMs: Date.now(),
					uiTimeoutMs: REFUND_TIMEOUT_MS,
				});
			}
			evidence.readyAt = {
				chainTimeS: await latestChainTimeS(),
				wallClockMs: Date.now(),
				...readiness,
			};

			// 5. Click the dApp's refund button. The page refetches on its own; it is not reloaded.
			let uiPathOk = false;
			const buttonShown = await dashboard.refundButton
				.first()
				.waitFor({ state: 'visible', timeout: RESILIENCE_BUDGET.refundUiGraceMs })
				.then(
					() => true,
					() => false,
				);
			if (buttonShown) {
				await dashboard.refundButton.first().click();
				uiPathOk = await expect(dashboard.stuckRequestRow)
					.toHaveCount(0, { timeout: RESILIENCE_BUDGET.refundClickGraceMs })
					.then(
						() => true,
						() => false,
					);
			}
			evidence.uiPath = { buttonShown, rowClearedAfterClick: uiPathOk };

			// 6. Did the UI path refund on chain? If not, send the claim Node-side so the window is
			// not lost. Check for an existing refund first, so a slow UI tx is never double-claimed.
			const fromBlock = promptReceipt.blockNumber;
			let refundLog = await waitForRefundLog({
				escrow: ESCROW_ADDRESS,
				escrowId,
				fromBlock,
				// 0 = read the logs once and return: when the UI path was not taken, this only
				// checks for a refund that already landed before the script fallback sends one.
				timeoutMs: uiPathOk ? RESILIENCE_BUDGET.refundClickGraceMs : 0,
				pollMs: RESILIENCE_BUDGET.refundPollMs,
			});
			if (refundLog && uiPathOk) {
				refundPath = 'ui';
			} else {
				let fallbackSent = false;
				if (!refundLog) {
					try {
						evidence.fallbackRefundTxHash = await sendFrom({
							from: owner,
							to: ESCROW_ADDRESS,
							data: processRefundCalldata(answerMessageId),
						});
						fallbackSent = true;
					} catch (err) {
						// A UI claim still in flight settles the escrow first, and this one then
						// reverts. Record that it failed (no message: it can carry an RPC URL) and
						// let the log decide — the UI's transaction is the refund if one is there.
						evidence.fallbackRefundFailed = err instanceof Error ? err.name : 'error';
					}
					refundLog = await waitForRefundLog({
						escrow: ESCROW_ADDRESS,
						escrowId,
						fromBlock,
						timeoutMs: RESILIENCE_BUDGET.refundClickGraceMs,
						pollMs: RESILIENCE_BUDGET.refundPollMs,
					});
				}
				// Without a fallback transaction of ours, the refund on chain is the dApp's.
				refundPath = fallbackSent ? 'script-fallback' : 'ui';
			}
			if (!refundLog) throw new Error('no PaymentRefunded log for this escrow after the refund');
			const refundReceipt = await receiptOf(refundLog.transactionHash);
			evidence.refund = {
				path: refundPath,
				txHash: refundLog.transactionHash,
				blockNumber: refundReceipt.blockNumber,
				blockTimestampS: await blockTimestampS(refundReceipt.blockNumber),
			};

			// 7. Chain state after the refund.
			expect(
				await pendingEscrowCount(ESCROW_ADDRESS, owner),
				'no pending escrow after refund',
			).toBe(0n);
			const balanceAfter = await getABLEBalance(TOKEN_ADDRESS, owner);
			evidence.tokenBalance = { ...(evidence.tokenBalance as object), afterRefund: balanceAfter };
			expect(balanceAfter, 'token balance restored to the pre-prompt value').toBe(balanceBefore);

			// 8. Indexed state: Payment, PromptRequest and the REFUND activity.
			const refundedPayment = await waitForGraph(
				() => getPaymentRecords(owner),
				records => records.some(r => r.id === payment.id && r.status === 'REFUNDED'),
				{ label: 'Payment.status REFUNDED', timeoutMs: RESILIENCE_BUDGET.indexWaitMs },
			);
			expect(refundedPayment.find(r => r.id === payment.id)?.status).toBe('REFUNDED');
			const refundedRequest = await waitForGraph(
				() => getPromptRequests(owner),
				requests => requests.some(r => r.id === stuck.id && r.isRefunded),
				{ label: 'PromptRequest.isRefunded', timeoutMs: RESILIENCE_BUDGET.indexWaitMs },
			);
			expect(refundedRequest.find(r => r.id === stuck.id)?.isRefunded).toBe(true);
			const activity = await waitForGraph(
				() => getActivities(owner),
				acts =>
					acts.some(
						a =>
							a.type === 'REFUND' &&
							a.transactionHash.toLowerCase() === refundLog!.transactionHash.toLowerCase(),
					),
				{ label: 'REFUND activity', timeoutMs: RESILIENCE_BUDGET.indexWaitMs },
			);
			evidence.activity = activity.find(a => a.type === 'REFUND');

			// 9. The UI path is the claim under test. A fallback is recorded and fails it here,
			// after every chain assertion above has already passed.
			expect(
				refundPath,
				'R-REFUND-01 UI path: the dApp refund button must refund without the script fallback',
			).toBe('ui');
		} finally {
			writeResilienceEvidence({
				dir: evidenceDirFrom(process.env),
				name: 'refund',
				evidence: { ...evidence, refundPath },
				secrets: registeredSecrets(),
			});
		}
	});
});

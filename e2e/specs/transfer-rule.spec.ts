import type { Page } from '@playwright/test';
import { toFunctionSelector } from 'viem';

import { expect, test } from '../fixtures';
import { CHAIN, LIVE_STACK } from '../helpers/chain';
import {
	ESCROW_ADDRESS,
	feeTokenUnits,
	fundAndActivatePlan,
	TOKEN_ADDRESS,
} from '../helpers/contracts';
import { assertChainTokenMatchesSetting, feeToken } from '../helpers/feeToken';
import { getPromptRequests, waitForGraph } from '../helpers/graph';
import {
	fundFeeToken,
	getFeeTokenBalance,
	getPromptFee,
	increaseTime,
	processRefund,
} from '../helpers/hardhat';
import { isTransferExempt, setTransferExempt, tryTransfer } from '../helpers/transferRule';

const SKIP_REASON =
	'Skipped: requires Hardhat node + oracle + Graph node (set E2E_LOCAL_SERVICES=1)';
const TRANSFERABLE_REASON =
	'Skipped: the build\'s fee token can be sent between holders (profile "transferable"); ' +
	'the transfer rule applies only to a token that moves to or from listed addresses';
const RESTRICTED_REASON =
	"Skipped: the build's fee token moves only to or from listed addresses (profile not " +
	'"transferable"); the restricted tests below cover it';
const LOCALNET_ONLY_REASON =
	"Localnet only: needs EVM time travel or the token owner's key, neither of which a public chain gives the suite";

// A synthetic, never-funded address standing in for "another holder". Lowercase so viem takes it
// without a checksum.
const OTHER_HOLDER = '0x000000000000000000000000000000000000d00d';
const REFUND_TIMEOUT_S = 3600; // matches EVMAIAgentEscrow REFUND_TIMEOUT

const isPending = (r: { isAnswered: boolean; isCancelled: boolean; isRefunded: boolean }) =>
	!r.isAnswered && !r.isCancelled && !r.isRefunded;

/**
 * Whether the build's token is the restricted kind, read from the profile the app reads. Only
 * asked on a live stack: without one the per-mode env file (and so the setting) may be absent,
 * and every test here skips anyway. The setting alone decides nothing: `beforeAll` below fails
 * the file when the token on chain is not the one the setting names.
 */
const RESTRICTED = LIVE_STACK && !feeToken().transferable;

/**
 * Resolves once the dApp's fee token check has asked the token about both listings (escrow,
 * then treasury), its last reads for a restricted token. A check that read the listing after
 * the escrow was unlisted would switch payments off before the send, and the test is about what
 * the token itself says when the payment reaches it.
 */
function feeTokenCheckFinished(page: Page): Promise<unknown> {
	const selector = toFunctionSelector('isTransferExempt(address)').slice(2);
	let asked = 0;
	return page.waitForResponse(
		response => {
			const body = response.request().postData() ?? '';
			asked += body.split(selector).length - 1;
			return asked >= 2;
		},
		{ timeout: 60_000 },
	);
}

// Each profile's transfer rule, asserted against the chain. A token that moves freely lets a
// holder pay another holder. A token that moves only to or from listed addresses (the escrow, its
// treasury and the token's owner are listed; users are not) refuses that, yet a prompt still pays
// the escrow, a refund still comes back from it, and with the escrow unlisted the payment is
// refused by the token and nothing is taken. Gated on the build's profile, never on a name, and
// the profile is first shown to be the token on chain.
test.describe('Fee token transfer rule (T-XFER)', () => {
	test.skip(!LIVE_STACK, SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');

	// Fails, never skips: an env file naming the other token would otherwise skip every test for
	// the token actually deployed and leave the run green.
	test.beforeAll(async () => {
		await assertChainTokenMatchesSetting(TOKEN_ADDRESS);
	});

	test.describe('on a token that moves freely', () => {
		test.skip(RESTRICTED, RESTRICTED_REASON);

		test('T-XFER-00: a holder can send to another holder', async ({ freshUserAccount }) => {
			const user = freshUserAccount.address;
			await fundFeeToken(TOKEN_ADDRESS, user, feeTokenUnits(1));

			// Asked with eth_call: nothing is sent, no gas is spent, so it runs on a public chain too.
			const outcome = await tryTransfer(TOKEN_ADDRESS, user, OTHER_HOLDER, feeTokenUnits(1));
			expect(
				outcome,
				outcome.refused ? `refused: ${outcome.error ?? outcome.message}` : 'went through',
			).toEqual({ refused: false });
		});
	});

	test.describe('on a token that moves only to or from listed addresses', () => {
		test.skip(!RESTRICTED, TRANSFERABLE_REASON);

		test.beforeEach(async ({ freshUserAccount }) => {
			await fundAndActivatePlan(freshUserAccount.address);
		});

		test('T-XFER-01: a holder cannot send to another holder, yet the same wallet pays for a prompt', async ({
			freshUserAccount,
			freshChatPage,
		}) => {
			const user = freshUserAccount.address;
			// Neither end is listed, so the token has no reason to let it through.
			expect(await isTransferExempt(TOKEN_ADDRESS, user)).toBe(false);
			expect(await isTransferExempt(TOKEN_ADDRESS, OTHER_HOLDER)).toBe(false);

			// Asked with eth_call: nothing is sent, no gas is spent.
			const outcome = await tryTransfer(TOKEN_ADDRESS, user, OTHER_HOLDER, feeTokenUnits(1));
			expect(outcome.refused, 'a holder-to-holder transfer went through').toBe(true);
			if (!outcome.refused) return;
			expect(outcome.error, outcome.message).toBe('TransferNotAllowed');
			if (outcome.args.length === 2) {
				const [from, to] = outcome.args as [string, string];
				expect(from.toLowerCase()).toBe(user.toLowerCase());
				expect(to.toLowerCase()).toBe(OTHER_HOLDER);
			} else {
				// The local node always returns the revert data, so its addresses are compared there. A
				// public node may give only a message naming the error; accepted, and said in the report.
				expect(CHAIN, 'the refusal came without its addresses').toBe('testnet');
				test.info().annotations.push({
					type: 'refusal without data',
					description: 'TransferNotAllowed was named in the message only; from and to not compared',
				});
			}

			// The same wallet pays the escrow, which is listed.
			const fee = await getPromptFee(ESCROW_ADDRESS);
			expect(fee).toBeGreaterThan(0n);
			const before = await getFeeTokenBalance(TOKEN_ADDRESS, user);
			await freshChatPage.goto();
			await freshChatPage.sendPromptAndWaitForResponse('Pay for this prompt from a holder wallet');
			const after = await getFeeTokenBalance(TOKEN_ADDRESS, user);
			expect(before - after).toBe(fee);
		});

		test('T-XFER-02: a refund comes back from the escrow to the user', async ({
			freshUserAccount,
			freshChatPage,
		}) => {
			test.skip(CHAIN === 'testnet', `${LOCALNET_ONLY_REASON} (the real hour is R-REFUND-01)`);
			const user = freshUserAccount.address;
			const before = await getFeeTokenBalance(TOKEN_ADDRESS, user);

			await freshChatPage.goto();
			await freshChatPage.sendDroppedPrompt('Hold this payment so it can be refunded');
			const reqs = await waitForGraph(
				() => getPromptRequests(user),
				r => r.some(isPending),
				{ label: 'pending PromptRequest' },
			);
			const stuck = reqs.find(isPending);
			if (!stuck)
				throw new Error('waitForGraph returned without the pending request it waited for');
			const whileHeld = await getFeeTokenBalance(TOKEN_ADDRESS, user);
			expect(whileHeld).toBeLessThan(before);

			await increaseTime(REFUND_TIMEOUT_S + 1);
			await processRefund(ESCROW_ADDRESS, user, stuck.id);

			// The whole payment is back: escrow to user went through the transfer rule.
			expect(await getFeeTokenBalance(TOKEN_ADDRESS, user)).toBe(before);
		});

		test.describe('with the escrow unlisted', () => {
			// Owner-global state, put back forward-only: no evm_revert, which would freeze the subgraph
			// for every later spec (docs/E2E-ISOLATION-MODEL.md).
			let unlisted = false;
			test.afterAll(async () => {
				if (unlisted) await setTransferExempt(TOKEN_ADDRESS, ESCROW_ADDRESS, true);
			});

			test('T-XFER-03: the token refuses the payment, the composer says so and nothing is taken', async ({
				freshUserAccount,
				freshChatPage,
				freshPage,
			}) => {
				test.skip(CHAIN === 'testnet', LOCALNET_ONLY_REASON);
				const user = freshUserAccount.address;

				const checked = feeTokenCheckFinished(freshPage);
				await freshChatPage.goto();
				await freshChatPage.assertComposerReady();
				await checked;

				const before = await getFeeTokenBalance(TOKEN_ADDRESS, user);
				unlisted = true;
				await setTransferExempt(TOKEN_ADDRESS, ESCROW_ADDRESS, false);
				expect(await isTransferExempt(TOKEN_ADDRESS, ESCROW_ADDRESS)).toBe(false);

				await freshChatPage.sendPrompt('This payment should be refused by the token');

				// The plain refused-payment wording (src/lib/feeTokenRefusal.ts), not a generic failure.
				await expect(freshPage.getByText('Payment Not Accepted').first()).toBeVisible({
					timeout: 30_000,
				});
				await expect(freshPage.getByText(/no tokens were taken/).first()).toBeVisible();
				expect(await getFeeTokenBalance(TOKEN_ADDRESS, user)).toBe(before);

				await setTransferExempt(TOKEN_ADDRESS, ESCROW_ADDRESS, true);
				unlisted = false;
				expect(await isTransferExempt(TOKEN_ADDRESS, ESCROW_ADDRESS)).toBe(true);
			});
		});
	});
});

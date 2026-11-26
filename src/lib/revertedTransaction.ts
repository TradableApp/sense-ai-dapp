/**
 * A transaction that was mined and reverted. thirdweb resolves its receipt like any other
 * (`sendAndConfirmTransaction` waits for the receipt and does not read its status), so the
 * status is read here and anything but `success` is thrown as this error.
 *
 * A reverted receipt carries no revert data, so nothing is known of why: only that the
 * transaction changed nothing on chain but the gas it spent. The words say that and no more.
 */
import { CANCEL_ACTION, REFUND_ACTION } from '@/lib/feeTokenRefusal';

/** The action names the chat and history mutations hand their error handler. */
export const SEND_MESSAGE_ACTION = 'send message';
export const REGENERATE_ACTION = 'regenerate response';
export const BRANCH_ACTION = 'branch conversation';
export const METADATA_ACTION = 'update conversation';

export class TransactionRevertedError extends Error {
	readonly action: string;

	constructor(action: string) {
		super(`The transaction to ${action} was mined but reverted on chain.`);
		this.name = 'TransactionRevertedError';
		this.action = action;
	}
}

/** Throws `TransactionRevertedError` unless the receipt's status is `success`. */
export function throwIfReverted(receipt: { status?: string }, action: string): void {
	if (receipt.status !== 'success') throw new TransactionRevertedError(action);
}

const GAS_ONLY = 'Only the network fee for the transaction was spent.';

const PAID_SEND_REVERTED = {
	title: 'Not Sent',
	description: `The transaction was mined but reverted on chain, so it was not sent and no fee was taken. ${GAS_ONLY}`,
};

const REVERTED_WORDS: Record<string, { title: string; description: string }> = {
	[CANCEL_ACTION]: {
		title: 'Not Cancelled',
		description: `The cancellation was mined but reverted on chain, so nothing was cancelled and no fee was taken. ${GAS_ONLY} The prompt may have been answered meanwhile; if it is still waiting, it can be refunded one hour after it was sent.`,
	},
	[REFUND_ACTION]: {
		title: 'No Refund Paid',
		description: `The refund was mined but reverted on chain, so nothing was refunded. ${GAS_ONLY} The request may have been answered, cancelled or refunded meanwhile.`,
	},
	[METADATA_ACTION]: {
		title: 'Not Changed',
		description: `The change was mined but reverted on chain, so the conversation was not renamed or deleted and no fee was taken. ${GAS_ONLY}`,
	},
	[SEND_MESSAGE_ACTION]: PAID_SEND_REVERTED,
	[REGENERATE_ACTION]: PAID_SEND_REVERTED,
	[BRANCH_ACTION]: PAID_SEND_REVERTED,
};

const REVERTED_FALLBACK = {
	title: 'Transaction Reverted',
	description: `The transaction was mined but reverted on chain, so nothing changed. ${GAS_ONLY}`,
};

/** What the user is told when the transaction for `action` reverted. */
export function revertedMessage(action: string): { title: string; description: string } {
	return REVERTED_WORDS[action] ?? REVERTED_FALLBACK;
}

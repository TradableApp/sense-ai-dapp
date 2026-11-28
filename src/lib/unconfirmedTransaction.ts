/**
 * A transaction that was sent and whose receipt did not come within thirdweb's wait
 * (`waitForReceipt`, a bounded number of blocks). It may still be mined, so it is neither a
 * success nor a failure: the words say it is not confirmed yet and what may still happen.
 */
import { CANCEL_ACTION, REFUND_ACTION } from '@/lib/feeTokenRefusal';
import {
	BRANCH_ACTION,
	METADATA_ACTION,
	REGENERATE_ACTION,
	SEND_MESSAGE_ACTION,
} from '@/lib/revertedTransaction';

/** thirdweb's rejection when no receipt has come within its wait. */
const RECEIPT_NOT_FOUND = /^Transaction receipt for \S+ not found after \d+ blocks/;

/** Whether `error` is thirdweb giving up on a receipt, not the transaction failing. */
export function isReceiptNotFound(error: unknown): boolean {
	return error instanceof Error && RECEIPT_NOT_FOUND.test(error.message);
}

export class TransactionNotConfirmedError extends Error {
	readonly action: string;

	constructor(action: string, cause: unknown) {
		super(`The transaction to ${action} was sent, but its receipt has not come yet.`);
		this.name = 'TransactionNotConfirmedError';
		this.action = action;
		this.cause = cause;
	}
}

/**
 * For a rejected send: rethrows a receipt that did not come as `TransactionNotConfirmedError`
 * for `action`, and any other error as it was.
 */
export function rethrowUnconfirmed(action: string): (_error: unknown) => never {
	return error => {
		throw isReceiptNotFound(error) ? new TransactionNotConfirmedError(action, error) : error;
	};
}

const PAID_SEND_AGAIN =
	'Sending it again would pay again. If it goes through, it will appear in your history.';

const NOT_CONFIRMED_WORDS: Record<string, { title: string; description: string }> = {
	[SEND_MESSAGE_ACTION]: {
		title: 'Send Not Confirmed',
		description: `The prompt was sent but is not confirmed yet and may still go through. ${PAID_SEND_AGAIN}`,
	},
	[REGENERATE_ACTION]: {
		title: 'Send Not Confirmed',
		description: `The request for a new answer was sent but is not confirmed yet and may still go through. ${PAID_SEND_AGAIN}`,
	},
	[BRANCH_ACTION]: {
		title: 'Send Not Confirmed',
		description: `The branch was sent but is not confirmed yet and may still go through. ${PAID_SEND_AGAIN}`,
	},
	[METADATA_ACTION]: {
		title: 'Change Not Confirmed',
		description:
			'The change was sent but is not confirmed yet and may still be applied. Check your wallet; the history shows the change once it syncs.',
	},
	[CANCEL_ACTION]: {
		title: 'Cancel Not Confirmed',
		description:
			'The cancellation was sent but is not confirmed yet, and the prompt may still be cancelled. Check your wallet before cancelling again.',
	},
	[REFUND_ACTION]: {
		title: 'Refund Not Confirmed',
		description:
			'The refund was sent but is not confirmed yet and may still be paid. Check your wallet before claiming it again.',
	},
};

const NOT_CONFIRMED_FALLBACK = {
	title: 'Not Confirmed',
	description: 'The transaction was sent but is not confirmed yet and may still go through.',
};

/** What the user is told when the transaction for `action` was sent and not yet confirmed. */
export function notConfirmedMessage(action: string): { title: string; description: string } {
	return NOT_CONFIRMED_WORDS[action] ?? NOT_CONFIRMED_FALLBACK;
}

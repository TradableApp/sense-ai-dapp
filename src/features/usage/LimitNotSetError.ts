import { describeFailure } from '@/lib/feeTokenCheckFailure';

/**
 * thirdweb's rejection when no receipt has come within its wait (`waitForReceipt`): the
 * transaction was sent and may still be mined.
 */
const RECEIPT_NOT_FOUND = /^Transaction receipt for \S+ not found after \d+ blocks/;

/** Whether `error` is thirdweb giving up on a receipt, not the transaction failing. */
export function isReceiptNotFound(error: unknown): boolean {
	return error instanceof Error && RECEIPT_NOT_FOUND.test(error.message);
}

/**
 * The approval was confirmed and setting the limit then did not finish: it failed, was
 * reverted, or has not been confirmed yet (`isUnconfirmed`). The approval stays on the token,
 * so the user is told what holds and the plan and balance are read again. The agent spends
 * only within a limit on the escrow, so a limit not set leaves any earlier plan as it was;
 * Revoke ends that plan, but the escrow refuses it while a prompt is pending.
 *
 * The guidance comes first and the reason last: the reason is the first line of the error,
 * scrubbed and capped (thirdweb's text runs on with the RPC URL and the call data).
 */
export default class LimitNotSetError extends Error {
	readonly isUnconfirmed: boolean;

	constructor(cause: unknown) {
		const isUnconfirmed = isReceiptNotFound(cause);
		const { line } = describeFailure(cause);
		super(
			isUnconfirmed
				? 'The approval went through and stands. The new limit was sent but is not confirmed yet and may still be set; the plan here will show it once it is.'
				: `The approval went through and stands, but the new limit was not set, so any earlier plan still applies. Set the plan again to finish. To stop spending under an earlier plan, use Revoke once no prompt is pending.${
						line ? ` Reason: ${line}` : ''
				  }`,
		);
		this.name = 'LimitNotSetError';
		this.isUnconfirmed = isUnconfirmed;
		this.cause = cause;
	}
}

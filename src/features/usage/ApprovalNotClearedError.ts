import { describeFailure } from '@/lib/feeTokenCheckFailure';

import { isReceiptNotFound } from './LimitNotSetError';

/** The label of the notice's action that sends the approval of zero again. */
export const REMOVE_APPROVAL_LABEL = 'Remove approval';

/**
 * - `failed`: removing the approval was declined, failed or reverted, so it is still in place;
 * - `unconfirmed`: it was sent and no receipt came in time, so it may still be confirmed;
 * - `unchecked`: the approval left could not be read, so it may still be in place.
 */
export type ApprovalNotClearedKind = 'failed' | 'unconfirmed' | 'unchecked';

const TITLES: Record<ApprovalNotClearedKind, string> = {
	failed: 'Approval Not Removed',
	unconfirmed: 'Removal Not Confirmed',
	unchecked: 'Approval Not Checked',
};

const REVOKED = 'The plan is revoked: its spending limit is cancelled.';

function messageFor(kind: ApprovalNotClearedKind, line: string | undefined): string {
	const reason = line ? ` Reason: ${line}` : '';
	switch (kind) {
		case 'unconfirmed':
			return `${REVOKED} Removing the token approval for the AI agent was sent but is not confirmed yet and may still be confirmed. If your wallet still shows the approval, use ${REMOVE_APPROVAL_LABEL}.`;
		case 'unchecked':
			return `${REVOKED} The token approval for the AI agent could not be checked, so it may still be in place. Use ${REMOVE_APPROVAL_LABEL} to be sure.${reason}`;
		default:
			return `${REVOKED} The token approval for the AI agent is still in place. Use ${REMOVE_APPROVAL_LABEL} to remove it.${reason}`;
	}
}

/**
 * The limit was cancelled and the token approval for the escrow was then not removed, or
 * could not be checked. The plan is gone, so the user is told that, what is left, and is
 * offered the approval of zero again.
 *
 * The guidance comes first and the reason last: the reason is the first line of the error,
 * scrubbed and capped (thirdweb's text runs on with the RPC URL and the call data). A
 * receipt that did not come is told apart from a failure, since it may still be confirmed.
 */
export default class ApprovalNotClearedError extends Error {
	readonly kind: ApprovalNotClearedKind;

	readonly title: string;

	constructor(cause: unknown, isUnchecked = false) {
		const kind: ApprovalNotClearedKind = isUnchecked
			? 'unchecked'
			: isReceiptNotFound(cause)
			? 'unconfirmed'
			: 'failed';
		super(messageFor(kind, describeFailure(cause).line));
		this.name = 'ApprovalNotClearedError';
		this.kind = kind;
		this.title = TITLES[kind];
		this.cause = cause;
	}
}

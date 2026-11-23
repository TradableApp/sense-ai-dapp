import { describeFailure } from '@/lib/feeTokenCheckFailure';

import { isReceiptNotFound } from './LimitNotSetError';

/** The label of the notice's action that sends the approval of zero again. */
export const REMOVE_APPROVAL_LABEL = 'Remove approval';

/**
 * - `failed`: removing the approval was declined, failed or reverted, so it is still in place;
 * - `unconfirmed`: it was sent and no receipt came in time, so it may still be confirmed;
 * - `unchecked`: the approval left could not be read, so it may still be in place;
 * - `account-changed`: the wallet's account changed after the limit was cancelled, so the
 *   removal was not sent (it would have gone from the other account);
 * - `plan-active-again`: after the limit was cancelled, a limit stands again (a plan set from
 *   another tab or device), so the approval is that plan's and the removal was not sent;
 * - `plan-unchecked`: whether a limit stands again could not be read, so the removal was not
 *   sent.
 */
export type ApprovalNotClearedKind =
	| 'failed'
	| 'unconfirmed'
	| 'unchecked'
	| 'account-changed'
	| 'plan-active-again'
	| 'plan-unchecked';

/** The kinds a caller names itself; the others are told from the cause. */
type NamedKind = Exclude<ApprovalNotClearedKind, 'failed' | 'unconfirmed'>;

/**
 * - `revoke`: the second step of a revoke, whose limit was cancelled just before;
 * - `removal`: the removal on its own (from a notice), which revoked no plan.
 */
export type ApprovalNotClearedStep = 'revoke' | 'removal';

const TITLES: Record<ApprovalNotClearedKind, string> = {
	failed: 'Approval Not Removed',
	unconfirmed: 'Removal Not Confirmed',
	unchecked: 'Approval Not Checked',
	'account-changed': 'Account Changed',
	'plan-active-again': 'Plan Active Again',
	'plan-unchecked': 'Plan Not Checked',
};

const REVOKED = 'The plan is revoked: its spending limit is cancelled. ';

function messageFor(
	kind: ApprovalNotClearedKind,
	line: string | undefined,
	step: ApprovalNotClearedStep,
): string {
	const reason = line ? ` Reason: ${line}` : '';
	const opening = step === 'revoke' ? REVOKED : '';
	switch (kind) {
		case 'unconfirmed':
			return `${opening}Removing the token approval for the AI agent was sent but is not confirmed yet and may still be confirmed. If your wallet still shows the approval, use ${REMOVE_APPROVAL_LABEL}.`;
		case 'account-changed':
			return `${opening}The token approval for the AI agent was not removed, because the account changed in your wallet before the second step. Select that account again: the dashboard then offers to remove it.`;
		case 'plan-active-again':
			return 'The plan you revoked is cancelled. A plan is active again on this account, set from another tab or device, so its token approval was left in place for it and nothing more was sent. To remove that plan too, use Revoke on the dashboard.';
		case 'plan-unchecked':
			return `${opening}Whether a new plan was set meanwhile could not be checked, so the token approval for the AI agent was left in place. Use ${REMOVE_APPROVAL_LABEL}: it checks again first and removes the approval only if no plan is active.${reason}`;
		case 'unchecked':
			return `${opening}The token approval for the AI agent could not be checked, so it may still be in place. Use ${REMOVE_APPROVAL_LABEL} to be sure.${reason}`;
		default:
			return `${opening}The token approval for the AI agent is still in place. Use ${REMOVE_APPROVAL_LABEL} to remove it.${reason}`;
	}
}

/**
 * The token approval for the escrow was not removed, or could not be checked. After a revoke
 * the limit was cancelled first, so the user is told the plan is gone, what is left, and is
 * offered the approval of zero again; the removal on its own revoked nothing and says only
 * what is left.
 *
 * The guidance comes first and the reason last: the reason is the first line of the error,
 * scrubbed and capped (thirdweb's text runs on with the RPC URL and the call data). A
 * receipt that did not come is told apart from a failure, since it may still be confirmed.
 */
export default class ApprovalNotClearedError extends Error {
	readonly kind: ApprovalNotClearedKind;

	readonly title: string;

	/** The account the approval is for, so the removal offered again acts only for it. */
	readonly owner: string | undefined;

	constructor(
		cause: unknown,
		named?: NamedKind,
		step: ApprovalNotClearedStep = 'revoke',
		owner?: string,
	) {
		const kind: ApprovalNotClearedKind =
			named ?? (isReceiptNotFound(cause) ? 'unconfirmed' : 'failed');
		super(messageFor(kind, describeFailure(cause).line, step));
		this.name = 'ApprovalNotClearedError';
		this.kind = kind;
		this.title = TITLES[kind];
		this.owner = owner;
		this.cause = cause;
	}
}

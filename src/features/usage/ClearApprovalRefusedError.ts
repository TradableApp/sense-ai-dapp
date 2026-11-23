import { describeFailure } from '@/lib/feeTokenCheckFailure';

/**
 * - `plan-active`: a spending limit stands, so the approval behind it is not removed;
 * - `plan-unchecked`: whether a limit stands could not be read, so nothing was sent;
 * - `account-changed`: the removal was offered by a notice for one account and another is
 *   selected now, so nothing was sent (it would have gone from the other account).
 */
export type ClearApprovalRefusal = 'plan-active' | 'plan-unchecked' | 'account-changed';

const TITLES: Record<ClearApprovalRefusal, string> = {
	'plan-active': 'Plan Is Active',
	'plan-unchecked': 'Plan Not Checked',
	'account-changed': 'Account Changed',
};

const PLAN_ACTIVE =
	'A plan is active, so its token approval was not removed and nothing was sent. To remove it, use Revoke on the dashboard: it cancels the plan, then removes the approval.';

const ACCOUNT_CHANGED =
	'The token approval for the AI agent was not removed and nothing was sent, because another account is selected in your wallet than the one this notice was for. Select that account again: the dashboard then offers to remove it.';

const PLAN_UNCHECKED =
	'Whether a plan is active could not be checked, so nothing was sent. Please try again.';

/**
 * Removing the approval for the escrow was asked for and nothing was sent: an approval of
 * zero under a standing limit would leave the plan unable to pay for any prompt, so the
 * limit is read first. Thrown before anything is built.
 *
 * The reason, when the read failed, is the first line of the error, scrubbed and capped.
 */
export default class ClearApprovalRefusedError extends Error {
	readonly kind: ClearApprovalRefusal;

	readonly title: string;

	/** The account the removal was asked for, so the removal offered again acts only for it. */
	readonly owner: string | undefined;

	constructor(kind: ClearApprovalRefusal, cause?: unknown, owner?: string) {
		const line = cause === undefined ? '' : describeFailure(cause).line;
		const reason = line ? ` Reason: ${line}` : '';
		const messages: Record<ClearApprovalRefusal, string> = {
			'plan-active': PLAN_ACTIVE,
			'plan-unchecked': `${PLAN_UNCHECKED}${reason}`,
			'account-changed': ACCOUNT_CHANGED,
		};
		super(messages[kind]);
		this.name = 'ClearApprovalRefusedError';
		this.kind = kind;
		this.title = TITLES[kind];
		this.owner = owner;
		this.cause = cause;
	}
}

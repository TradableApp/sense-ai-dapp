import { describeFailure } from '@/lib/feeTokenCheckFailure';

/**
 * - `plan-active`: a spending limit stands, so the approval behind it is not removed;
 * - `plan-unchecked`: whether a limit stands could not be read, so nothing was sent.
 */
export type ClearApprovalRefusal = 'plan-active' | 'plan-unchecked';

const TITLES: Record<ClearApprovalRefusal, string> = {
	'plan-active': 'Plan Is Active',
	'plan-unchecked': 'Plan Not Checked',
};

const PLAN_ACTIVE =
	'A plan is active, so its token approval was not removed and nothing was sent. To remove it, use Revoke on the dashboard: it cancels the plan, then removes the approval.';

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

	constructor(kind: ClearApprovalRefusal, cause?: unknown) {
		const line = cause === undefined ? '' : describeFailure(cause).line;
		const reason = line ? ` Reason: ${line}` : '';
		super(kind === 'plan-active' ? PLAN_ACTIVE : `${PLAN_UNCHECKED}${reason}`);
		this.name = 'ClearApprovalRefusedError';
		this.kind = kind;
		this.title = TITLES[kind];
		this.cause = cause;
	}
}

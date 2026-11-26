/**
 * A refund whose transaction succeeded but refunded nothing: the escrow ignores a refund of
 * an id it holds no payment for, without reverting, so success is read from its
 * `PaymentRefunded` event for the id asked for.
 */
export class NothingRefundedError extends Error {
	constructor() {
		super('The refund transaction succeeded but the escrow refunded nothing for this request.');
		this.name = 'NothingRefundedError';
	}
}

export const NOTHING_REFUNDED_MESSAGE = {
	title: 'Nothing Refunded',
	description:
		'The transaction went through, but the escrow refunded no payment for this request, so nothing was refunded. The list of pending requests is read again.',
};

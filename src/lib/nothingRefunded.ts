import { type Abi, decodeEventLog } from 'viem';

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

/** A log as a receipt carries it. */
interface ReceiptLog {
	address: string;
	topics: readonly string[];
	data: string;
}

const REFUND_EVENT = 'PaymentRefunded';

/**
 * Whether the receipt's logs carry `eventName` from the contract at `address` with its `field`
 * equal to `id`. Only a log from that contract that decodes as that event counts: another event
 * with the same field does not, and neither does a log that does not decode. A receipt's
 * `success` alone says the transaction was mined without reverting, not that the contract did
 * what was asked (an account contract can swallow its inner call's failure, and the escrow
 * returns quietly for a refund it holds no payment for), so this is the proof.
 */
export function receiptCarries(
	logs: readonly ReceiptLog[],
	address: string,
	abi: readonly unknown[],
	eventName: string,
	field: string,
	id: number | string | bigint,
): boolean {
	const contract = address.toLowerCase();
	const wanted = BigInt(id);
	return logs.some(log => {
		if (log.address.toLowerCase() !== contract) return false;
		try {
			// The log says which event it is (its first topic); the name is then compared here,
			// since decoding does not refuse a log of another event.
			const decoded = decodeEventLog({
				abi: abi as Abi,
				topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
				data: log.data as `0x${string}`,
			}) as { eventName?: string; args?: Record<string, unknown> };
			return decoded.eventName === eventName && decoded.args?.[field] === wanted;
		} catch {
			return false;
		}
	});
}

/** Whether the receipt's logs carry the escrow's `PaymentRefunded` for `answerMessageId`. */
export function receiptRefunded(
	logs: readonly ReceiptLog[],
	escrowAddress: string,
	escrowAbi: readonly unknown[],
	answerMessageId: number | string,
): boolean {
	return receiptCarries(logs, escrowAddress, escrowAbi, REFUND_EVENT, 'escrowId', answerMessageId);
}

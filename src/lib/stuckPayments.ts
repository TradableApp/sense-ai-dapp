import { REFUND_TIMEOUT_MS } from '@/lib/constants';

/**
 * Which of a wallet's payments are stuck: pending in the subgraph and still held by the
 * escrow. The subgraph is read page by page (a heavy canceller can have more than a page of
 * payments it still lists as pending), and a failed read of the escrow fails the whole
 * answer: leaving that payment out would read as "nothing stuck" and hide money the user can
 * get back.
 */

/** A pending payment as the subgraph lists it. */
export interface PendingPayment {
	id: string;
	amount: string;
	createdAt: string;
}

export interface StuckPayment {
	id: string;
	amount: string;
	/** When it was made, in milliseconds. */
	createdAt: number;
	isRefundable: boolean;
}

/** The subgraph's largest page. */
export const STUCK_PAGE_SIZE = 100;

/** The subgraph refuses a skip past 5,000, so the last page starts there. */
export const STUCK_MAX_PAGES = 5_000 / STUCK_PAGE_SIZE + 1;

/** The escrow's status for a payment it still holds (`EscrowStatus.PENDING`). */
const ESCROW_PENDING = 0;

/** Every pending payment, page by page until a short page or the last page served. */
export async function fetchPendingPayments(
	requestPage: (_skip: number) => Promise<readonly PendingPayment[]>,
): Promise<PendingPayment[]> {
	const pages: PendingPayment[][] = [];
	for (let index = 0; index < STUCK_MAX_PAGES; index += 1) {
		// One page at a time: whether there is a next one depends on this one.
		// eslint-disable-next-line no-await-in-loop
		const page = await requestPage(index * STUCK_PAGE_SIZE);
		pages.push([...page]);
		if (page.length < STUCK_PAGE_SIZE) break;
	}
	return pages.flat();
}

/** The candidates the escrow still holds; rejects if any read fails. */
export async function verifyStuck(
	candidates: readonly PendingPayment[],
	readStatus: (_id: string) => Promise<number>,
	now: number,
): Promise<StuckPayment[]> {
	const statuses = await Promise.all(candidates.map(payment => readStatus(payment.id)));
	return candidates.flatMap((payment, index) => {
		if (statuses[index] !== ESCROW_PENDING) return [];
		const createdAt = Number(payment.createdAt) * 1000;
		return [
			{
				id: payment.id,
				amount: payment.amount,
				createdAt,
				isRefundable: now > createdAt + REFUND_TIMEOUT_MS,
			},
		];
	});
}

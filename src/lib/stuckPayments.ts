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

/**
 * How many escrow reads are out at once. Each is its own call to the node, and a public node
 * answers a burst with 429, which would fail the whole answer.
 */
export const STUCK_VERIFY_BATCH = 20;

/** The escrow's status for a payment it still holds (`EscrowStatus.PENDING`). */
const ESCROW_PENDING = 0;

/** The pending payments read, and how many pages it took. */
export interface PendingPayments {
	payments: PendingPayment[];
	pagesRead: number;
}

/**
 * Every pending payment, page by page until a short page or the last page served. A payment
 * settled between two page reads shifts the next page back, so the same one can be served on
 * two pages: each is listed once, as it was first served.
 */
export async function fetchPendingPayments(
	requestPage: (_skip: number) => Promise<readonly PendingPayment[]>,
): Promise<PendingPayments> {
	const byId = new Map<string, PendingPayment>();
	let pagesRead = 0;
	for (let index = 0; index < STUCK_MAX_PAGES; index += 1) {
		// One page at a time: whether there is a next one depends on this one.
		// eslint-disable-next-line no-await-in-loop
		const page = await requestPage(index * STUCK_PAGE_SIZE);
		pagesRead += 1;
		page.forEach(payment => {
			if (!byId.has(payment.id)) byId.set(payment.id, payment);
		});
		if (page.length < STUCK_PAGE_SIZE) break;
	}
	return { payments: [...byId.values()], pagesRead };
}

/** The candidates the escrow still holds; rejects if any read fails. */
export async function verifyStuck(
	candidates: readonly PendingPayment[],
	readStatus: (_id: string) => Promise<number>,
	now: number,
): Promise<StuckPayment[]> {
	const statuses: number[] = [];
	for (let start = 0; start < candidates.length; start += STUCK_VERIFY_BATCH) {
		const batch = candidates.slice(start, start + STUCK_VERIFY_BATCH);
		// One batch at a time: that is the limit on how many reads are out at once.
		// eslint-disable-next-line no-await-in-loop
		statuses.push(...(await Promise.all(batch.map(payment => readStatus(payment.id)))));
	}
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

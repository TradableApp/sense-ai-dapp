import { isPastRefundWindow } from '@/lib/refund';

/**
 * Which of a wallet's payments are stuck: pending in the subgraph and still held by the
 * escrow for this wallet. The subgraph only says which ids to ask about: whose payment it is,
 * its amount, when it was made and whether it is still held are all read from the escrow. The
 * subgraph is read page by page (a heavy canceller can have more than a page of payments it
 * still lists as pending), and a failed read of the escrow fails the whole answer: leaving
 * that payment out would read as "nothing stuck" and hide money the user can get back.
 */

/** A pending payment as the subgraph lists it. Only its id is used. */
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

/** The escrow's `escrows(id)` entry: `(user, amount, createdAt, status)`, in that order. */
export interface EscrowEntry {
	user: string;
	amount: bigint;
	/** When it was made, in seconds (block time). */
	createdAt: bigint;
	status: number;
}

const isWhole = (value: unknown): value is bigint | number =>
	typeof value === 'bigint' || (typeof value === 'number' && Number.isSafeInteger(value));

/**
 * The escrow's answer for one id, read field by field. Anything else throws, so the read
 * fails (and the query with it) rather than listing a payment from an answer it cannot read.
 */
export function escrowEntryFrom(raw: unknown): EscrowEntry {
	if (!Array.isArray(raw) || raw.length < 4) throw new TypeError('Unexpected escrow entry.');
	const [user, amount, createdAt, status] = raw as unknown[];
	if (typeof user !== 'string' || !isWhole(amount) || !isWhole(createdAt) || !isWhole(status)) {
		throw new TypeError('Unexpected escrow entry.');
	}
	return { user, amount: BigInt(amount), createdAt: BigInt(createdAt), status: Number(status) };
}

/** The largest id the escrow can count to (a `uint256`). */
const MAX_ESCROW_ID = 2n ** 256n - 1n;

/**
 * Whether a row the subgraph served can name a payment: an object whose id is a whole number,
 * in plain digits, that the escrow can count to. The escrow is asked about every row kept, and
 * an id it cannot be asked about would fail that read, and with it the list of every other
 * payment the wallet can get back.
 */
export function namesPayment(row: unknown): row is PendingPayment {
	if (typeof row !== 'object' || row === null) return false;
	const { id } = row as { id?: unknown };
	return typeof id === 'string' && /^\d{1,78}$/.test(id) && BigInt(id) <= MAX_ESCROW_ID;
}

/** The pending payments read, and how many pages it took. */
export interface PendingPayments {
	payments: PendingPayment[];
	pagesRead: number;
}

/**
 * Every pending payment, page by page until a short page or the last page served. A payment
 * settled between two page reads shifts the next page back, so the same one can be served on
 * two pages: each is listed once, as it was first served. A row that can name no payment
 * (`namesPayment`) is left out; a short page is still judged by the rows served.
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
			if (namesPayment(payment) && !byId.has(payment.id)) byId.set(payment.id, payment);
		});
		if (page.length < STUCK_PAGE_SIZE) break;
	}
	return { payments: [...byId.values()], pagesRead };
}

/**
 * The list as it stands at `now`: a payment whose hour (and the margin after it, see
 * `REFUND_UNLOCK_MARGIN_MS`) has passed since the list was read is refundable. One that was
 * refundable when read stays so; one unlocked by `now` stays so only while `now` does not go
 * back, which the caller's clock ensures.
 */
export const refundableAt = (stuck: readonly StuckPayment[], now: number): StuckPayment[] =>
	stuck.map(payment =>
		payment.isRefundable || !isPastRefundWindow(payment.createdAt, now)
			? payment
			: { ...payment, isRefundable: true },
	);

/**
 * The candidates the escrow still holds for `owner` (compared without regard to letter case),
 * with the amount and time made it holds them under; rejects if any read fails. A candidate
 * held for another account is left out: a refund pays the escrow's user, not the caller.
 */
export async function verifyStuck(
	candidates: readonly PendingPayment[],
	readEscrow: (_id: string) => Promise<EscrowEntry>,
	owner: string,
	now: number,
): Promise<StuckPayment[]> {
	const entries: EscrowEntry[] = [];
	for (let start = 0; start < candidates.length; start += STUCK_VERIFY_BATCH) {
		const batch = candidates.slice(start, start + STUCK_VERIFY_BATCH);
		// One batch at a time: that is the limit on how many reads are out at once.
		// eslint-disable-next-line no-await-in-loop
		entries.push(...(await Promise.all(batch.map(payment => readEscrow(payment.id)))));
	}
	const ownerKey = owner.toLowerCase();
	return candidates.flatMap((payment, index) => {
		const entry = entries[index];
		if (entry.status !== ESCROW_PENDING || entry.user.toLowerCase() !== ownerKey) return [];
		const createdAt = Number(entry.createdAt) * 1000;
		return [
			{
				id: payment.id,
				amount: entry.amount.toString(),
				createdAt,
				isRefundable: isPastRefundWindow(createdAt, now),
			},
		];
	});
}

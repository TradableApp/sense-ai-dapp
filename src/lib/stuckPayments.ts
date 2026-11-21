/** A pending payment as the subgraph lists it. */
export interface PendingPayment {
	id: string;
	amount: string;
	createdAt: string;
}

export const STUCK_PAGE_SIZE = 100;
export const STUCK_MAX_PAGES = 0;

export async function fetchPendingPayments(
	_requestPage: (_skip: number) => Promise<readonly PendingPayment[]>,
): Promise<PendingPayment[]> {
	return [];
}

export async function verifyStuck(
	_candidates: readonly PendingPayment[],
	_readStatus: (_id: string) => Promise<number>,
	_now: number,
) {
	return [];
}

import { describe, expect, it, vi } from 'vitest';

import { REFUND_TIMEOUT_MS } from '@/lib/constants';

import {
	fetchPendingPayments,
	type PendingPayment,
	STUCK_MAX_PAGES,
	STUCK_PAGE_SIZE,
	verifyStuck,
} from './stuckPayments';

const payment = (n: number): PendingPayment => ({ id: String(n), amount: '1', createdAt: '100' });
const page = (from: number, count: number) =>
	Array.from({ length: count }, (_, i) => payment(from + i));

describe('the pending payments a wallet has', () => {
	// A heavy canceller can have more than one page; the stuck one may be past the first.
	it('are read page by page past the first hundred', async () => {
		const requestPage = vi.fn(async (skip: number) =>
			skip < 2 * STUCK_PAGE_SIZE ? page(skip, STUCK_PAGE_SIZE) : page(skip, 30),
		);

		const { payments, pagesRead } = await fetchPendingPayments(requestPage);

		expect(payments).toHaveLength(2 * STUCK_PAGE_SIZE + 30);
		expect(pagesRead).toBe(3);
		expect(requestPage.mock.calls.map(([skip]) => skip)).toEqual([
			0,
			STUCK_PAGE_SIZE,
			2 * STUCK_PAGE_SIZE,
		]);
	});

	// The subgraph refuses a skip past 5,000, so the reading stops at a bounded number of pages.
	it('stop at the last page the subgraph serves', async () => {
		const requestPage = vi.fn(async (skip: number) => page(skip, STUCK_PAGE_SIZE));

		await fetchPendingPayments(requestPage);

		expect(requestPage).toHaveBeenCalledTimes(STUCK_MAX_PAGES);
		expect((STUCK_MAX_PAGES - 1) * STUCK_PAGE_SIZE).toBeLessThanOrEqual(5_000);
	});

	it('are not read again once a page is short', async () => {
		const requestPage = vi.fn(async () => page(0, 3));

		const { payments, pagesRead } = await fetchPendingPayments(requestPage);

		expect(payments).toHaveLength(3);
		expect(pagesRead).toBe(1);
		expect(requestPage).toHaveBeenCalledTimes(1);
	});

	// A payment settled between two page reads shifts the next page back by one, so the same
	// payment can be served on both: it is one payment, and one refund.
	it('list a payment served on two pages once', async () => {
		const requestPage = vi.fn(async (skip: number) =>
			skip === 0 ? page(0, STUCK_PAGE_SIZE) : page(STUCK_PAGE_SIZE - 1, 10),
		);

		const { payments } = await fetchPendingPayments(requestPage);

		const ids = payments.map(each => each.id);
		expect(ids).toHaveLength(STUCK_PAGE_SIZE + 9);
		expect(new Set(ids).size).toBe(ids.length);
	});
});

describe('which pending payments are stuck', () => {
	const NOW = 100_000 + REFUND_TIMEOUT_MS + 1;

	it('keeps only those the escrow still holds, refundable after the timeout', async () => {
		const readStatus = vi.fn(async (id: string) => (id === '1' ? 0 : 1));

		const stuck = await verifyStuck([payment(1), payment(2)], readStatus, NOW);

		expect(stuck).toEqual([
			expect.objectContaining({ id: '1', createdAt: 100_000, isRefundable: true }),
		]);
	});

	// A failed read is not "nothing stuck": that would hide a payment the user can get back.
	it('fails when a read of the escrow fails, rather than leaving the payment out', async () => {
		const readStatus = vi.fn(async (id: string) => {
			if (id === '2') throw new Error('rpc down');
			return 0;
		});

		await expect(verifyStuck([payment(1), payment(2)], readStatus, NOW)).rejects.toThrow(
			'rpc down',
		);
	});
});

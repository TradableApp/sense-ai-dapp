import { describe, expect, it } from 'vitest';

import orderCancelPairs from '@/lib/activityOrder';

const TX = '0x5555555555555555555555555555555555555555555555555555555555555555';

const row = (id: string, type: string, timestamp: string) => ({ id, type, timestamp });

describe('orderCancelPairs', () => {
	it('puts a cancel before its returned amount when the subgraph gave them the other way', () => {
		const rows = [
			row(`${TX}-4-return`, 'CANCEL_RETURN', '200'),
			row(`${TX}-4`, 'CANCEL', '200'),
			row(`${TX}-1`, 'CONVERSATION', '100'),
		];

		expect(orderCancelPairs(rows).map(r => r.id)).toEqual([`${TX}-4`, `${TX}-4-return`, `${TX}-1`]);
	});

	it('leaves a pair already in order, and every other row, where it is', () => {
		const rows = [
			row(`${TX}-9`, 'PLAN_UPDATE', '300'),
			row(`${TX}-4`, 'CANCEL', '200'),
			row(`${TX}-4-return`, 'CANCEL_RETURN', '200'),
			row(`${TX}-1`, 'CONVERSATION', '100'),
		];

		expect(orderCancelPairs(rows)).toEqual(rows);
	});

	it('keeps the same-timestamp rows of other actions in the order given', () => {
		const rows = [
			row(`${TX}-6-return`, 'CANCEL_RETURN', '200'),
			row(`${TX}-7`, 'RENAME', '200'),
			row(`${TX}-6`, 'CANCEL', '200'),
		];

		expect(orderCancelPairs(rows).map(r => r.id)).toEqual([`${TX}-7`, `${TX}-6`, `${TX}-6-return`]);
	});

	it('leaves a returned amount whose cancel is not in the page where it is', () => {
		const rows = [
			row(`${TX}-1`, 'CONVERSATION', '300'),
			row(`${TX}-4-return`, 'CANCEL_RETURN', '200'),
		];

		expect(orderCancelPairs(rows)).toEqual(rows);
	});

	it('does not pair a returned amount with a cancel of another time', () => {
		const rows = [row(`${TX}-4-return`, 'CANCEL_RETURN', '201'), row(`${TX}-4`, 'CANCEL', '200')];

		expect(orderCancelPairs(rows)).toEqual(rows);
	});

	it('does not change the array it was given', () => {
		const rows = [row(`${TX}-4-return`, 'CANCEL_RETURN', '200'), row(`${TX}-4`, 'CANCEL', '200')];
		const before = [...rows];

		orderCancelPairs(rows);

		expect(rows).toEqual(before);
	});
});

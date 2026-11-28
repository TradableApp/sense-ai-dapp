import { type AbiEvent, encodeEventTopics, getAbiItem } from 'viem';
import { describe, expect, it } from 'vitest';

import EVMAIAgentEscrowABI from '@/lib/abi/EVMAIAgentEscrow.json';

import { receiptRefunded } from './nothingRefunded';

const ESCROW = '0x00000000000000000000000000000000000000e5';
const ABI = EVMAIAgentEscrowABI.abi;

/** A log of the escrow's event `name` for `escrowId`, as a receipt carries it. */
function escrowLog(name: string, escrowId: bigint, address = ESCROW) {
	const topics = encodeEventTopics({
		abi: [getAbiItem({ abi: ABI, name }) as AbiEvent],
		eventName: name,
		args: { escrowId },
	} as never);
	return { address, topics, data: '0x' } as never;
}

describe('receiptRefunded', () => {
	it('finds the refund of the request asked for, whatever the letter case of the address', () => {
		const logs = [escrowLog('PaymentRefunded', 3n, ESCROW.toUpperCase().replace('0X', '0x'))];

		expect(receiptRefunded(logs, ESCROW, ABI, '3')).toBe(true);
		expect(receiptRefunded(logs, ESCROW, ABI, 3)).toBe(true);
	});

	it.each([
		['no log', []],
		['a refund of another request', [escrowLog('PaymentRefunded', 4n)]],
		['the same event from another contract', [escrowLog('PaymentRefunded', 3n, `0x${'f'.repeat(40)}`)]],
		// Another event of the escrow with the same one field: only the refund counts.
		['a payment finalized for this request', [escrowLog('PaymentFinalized', 3n)]],
		['a log with no topics', [{ address: ESCROW, topics: [], data: '0x' } as never]],
	])('finds none in %s', (_name, logs) => {
		expect(receiptRefunded(logs, ESCROW, ABI, '3')).toBe(false);
	});

	it('finds none, and does not throw, for an id that is not a whole number', () => {
		const logs = [escrowLog('PaymentRefunded', 3n)];

		expect(receiptRefunded(logs, ESCROW, ABI, 'three')).toBe(false);
		expect(receiptRefunded(logs, ESCROW, ABI, '')).toBe(false);
	});
});

import { getContract, readContract } from 'thirdweb';
import type { AbiFunction } from 'viem';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import EVMAIAgentEscrowABI from '@/lib/abi/EVMAIAgentEscrow.json';

import { ESCROW_FEE_GETTERS, type EscrowFeeKind, FeeNotReadError, readEscrowFee } from './escrowFee';

vi.mock('thirdweb', () => ({
	getContract: vi.fn((options: { address: string }) => ({ address: options.address })),
	readContract: vi.fn(),
}));
vi.mock('@/config/thirdweb', () => ({ client: {} }));

const chain = { id: 31337 } as never;
const ESCROW = '0x00000000000000000000000000000000000000e5';
const KINDS = Object.keys(ESCROW_FEE_GETTERS) as EscrowFeeKind[];

beforeEach(() => {
	vi.clearAllMocks();
});

describe('readEscrowFee', () => {
	it.each(KINDS)('reads the %s fee from the escrow with a fixed signature', async kind => {
		vi.mocked(readContract).mockResolvedValue(7n as never);

		await expect(readEscrowFee(chain, ESCROW, kind)).resolves.toBe(7n);

		expect(getContract).toHaveBeenCalledWith(expect.objectContaining({ address: ESCROW }));
		expect(readContract).toHaveBeenCalledWith(
			expect.objectContaining({
				method: `function ${ESCROW_FEE_GETTERS[kind]}() view returns (uint256)`,
				params: [],
			}),
		);
	});

	it('a fee of zero is a fee, not a failed read', async () => {
		vi.mocked(readContract).mockResolvedValue(0n as never);

		await expect(readEscrowFee(chain, ESCROW, 'prompt')).resolves.toBe(0n);
	});

	it.each([undefined, null, '5', 5, {}])(
		'an answer that is not a number (%s) is a failed read, never a fee',
		async answer => {
			vi.mocked(readContract).mockResolvedValue(answer as never);

			await expect(readEscrowFee(chain, ESCROW, 'prompt')).rejects.toBeInstanceOf(
				FeeNotReadError,
			);
		},
	);

	// thirdweb's error text can carry the RPC URL, so only the fact of the failure is kept.
	it('a read that throws is a FeeNotReadError that carries none of the original text', async () => {
		vi.mocked(readContract).mockRejectedValue(new Error('POST https://rpc.example/v2/key-123'));

		const error = await readEscrowFee(chain, ESCROW, 'cancellation').catch(e => e);

		expect(error).toBeInstanceOf(FeeNotReadError);
		expect(String(error.message)).not.toMatch(/rpc\.example|key-123/);
		expect(error.kind).toBe('cancellation');
	});
});

// The reads are found by name on a contract synced from another repository. A renamed getter
// would make every paid send fail before it is sent, so the names are pinned to the real file.
describe('the fee getters the reads depend on', () => {
	it.each(KINDS)('the escrow has the %s fee getter, a view with no inputs returning uint256', kind => {
		const item = (EVMAIAgentEscrowABI.abi as AbiFunction[]).find(
			entry => entry.type === 'function' && entry.name === ESCROW_FEE_GETTERS[kind],
		);

		expect({
			inputs: item?.inputs.map(input => input.type),
			outputs: item?.outputs.map(output => output.type),
			stateMutability: item?.stateMutability,
		}).toEqual({ inputs: [], outputs: ['uint256'], stateMutability: 'view' });
	});

	// The last argument of each paying call is the most the caller agrees to pay.
	it.each([
		['initiatePrompt', 4],
		['initiateRegeneration', 6],
		['initiateBranch', 5],
		['initiateMetadataUpdate', 4],
		['cancelPrompt', 2],
	])('%s takes %i arguments, the last of them _maxFee', (name, count) => {
		const item = (EVMAIAgentEscrowABI.abi as AbiFunction[]).find(
			entry => entry.type === 'function' && entry.name === name,
		);

		expect(item?.inputs).toHaveLength(count);
		expect(item?.inputs.at(-1)).toMatchObject({ name: '_maxFee', type: 'uint256' });
	});
});

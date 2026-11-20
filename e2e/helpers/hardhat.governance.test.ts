// @vitest-environment node
//
// The ownership helpers the governance specs are built on, against a stand-in chain. A spec
// that hands ownership over and back trusts these to send each step from the right account:
// an accept sent by the old owner, or a full move that only offers, leaves the contract with
// a pending owner and every later spec with the wrong one.
import { encodeFunctionData, parseAbi } from 'viem';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const chain = vi.hoisted(() => ({
	rpc: vi.fn(),
	sendFrom: vi.fn(async () => '0xhash'),
}));

vi.mock('./chain', () => ({
	CHAIN: 'localnet',
	rpc: chain.rpc,
	sendFrom: chain.sendFrom,
	getChainConfig: () => ({ chain: 'localnet', rpcUrl: 'http://127.0.0.1:8545' }),
}));

const {
	DEPLOYER_ADDRESS,
	acceptOwnership,
	getOwner,
	getPendingOwner,
	offerOwnership,
	transferOwnership,
} = await import('./hardhat');

const CONTRACT = '0x00000000000000000000000000000000000000c1';
const NEW_OWNER = '0x00000000000000000000000000000000000000a2';
const OTHER_OWNER = '0x00000000000000000000000000000000000000b3';

const OWNABLE = parseAbi([
	'function transferOwnership(address newOwner)',
	'function acceptOwnership()',
	'function pendingOwner() view returns (address)',
	'function owner() view returns (address)',
]);
const OFFER_TO_NEW_OWNER = encodeFunctionData({
	abi: OWNABLE,
	functionName: 'transferOwnership',
	args: [NEW_OWNER],
});
const ACCEPT = encodeFunctionData({ abi: OWNABLE, functionName: 'acceptOwnership' });
const asWord = (address: string) => `0x${address.slice(2).padStart(64, '0')}`;

describe('ownership helpers', () => {
	beforeEach(() => {
		chain.rpc.mockReset();
		chain.sendFrom.mockClear();
	});

	it('offers ownership from the deploy account unless told who the owner is', async () => {
		await offerOwnership(CONTRACT, NEW_OWNER);

		expect(chain.sendFrom.mock.calls).toEqual([
			[{ from: DEPLOYER_ADDRESS, to: CONTRACT, data: OFFER_TO_NEW_OWNER }],
		]);
	});

	it('offers ownership from the owner it is given', async () => {
		await offerOwnership(CONTRACT, NEW_OWNER, OTHER_OWNER);

		expect(chain.sendFrom.mock.calls).toEqual([
			[{ from: OTHER_OWNER, to: CONTRACT, data: OFFER_TO_NEW_OWNER }],
		]);
	});

	it('accepts from the new owner, the only account the contract takes it from', async () => {
		await acceptOwnership(CONTRACT, NEW_OWNER);

		expect(chain.sendFrom.mock.calls).toEqual([[{ from: NEW_OWNER, to: CONTRACT, data: ACCEPT }]]);
	});

	it('moves ownership completely: the offer from the owner, then the accept from the new owner', async () => {
		await transferOwnership(CONTRACT, NEW_OWNER, OTHER_OWNER);

		expect(chain.sendFrom.mock.calls).toEqual([
			[{ from: OTHER_OWNER, to: CONTRACT, data: OFFER_TO_NEW_OWNER }],
			[{ from: NEW_OWNER, to: CONTRACT, data: ACCEPT }],
		]);
	});

	it('does not accept when the offer is refused', async () => {
		chain.sendFrom.mockRejectedValueOnce(new Error('OwnableUnauthorizedAccount'));

		await expect(transferOwnership(CONTRACT, NEW_OWNER, OTHER_OWNER)).rejects.toThrow(
			'OwnableUnauthorizedAccount',
		);
		expect(chain.sendFrom).toHaveBeenCalledTimes(1);
	});

	it('reads the pending owner and the owner with the call each one names', async () => {
		chain.rpc.mockImplementation(async (_method: string, params: [{ data: string }]) =>
			params[0].data === encodeFunctionData({ abi: OWNABLE, functionName: 'pendingOwner' })
				? asWord(NEW_OWNER)
				: asWord(OTHER_OWNER),
		);

		await expect(getPendingOwner(CONTRACT)).resolves.toBe(NEW_OWNER);
		await expect(getOwner(CONTRACT)).resolves.toBe(OTHER_OWNER);
		expect(chain.rpc.mock.calls.map(([method, params]) => [method, params[0].to])).toEqual([
			['eth_call', CONTRACT],
			['eth_call', CONTRACT],
		]);
	});
});

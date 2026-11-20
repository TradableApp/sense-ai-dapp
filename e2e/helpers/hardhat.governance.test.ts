// @vitest-environment node
//
// The ownership helpers the governance specs are built on, against a stand-in chain. A spec
// that hands ownership over and back trusts these to send each step from the right account:
// an accept sent by the old owner, or a full move that only offers, leaves the contract with
// a pending owner and every later spec with the wrong one.
import { encodeFunctionData, parseAbi } from 'viem';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
	acceptOwnership,
	DEPLOYER_ADDRESS,
	getOwner,
	getPendingOwner,
	offerOwnership,
	transferOwnership,
} from './hardhat';

type Chain = typeof import('./chain');

const chain = vi.hoisted(() => ({
	rpc: vi.fn<Chain['rpc']>(),
	sendFrom: vi.fn<Chain['sendFrom']>(async () => '0xhash'),
}));

// Only the two calls that reach the chain are replaced. The rest of the module is the real
// one: other helpers loaded with `./hardhat` use it while they load.
vi.mock('./chain', async importOriginal => ({
	...(await importOriginal<Chain>()),
	CHAIN: 'localnet',
	rpc: chain.rpc,
	sendFrom: chain.sendFrom,
}));

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
const READ_OWNER = encodeFunctionData({ abi: OWNABLE, functionName: 'owner' });
const READ_PENDING_OWNER = encodeFunctionData({ abi: OWNABLE, functionName: 'pendingOwner' });
const asWord = (address: string) => `0x${address.slice(2).padStart(64, '0')}`;

describe('ownership helpers', () => {
	beforeEach(() => {
		chain.rpc.mockReset();
		chain.sendFrom.mockReset();
		chain.sendFrom.mockResolvedValue('0xhash');
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

	it('moves ownership from the deploy account unless told who the owner is', async () => {
		await transferOwnership(CONTRACT, NEW_OWNER);

		expect(chain.sendFrom.mock.calls).toEqual([
			[{ from: DEPLOYER_ADDRESS, to: CONTRACT, data: OFFER_TO_NEW_OWNER }],
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

	it('reads the owner with owner(), at the latest block, and nothing else', async () => {
		chain.rpc.mockResolvedValue(asWord(OTHER_OWNER));

		await expect(getOwner(CONTRACT)).resolves.toBe(OTHER_OWNER);
		expect(chain.rpc.mock.calls).toEqual([
			['eth_call', [{ to: CONTRACT, data: READ_OWNER }, 'latest']],
		]);
	});

	it('reads the pending owner with pendingOwner(), at the latest block, and nothing else', async () => {
		chain.rpc.mockResolvedValue(asWord(NEW_OWNER));

		await expect(getPendingOwner(CONTRACT)).resolves.toBe(NEW_OWNER);
		expect(chain.rpc.mock.calls).toEqual([
			['eth_call', [{ to: CONTRACT, data: READ_PENDING_OWNER }, 'latest']],
		]);
	});
});

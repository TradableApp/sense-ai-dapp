import { keccak256, stringToBytes } from 'viem';
import { describe, expect, it } from 'vitest';

import AbleTokenABI from '@/lib/abi/AbleToken.json';
import EscrowABI from '@/lib/abi/EVMAIAgentEscrow.json';
import SenseTokenABI from '@/lib/abi/SenseToken.json';

import { errorSelector, messageNamesError } from './contractErrorSelector';

// The first four bytes of keccak256 of the error's canonical signature: its name and the
// bare parameter types, with no `error` keyword and no parameter names. That is what a
// node returns as revert data, and the values below are what Solidity emits for each.
const canonical = (signature: string) => keccak256(stringToBytes(signature)).slice(0, 10);

describe('errorSelector', () => {
	it.each([
		[SenseTokenABI.abi, 'TransferNotAllowed', 'TransferNotAllowed(address,address)', '0x8fd7fe1b'],
		[
			AbleTokenABI.abi,
			'ERC20InsufficientBalance',
			'ERC20InsufficientBalance(address,uint256,uint256)',
			'0xe450d38c',
		],
		[EscrowABI.abi, 'NoActiveSpendingLimit', 'NoActiveSpendingLimit()', '0x859a68cc'],
		[SenseTokenABI.abi, 'EnforcedPause', 'EnforcedPause()', '0xd93c0665'],
	])('gives the selector a node returns for %s', (abi, name, signature, selector) => {
		expect(canonical(signature)).toBe(selector);
		expect(errorSelector(abi, name)).toBe(selector);
	});

	it('is undefined for a name the ABI does not declare as an error', () => {
		expect(errorSelector(SenseTokenABI.abi, 'NoSuchError')).toBeUndefined();
		expect(errorSelector(SenseTokenABI.abi, 'transfer')).toBeUndefined();
	});
});

describe('messageNamesError', () => {
	const { abi } = SenseTokenABI;

	it('finds the error by name', () => {
		expect(
			messageNamesError('execution reverted: TransferNotAllowed', abi, 'TransferNotAllowed'),
		).toBe(true);
	});

	it('finds the error by selector alone, as a real node reports one the called contract does not declare', () => {
		const message = 'Encoded error signature "0x8fd7fe1b" not found on ABI.';

		expect(messageNamesError(message, abi, 'TransferNotAllowed')).toBe(true);
	});

	it('finds the selector at the head of raw revert data, whatever its letter case', () => {
		const data = `0x8FD7FE1B${'00'.repeat(64)}`;

		expect(messageNamesError(`reverted with data ${data}`, abi, 'TransferNotAllowed')).toBe(true);
	});

	it('does not mistake another error for it', () => {
		expect(
			messageNamesError('Encoded error signature "0xd93c0665"', abi, 'TransferNotAllowed'),
		).toBe(false);
		expect(messageNamesError('', abi, 'TransferNotAllowed')).toBe(false);
	});
});
